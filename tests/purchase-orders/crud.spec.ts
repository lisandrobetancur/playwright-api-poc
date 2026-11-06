import { test, expect } from '@src/fixtures/api.fixture';
import type { PurchaseOrder, PurchaseOrderPage } from '@src/api/types';
import { buildPurchaseOrder } from '@src/data/factories';
import { MISSING_ID, products, purchaseOrders, suppliers, users, warehouses } from '@src/data/seed';

const NEW_ID = 4;

test.describe('GET /purchase-orders', () => {
  test('lists the seeded orders @smoke', async ({ viewer }) => {
    const response = await viewer.get('/purchase-orders');

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as PurchaseOrderPage;
    expect(page).toMatchObject({ total: 3, limit: 10, offset: 0 });
    expect(page.items.map((o) => [o.code, o.status])).toEqual([
      [purchaseOrders.draft.number, 'draft'],
      [purchaseOrders.submitted.number, 'submitted'],
      [purchaseOrders.cancelled.number, 'cancelled'],
    ]);
    expect(response.headers()['x-total-count']).toBe('3');
  });

  test('filters by status', async ({ viewer }) => {
    const response = await viewer.get('/purchase-orders', { params: { status: 'submitted' } });

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as PurchaseOrderPage;
    expect(page.total).toBe(1);
    expect(page.items[0].id).toBe(purchaseOrders.submitted.id);
  });

  test('filters by supplier_id', async ({ viewer }) => {
    const response = await viewer.get('/purchase-orders', { params: { supplier_id: suppliers.lumen.id } });

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as PurchaseOrderPage;
    expect(page.items.map((o) => o.id)).toEqual([purchaseOrders.submitted.id]);
    expect(page.items[0].supplier).toEqual({ id: suppliers.lumen.id, name: suppliers.lumen.name });
  });

  test('paginates with limit and offset', async ({ viewer }) => {
    const response = await viewer.get('/purchase-orders', { params: { limit: 1, offset: 1 } });

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as PurchaseOrderPage;
    expect(page).toMatchObject({ total: 3, limit: 1, offset: 1 });
    expect(page.items.map((o) => o.id)).toEqual([purchaseOrders.submitted.id]);
  });

  test('an unknown status gives 422', async ({ viewer }) => {
    await expect(
      await viewer.get('/purchase-orders', { params: { status: 'lost' } }),
    ).toHaveValidationErrorFor('status');
  });

  test('requires authentication', async ({ request }) => {
    await expect(await request.get('/purchase-orders')).toBeApiError(401);
  });
});

test.describe('GET /purchase-orders/{id}', () => {
  test('returns the draft order with its lines and total', async ({ viewer }) => {
    const response = await viewer.get(`/purchase-orders/${purchaseOrders.draft.id}`);

    await expect(response).toHaveStatus(200);
    const order = (await response.json()) as PurchaseOrder;
    expect(order).toMatchObject({
      id: purchaseOrders.draft.id,
      code: purchaseOrders.draft.number,
      status: 'draft',
      supplier: { id: suppliers.acme.id, name: suppliers.acme.name },
      warehouse_id: warehouses.main.id,
      total: purchaseOrders.draft.total,
    });
    expect(order.lines).toEqual([
      {
        product_id: products.tape.id,
        sku: products.tape.sku,
        quantity: 50,
        unit_cost: 10.5,
        line_total: 525,
      },
      {
        product_id: products.sword.id,
        sku: products.sword.sku,
        quantity: 20,
        unit_cost: 12,
        line_total: 240,
      },
    ]);
  });

  test('an unknown id gives 404', async ({ viewer }) => {
    await expect(await viewer.get(`/purchase-orders/${MISSING_ID}`)).toBeApiError(404, 'not found');
  });

  test('requires authentication', async ({ request }) => {
    await expect(await request.get(`/purchase-orders/${purchaseOrders.draft.id}`)).toBeApiError(401);
  });
});

