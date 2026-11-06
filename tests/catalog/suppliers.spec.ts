import { test, expect } from '@src/fixtures/api.fixture';
import { MISSING_ID, suppliers } from '@src/data/seed';
import { buildSupplier } from '@src/data/factories';
import type { Supplier, SupplierCursorPage } from '@src/api/types';

/** Extracts the URL of `rel="next"` from a Link header, if any. */
function nextLink(link: string | undefined): string | undefined {
  return link?.match(/<([^>]+)>;\s*rel="next"/)?.[1];
}

test.describe('GET /suppliers', () => {
  test('first page uses the default limit of 2 and offers a next cursor @smoke', async ({ request }) => {
    const response = await request.get('/suppliers');

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as SupplierCursorPage;
    expect(page.limit).toBe(2);
    expect(page.items.map((s) => s.id)).toEqual([suppliers.acme.id, suppliers.northwind.id]);
    expect(page.next_cursor).toEqual(expect.any(String));
    expect(nextLink(response.headers()['link'])).toBeDefined();
  });

  test('walking next_cursor visits every supplier exactly once', async ({ apiKeyClient, request }) => {
    await apiKeyClient.post('/suppliers', { data: buildSupplier() });
    await apiKeyClient.post('/suppliers', { data: buildSupplier() });

    const seen: number[] = [];
    let cursor: string | null = null;
    do {
      const params: Record<string, string | number> = { limit: 2, ...(cursor ? { cursor } : {}) };
      const response = await request.get('/suppliers', { params });
      await expect(response).toHaveStatus(200);
      const page = (await response.json()) as SupplierCursorPage;
      expect(page.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.items.map((s) => s.id));
      cursor = page.next_cursor;
    } while (cursor);

    expect(seen).toHaveLength(5);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  test('following Link rel="next" reaches the last page, which has no Link and a null cursor', async ({
    request,
  }) => {
    const first = await request.get('/suppliers', { params: { limit: 2 } });
    const url = nextLink(first.headers()['link']);
    expect(url).toContain('cursor=');
    expect(url).toContain('limit=2');

    const last = await request.get(url!);

    await expect(last).toHaveStatus(200);
    const page = (await last.json()) as SupplierCursorPage;
    expect(page.items.map((s) => s.id)).toEqual([suppliers.lumen.id]);
    expect(page.next_cursor).toBeNull();
    expect(last.headers()['link']).toBeUndefined();
  });

  test('a limit that covers everything returns one page without a cursor', async ({ request }) => {
    const response = await request.get('/suppliers', { params: { limit: 100 } });

    const page = (await response.json()) as SupplierCursorPage;
    expect(page.items).toHaveLength(Object.keys(suppliers).length);
    expect(page.next_cursor).toBeNull();
  });

  test('filters by country, case-insensitively', async ({ request }) => {
    const response = await request.get('/suppliers', { params: { country: 'uk' } });

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as SupplierCursorPage;
    expect(page.items.map((s) => s.id)).toEqual([suppliers.northwind.id]);
    expect(page.next_cursor).toBeNull();
  });

  test('an unknown country gives an empty page', async ({ request }) => {
    const page = (await (
      await request.get('/suppliers', { params: { country: 'Atlantis' } })
    ).json()) as SupplierCursorPage;

    expect(page.items).toEqual([]);
    expect(page.next_cursor).toBeNull();
  });

  for (const cursor of ['%%%', 'not-a-cursor', Buffer.from('{"after":"x"}').toString('base64url')]) {
    test(`answers 400 for the invalid cursor "${cursor}"`, async ({ request }) => {
      await expect(await request.get('/suppliers', { params: { cursor } })).toBeApiError(
        400,
        'Invalid cursor',
      );
    });
  }

  for (const limit of [0, 101]) {
    test(`answers 422 for limit=${limit}`, async ({ request }) => {
      await expect(await request.get('/suppliers', { params: { limit } })).toHaveValidationErrorFor('limit');
    });
  }
});

test.describe('GET /suppliers/{id}', () => {
  test('returns one supplier', async ({ request }) => {
    const response = await request.get(`/suppliers/${suppliers.lumen.id}`);

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as Supplier).toEqual(expect.objectContaining(suppliers.lumen));
  });

  test('answers 404 for an unknown id', async ({ request }) => {
    await expect(await request.get(`/suppliers/${MISSING_ID}`)).toBeApiError(404, 'not found');
  });
});

test.describe('POST /suppliers', () => {
  test('a valid API key creates a supplier with 201 and Location @smoke', async ({ apiKeyClient }) => {
    const payload = buildSupplier();

    const response = await apiKeyClient.post('/suppliers', { data: payload });

    await expect(response).toHaveStatus(201);
    const created = (await response.json()) as Supplier;
    expect(created).toEqual({ id: expect.any(Number), ...payload });
    expect(response.headers()['location']).toBe(`/suppliers/${created.id}`);
  });

  test('answers 401 without an API key', async ({ request }) => {
    await expect(await request.post('/suppliers', { data: buildSupplier() })).toBeApiError(
      401,
      'Missing X-API-Key',
    );
  });

  test('answers 401 with a wrong API key', async ({ withHeaders }) => {
    const client = await withHeaders({ 'X-API-Key': 'wrong-key' });

    await expect(await client.post('/suppliers', { data: buildSupplier() })).toBeApiError(
      401,
      'Invalid API key',
    );
  });

  test('a Bearer token is not a substitute for the API key', async ({ admin }) => {
    await expect(await admin.post('/suppliers', { data: buildSupplier() })).toHaveStatus(401);
  });

  test('answers 409 for a duplicate name, case-insensitively', async ({ apiKeyClient }) => {
    const response = await apiKeyClient.post('/suppliers', {
      data: buildSupplier({ name: suppliers.acme.name.toLowerCase() }),
    });

    await expect(response).toBeApiError(409, 'already exists');
  });

  test('answers 422 for an invalid email', async ({ apiKeyClient }) => {
    await expect(
      await apiKeyClient.post('/suppliers', { data: buildSupplier({ email: 'not-an-email' }) }),
    ).toHaveValidationErrorFor('email');
  });

  test('answers 422 when name is missing', async ({ apiKeyClient }) => {
    await expect(
      await apiKeyClient.post('/suppliers', { data: { country: 'Chile' } }),
    ).toHaveValidationErrorFor('name');
  });

  test('answers 415 for a non-JSON content type', async ({ apiKeyClient }) => {
    const response = await apiKeyClient.post('/suppliers', {
      headers: { 'Content-Type': 'text/plain' },
      data: JSON.stringify(buildSupplier()),
    });

    await expect(response).toHaveStatus(415);
  });
});

test.describe('PUT /suppliers/{id}', () => {
  test('replaces the whole supplier; omitted fields become null', async ({ apiKeyClient }) => {
    const created = (await (
      await apiKeyClient.post('/suppliers', { data: buildSupplier() })
    ).json()) as Supplier;
    const name = buildSupplier().name;

    const response = await apiKeyClient.put(`/suppliers/${created.id}`, { data: { name } });

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as Supplier).toEqual({
      id: created.id,
      name,
      email: null,
      phone: null,
      country: null,
    });
  });

  test("answers 409 when taking another supplier's name", async ({ apiKeyClient }) => {
    const response = await apiKeyClient.put(`/suppliers/${suppliers.lumen.id}`, {
      data: { name: suppliers.acme.name },
    });

    await expect(response).toBeApiError(409, 'already exists');
  });

  test('answers 404 for an unknown id', async ({ apiKeyClient }) => {
    await expect(await apiKeyClient.put(`/suppliers/${MISSING_ID}`, { data: buildSupplier() })).toBeApiError(
      404,
      'not found',
    );
  });

  test('answers 401 without an API key', async ({ request }) => {
    await expect(
      await request.put(`/suppliers/${suppliers.lumen.id}`, { data: buildSupplier() }),
    ).toHaveStatus(401);
  });
});

