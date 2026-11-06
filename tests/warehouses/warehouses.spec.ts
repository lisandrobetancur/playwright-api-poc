import { test, expect } from '@src/fixtures/api.fixture';
import { MISSING_ID, warehouses } from '@src/data/seed';
import { buildWarehouse } from '@src/data/factories';
import type { Warehouse, WarehousePage } from '@src/api/types';

const seededCodes = Object.values(warehouses).map((w) => w.code);

test.describe('GET /warehouses', () => {
  test('lists the seeded warehouses for any role @smoke', async ({ viewer }) => {
    const response = await viewer.get('/warehouses');

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as WarehousePage;
    expect(page.items.map((w) => w.code)).toEqual(seededCodes);
    expect(page).toEqual(expect.objectContaining({ total: 3, limit: 10, offset: 0 }));
    expect(response.headers()['x-total-count']).toBe('3');
  });

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(await request.get('/warehouses')).toHaveStatus(401);
  });

  test('paginates with limit/offset and Link headers', async ({ clerk }) => {
    const response = await clerk.get('/warehouses', { params: { limit: 1, offset: 1 } });

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as WarehousePage;
    expect(page.items.map((w) => w.code)).toEqual([warehouses.stage.code]);
    expect(page.total).toBe(3);
    const link = response.headers()['link'];
    for (const rel of ['first', 'prev', 'next', 'last']) {
      expect(link).toContain(`rel="${rel}"`);
    }
  });

  test('the last page has no rel="next"', async ({ clerk }) => {
    const response = await clerk.get('/warehouses', { params: { limit: 2, offset: 2 } });

    expect(((await response.json()) as WarehousePage).items).toHaveLength(1);
    expect(response.headers()['link']).not.toContain('rel="next"');
  });

  test('filters by active flag', async ({ admin }) => {
    await admin.patch(`/warehouses/${warehouses.annex.id}`, { data: { active: false } });

    const active = (await (
      await admin.get('/warehouses', { params: { active: true } })
    ).json()) as WarehousePage;
    const inactive = (await (
      await admin.get('/warehouses', { params: { active: false } })
    ).json()) as WarehousePage;

    expect(active.items.map((w) => w.code)).toEqual([warehouses.main.code, warehouses.stage.code]);
    expect(inactive.items.map((w) => w.code)).toEqual([warehouses.annex.code]);
    expect(inactive.total).toBe(1);
  });

  for (const [name, value] of [
    ['limit', 0],
    ['limit', 101],
    ['offset', -1],
  ] as const) {
    test(`answers 422 for ${name}=${value}`, async ({ viewer }) => {
      await expect(await viewer.get('/warehouses', { params: { [name]: value } })).toHaveValidationErrorFor(
        name,
      );
    });
  }
});

test.describe('GET /warehouses/{id}', () => {
  test('returns one warehouse', async ({ viewer }) => {
    const response = await viewer.get(`/warehouses/${warehouses.main.id}`);

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as Warehouse).toEqual(expect.objectContaining(warehouses.main));
  });

  test('answers 404 for an unknown id', async ({ viewer }) => {
    await expect(await viewer.get(`/warehouses/${MISSING_ID}`)).toBeApiError(404, 'not found');
  });

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(await request.get(`/warehouses/${warehouses.main.id}`)).toHaveStatus(401);
  });
});

