import { test, expect } from '@src/fixtures/api.fixture';

type ChaosOut = { status: number; delay_ms: number };

test.describe('/chaos', () => {
  test('answers 200 with the chosen delay and status by default', async ({ request }) => {
    const response = await request.get('/chaos');

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as ChaosOut).toEqual({ status: 200, delay_ms: 0 });
  });

  test('returns the requested status code @smoke', async ({ request }) => {
    for (const status of [201, 400, 404, 418, 500, 502]) {
      const response = await request.get('/chaos', { params: { status } });
      await expect(response).toHaveStatus(status);
      expect((await response.json()) as ChaosOut).toEqual({ status, delay_ms: 0 });
    }
  });

  test('works with POST, PUT, PATCH and DELETE', async ({ request }) => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await request.fetch('/chaos', { method, params: { status: 202 } });
      await expect(response).toHaveStatus(202);
    }
  });

  test('waits for the requested delay', async ({ request }) => {
    const started = Date.now();

    const response = await request.get('/chaos', { params: { delay: 300 } });

    await expect(response).toHaveStatus(200);
    expect(Date.now() - started).toBeGreaterThanOrEqual(300);
    expect(((await response.json()) as ChaosOut).delay_ms).toBe(300);
  });

  test('a request timeout shorter than the delay fails on the client side', async ({ request }) => {
    await expect(request.get('/chaos', { params: { delay: 1_000 }, timeout: 200 })).rejects.toThrow(
      /timeout/i,
    );
  });

  test('429 and 503 carry Retry-After', async ({ request }) => {
    for (const status of [429, 503]) {
      const response = await request.get('/chaos', { params: { status } });
      await expect(response).toHaveStatus(status);
      expect(response.headers()['retry-after']).toBe('1');
    }
  });

  test('401 carries WWW-Authenticate', async ({ request }) => {
    const response = await request.get('/chaos', { params: { status: 401 } });

    await expect(response).toHaveStatus(401);
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });

  test('204 and 304 have no body', async ({ request }) => {
    for (const status of [204, 304]) {
      const response = await request.post('/chaos', { params: { status } });
      await expect(response).toHaveStatus(status);
      expect(await response.body()).toHaveLength(0);
    }
  });

  test('a redirect status points Location at /health', async ({ request }) => {
    const response = await request.get('/chaos', { params: { status: 302 }, maxRedirects: 0 });

    await expect(response).toHaveStatus(302);
    expect(response.headers()['location']).toBe('/health');
  });

  test('rejects a status outside 200-599 with 422', async ({ request }) => {
    for (const status of [99, 199, 600]) {
      const response = await request.get('/chaos', { params: { status } });
      await expect(response).toHaveValidationErrorFor('status');
    }
  });

  test('rejects a delay outside 0-30000 ms with 422', async ({ request }) => {
    for (const delay of [-1, 30_001]) {
      const response = await request.get('/chaos', { params: { delay } });
      await expect(response).toHaveValidationErrorFor('delay');
    }
  });
});

test.describe('GET /chaos/exception', () => {
  test('an unhandled exception becomes a 500 with a JSON error body', async ({ request }) => {
    const response = await request.get('/chaos/exception');

    await expect(response).toBeApiError(500, 'Internal server error');
    expect(await response.json()).toEqual({ detail: 'Internal server error', error: 'RuntimeError' });
  });
});
