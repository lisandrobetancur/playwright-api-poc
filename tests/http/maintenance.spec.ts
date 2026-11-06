import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '@src/fixtures/api.fixture';

async function setMaintenance(request: APIRequestContext, active: boolean, retry_after?: number) {
  const response = await request.post('/__maintenance', { data: { active, retry_after } });
  await expect(response).toHaveStatus(200);
  return response;
}

test.describe('POST /__maintenance', () => {
  // The reset before each test also clears maintenance mode; turning it off here keeps the server usable
  // even for a run that skips the reset.
  test.afterEach(async ({ request }) => {
    await setMaintenance(request, false);
  });

  test('turns maintenance on: other endpoints answer 503 + Retry-After @smoke', async ({ request }) => {
    const toggle = await setMaintenance(request, true, 7);
    expect(await toggle.json()).toEqual({ active: true, retry_after: 7 });

    const response = await request.get('/products');

    await expect(response).toBeApiError(503, 'maintenance');
    expect(response.headers()['retry-after']).toBe('7');
  });

  test('every method and area is blocked, authenticated or not', async ({ request, admin }) => {
    await setMaintenance(request, true, 5);

    const calls = [
      request.get('/products/1'),
      request.post('/auth/login', { data: { email: 'admin@proproom.test', password: 'Admin123!' } }),
      admin.get('/alerts/low-stock'),
      admin.post('/reports', { data: { type: 'inventory' } }),
      admin.delete('/products/7'),
      request.put('/echo', { data: { a: 1 } }),
      request.get('/chaos'),
      request.fetch('/products', { method: 'OPTIONS' }),
    ];
    for (const response of await Promise.all(calls)) {
      await expect(response).toHaveStatus(503);
      expect(response.headers()['retry-after']).toBe('5');
    }
  });

  test('defaults Retry-After to 30 seconds', async ({ request }) => {
    await setMaintenance(request, true);

    expect((await request.get('/products')).headers()['retry-after']).toBe('30');
  });

  test('health, reset, maintenance and the docs stay available', async ({ request }) => {
    await setMaintenance(request, true);

    for (const path of ['/health', '/openapi.json', '/docs']) {
      await expect(await request.get(path)).toHaveStatus(200);
    }
    await setMaintenance(request, true, 10); // the toggle itself still works
  });

  test('503 responses still carry X-Request-ID', async ({ request }) => {
    await setMaintenance(request, true);

    const response = await request.get('/products', { headers: { 'X-Request-ID': 'maint-1' } });

    expect(response.headers()['x-request-id']).toBe('maint-1');
  });

  test('turning it off restores normal service', async ({ request }) => {
    await setMaintenance(request, true);
    await setMaintenance(request, false);

    await expect(await request.get('/products')).toHaveStatus(200);
  });

  test('the reset turns maintenance off', async ({ request }) => {
    await setMaintenance(request, true);

    await expect(await request.post('/__reset')).toHaveStatus(200);

    await expect(await request.get('/products')).toHaveStatus(200);
  });

  test('rejects a retry_after outside 1-3600 with 422', async ({ request }) => {
    for (const retry_after of [0, 3601]) {
      const response = await request.post('/__maintenance', { data: { active: true, retry_after } });
      await expect(response).toHaveValidationErrorFor('retry_after');
    }
  });

  test('rejects a body without active with 422', async ({ request }) => {
    const response = await request.post('/__maintenance', { data: { retry_after: 5 } });

    await expect(response).toHaveValidationErrorFor('active');
  });

  test('rejects a non-JSON body with 415', async ({ request }) => {
    const response = await request.post('/__maintenance', { form: { active: 'true' } });

    await expect(response).toBeApiError(415, 'application/json');
  });
});
