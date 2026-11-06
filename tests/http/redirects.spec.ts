import { test, expect } from '@src/fixtures/api.fixture';
import type { Echo, Product, ProductPage } from '@src/api/types';
import { MISSING_ID, PRODUCT_COUNT, products } from '@src/data/seed';

const CODES = [301, 302, 303, 307, 308] as const;

test.describe('/redirect/{code}', () => {
  for (const code of CODES) {
    test(`${code} sends Location to the target`, async ({ request }) => {
      const response = await request.get(`/redirect/${code}`, {
        params: { to: '/products/1' },
        maxRedirects: 0,
      });

      await expect(response).toHaveStatus(code);
      expect(response.headers()['location']).toBe('/products/1');
    });
  }

  test('defaults the target to /health', async ({ request }) => {
    const response = await request.get('/redirect/302', { maxRedirects: 0 });

    expect(response.headers()['location']).toBe('/health');
  });

  test('is followed by default @smoke', async ({ request }) => {
    const response = await request.get('/redirect/302', { params: { to: '/products/1' } });

    await expect(response).toHaveStatus(200);
    expect(response.url()).toMatch(/\/products\/1$/);
    expect(((await response.json()) as Product).sku).toBe(products.chair.sku);
  });

  test('303 turns a POST into a GET without a body', async ({ request }) => {
    const response = await request.post('/redirect/303', { params: { to: '/echo' }, data: { drop: 'me' } });

    await expect(response).toHaveStatus(200);
    const echo = (await response.json()) as Echo;
    expect(echo.method).toBe('GET');
    expect(echo.body).toBeNull();
  });

  for (const code of [307, 308]) {
    test(`${code} keeps the method and the body`, async ({ request }) => {
      const response = await request.put(`/redirect/${code}`, {
        params: { to: '/echo' },
        data: { keep: 'me' },
      });

      await expect(response).toHaveStatus(200);
      const echo = (await response.json()) as Echo;
      expect(echo.method).toBe('PUT');
      expect(echo.body).toEqual({ keep: 'me' });
    });
  }

  test('rejects a code that is not a redirect with 400', async ({ request }) => {
    const response = await request.get('/redirect/200', { maxRedirects: 0 });

    await expect(response).toBeApiError(400, 'Unsupported redirect code');
  });

  test('rejects an absolute or protocol-relative target with 400', async ({ request }) => {
    for (const to of ['https://evil.example', '//evil.example', 'products']) {
      const response = await request.get('/redirect/302', { params: { to }, maxRedirects: 0 });
      await expect(response).toBeApiError(400, 'relative path');
    }
  });

  test('rejects a non-numeric code with 422', async ({ request }) => {
    await expect(await request.get('/redirect/abc', { maxRedirects: 0 })).toHaveValidationErrorFor('code');
  });
});

test.describe('GET /v1/products/{id}', () => {
  test('is a 301 to the current product URL', async ({ request }) => {
    const response = await request.get('/v1/products/1', { maxRedirects: 0 });

    await expect(response).toHaveStatus(301);
    expect(response.headers()['location']).toBe('/products/1');
  });

  test('following it returns the product', async ({ request }) => {
    const response = await request.get('/v1/products/1');

    await expect(response).toHaveStatus(200);
    expect(((await response.json()) as Product).id).toBe(products.chair.id);
  });

  test('following it for a missing product ends in 404', async ({ request }) => {
    await expect(await request.get(`/v1/products/${MISSING_ID}`)).toBeApiError(404);
  });
});

test.describe('GET /catalog', () => {
  test('is a 302 to the active products', async ({ request }) => {
    const response = await request.get('/catalog', { maxRedirects: 0 });

    await expect(response).toHaveStatus(302);
    expect(response.headers()['location']).toBe('/products?active=true');
  });

  test('following it lists only the active products', async ({ request }) => {
    const response = await request.get('/catalog');

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as ProductPage;
    expect(page.total).toBe(PRODUCT_COUNT - 1);
    expect(page.items.every((product) => product.active)).toBe(true);
  });
});
