import { test, expect } from '@src/fixtures/api.fixture';
import type { Echo } from '@src/api/types';

test.describe('/echo', () => {
  test('mirrors method, path, query, headers and a JSON body @smoke', async ({ request }) => {
    const response = await request.put('/echo', {
      params: { x: '1', q: 'chair' },
      headers: { 'X-Custom': 'yes' },
      data: { a: [1, { b: 2 }] },
    });

    await expect(response).toHaveStatus(200);
    const echo = (await response.json()) as Echo;
    expect(echo).toMatchObject({
      method: 'PUT',
      path: '/echo',
      query: { x: '1', q: 'chair' },
      content_type: 'application/json',
      body: { a: [1, { b: 2 }] },
    });
    expect(echo.headers['x-custom']).toBe('yes');
  });

  test('supports GET, POST, PATCH and DELETE', async ({ request }) => {
    for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
      const response = await request.fetch('/echo', { method });
      await expect(response).toHaveStatus(200);
      expect(((await response.json()) as Echo).method).toBe(method);
    }
  });

  test('a request without a body echoes body null', async ({ request }) => {
    const echo = (await (await request.get('/echo')).json()) as Echo;

    expect(echo.body).toBeNull();
    expect(echo.query).toEqual({});
  });

  test('parses cookies sent in the Cookie header', async ({ request }) => {
    const response = await request.get('/echo', { headers: { Cookie: 'c=v; theme=dark' } });

    expect(((await response.json()) as Echo).cookies).toEqual({ c: 'v', theme: 'dark' });
  });

  test('parses a +json media type as JSON', async ({ request }) => {
    const response = await request.patch('/echo', {
      headers: { 'Content-Type': 'application/merge-patch+json' },
      data: JSON.stringify({ name: null }),
    });

    expect(((await response.json()) as Echo).body).toEqual({ name: null });
  });

  test('parses a form-urlencoded body', async ({ request }) => {
    const response = await request.post('/echo', { form: { f: '1', name: 'Ann' } });

    const echo = (await response.json()) as Echo;
    expect(echo.content_type).toBe('application/x-www-form-urlencoded');
    expect(echo.body).toEqual({ f: '1', name: 'Ann' });
  });

  test('describes multipart files and keeps plain fields', async ({ request }) => {
    const response = await request.post('/echo', {
      multipart: {
        note: 'hello',
        up: { name: 'a.bin', mimeType: 'application/octet-stream', buffer: Buffer.from([0, 1]) },
      },
    });

    const echo = (await response.json()) as Echo;
    expect(echo.content_type).toMatch(/^multipart\/form-data; boundary=/);
    expect(echo.body).toEqual({
      note: 'hello',
      up: { filename: 'a.bin', content_type: 'application/octet-stream', size_bytes: 2 },
    });
  });

  test('returns a text body as a string', async ({ request }) => {
    const response = await request.post('/echo', {
      headers: { 'Content-Type': 'text/plain' },
      data: 'hi there',
    });

    expect(((await response.json()) as Echo).body).toBe('hi there');
  });

  test('returns a non-UTF-8 binary body as base64', async ({ request }) => {
    const response = await request.post('/echo', {
      headers: { 'Content-Type': 'application/octet-stream' },
      data: Buffer.from([0xff, 0xfe, 0x00]),
    });

    expect(((await response.json()) as Echo).body).toEqual({ base64: '//4A' });
  });

  test('malformed JSON gives 400', async ({ request }) => {
    // API bug: README documents 400 for malformed JSON (and /echo declares a 400 response), but /echo calls
    // request.json() without handling the JSONDecodeError, so the unhandled-error handler answers 500.
    test.fail();
    const response = await request.post('/echo', {
      headers: { 'Content-Type': 'application/json' },
      data: Buffer.from('{"broken": '), // a Buffer is sent as-is; a string would be JSON-encoded
    });

    await expect(response).toBeApiError(400);
  });
});
