import { test, expect } from '@src/fixtures/api.fixture';
import type { ProductPage } from '@src/api/types';
import { PRODUCT_COUNT, categories, products, suppliers } from '@src/data/seed';
import { parseLinks, productIds } from './helpers';

test.describe('GET /products', () => {
  test('lists the seed products with the default page size @smoke', async ({ request }) => {
    const response = await request.get('/products');

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as ProductPage;
    expect(page).toMatchObject({ total: PRODUCT_COUNT, limit: 10, offset: 0 });
    expect(page.items.map((product) => product.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  test('is public: no credentials are needed', async ({ request }) => {
    const response = await request.get('/products', { headers: { Authorization: '' } });
    await expect(response).toHaveStatus(200);
  });

  test.describe('filters', () => {
    test('category_id', async ({ request }) => {
      const response = await request.get('/products', { params: { category_id: categories.lighting.id } });
      expect(await productIds(response)).toEqual([products.lamp.id, products.spotlight.id]);
    });

    test('supplier_id', async ({ request }) => {
      const response = await request.get('/products', { params: { supplier_id: suppliers.northwind.id } });
      expect(await productIds(response)).toEqual([products.curtain.id]);
    });

    test('q searches the name case-insensitively', async ({ request }) => {
      const response = await request.get('/products', { params: { q: 'CHAIR' } });
      expect(await productIds(response)).toEqual([products.chair.id]);
    });

    test('q searches the SKU case-insensitively', async ({ request }) => {
      const response = await request.get('/products', { params: { q: 'lgt-' } });
      expect(await productIds(response)).toEqual([products.lamp.id, products.spotlight.id]);
    });

    test('tag', async ({ request }) => {
      const response = await request.get('/products', { params: { tag: 'period' } });
      expect(await productIds(response)).toEqual([products.chair.id, products.lamp.id]);
    });

    test('active=false returns only inactive products', async ({ request }) => {
      const response = await request.get('/products', { params: { active: false } });
      expect(await productIds(response)).toEqual([products.bookSet.id]);
    });

    test('min_price and max_price are inclusive bounds', async ({ request }) => {
      const response = await request.get('/products', { params: { min_price: 30, max_price: 80 } });

      const page = (await response.json()) as ProductPage;
      expect(page.items.map((product) => product.id)).toEqual([1, 3, 5]);
      for (const product of page.items) {
        expect(product.unit_price).toBeGreaterThanOrEqual(30);
        expect(product.unit_price).toBeLessThanOrEqual(80);
      }
    });

    test('low_stock=true returns products at or below their reorder level', async ({ request }) => {
      const response = await request.get('/products', { params: { low_stock: true } });
      expect(await productIds(response)).toEqual([
        products.spotlight.id,
        products.bookSet.id,
        products.tape.id,
      ]);
    });

    test('low_stock=false returns the rest', async ({ request }) => {
      const response = await request.get('/products', { params: { low_stock: false } });
      expect(await productIds(response)).toEqual([1, 2, 3, 5, 6]);
    });

    test('filters combine with AND', async ({ request }) => {
      const response = await request.get('/products', {
        params: { category_id: categories.furniture.id, min_price: 100 },
      });
      expect(await productIds(response)).toEqual([products.table.id]);
    });

    test('a filter without matches returns an empty page', async ({ request }) => {
      const response = await request.get('/products', { params: { q: 'no-such-prop' } });

      await expect(response).toHaveStatus(200);
      expect(await response.json()).toMatchObject({ items: [], total: 0 });
      expect(response.headers()['x-total-count']).toBe('0');
    });
  });

  test.describe('sorting', () => {
    test('sort=-price orders by price descending', async ({ request }) => {
      const response = await request.get('/products', { params: { sort: '-price' } });

      const prices = ((await response.json()) as ProductPage).items.map((product) => product.unit_price);
      expect(prices).toEqual([...prices].sort((a, b) => b - a));
      expect(prices[0]).toBe(250);
    });

    test('sort=sku orders by SKU ascending', async ({ request }) => {
      const response = await request.get('/products', { params: { sort: 'sku' } });

      const skus = ((await response.json()) as ProductPage).items.map((product) => product.sku);
      expect(skus).toEqual([...skus].sort());
    });

    test('sort=-id reverses the default order', async ({ request }) => {
      const response = await request.get('/products', { params: { sort: '-id' } });
      expect(await productIds(response)).toEqual([8, 7, 6, 5, 4, 3, 2, 1]);
    });

    test('an unknown sort field is a 422', async ({ request }) => {
      const response = await request.get('/products', { params: { sort: 'nope' } });
      await expect(response).toHaveValidationErrorFor('sort');
    });
  });

  test.describe('pagination', () => {
    test('limit and offset select a page', async ({ request }) => {
      const response = await request.get('/products', { params: { limit: 3, offset: 3 } });

      await expect(response).toHaveStatus(200);
      const page = (await response.json()) as ProductPage;
      expect(page).toMatchObject({ total: PRODUCT_COUNT, limit: 3, offset: 3 });
      expect(page.items.map((product) => product.id)).toEqual([4, 5, 6]);
    });

    test('X-Total-Count carries the total of the filtered collection', async ({ request }) => {
      const all = await request.get('/products', { params: { limit: 1 } });
      expect(all.headers()['x-total-count']).toBe(String(PRODUCT_COUNT));

      const filtered = await request.get('/products', { params: { category_id: categories.lighting.id } });
      expect(filtered.headers()['x-total-count']).toBe('2');
    });

    test('a middle page links to first, prev, next and last', async ({ request }) => {
      const response = await request.get('/products', { params: { limit: 3, offset: 3 } });

      const links = parseLinks(response.headers()['link']);
      expect(Object.keys(links).sort()).toEqual(['first', 'last', 'next', 'prev']);
      expect(new URL(links.first).searchParams.get('offset')).toBe('0');
      expect(new URL(links.prev).searchParams.get('offset')).toBe('0');
      expect(new URL(links.next).searchParams.get('offset')).toBe('6');
      expect(new URL(links.last).searchParams.get('offset')).toBe('6');
      expect(new URL(links.next).searchParams.get('limit')).toBe('3');
    });

    test('the first page has no prev link', async ({ request }) => {
      const response = await request.get('/products', { params: { limit: 3 } });

      const links = parseLinks(response.headers()['link']);
      expect(links).not.toHaveProperty('prev');
      expect(links).toHaveProperty('next');
    });

    test('the last page has no next link', async ({ request }) => {
      const response = await request.get('/products', { params: { limit: 3, offset: 6 } });

      const links = parseLinks(response.headers()['link']);
      expect(links).toHaveProperty('prev');
      expect(links).not.toHaveProperty('next');
      expect(await productIds(response)).toEqual([7, 8]);
    });

    test('Link URLs keep the active filters', async ({ request }) => {
      const response = await request.get('/products', { params: { active: true, limit: 2 } });

      const next = new URL(parseLinks(response.headers()['link']).next);
      expect(next.searchParams.get('active')).toBe('true');
      expect(next.searchParams.get('offset')).toBe('2');
    });

    test('an offset beyond the total returns an empty page', async ({ request }) => {
      const response = await request.get('/products', { params: { offset: 100 } });

      await expect(response).toHaveStatus(200);
      expect(await response.json()).toMatchObject({ items: [], total: PRODUCT_COUNT });
    });

    for (const limit of [0, 101]) {
      test(`limit=${limit} is out of range (422)`, async ({ request }) => {
        const response = await request.get('/products', { params: { limit } });
        await expect(response).toHaveValidationErrorFor('limit');
      });
    }

    test('a negative offset is a 422', async ({ request }) => {
      const response = await request.get('/products', { params: { offset: -1 } });
      await expect(response).toHaveValidationErrorFor('offset');
    });
  });

  test.describe('invalid parameters', () => {
    test('min_price greater than max_price is a 400', async ({ request }) => {
      const response = await request.get('/products', { params: { min_price: 50, max_price: 10 } });
      await expect(response).toBeApiError(400, 'min_price cannot be greater than max_price');
    });

    test('a negative min_price is a 422', async ({ request }) => {
      const response = await request.get('/products', { params: { min_price: -1 } });
      await expect(response).toHaveValidationErrorFor('min_price');
    });

    test('a non-numeric category_id is a 422', async ({ request }) => {
      const response = await request.get('/products', { params: { category_id: 'abc' } });
      await expect(response).toHaveValidationErrorFor('category_id');
    });
  });
});

test.describe('HEAD /products', () => {
  test('returns X-Total-Count and no body', async ({ request }) => {
    const response = await request.head('/products');

    await expect(response).toHaveStatus(200);
    expect(response.headers()['x-total-count']).toBe(String(PRODUCT_COUNT));
    expect(await response.body()).toHaveLength(0);
  });
});
