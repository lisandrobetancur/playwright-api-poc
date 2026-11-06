import { test, expect } from '@src/fixtures/api.fixture';
import type { Product } from '@src/api/types';
import { MISSING_ID, categories, products, suppliers } from '@src/data/seed';

test.describe('GET /products/{id}', () => {
  test('returns the product with nested category and supplier @smoke', async ({ request }) => {
    const response = await request.get(`/products/${products.chair.id}`);

    await expect(response).toHaveStatus(200);
    const product = (await response.json()) as Product;
    expect(product).toMatchObject({
      id: products.chair.id,
      sku: products.chair.sku,
      name: 'Wooden chair',
      category_id: categories.furniture.id,
      supplier_id: suppliers.acme.id,
      category: { id: categories.furniture.id, name: categories.furniture.name },
      supplier: { id: suppliers.acme.id, name: suppliers.acme.name },
      unit_price: 45,
      unit: 'unit',
      reorder_level: products.chair.reorderLevel,
      tags: ['wood', 'period'],
      dimensions: { width_cm: 45, height_cm: 90, depth_cm: 50 },
      active: true,
      has_photo: true,
      version: 1,
    });
  });

  test('total_stock is the sum over every warehouse', async ({ request }) => {
    const response = await request.get(`/products/${products.chair.id}`);

    const { main, stage } = products.chair.stock;
    expect(((await response.json()) as Product).total_stock).toBe(main + stage);
  });

  test('a product without supplier has supplier null', async ({ request }) => {
    const response = await request.get(`/products/${products.bookSet.id}`);

    const product = (await response.json()) as Product;
    expect(product.supplier_id).toBeNull();
    expect(product.supplier).toBeNull();
    expect(product.has_photo).toBe(false);
  });

  test('sends a versioned ETag and Cache-Control: no-cache', async ({ request }) => {
    const response = await request.get(`/products/${products.chair.id}`);

    expect(response.headers()['etag']).toBe(`"product-${products.chair.id}-v1"`);
    expect(response.headers()['cache-control']).toBe('no-cache');
  });

  test('If-None-Match with the current ETag answers 304 without a body', async ({ request }) => {
    const etag = (await request.get(`/products/${products.chair.id}`)).headers()['etag'];

    const response = await request.get(`/products/${products.chair.id}`, {
      headers: { 'If-None-Match': etag },
    });

    await expect(response).toHaveStatus(304);
    expect(response.headers()['etag']).toBe(etag);
    expect(await response.body()).toHaveLength(0);
  });

  test('If-None-Match accepts a weak ETag and a list of ETags', async ({ request }) => {
    const etag = `"product-${products.chair.id}-v1"`;

    const weak = await request.get(`/products/${products.chair.id}`, {
      headers: { 'If-None-Match': `W/${etag}` },
    });
    await expect(weak).toHaveStatus(304);

    const list = await request.get(`/products/${products.chair.id}`, {
      headers: { 'If-None-Match': `"other", ${etag}` },
    });
    await expect(list).toHaveStatus(304);
  });

  test('If-None-Match with a stale ETag returns the new representation', async ({ request, admin }) => {
    const stale = (await request.get(`/products/${products.chair.id}`)).headers()['etag'];
    await admin.patch(`/products/${products.chair.id}`, { data: { unit_price: 50 } });

    const response = await request.get(`/products/${products.chair.id}`, {
      headers: { 'If-None-Match': stale },
    });

    await expect(response).toHaveStatus(200);
    expect(response.headers()['etag']).toBe(`"product-${products.chair.id}-v2"`);
    expect(((await response.json()) as Product).unit_price).toBe(50);
  });

  test('an unknown id is a 404', async ({ request }) => {
    const response = await request.get(`/products/${MISSING_ID}`);
    await expect(response).toBeApiError(404, `Product ${MISSING_ID} not found`);
  });

  test('a non-numeric id is a 422', async ({ request }) => {
    const response = await request.get('/products/abc');
    await expect(response).toHaveValidationErrorFor('product_id');
  });
});

test.describe('HEAD /products/{id}', () => {
  test('returns the ETag and no body', async ({ request }) => {
    const response = await request.head(`/products/${products.table.id}`);

    await expect(response).toHaveStatus(200);
    expect(response.headers()['etag']).toBe(`"product-${products.table.id}-v1"`);
    expect(await response.body()).toHaveLength(0);
  });

  test('honours If-None-Match with 304', async ({ request }) => {
    const response = await request.head(`/products/${products.table.id}`, {
      headers: { 'If-None-Match': `"product-${products.table.id}-v1"` },
    });
    await expect(response).toHaveStatus(304);
  });

  test('an unknown id is a 404', async ({ request }) => {
    const response = await request.head(`/products/${MISSING_ID}`);
    await expect(response).toHaveStatus(404);
  });
});
