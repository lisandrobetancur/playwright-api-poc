import { test, expect } from '@src/fixtures/api.fixture';
import type { PurchaseOrder, PurchaseOrderPage } from '@src/api/types';
import { buildPurchaseOrder } from '@src/data/factories';
import { warehouses } from '@src/data/seed';

const SEEDED_ORDERS = 3;

test.describe('POST /purchase-orders with Idempotency-Key', () => {
  test('the same key and body replays the first response without a duplicate @smoke', async ({ clerk }) => {
    const body = buildPurchaseOrder();
    const headers = { 'Idempotency-Key': 'po-replay-1' };

    const first = await clerk.post('/purchase-orders', { data: body, headers });
    const second = await clerk.post('/purchase-orders', { data: body, headers });

    await expect(first).toHaveStatus(201);
    expect(first.headers()['idempotency-replayed']).toBeUndefined();
    await expect(second).toHaveStatus(201);
    expect(second.headers()['idempotency-replayed']).toBe('true');
    expect(second.headers()['location']).toBe(first.headers()['location']);
    expect((await second.json()) as PurchaseOrder).toEqual(await first.json());

    const page = (await (await clerk.get('/purchase-orders')).json()) as PurchaseOrderPage;
    expect(page.total).toBe(SEEDED_ORDERS + 1);
  });

  test('the same key with another body gives 422', async ({ clerk }) => {
    const headers = { 'Idempotency-Key': 'po-replay-2' };
    const body = buildPurchaseOrder({ warehouse_id: warehouses.main.id });
    await expect(await clerk.post('/purchase-orders', { data: body, headers })).toHaveStatus(201);

    const response = await clerk.post('/purchase-orders', {
      data: { ...body, warehouse_id: warehouses.stage.id },
      headers,
    });

    await expect(response).toBeApiError(422, 'different request body');
    const page = (await (await clerk.get('/purchase-orders')).json()) as PurchaseOrderPage;
    expect(page.total).toBe(SEEDED_ORDERS + 1);
  });

  test('different keys create different orders', async ({ clerk }) => {
    const body = buildPurchaseOrder();
    const first = await clerk.post('/purchase-orders', {
      data: body,
      headers: { 'Idempotency-Key': 'po-a' },
    });
    const second = await clerk.post('/purchase-orders', {
      data: body,
      headers: { 'Idempotency-Key': 'po-b' },
    });

    await expect(second).toHaveStatus(201);
    expect(second.headers()['idempotency-replayed']).toBeUndefined();
    expect(((await second.json()) as PurchaseOrder).id).not.toBe(((await first.json()) as PurchaseOrder).id);
  });

  test('without a key, repeating the request creates a duplicate', async ({ clerk }) => {
    const body = buildPurchaseOrder();
    await expect(await clerk.post('/purchase-orders', { data: body })).toHaveStatus(201);
    await expect(await clerk.post('/purchase-orders', { data: body })).toHaveStatus(201);

    const page = (await (await clerk.get('/purchase-orders')).json()) as PurchaseOrderPage;
    expect(page.total).toBe(SEEDED_ORDERS + 2);
  });

  test('keys are scoped per user', async ({ admin, clerk }) => {
    const body = buildPurchaseOrder();
    const headers = { 'Idempotency-Key': 'po-shared' };
    await expect(await clerk.post('/purchase-orders', { data: body, headers })).toHaveStatus(201);

    const byAdmin = await admin.post('/purchase-orders', { data: body, headers });

    await expect(byAdmin).toHaveStatus(201);
    expect(byAdmin.headers()['idempotency-replayed']).toBeUndefined();
  });

  test('the key is forgotten after a reset', async ({ request, login, withToken }) => {
    const body = buildPurchaseOrder();
    const headers = { 'Idempotency-Key': 'po-reset' };
    const before = await withToken((await login('clerk')).access_token);
    await expect(await before.post('/purchase-orders', { data: body, headers })).toHaveStatus(201);

    await expect(await request.post('/__reset')).toHaveStatus(200);
    const after = await withToken((await login('clerk')).access_token);
    const response = await after.post('/purchase-orders', {
      data: { ...body, notes: 'other body' },
      headers,
    });

    await expect(response).toHaveStatus(201);
    expect(response.headers()['idempotency-replayed']).toBeUndefined();
  });

  test('a key longer than 255 characters gives 400', async ({ clerk }) => {
    const response = await clerk.post('/purchase-orders', {
      data: buildPurchaseOrder(),
      headers: { 'Idempotency-Key': 'k'.repeat(256) },
    });

    await expect(response).toBeApiError(400, 'Idempotency-Key');
  });
});
