import { test, expect } from '@src/fixtures/api.fixture';
import { MISSING_ID, products, warehouses } from '@src/data/seed';
import type { MovementPage, StockIn, StockLevel } from '@src/api/types';
import { getStockLevel, stockEtag } from './helpers';

const W = warehouses.main.id;
const P = products.chair.id;
const path = `/warehouses/${W}/stock/${P}`;
const count = { quantity: 35, reason: 'Cycle count' };

test.describe('PUT /warehouses/{id}/stock/{product_id}', () => {
  test('with a fresh ETag adjusts the quantity and bumps the version @smoke', async ({ clerk }) => {
    const { etag } = await getStockLevel(clerk, W, P);

    const response = await clerk.put(path, { data: count, headers: { 'If-Match': etag } });

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as StockLevel).toEqual(
      expect.objectContaining({ warehouse_id: W, product_id: P, quantity: 35, version: 2 }),
    );
    expect(response.headers()['etag']).toBe(stockEtag(W, P, 2));
    expect((await getStockLevel(clerk, W, P)).level.quantity).toBe(35);
  });

  test('records the difference as an adjustment movement', async ({ clerk }) => {
    const { etag } = await getStockLevel(clerk, W, P);

    await clerk.put(path, { data: count, headers: { 'If-Match': etag } });

    const movements = (await (
      await clerk.get('/movements', { params: { type: 'adjustment', product_id: P } })
    ).json()) as MovementPage;
    expect(movements.items).toHaveLength(1);
    expect(movements.items[0]).toEqual(
      expect.objectContaining({
        type: 'adjustment',
        product_id: P,
        to_warehouse_id: W,
        quantity: count.quantity - products.chair.stock.main,
        note: count.reason,
      }),
    );
  });

  test('admin may adjust stock too', async ({ admin }) => {
    const { etag } = await getStockLevel(admin, W, P);

    await expect(await admin.put(path, { data: count, headers: { 'If-Match': etag } })).toHaveStatus(200);
  });

  test('a level that does not exist yet is adjusted with the version 0 ETag', async ({ clerk }) => {
    const annex = warehouses.annex.id;

    const response = await clerk.put(`/warehouses/${annex}/stock/${products.table.id}`, {
      data: { quantity: 4, reason: 'Found in the annex' },
      headers: { 'If-Match': stockEtag(annex, products.table.id, 0) },
    });

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as StockLevel).toEqual(
      expect.objectContaining({ quantity: 4, version: 1 }),
    );
  });

  test('answers 428 without If-Match', async ({ clerk }) => {
    await expect(await clerk.put(path, { data: count })).toBeApiError(428, 'If-Match header is required');
    expect((await getStockLevel(clerk, W, P)).level.quantity).toBe(products.chair.stock.main);
  });

  test('answers 412 with a stale ETag', async ({ clerk }) => {
    const { etag } = await getStockLevel(clerk, W, P);
    await expect(await clerk.put(path, { data: count, headers: { 'If-Match': etag } })).toHaveStatus(200);

    const stale = await clerk.put(path, {
      data: { quantity: 30, reason: 'Recount' },
      headers: { 'If-Match': etag },
    });

    await expect(stale).toBeApiError(412, 'has changed');
    expect((await getStockLevel(clerk, W, P)).level.quantity).toBe(35);
  });

  test('a concurrent movement makes the old ETag stale', async ({ clerk }) => {
    const { etag } = await getStockLevel(clerk, W, P);
    const delivery: StockIn = { type: 'in', product_id: P, warehouse_id: W, quantity: 5 };
    await expect(await clerk.post('/movements', { data: delivery })).toHaveStatus(201);

    await expect(await clerk.put(path, { data: count, headers: { 'If-Match': etag } })).toHaveStatus(412);

    const fresh = await getStockLevel(clerk, W, P);
    expect(fresh.etag).toBe(stockEtag(W, P, 2));
    await expect(await clerk.put(path, { data: count, headers: { 'If-Match': fresh.etag } })).toHaveStatus(
      200,
    );
  });

  test('answers 403 for the viewer even with a valid ETag', async ({ viewer }) => {
    const { etag } = await getStockLevel(viewer, W, P);

    await expect(await viewer.put(path, { data: count, headers: { 'If-Match': etag } })).toHaveStatus(403);
  });

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(
      await request.put(path, { data: count, headers: { 'If-Match': stockEtag(W, P, 1) } }),
    ).toHaveStatus(401);
  });

  test('answers 404 for an unknown product', async ({ clerk }) => {
    await expect(
      await clerk.put(`/warehouses/${W}/stock/${MISSING_ID}`, {
        data: count,
        headers: { 'If-Match': stockEtag(W, MISSING_ID, 0) },
      }),
    ).toBeApiError(404, 'not found');
  });

  test('answers 404 for an unknown warehouse', async ({ clerk }) => {
    await expect(
      await clerk.put(`/warehouses/${MISSING_ID}/stock/${P}`, {
        data: count,
        headers: { 'If-Match': stockEtag(MISSING_ID, P, 0) },
      }),
    ).toBeApiError(404, 'not found');
  });

  test('answers 422 for a negative quantity', async ({ clerk }) => {
    await expect(
      await clerk.put(path, {
        data: { ...count, quantity: -1 },
        headers: { 'If-Match': stockEtag(W, P, 1) },
      }),
    ).toHaveValidationErrorFor('quantity');
  });

  test('answers 422 without a reason', async ({ clerk }) => {
    await expect(
      await clerk.put(path, { data: { quantity: 10 }, headers: { 'If-Match': stockEtag(W, P, 1) } }),
    ).toHaveValidationErrorFor('reason');
  });

  test('answers 415 for a non-JSON content type', async ({ clerk }) => {
    const response = await clerk.put(path, {
      data: JSON.stringify(count),
      headers: { 'If-Match': stockEtag(W, P, 1), 'Content-Type': 'text/plain' },
    });

    await expect(response).toBeApiError(415, 'application/json');
  });
});
