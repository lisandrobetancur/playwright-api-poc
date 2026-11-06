import { test, expect } from '@src/fixtures/api.fixture';
import type { Product } from '@src/api/types';
import { MISSING_ID, products } from '@src/data/seed';

const chair = products.chair;
const textPlain = { 'Content-Type': 'text/plain' };

test.describe('GET /products/{id}/description', () => {
  test('returns the description as text/plain @smoke', async ({ request }) => {
    const response = await request.get(`/products/${chair.id}/description`);

    await expect(response).toHaveStatus(200);
    expect(response.headers()['content-type']).toMatch(/^text\/plain/);
    expect(await response.text()).toBe('Wooden chair.');
  });

  test('an unknown product is a 404', async ({ request }) => {
    const response = await request.get(`/products/${MISSING_ID}/description`);
    await expect(response).toBeApiError(404, 'not found');
  });
});

test.describe('PUT /products/{id}/description', () => {
  test('admin replaces the description with a text/plain body', async ({ admin }) => {
    const response = await admin.put(`/products/${chair.id}/description`, {
      data: 'Oak, 1920s style',
      headers: textPlain,
    });

    await expect(response).toHaveStatus(200);
    expect(response.headers()['content-type']).toMatch(/^text\/plain/);
    expect(await response.text()).toBe('Oak, 1920s style');
  });

  test('the new description is visible on the product and bumps its version', async ({ admin, request }) => {
    await admin.put(`/products/${chair.id}/description`, { data: 'Oak, 1920s style', headers: textPlain });

    const product = (await (await request.get(`/products/${chair.id}`)).json()) as Product;
    expect(product).toMatchObject({ description: 'Oak, 1920s style', version: 2 });
  });

  test('keeps multi-line UTF-8 text intact', async ({ admin, request }) => {
    const text = 'Café-style oak chair — 1920s naïve design\nSecond line ✓';

    await admin.put(`/products/${chair.id}/description`, {
      data: text,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });

    expect(await (await request.get(`/products/${chair.id}/description`)).text()).toBe(text);
  });

  test('a description longer than 5000 characters is a 422', async ({ admin }) => {
    const response = await admin.put(`/products/${chair.id}/description`, {
      data: 'x'.repeat(5001),
      headers: textPlain,
    });
    await expect(response).toBeApiError(422, '5000 characters');
  });

  test('a body that is not UTF-8 is a 400', async ({ admin }) => {
    const response = await admin.put(`/products/${chair.id}/description`, {
      data: Buffer.from([0xff, 0xfe, 0xfd]),
      headers: textPlain,
    });
    await expect(response).toBeApiError(400, 'UTF-8');
  });

  test('a JSON body is a 415', async ({ admin }) => {
    const response = await admin.put(`/products/${chair.id}/description`, { data: { description: 'Oak' } });
    await expect(response).toBeApiError(415, 'text/plain');
  });

  test('an unknown product is a 404', async ({ admin }) => {
    const response = await admin.put(`/products/${MISSING_ID}/description`, {
      data: 'Ghost',
      headers: textPlain,
    });
    await expect(response).toBeApiError(404, 'not found');
  });

  test('anonymous is a 401', async ({ request }) => {
    const response = await request.put(`/products/${chair.id}/description`, {
      data: 'Oak',
      headers: textPlain,
    });
    await expect(response).toBeApiError(401);
  });

  test('clerk is a 403', async ({ clerk }) => {
    const response = await clerk.put(`/products/${chair.id}/description`, {
      data: 'Oak',
      headers: textPlain,
    });
    await expect(response).toBeApiError(403);
  });

  test('viewer is a 403', async ({ viewer }) => {
    const response = await viewer.put(`/products/${chair.id}/description`, {
      data: 'Oak',
      headers: textPlain,
    });
    await expect(response).toBeApiError(403);
  });
});
