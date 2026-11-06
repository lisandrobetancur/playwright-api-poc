import { test, expect } from '@src/fixtures/api.fixture';
import type { ValidationError } from '@src/api/types';
import { MISSING_ID } from '@src/data/seed';

test.describe('OPTIONS', () => {
  test('answers 204 with the allowed methods of a path @smoke', async ({ request }) => {
    const response = await request.fetch('/products/1', { method: 'OPTIONS' });

    await expect(response).toHaveStatus(204);
    expect(response.headers()['allow']).toBe('DELETE, GET, HEAD, OPTIONS, PATCH, PUT');
  });

  test('lists only the methods a path supports', async ({ request }) => {
    const cases = {
      '/movements': 'GET, OPTIONS, POST',
      '/health': 'GET, HEAD, OPTIONS',
      '/alerts/low-stock': 'GET, OPTIONS',
      '/echo': 'DELETE, GET, OPTIONS, PATCH, POST, PUT',
    };
    for (const [path, allow] of Object.entries(cases)) {
      const response = await request.fetch(path, { method: 'OPTIONS' });
      expect(response.headers()['allow'], path).toBe(allow);
    }
  });

  test('gives 404 for an unknown path', async ({ request }) => {
    await expect(await request.fetch('/does-not-exist', { method: 'OPTIONS' })).toBeApiError(404);
  });
});

test.describe('CORS', () => {
  test('a preflight is answered by the CORS middleware', async ({ request }) => {
    const response = await request.fetch('/products', {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://example.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'authorization, content-type',
      },
    });

    await expect(response).toHaveStatus(200);
    const headers = response.headers();
    expect(headers['access-control-allow-origin']).toBe('*');
    expect(headers['access-control-allow-methods']).toContain('POST');
    expect(headers['access-control-allow-headers']?.toLowerCase()).toContain('authorization');
  });

  test('a cross-origin request gets Allow-Origin and the exposed headers', async ({ request }) => {
    const response = await request.get('/products', { headers: { Origin: 'http://example.com' } });

    await expect(response).toHaveStatus(200);
    expect(response.headers()['access-control-allow-origin']).toBe('*');
    const exposed = response.headers()['access-control-expose-headers'].toLowerCase();
    for (const header of ['location', 'etag', 'link', 'x-total-count', 'retry-after', 'x-request-id']) {
      expect(exposed).toContain(header);
    }
  });
});

test.describe('Method not allowed', () => {
  test('PUT /health gives 405 with an Allow header', async ({ request }) => {
    const response = await request.put('/health');

    await expect(response).toBeApiError(405, 'Method Not Allowed');
    expect(response.headers()['allow']).toContain('GET');
  });

  test('changing an immutable movement gives 405', async ({ admin }) => {
    await expect(await admin.put('/movements/1', { data: {} })).toBeApiError(405);
    await expect(await admin.delete('/movements/1')).toBeApiError(405);
  });
});

test.describe('Request bodies', () => {
  test('malformed JSON gives 400 @smoke', async ({ request }) => {
    const response = await request.put('/preferences', {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{"language": "es",'), // a Buffer is sent as-is; a string would be JSON-encoded
    });

    await expect(response).toBeApiError(400, 'not valid JSON');
  });

  test('malformed JSON on an authenticated endpoint also gives 400', async ({ viewer }) => {
    const response = await viewer.post('/reports', {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from("{type: 'inventory'}"),
    });

    await expect(response).toBeApiError(400, 'not valid JSON');
  });

  test('a JSON endpoint rejects another Content-Type with 415', async ({ request }) => {
    const response = await request.put('/preferences', {
      headers: { 'Content-Type': 'text/plain' },
      data: '{"language": "es"}',
    });

    await expect(response).toBeApiError(415, "Unsupported media type 'text/plain'");
  });

  test('a form body on a JSON endpoint gives 415', async ({ viewer }) => {
    const response = await viewer.post('/reports', { form: { type: 'inventory' } });

    await expect(response).toBeApiError(415, 'application/json');
  });

  test('a +json media type is accepted as JSON', async ({ request }) => {
    const response = await request.put('/preferences', {
      headers: { 'Content-Type': 'application/vnd.proproom+json' },
      data: JSON.stringify({ language: 'pt' }),
    });

    await expect(response).toHaveStatus(200);
  });
});

test.describe('Error body shape', () => {
  test('HTTP errors use {"detail": "<message>"}', async ({ request }) => {
    const response = await request.get(`/products/${MISSING_ID}`);

    await expect(response).toHaveStatus(404);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(await response.json()).toEqual({ detail: expect.stringContaining('not found') });
  });

  test('an unknown path gives 404 Not Found', async ({ request }) => {
    // API bug: the catch-all `OPTIONS /{path:path}` route matches every path, so any other method on an
    // unknown path answers 405 with `Allow: OPTIONS` instead of 404.
    test.fail();
    const response = await request.get('/does-not-exist');

    await expect(response).toHaveStatus(404);
    expect(await response.json()).toEqual({ detail: 'Not Found' });
  });

  test('validation errors use {"detail": [{loc, msg, type}]}', async ({ request }) => {
    const response = await request.put('/preferences', { data: { theme: 'neon' } });

    await expect(response).toHaveStatus(422);
    const { detail } = (await response.json()) as { detail: ValidationError[] };
    expect(detail).toEqual([
      expect.objectContaining({ loc: ['body', 'theme'], msg: expect.any(String), type: expect.any(String) }),
    ]);
  });
});
