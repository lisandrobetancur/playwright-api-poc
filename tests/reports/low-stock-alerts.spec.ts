import { test, expect } from '@src/fixtures/api.fixture';
import type { LowStockAlert } from '@src/api/types';
import { MISSING_ID, products, warehouses } from '@src/data/seed';

const ids = (alerts: LowStockAlert[]) => alerts.map((alert) => alert.product_id);

test.describe('GET /alerts/low-stock', () => {
  test('lists the active products at or below their reorder level @smoke', async ({ viewer }) => {
    const response = await viewer.get('/alerts/low-stock');

    await expect(response).toHaveStatus(200);
    const alerts = (await response.json()) as LowStockAlert[];
    expect(ids(alerts)).toEqual([products.spotlight.id, products.tape.id]);
  });

  test('reports the total quantity and the shortage of each product', async ({ viewer }) => {
    const alerts = (await (await viewer.get('/alerts/low-stock')).json()) as LowStockAlert[];

    expect(alerts).toEqual([
      expect.objectContaining({
        product_id: products.spotlight.id,
        sku: products.spotlight.sku,
        warehouse_id: null,
        quantity: 4,
        reorder_level: 4,
        shortage: 0, // exactly at the threshold still counts
      }),
      expect.objectContaining({
        product_id: products.tape.id,
        sku: products.tape.sku,
        warehouse_id: null,
        quantity: 25,
        reorder_level: 30,
        shortage: 5,
      }),
    ]);
  });

  test('never includes the inactive product', async ({ viewer }) => {
    const alerts = (await (await viewer.get('/alerts/low-stock')).json()) as LowStockAlert[];

    expect(ids(alerts)).not.toContain(products.bookSet.id);
  });

  test('?warehouse_id compares only the stock held in that warehouse', async ({ viewer }) => {
    const response = await viewer.get('/alerts/low-stock', { params: { warehouse_id: warehouses.main.id } });

    await expect(response).toHaveStatus(200);
    const alerts = (await response.json()) as LowStockAlert[];
    // MAIN: spotlight 3 <= 4, sword 8 <= 10, tape 25 <= 30.
    expect(ids(alerts)).toEqual([products.spotlight.id, products.sword.id, products.tape.id]);
    for (const alert of alerts) expect(alert.warehouse_id).toBe(warehouses.main.id);
    expect(alerts.find((alert) => alert.product_id === products.sword.id)).toMatchObject({
      quantity: 8,
      shortage: 2,
    });
  });

  test('an empty warehouse flags every active product with a reorder level', async ({ viewer }) => {
    const response = await viewer.get('/alerts/low-stock', { params: { warehouse_id: warehouses.annex.id } });

    const alerts = (await response.json()) as LowStockAlert[];
    expect(ids(alerts)).toEqual([1, 2, 3, 4, 5, 6, 8]);
    for (const alert of alerts) expect(alert).toMatchObject({ quantity: 0, shortage: alert.reorder_level });
  });

  test('an unknown warehouse gives 404', async ({ viewer }) => {
    const response = await viewer.get('/alerts/low-stock', { params: { warehouse_id: MISSING_ID } });

    await expect(response).toBeApiError(404, 'not found');
  });

  test('a non-numeric warehouse_id gives 422', async ({ viewer }) => {
    const response = await viewer.get('/alerts/low-stock', { params: { warehouse_id: 'main' } });

    await expect(response).toHaveValidationErrorFor('warehouse_id');
  });

  test('a stock movement can clear an alert', async ({ clerk, viewer }) => {
    const movement = await clerk.post('/movements', {
      data: { type: 'in', product_id: products.tape.id, warehouse_id: warehouses.main.id, quantity: 10 },
    });
    await expect(movement).toHaveStatus(201);

    const alerts = (await (await viewer.get('/alerts/low-stock')).json()) as LowStockAlert[];
    expect(ids(alerts)).toEqual([products.spotlight.id]);
  });

  test('every role may read the alerts', async ({ admin, clerk, viewer }) => {
    for (const client of [admin, clerk, viewer]) {
      await expect(await client.get('/alerts/low-stock')).toHaveStatus(200);
    }
  });

  test('anonymous callers get 401', async ({ request }) => {
    await expect(await request.get('/alerts/low-stock')).toBeApiError(401);
  });
});