test.describe('POST /warehouses', () => {
  test('admin creates a warehouse with 201 and Location @smoke', async ({ admin }) => {
    const payload = buildWarehouse();

    const response = await admin.post('/warehouses', { data: payload });

    await expect(response).toHaveStatus(201);
    const created = (await response.json()) as Warehouse;
    expect(created).toEqual({ id: expect.any(Number), ...payload });
    expect(response.headers()['location']).toBe(`/warehouses/${created.id}`);
  });

  test('active defaults to true and city to null', async ({ admin }) => {
    const { code, name } = buildWarehouse();

    const response = await admin.post('/warehouses', { data: { code, name } });

    await expect(response).toHaveStatus(201);
    expect((await response.json()) as Warehouse).toEqual(
      expect.objectContaining({ active: true, city: null }),
    );
  });

  test('answers 409 for a duplicate code', async ({ admin }) => {
    await expect(
      await admin.post('/warehouses', { data: buildWarehouse({ code: warehouses.main.code }) }),
    ).toBeApiError(409, 'already exists');
  });

  for (const role of ['clerk', 'viewer'] as const) {
    test(`answers 403 for the ${role}`, async ({ login, withToken }) => {
      const client = await withToken((await login(role)).access_token);

      await expect(await client.post('/warehouses', { data: buildWarehouse() })).toHaveStatus(403);
    });
  }

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(await request.post('/warehouses', { data: buildWarehouse() })).toHaveStatus(401);
  });

  for (const code of ['wh-lower', 'X', 'WH_UNDERSCORE', 'W'.repeat(21)]) {
    test(`answers 422 for the invalid code "${code}"`, async ({ admin }) => {
      await expect(
        await admin.post('/warehouses', { data: buildWarehouse({ code }) }),
      ).toHaveValidationErrorFor('code');
    });
  }

  test('answers 422 when name is missing', async ({ admin }) => {
    await expect(
      await admin.post('/warehouses', { data: { code: buildWarehouse().code } }),
    ).toHaveValidationErrorFor('name');
  });

  test('answers 415 for a non-JSON content type', async ({ admin }) => {
    const response = await admin.post('/warehouses', {
      headers: { 'Content-Type': 'text/plain' },
      data: JSON.stringify(buildWarehouse()),
    });

    await expect(response).toBeApiError(415, 'application/json');
  });
});

test.describe('PATCH /warehouses/{id}', () => {
  test('admin changes only the given fields', async ({ admin }) => {
    const response = await admin.patch(`/warehouses/${warehouses.annex.id}`, {
      data: { city: 'Capital City' },
    });

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as Warehouse).toEqual(
      expect.objectContaining({ ...warehouses.annex, city: 'Capital City', active: true }),
    );
  });

  test('answers 409 when taking another warehouse code', async ({ admin }) => {
    await expect(
      await admin.patch(`/warehouses/${warehouses.annex.id}`, { data: { code: warehouses.main.code } }),
    ).toBeApiError(409, 'already exists');
  });

  for (const field of ['code', 'name', 'active']) {
    test(`answers 422 when ${field} is set to null`, async ({ admin }) => {
      await expect(
        await admin.patch(`/warehouses/${warehouses.annex.id}`, { data: { [field]: null } }),
      ).toBeApiError(422, 'cannot be null');
    });
  }

  test('answers 404 for an unknown id', async ({ admin }) => {
    await expect(await admin.patch(`/warehouses/${MISSING_ID}`, { data: { city: 'X' } })).toBeApiError(
      404,
      'not found',
    );
  });

  test('answers 403 for the clerk', async ({ clerk }) => {
    await expect(
      await clerk.patch(`/warehouses/${warehouses.annex.id}`, { data: { city: 'X' } }),
    ).toHaveStatus(403);
  });

  test('answers 415 for a non-JSON content type', async ({ admin }) => {
    const response = await admin.patch(`/warehouses/${warehouses.annex.id}`, {
      headers: { 'Content-Type': 'text/plain' },
      data: '{"city":"X"}',
    });

    await expect(response).toHaveStatus(415);
  });
});

test.describe('DELETE /warehouses/{id}', () => {
  test('admin deletes the empty WH-ANNEX with 204', async ({ admin }) => {
    const response = await admin.delete(`/warehouses/${warehouses.annex.id}`);

    await expect(response).toHaveStatus(204);
    await expect(await admin.get(`/warehouses/${warehouses.annex.id}`)).toHaveStatus(404);
  });

  test('answers 409 for a warehouse with stock history', async ({ admin }) => {
    await expect(await admin.delete(`/warehouses/${warehouses.main.id}`)).toBeApiError(
      409,
      'has stock history',
    );
  });

  test('answers 404 for an unknown id', async ({ admin }) => {
    await expect(await admin.delete(`/warehouses/${MISSING_ID}`)).toBeApiError(404, 'not found');
  });

  test('answers 403 for the clerk', async ({ clerk }) => {
    await expect(await clerk.delete(`/warehouses/${warehouses.annex.id}`)).toHaveStatus(403);
  });

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(await request.delete(`/warehouses/${warehouses.annex.id}`)).toHaveStatus(401);
  });
});
