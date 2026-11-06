import { test, expect } from '@src/fixtures/api.fixture';
import { MISSING_ID, products, warehouses } from '@src/data/seed';
import type { StockLevel, StockPage } from '@src/api/types';
import { stockEtag } from './helpers';

const mainSkusSorted = Object.values(products)
  .filter((p) => p.stock.main > 0)
  .map((p) => p.sku as string)
  .sort();

test.describe('GET /warehouses/{id}/stock', () => {
  test('lists the levels of a warehouse sorted by SKU @smoke', async ({ viewer }) => {
    const response = await viewer.get(`/warehouses/${warehouses.main.id}/stock`);

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as StockPage;
    expect(page).toEqual(expect.objectContaining({ total: mainSkusSorted.length, limit: 10, offset: 0 }));
    expect(page.items.map((s) => s.sku)).toEqual(mainSkusSorted);
    expect(response.headers()['x-total-count']).toBe(String(mainSkusSorted.length));
  });

  test('each item carries the product data and the quantity in that warehouse', async ({ viewer }) => {
    const page = (await (await viewer.get(`/warehouses/${warehouses.main.id}/stock`)).json()) as StockPage;

    const chair = page.items.find((s) => s.product_id === products.chair.id);
    expect(chair).toEqual(
      expect.objectContaining({
        warehouse_id: warehouses.main.id,
        sku: products.chair.sku,
        product_name: expect.any(String),
        quantity: products.chair.stock.main,
        reorder_level: products.chair.reorderLevel,
        version: 1,
      }),
    );
  });

  test('low_only keeps only levels at or below the reorder level', async ({ viewer }) => {
    const response = await viewer.get(`/warehouses/${warehouses.main.id}/stock`, {
      params: { low_only: true },
    });

    const page = (await response.json()) as StockPage;
    expect(page.items.map((s) => s.sku)).toEqual([
      products.tape.sku,
      products.sword.sku,
      products.spotlight.sku,
    ]);
    expect(page.total).toBe(3);
    for (const level of page.items) {
      expect(level.quantity).toBeLessThanOrEqual(level.reorder_level);
    }
  });

  test('low_only is scoped to the warehouse', async ({ viewer }) => {
    const page = (await (
      await viewer.get(`/warehouses/${warehouses.stage.id}/stock`, { params: { low_only: true } })
    ).json()) as StockPage;

    expect(page.items.map((s) => s.sku)).toEqual([
      products.sword.sku,
      products.lamp.sku,
      products.spotlight.sku,
    ]);
  });

  for (const sort of ['sku', '-sku', 'quantity', '-quantity'] as const) {
    test(`sorts by ${sort}`, async ({ viewer }) => {
      const page = (await (
        await viewer.get(`/warehouses/${warehouses.main.id}/stock`, { params: { sort } })
      ).json()) as StockPage;

      const key = sort.replace('-', '') as 'sku' | 'quantity';
      const values = page.items.map((s) => s[key]);
      const sorted = [...values].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      expect(values).toEqual(sort.startsWith('-') ? sorted.reverse() : sorted);
    });
  }

  test('answers 422 for an unsupported sort', async ({ viewer }) => {
    await expect(
      await viewer.get(`/warehouses/${warehouses.main.id}/stock`, { params: { sort: 'price' } }),
    ).toHaveValidationErrorFor('sort');
  });

  test('paginates with limit/offset', async ({ viewer }) => {
    const response = await viewer.get(`/warehouses/${warehouses.main.id}/stock`, {
      params: { limit: 3, offset: 3 },
    });

    const page = (await response.json()) as StockPage;
    expect(page.items.map((s) => s.sku)).toEqual(mainSkusSorted.slice(3, 6));
    expect(page.total).toBe(mainSkusSorted.length);
    expect(response.headers()['link']).toContain('rel="next"');
    expect(response.headers()['link']).toContain('rel="prev"');
  });

  test('an empty warehouse has no levels', async ({ viewer }) => {
    const page = (await (await viewer.get(`/warehouses/${warehouses.annex.id}/stock`)).json()) as StockPage;

    expect(page.items).toEqual([]);
    expect(page.total).toBe(0);
  });

  test('answers 404 for an unknown warehouse', async ({ viewer }) => {
    await expect(await viewer.get(`/warehouses/${MISSING_ID}/stock`)).toBeApiError(404, 'not found');
  });

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(await request.get(`/warehouses/${warehouses.main.id}/stock`)).toHaveStatus(401);
  });
});

test.describe('GET /warehouses/{id}/stock/{product_id}', () => {
  test('returns one level with an ETag "stock-{w}-{p}-v{version}" @smoke', async ({ viewer }) => {
    const response = await viewer.get(`/warehouses/${warehouses.main.id}/stock/${products.chair.id}`);

    await expect(response).toHaveStatus(200);
    const level = (await response.json()) as StockLevel;
    expect(level).toEqual(
      expect.objectContaining({
        warehouse_id: warehouses.main.id,
        product_id: products.chair.id,
        quantity: products.chair.stock.main,
        version: 1,
      }),
    );
    expect(response.headers()['etag']).toBe(stockEtag(warehouses.main.id, products.chair.id, 1));
  });

  test('a missing level is quantity 0, version 0', async ({ viewer }) => {
    const response = await viewer.get(`/warehouses/${warehouses.annex.id}/stock/${products.chair.id}`);

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as StockLevel).toEqual(
      expect.objectContaining({ quantity: 0, version: 0, updated_at: null }),
    );
    expect(response.headers()['etag']).toBe(stockEtag(warehouses.annex.id, products.chair.id, 0));
  });

  test('If-None-Match with the current ETag answers 304 without a body', async ({ viewer }) => {
    const path = `/warehouses/${warehouses.main.id}/stock/${products.chair.id}`;
    const etag = (await viewer.get(path)).headers()['etag'];

    const response = await viewer.get(path, { headers: { 'If-None-Match': etag } });

    await expect(response).toHaveStatus(304);
    expect(response.headers()['etag']).toBe(etag);
    expect(await response.body()).toHaveLength(0);
  });

  test('If-None-Match with another ETag answers 200', async ({ viewer }) => {
    const response = await viewer.get(`/warehouses/${warehouses.main.id}/stock/${products.chair.id}`, {
      headers: { 'If-None-Match': stockEtag(warehouses.main.id, products.chair.id, 99) },
    });

    await expect(response).toHaveStatus(200);
  });

  test('answers 404 for an unknown product', async ({ viewer }) => {
    await expect(await viewer.get(`/warehouses/${warehouses.main.id}/stock/${MISSING_ID}`)).toBeApiError(
      404,
      'not found',
    );
  });

  test('answers 404 for an unknown warehouse', async ({ viewer }) => {
    await expect(await viewer.get(`/warehouses/${MISSING_ID}/stock/${products.chair.id}`)).toBeApiError(
      404,
      'not found',
    );
  });

  test('answers 401 for an anonymous caller', async ({ request }) => {
    await expect(
      await request.get(`/warehouses/${warehouses.main.id}/stock/${products.chair.id}`),
    ).toHaveStatus(401);
  });
});