test.describe('PATCH /suppliers/{id}', () => {
  test('changes only the given fields', async ({ apiKeyClient }) => {
    const response = await apiKeyClient.patch(`/suppliers/${suppliers.lumen.id}`, {
      data: { phone: '+49 30 1234' },
    });

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as Supplier).toEqual(
      expect.objectContaining({ ...suppliers.lumen, phone: '+49 30 1234' }),
    );
  });

  test('answers 422 when name is set to null', async ({ apiKeyClient }) => {
    await expect(
      await apiKeyClient.patch(`/suppliers/${suppliers.lumen.id}`, { data: { name: null } }),
    ).toBeApiError(422, 'cannot be null');
  });

  test('answers 422 for an invalid email', async ({ apiKeyClient }) => {
    await expect(
      await apiKeyClient.patch(`/suppliers/${suppliers.lumen.id}`, { data: { email: 'nope' } }),
    ).toHaveValidationErrorFor('email');
  });

  test('answers 409 for a duplicate name', async ({ apiKeyClient }) => {
    await expect(
      await apiKeyClient.patch(`/suppliers/${suppliers.lumen.id}`, {
        data: { name: suppliers.northwind.name },
      }),
    ).toBeApiError(409, 'already exists');
  });

  test('answers 401 with a wrong API key', async ({ withHeaders }) => {
    const client = await withHeaders({ 'X-API-Key': 'wrong-key' });

    await expect(
      await client.patch(`/suppliers/${suppliers.lumen.id}`, { data: { phone: '1' } }),
    ).toHaveStatus(401);
  });
});

test.describe('DELETE /suppliers/{id}', () => {
  test('deletes an unused supplier with 204', async ({ apiKeyClient, request }) => {
    const created = (await (
      await apiKeyClient.post('/suppliers', { data: buildSupplier() })
    ).json()) as Supplier;

    await expect(await apiKeyClient.delete(`/suppliers/${created.id}`)).toHaveStatus(204);
    await expect(await request.get(`/suppliers/${created.id}`)).toHaveStatus(404);
  });

  test('answers 409 for a supplier used by products or purchase orders', async ({ apiKeyClient }) => {
    await expect(await apiKeyClient.delete(`/suppliers/${suppliers.acme.id}`)).toBeApiError(
      409,
      'referenced by products or purchase orders',
    );
  });

  test('answers 404 for an unknown id', async ({ apiKeyClient }) => {
    await expect(await apiKeyClient.delete(`/suppliers/${MISSING_ID}`)).toBeApiError(404, 'not found');
  });

  test('answers 401 without an API key', async ({ request }) => {
    await expect(await request.delete(`/suppliers/${suppliers.acme.id}`)).toHaveStatus(401);
  });
});
