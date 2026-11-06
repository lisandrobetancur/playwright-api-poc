import { test, expect } from '@src/fixtures/api.fixture';
import type { Movement } from '@src/api/types';
import { MISSING_ID, products, users, warehouses } from '@src/data/seed';

test.describe('GET /movements/{id}', () => {
  test('returns a seeded opening movement @smoke', async ({ viewer }) => {
    const response = await viewer.get('/movements/1');

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as Movement).toEqual({
      id: 1,
      type: 'in',
      product_id: products.chair.id,
      from_warehouse_id: null,
      to_warehouse_id: warehouses.main.id,
      quantity: products.chair.stock.main,
      reference: 'OPENING',
      note: 'Opening balance',
      created_by: users.admin.id,
      created_at: '2026-01-01T00:00:00',
    });
  });

  test('an unknown id gives 404', async ({ viewer }) => {
    await expect(await viewer.get(`/movements/${MISSING_ID}`)).toBeApiError(404, 'not found');
  });

  test('a non-numeric id gives 422', async ({ viewer }) => {
    await expect(await viewer.get('/movements/abc')).toHaveValidationErrorFor('movement_id');
  });

  test('requires authentication', async ({ request }) => {
    await expect(await request.get('/movements/1')).toBeApiError(401);
  });
});

test.describe('Movements are immutable', () => {
  test('PUT /movements/{id} gives 405', async ({ admin }) => {
    const response = await admin.put('/movements/1', { data: { quantity: 1 } });

    await expect(response).toHaveStatus(405);
    expect(response.headers()['allow']).toBe('GET');
  });

  test('PATCH /movements/{id} gives 405', async ({ admin }) => {
    await expect(await admin.patch('/movements/1', { data: { quantity: 1 } })).toHaveStatus(405);
  });

  test('DELETE /movements/{id} gives 405 and the movement survives', async ({ admin }) => {
    await expect(await admin.delete('/movements/1')).toHaveStatus(405);
    await expect(await admin.get('/movements/1')).toHaveStatus(200);
  });
});
