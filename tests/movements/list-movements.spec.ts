import { test, expect } from '@src/fixtures/api.fixture';
import type { MovementPage, StockOut, StockTransfer } from '@src/api/types';
import { MOVEMENT_COUNT, products, warehouses } from '@src/data/seed';
import { AFTER_SEED } from './helpers';

test.describe('GET /movements', () => {
  test('lists the seeded opening movements with pagination headers @smoke', async ({ viewer }) => {
    const response = await viewer.get('/movements');

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as MovementPage;
    expect(page).toMatchObject({ total: MOVEMENT_COUNT, limit: 10, offset: 0 });
    expect(page.items).toHaveLength(10);
    expect(page.items.map((m) => m.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(page.items.every((m) => m.type === 'in' && m.reference === 'OPENING')).toBe(true);
    expect(response.headers()['x-total-count']).toBe(String(MOVEMENT_COUNT));
    expect(response.headers()['link']).toContain('rel="next"');
  });

  test('limit and offset select a page', async ({ viewer }) => {
    const response = await viewer.get('/movements', { params: { limit: 5, offset: 10 } });

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as MovementPage;
    expect(page).toMatchObject({ total: MOVEMENT_COUNT, limit: 5, offset: 10 });
    expect(page.items.map((m) => m.id)).toEqual([11]);
    expect(response.headers()['link']).toContain('rel="prev"');
    expect(response.headers()['link']).not.toContain('rel="next"');
  });

  test('sort=-id returns the newest movement first', async ({ viewer }) => {
    const response = await viewer.get('/movements', { params: { sort: '-id', limit: 3 } });

    await expect(response).toHaveStatus(200);
    expect(((await response.json()) as MovementPage).items.map((m) => m.id)).toEqual([11, 10, 9]);
  });

  test('filters by product_id', async ({ viewer }) => {
    const response = await viewer.get('/movements', { params: { product_id: products.chair.id } });

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as MovementPage;
    expect(page.total).toBe(2);
    expect(page.items.every((m) => m.product_id === products.chair.id)).toBe(true);
  });

  test('filters by warehouse_id, matching both source and destination', async ({ clerk }) => {
    const transfer: StockTransfer = {
      type: 'transfer',
      product_id: products.curtain.id,
      from_warehouse_id: warehouses.main.id,
      to_warehouse_id: warehouses.stage.id,
      quantity: 5,
    };
    await expect(await clerk.post('/movements', { data: transfer })).toHaveStatus(201);

    for (const warehouse of [warehouses.main, warehouses.stage]) {
      const response = await clerk.get('/movements', {
        params: { warehouse_id: warehouse.id, type: 'transfer' },
      });
      await expect(response).toHaveStatus(200);
      expect(((await response.json()) as MovementPage).total).toBe(1);
    }
  });

  test('the stage warehouse has four opening movements', async ({ viewer }) => {
    const response = await viewer.get('/movements', { params: { warehouse_id: warehouses.stage.id } });

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as MovementPage;
    expect(page.total).toBe(4);
    expect(page.items.every((m) => m.to_warehouse_id === warehouses.stage.id)).toBe(true);
  });

  test('filters by type', async ({ clerk }) => {
    const out: StockOut = {
      type: 'out',
      product_id: products.chair.id,
      warehouse_id: warehouses.main.id,
      quantity: 1,
    };
    await expect(await clerk.post('/movements', { data: out })).toHaveStatus(201);

    const outs = (await (await clerk.get('/movements', { params: { type: 'out' } })).json()) as MovementPage;
    expect(outs.total).toBe(1);
    expect(outs.items[0]).toMatchObject({ type: 'out', product_id: products.chair.id });

    const ins = (await (await clerk.get('/movements', { params: { type: 'in' } })).json()) as MovementPage;
    expect(ins.total).toBe(MOVEMENT_COUNT);
  });

  test('from/to restrict by creation time', async ({ clerk }) => {
    const out: StockOut = {
      type: 'out',
      product_id: products.chair.id,
      warehouse_id: warehouses.main.id,
      quantity: 1,
    };
    await expect(await clerk.post('/movements', { data: out })).toHaveStatus(201);

    const recent = (await (
      await clerk.get('/movements', { params: { from: AFTER_SEED } })
    ).json()) as MovementPage;
    expect(recent.items.map((m) => m.id)).toEqual([MOVEMENT_COUNT + 1]);

    const seeded = (await (
      await clerk.get('/movements', { params: { from: '2026-01-01T00:00:00', to: '2026-01-01T00:00:00' } })
    ).json()) as MovementPage;
    expect(seeded.total).toBe(MOVEMENT_COUNT);
  });

  test('from later than to gives 400', async ({ viewer }) => {
    const response = await viewer.get('/movements', {
      params: { from: '2027-01-01T00:00:00', to: '2026-01-01T00:00:00' },
    });

    await expect(response).toBeApiError(400, "'from' must be earlier than 'to'");
  });

  test('rejects invalid query parameters with 422', async ({ viewer }) => {
    await expect(await viewer.get('/movements', { params: { type: 'teleport' } })).toHaveValidationErrorFor(
      'type',
    );
    await expect(await viewer.get('/movements', { params: { sort: 'quantity' } })).toHaveValidationErrorFor(
      'sort',
    );
    await expect(await viewer.get('/movements', { params: { limit: 101 } })).toHaveValidationErrorFor(
      'limit',
    );
    await expect(await viewer.get('/movements', { params: { offset: -1 } })).toHaveValidationErrorFor(
      'offset',
    );
    await expect(await viewer.get('/movements', { params: { from: 'yesterday' } })).toHaveValidationErrorFor(
      'from',
    );
  });

  test('requires authentication', async ({ request }) => {
    const response = await request.get('/movements');

    await expect(response).toBeApiError(401);
    expect(response.headers()['www-authenticate']).toBeTruthy();
  });
});
