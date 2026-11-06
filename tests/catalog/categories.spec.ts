import { test, expect } from '@src/fixtures/api.fixture';
import { categories, MISSING_ID } from '@src/data/seed';
import { buildCategory } from '@src/data/factories';
import type { Category } from '@src/api/types';

test.describe('GET /categories', () => {
  test('lists the seeded categories in id order, publicly @smoke', async ({ request }) => {
    const response = await request.get('/categories');

    await expect(response).toHaveStatus(200);
    const body = (await response.json()) as Category[];
    expect(body.map(({ id, name }) => ({ id, name }))).toEqual(Object.values(categories));
  });
});

test.describe('GET /categories/{id}', () => {
  test('returns one category', async ({ request }) => {
    const response = await request.get(`/categories/${categories.lighting.id}`);

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as Category).toEqual(
      expect.objectContaining({ id: categories.lighting.id, name: categories.lighting.name }),
    );
  });

  test('answers 404 for an unknown id', async ({ request }) => {
    await expect(await request.get(`/categories/${MISSING_ID}`)).toBeApiError(404, 'not found');
  });

  test('answers 422 for a non-numeric id', async ({ request }) => {
    await expect(await request.get('/categories/abc')).toHaveValidationErrorFor('category_id');
  });
});

test.describe('POST /categories', () => {
  test('admin creates a category with 201 and Location @smoke', async ({ admin, request }) => {
    const payload = buildCategory();

    const response = await admin.post('/categories', { data: payload });

    await expect(response).toHaveStatus(201);
    const created = (await response.json()) as Category;
    expect(created).toEqual({ id: expect.any(Number), ...payload });
    expect(response.headers()['location']).toBe(`/categories/${created.id}`);
    await expect(await request.get(`/categories/${created.id}`)).toHaveStatus(200);
  });

  test('description is optional and defaults to null', async ({ admin }) => {
    const response = await admin.post('/categories', { data: { name: buildCategory().name } });

    await expect(response).toHaveStatus(201);
    expect(((await response.json()) as Category).description).toBeNull();
  });

  test('answers 409 for a duplicate name, case-insensitively', async ({ admin }) => {
    const response = await admin.post('/categories', {
      data: buildCategory({ name: categories.furniture.name.toUpperCase() }),
    });

    await expect(response).toBeApiError(409, 'already exists');
  });

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(await request.post('/categories', { data: buildCategory() })).toHaveStatus(401);
  });

  for (const role of ['clerk', 'viewer'] as const) {
    test(`answers 403 for the ${role}`, async ({ login, withToken }) => {
      const client = await withToken((await login(role)).access_token);

      await expect(await client.post('/categories', { data: buildCategory() })).toHaveStatus(403);
    });
  }

  test('answers 422 for an empty name', async ({ admin }) => {
    await expect(await admin.post('/categories', { data: { name: '' } })).toHaveValidationErrorFor('name');
  });

  test('answers 422 when name is missing', async ({ admin }) => {
    await expect(
      await admin.post('/categories', { data: { description: 'No name' } }),
    ).toHaveValidationErrorFor('name');
  });

  test('answers 422 for a name longer than 80 characters', async ({ admin }) => {
    await expect(
      await admin.post('/categories', { data: { name: 'x'.repeat(81) } }),
    ).toHaveValidationErrorFor('name');
  });

  test('answers 415 for a non-JSON content type', async ({ admin }) => {
    const response = await admin.post('/categories', {
      headers: { 'Content-Type': 'text/plain' },
      data: JSON.stringify(buildCategory()),
    });

    await expect(response).toBeApiError(415, 'application/json');
  });
});

test.describe('PUT /categories/{id}', () => {
  test('admin replaces a category; omitted description becomes null', async ({ admin }) => {
    const created = (await (await admin.post('/categories', { data: buildCategory() })).json()) as Category;
    const name = buildCategory().name;

    const response = await admin.put(`/categories/${created.id}`, { data: { name } });

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as Category).toEqual({ id: created.id, name, description: null });
  });

  test('keeping its own name is not a conflict', async ({ admin }) => {
    const response = await admin.put(`/categories/${categories.textiles.id}`, {
      data: { name: categories.textiles.name, description: 'Updated' },
    });

    await expect(response).toHaveStatus(200);
    expect(((await response.json()) as Category).description).toBe('Updated');
  });

  test("answers 409 when taking another category's name", async ({ admin }) => {
    const response = await admin.put(`/categories/${categories.textiles.id}`, {
      data: { name: categories.lighting.name },
    });

    await expect(response).toBeApiError(409, 'already exists');
  });

  test('answers 404 for an unknown id', async ({ admin }) => {
    await expect(await admin.put(`/categories/${MISSING_ID}`, { data: buildCategory() })).toBeApiError(
      404,
      'not found',
    );
  });

  test('answers 403 for the clerk', async ({ clerk }) => {
    await expect(
      await clerk.put(`/categories/${categories.textiles.id}`, { data: buildCategory() }),
    ).toHaveStatus(403);
  });

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(
      await request.put(`/categories/${categories.textiles.id}`, { data: buildCategory() }),
    ).toHaveStatus(401);
  });

  test('answers 415 for a non-JSON content type', async ({ admin }) => {
    const response = await admin.put(`/categories/${categories.textiles.id}`, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      data: 'name=Fabric',
    });

    await expect(response).toHaveStatus(415);
  });
});

test.describe('DELETE /categories/{id}', () => {
  test('admin deletes an unused category with 204', async ({ admin, request }) => {
    const created = (await (await admin.post('/categories', { data: buildCategory() })).json()) as Category;

    const response = await admin.delete(`/categories/${created.id}`);

    await expect(response).toHaveStatus(204);
    expect(await response.body()).toHaveLength(0);
    await expect(await request.get(`/categories/${created.id}`)).toHaveStatus(404);
  });

  test('answers 409 for a category that still has products', async ({ admin }) => {
    await expect(await admin.delete(`/categories/${categories.furniture.id}`)).toBeApiError(
      409,
      'still has products',
    );
  });

  test('answers 404 for an unknown id', async ({ admin }) => {
    await expect(await admin.delete(`/categories/${MISSING_ID}`)).toBeApiError(404, 'not found');
  });

  test('answers 403 for the viewer', async ({ viewer }) => {
    await expect(await viewer.delete(`/categories/${categories.furniture.id}`)).toHaveStatus(403);
  });

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(await request.delete(`/categories/${categories.furniture.id}`)).toHaveStatus(401);
  });
});
