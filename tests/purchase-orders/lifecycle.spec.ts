import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '@src/fixtures/api.fixture';
import type { MovementPage, PurchaseOrder, StockLevel } from '@src/api/types';
import { buildPurchaseOrder } from '@src/data/factories';
import { MISSING_ID, products, purchaseOrders, users, warehouses } from '@src/data/seed';

async function receipts(client: APIRequestContext) {
  const response = await client.get('/movements', { params: { type: 'receipt' } });
  await expect(response).toHaveStatus(200);
  return ((await response.json()) as MovementPage).items;
}

async function mainStock(client: APIRequestContext, productId: number) {
  const response = await client.get(`/warehouses/${warehouses.main.id}/stock/${productId}`);
  await expect(response).toHaveStatus(200);
  return ((await response.json()) as StockLevel).quantity;
}

test.describe('Purchase order lifecycle', () => {
  test('draft → submitted → received adds stock and records receipts @smoke', async ({ clerk }) => {
    const created = (await (
      await clerk.post('/purchase-orders', { data: buildPurchaseOrder() })
    ).json()) as PurchaseOrder;

    const submitted = await clerk.post(`/purchase-orders/${created.id}/submit`);
    await expect(submitted).toHaveStatus(200);
    expect(((await submitted.json()) as PurchaseOrder).status).toBe('submitted');

    const received = await clerk.post(`/purchase-orders/${created.id}/receive`);
    await expect(received).toHaveStatus(200);
    expect(((await received.json()) as PurchaseOrder).status).toBe('received');

    expect(await mainStock(clerk, products.chair.id)).toBe(products.chair.stock.main + 4);
    expect(await mainStock(clerk, products.lamp.id)).toBe(products.lamp.stock.main + 2);
    const movements = await receipts(clerk);
    expect(movements.map((m) => [m.product_id, m.quantity])).toEqual([
      [products.chair.id, 4],
      [products.lamp.id, 2],
    ]);
    expect(
      movements.every((m) => m.reference === created.code && m.to_warehouse_id === warehouses.main.id),
    ).toBe(true);
    expect(movements.every((m) => m.created_by === users.clerk.id)).toBe(true);
  });

  test.describe('POST /purchase-orders/{id}/submit', () => {
    test('submits a draft', async ({ admin }) => {
      const response = await admin.post(`/purchase-orders/${purchaseOrders.draft.id}/submit`);

      await expect(response).toHaveStatus(200);
      expect(((await response.json()) as PurchaseOrder).status).toBe('submitted');
      const persisted = (await (
        await admin.get(`/purchase-orders/${purchaseOrders.draft.id}`)
      ).json()) as PurchaseOrder;
      expect(persisted.status).toBe('submitted');
    });

    for (const order of [purchaseOrders.submitted, purchaseOrders.cancelled]) {
      test(`a ${order.status} order cannot be submitted (409)`, async ({ clerk }) => {
        await expect(await clerk.post(`/purchase-orders/${order.id}/submit`)).toBeApiError(
          409,
          `Cannot move a ${order.status} order to submitted`,
        );
      });
    }
  });

  test.describe('POST /purchase-orders/{id}/receive', () => {
    test('receives the seeded submitted order into its warehouse', async ({ clerk }) => {
      const response = await clerk.post(`/purchase-orders/${purchaseOrders.submitted.id}/receive`);

      await expect(response).toHaveStatus(200);
      expect(((await response.json()) as PurchaseOrder).status).toBe('received');
      expect(await mainStock(clerk, products.spotlight.id)).toBe(products.spotlight.stock.main + 4);
      expect(await receipts(clerk)).toEqual([
        expect.objectContaining({
          type: 'receipt',
          product_id: products.spotlight.id,
          quantity: 4,
          reference: purchaseOrders.submitted.number,
        }),
      ]);
    });

    test('receiving a draft gives 409 and adds no stock', async ({ clerk }) => {
      await expect(await clerk.post(`/purchase-orders/${purchaseOrders.draft.id}/receive`)).toBeApiError(
        409,
        'Cannot move a draft order to received',
      );
      expect(await mainStock(clerk, products.tape.id)).toBe(products.tape.stock.main);
      expect(await receipts(clerk)).toHaveLength(0);
    });

    test('receiving twice gives 409 and does not add stock again', async ({ clerk }) => {
      await expect(await clerk.post(`/purchase-orders/${purchaseOrders.submitted.id}/receive`)).toHaveStatus(
        200,
      );

      await expect(await clerk.post(`/purchase-orders/${purchaseOrders.submitted.id}/receive`)).toBeApiError(
        409,
      );
      expect(await mainStock(clerk, products.spotlight.id)).toBe(products.spotlight.stock.main + 4);
      expect(await receipts(clerk)).toHaveLength(1);
    });

    test('a cancelled order cannot be received (409)', async ({ clerk }) => {
      await expect(await clerk.post(`/purchase-orders/${purchaseOrders.cancelled.id}/receive`)).toBeApiError(
        409,
      );
    });
  });

  test.describe('POST /purchase-orders/{id}/cancel', () => {
    for (const order of [purchaseOrders.draft, purchaseOrders.submitted]) {
      test(`cancels a ${order.status} order`, async ({ clerk }) => {
        const response = await clerk.post(`/purchase-orders/${order.id}/cancel`);

        await expect(response).toHaveStatus(200);
        expect(((await response.json()) as PurchaseOrder).status).toBe('cancelled');
      });
    }

    test('cancelling a cancelled order gives 409', async ({ clerk }) => {
      await expect(await clerk.post(`/purchase-orders/${purchaseOrders.cancelled.id}/cancel`)).toBeApiError(
        409,
        'Cannot move a cancelled order to cancelled',
      );
    });

    test('a received order cannot be cancelled (409)', async ({ clerk }) => {
      await expect(await clerk.post(`/purchase-orders/${purchaseOrders.submitted.id}/receive`)).toHaveStatus(
        200,
      );

      await expect(await clerk.post(`/purchase-orders/${purchaseOrders.submitted.id}/cancel`)).toBeApiError(
        409,
      );
    });

    test('a cancelled order can no longer be edited', async ({ clerk }) => {
      await expect(await clerk.post(`/purchase-orders/${purchaseOrders.draft.id}/cancel`)).toHaveStatus(200);

      await expect(
        await clerk.patch(`/purchase-orders/${purchaseOrders.draft.id}`, { data: { notes: 'x' } }),
      ).toBeApiError(409);
    });
  });

  test.describe('permissions and unknown orders', () => {
    for (const action of ['submit', 'receive', 'cancel'] as const) {
      test(`${action}: a viewer gets 403`, async ({ viewer }) => {
        await expect(
          await viewer.post(`/purchase-orders/${purchaseOrders.submitted.id}/${action}`),
        ).toBeApiError(403);
      });

      test(`${action}: an anonymous caller gets 401`, async ({ request }) => {
        await expect(
          await request.post(`/purchase-orders/${purchaseOrders.submitted.id}/${action}`),
        ).toBeApiError(401);
      });

      test(`${action}: an unknown order gives 404`, async ({ clerk }) => {
        await expect(await clerk.post(`/purchase-orders/${MISSING_ID}/${action}`)).toBeApiError(
          404,
          'not found',
        );
      });
    }
  });
});