test.describe('POST /purchase-orders', () => {
  test('creates a draft with a computed total, 201 + Location @smoke', async ({ clerk }) => {
    const body = buildPurchaseOrder({ expected_date: '2027-03-01' });
    const response = await clerk.post('/purchase-orders', { data: body });

    await expect(response).toHaveStatus(201);
    expect(response.headers()['location']).toBe(`/purchase-orders/${NEW_ID}`);
    const order = (await response.json()) as PurchaseOrder;
    expect(order).toMatchObject({
      id: NEW_ID,
      code: 'PO-00004',
      status: 'draft',
      supplier: { id: suppliers.acme.id },
      warehouse_id: warehouses.main.id,
      expected_date: '2027-03-01',
      notes: body.notes,
      total: 4 * 25 + 2 * 40,
      created_by: users.clerk.id,
    });
    expect(order.lines.map((l) => [l.sku, l.line_total])).toEqual([
      [products.chair.sku, 100],
      [products.lamp.sku, 80],
    ]);
  });

  test('the new order can be read back through its Location', async ({ clerk }) => {
    const created = await clerk.post('/purchase-orders', { data: buildPurchaseOrder() });
    const fetched = await clerk.get(created.headers()['location']);

    await expect(fetched).toHaveStatus(200);
    expect(await fetched.json()).toEqual(await created.json());
  });

  test('an admin can create orders', async ({ admin }) => {
    const response = await admin.post('/purchase-orders', { data: buildPurchaseOrder() });

    await expect(response).toHaveStatus(201);
    expect(((await response.json()) as PurchaseOrder).created_by).toBe(users.admin.id);
  });

  test('a viewer gets 403', async ({ viewer }) => {
    await expect(await viewer.post('/purchase-orders', { data: buildPurchaseOrder() })).toBeApiError(403);
  });

  test('an anonymous caller gets 401', async ({ request }) => {
    await expect(await request.post('/purchase-orders', { data: buildPurchaseOrder() })).toBeApiError(401);
  });

  test('a non-JSON content type gives 415', async ({ clerk }) => {
    const response = await clerk.post('/purchase-orders', {
      data: JSON.stringify(buildPurchaseOrder()),
      headers: { 'Content-Type': 'text/plain' },
    });

    await expect(response).toBeApiError(415, 'unsupported media type');
  });

  test.describe('validation', () => {
    test('requires at least one line', async ({ clerk }) => {
      const response = await clerk.post('/purchase-orders', { data: buildPurchaseOrder({ lines: [] }) });

      await expect(response).toHaveValidationErrorFor('lines');
    });

    test('line quantity must be at least 1', async ({ clerk }) => {
      const body = buildPurchaseOrder({
        lines: [{ product_id: products.chair.id, quantity: 0, unit_cost: 1 }],
      });

      await expect(await clerk.post('/purchase-orders', { data: body })).toHaveValidationErrorFor('quantity');
    });

    test('unit cost cannot be negative', async ({ clerk }) => {
      const body = buildPurchaseOrder({
        lines: [{ product_id: products.chair.id, quantity: 1, unit_cost: -1 }],
      });

      await expect(await clerk.post('/purchase-orders', { data: body })).toHaveValidationErrorFor(
        'unit_cost',
      );
    });

    test('supplier_id is required', async ({ clerk }) => {
      const { supplier_id: _omitted, ...body } = buildPurchaseOrder();

      await expect(await clerk.post('/purchase-orders', { data: body })).toHaveValidationErrorFor(
        'supplier_id',
      );
    });

    test('an unknown supplier gives 422', async ({ clerk }) => {
      const response = await clerk.post('/purchase-orders', {
        data: buildPurchaseOrder({ supplier_id: MISSING_ID }),
      });

      await expect(response).toBeApiError(422, `Supplier ${MISSING_ID} does not exist`);
    });

    test('an unknown warehouse gives 422', async ({ clerk }) => {
      const response = await clerk.post('/purchase-orders', {
        data: buildPurchaseOrder({ warehouse_id: MISSING_ID }),
      });

      await expect(response).toBeApiError(422, `Warehouse ${MISSING_ID} does not exist`);
    });

    test('an unknown product gives 422', async ({ clerk }) => {
      const body = buildPurchaseOrder({ lines: [{ product_id: MISSING_ID, quantity: 1, unit_cost: 1 }] });

      await expect(await clerk.post('/purchase-orders', { data: body })).toBeApiError(
        422,
        `Product ${MISSING_ID} does not exist`,
      );
    });

    test('a product may appear only once per order', async ({ clerk }) => {
      const line = { product_id: products.chair.id, quantity: 1, unit_cost: 1 };
      const response = await clerk.post('/purchase-orders', {
        data: buildPurchaseOrder({ lines: [line, line] }),
      });

      await expect(response).toBeApiError(422, 'only once');
    });
  });
});

