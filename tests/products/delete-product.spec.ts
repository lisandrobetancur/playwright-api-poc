import { test, expect } from '@src/fixtures/api.fixture';
import type { Product } from '@src/api/types';
import { MISSING_ID, PRODUCT_COUNT, products } from '@src/data/seed';
import { buildProduct, buildPurchaseOrder } from '@src/data/factories';

const bookSet = products.bookSet;

test.describe('DELETE /products/{id}', () => {
  test('admin deletes a product without history: 204 @smoke', async ({ admin, request }) => {
    const response = await admin.delete(`/products/${bookSet.id}`);

    await expect(response).toHaveStatus(204);
    expect(await response.body()).toHaveLength(0);
    await expect(await request.get(`/products/${bookSet.id}`)).toHaveStatus(404);
    expect((await request.head('/products')).headers()['x-total-count']).toBe(String(PRODUCT_COUNT - 1));
  });

  test('deleting twice gives 404 the second time', async ({ admin }) => {
    await admin.delete(`/products/${bookSet.id}`);
    const response = await admin.delete(`/products/${bookSet.id}`);
    await expect(response).toBeApiError(404, 'not found');
  });

  test('a freshly created product can be deleted', async ({ admin }) => {
    const created = (await (await admin.post('/products', { data: buildProduct() })).json()) as Product;
    await expect(await admin.delete(`/products/${created.id}`)).toHaveStatus(204);
  });

  test('a product with stock movements is a 409', async ({ admin }) => {
    const response = await admin.delete(`/products/${products.chair.id}`);
    await expect(response).toBeApiError(409, 'stock history or purchase orders');
  });

  test('a product used by a purchase order is a 409', async ({ admin }) => {
    const created = (await (await admin.post('/products', { data: buildProduct() })).json()) as Product;
    const order = await admin.post('/purchase-orders', {
      data: buildPurchaseOrder({ lines: [{ product_id: created.id, quantity: 1, unit_cost: 5 }] }),
    });
    await expect(order).toHaveStatus(201);

    const response = await admin.delete(`/products/${created.id}`);

    await expect(response).toBeApiError(409, 'stock history or purchase orders');
  });

  test('a stale If-Match is a 412', async ({ admin }) => {
    const response = await admin.delete(`/products/${bookSet.id}`, {
      headers: { 'If-Match': '"product-7-v0"' },
    });
    await expect(response).toBeApiError(412);
  });

  test('a matching If-Match is accepted', async ({ admin }) => {
    const response = await admin.delete(`/products/${bookSet.id}`, {
      headers: { 'If-Match': `"product-${bookSet.id}-v1"` },
    });
    await expect(response).toHaveStatus(204);
  });

  test('an unknown product is a 404', async ({ admin }) => {
    const response = await admin.delete(`/products/${MISSING_ID}`);
    await expect(response).toBeApiError(404, 'not found');
  });

  test('anonymous is a 401', async ({ request }) => {
    const response = await request.delete(`/products/${bookSet.id}`);
    await expect(response).toBeApiError(401);
  });

  test('clerk is a 403', async ({ clerk }) => {
    const response = await clerk.delete(`/products/${bookSet.id}`);
    await expect(response).toBeApiError(403);
  });

  test('viewer is a 403', async ({ viewer }) => {
    const response = await viewer.delete(`/products/${bookSet.id}`);
    await expect(response).toBeApiError(403);
  });
});