test.describe('PATCH /purchase-orders/{id}', () => {
  test('edits notes and expected date of a draft', async ({ clerk }) => {
    const response = await clerk.patch(`/purchase-orders/${purchaseOrders.draft.id}`, {
      data: { notes: 'Rush', expected_date: '2027-05-05' },
    });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toMatchObject({
      notes: 'Rush',
      expected_date: '2027-05-05',
      total: purchaseOrders.draft.total,
    });
  });

  test('replacing the lines recomputes the total', async ({ admin }) => {
    const response = await admin.patch(`/purchase-orders/${purchaseOrders.draft.id}`, {
      data: { lines: [{ product_id: products.tape.id, quantity: 10, unit_cost: 2.5 }] },
    });

    await expect(response).toHaveStatus(200);
    const order = (await response.json()) as PurchaseOrder;
    expect(order.lines).toHaveLength(1);
    expect(order.total).toBe(25);
  });

  test('lines cannot be null', async ({ clerk }) => {
    const response = await clerk.patch(`/purchase-orders/${purchaseOrders.draft.id}`, {
      data: { lines: null },
    });

    await expect(response).toBeApiError(422, 'cannot be null');
  });

  for (const order of [purchaseOrders.submitted, purchaseOrders.cancelled]) {
    test(`a ${order.status} order cannot be edited (409)`, async ({ clerk }) => {
      const response = await clerk.patch(`/purchase-orders/${order.id}`, { data: { notes: 'late' } });

      await expect(response).toBeApiError(409, 'Only draft orders can be edited');
    });
  }

  test('an unknown id gives 404', async ({ clerk }) => {
    await expect(await clerk.patch(`/purchase-orders/${MISSING_ID}`, { data: { notes: 'x' } })).toBeApiError(
      404,
    );
  });

  test('a non-JSON content type gives 415', async ({ clerk }) => {
    const response = await clerk.patch(`/purchase-orders/${purchaseOrders.draft.id}`, {
      data: 'notes=x',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });

    await expect(response).toBeApiError(415);
  });

  test('a viewer gets 403', async ({ viewer }) => {
    await expect(
      await viewer.patch(`/purchase-orders/${purchaseOrders.draft.id}`, { data: { notes: 'x' } }),
    ).toBeApiError(403);
  });

  test('an anonymous caller gets 401', async ({ request }) => {
    await expect(
      await request.patch(`/purchase-orders/${purchaseOrders.draft.id}`, { data: { notes: 'x' } }),
    ).toBeApiError(401);
  });
});

test.describe('DELETE /purchase-orders/{id}', () => {
  test('deletes a draft order', async ({ clerk }) => {
    await expect(await clerk.delete(`/purchase-orders/${purchaseOrders.draft.id}`)).toHaveStatus(204);
    await expect(await clerk.get(`/purchase-orders/${purchaseOrders.draft.id}`)).toBeApiError(404);
  });

  for (const order of [purchaseOrders.submitted, purchaseOrders.cancelled]) {
    test(`a ${order.status} order cannot be deleted (409)`, async ({ admin }) => {
      await expect(await admin.delete(`/purchase-orders/${order.id}`)).toBeApiError(
        409,
        'Only draft orders can be deleted',
      );
    });
  }

  test('an unknown id gives 404', async ({ clerk }) => {
    await expect(await clerk.delete(`/purchase-orders/${MISSING_ID}`)).toBeApiError(404);
  });

  test('a viewer gets 403', async ({ viewer }) => {
    await expect(await viewer.delete(`/purchase-orders/${purchaseOrders.draft.id}`)).toBeApiError(403);
  });

  test('an anonymous caller gets 401', async ({ request }) => {
    await expect(await request.delete(`/purchase-orders/${purchaseOrders.draft.id}`)).toBeApiError(401);
  });
});
