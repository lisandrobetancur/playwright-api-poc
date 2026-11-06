import { test, expect } from '@src/fixtures/api.fixture';

type Preferences = { language: 'en' | 'es' | 'pt'; theme: 'light' | 'dark' };
type ContactOut = { id: number; name: string; email: string; message: string; received_at: string };

const DEFAULTS: Preferences = { language: 'en', theme: 'light' };

test.describe('/preferences', () => {
  test('GET returns the defaults without cookies', async ({ request }) => {
    const response = await request.get('/preferences');

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toEqual(DEFAULTS);
  });

  test('GET reads the preference cookies', async ({ request }) => {
    const response = await request.get('/preferences', { headers: { Cookie: 'language=pt; theme=dark' } });

    expect(await response.json()).toEqual({ language: 'pt', theme: 'dark' });
  });

  test('GET ignores unknown cookie values', async ({ request }) => {
    const response = await request.get('/preferences', {
      headers: { Cookie: 'language=klingon; theme=neon' },
    });

    expect(await response.json()).toEqual(DEFAULTS);
  });

  test('PUT stores the preferences with Set-Cookie @smoke', async ({ request }) => {
    const response = await request.put('/preferences', { data: { language: 'es', theme: 'dark' } });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toEqual({ language: 'es', theme: 'dark' });
    const cookies = response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .map((header) => header.value);
    expect(cookies).toEqual([
      expect.stringMatching(/^language=es;.*Max-Age=31536000.*SameSite=lax/i),
      expect.stringMatching(/^theme=dark;.*Max-Age=31536000.*SameSite=lax/i),
    ]);
  });

  test('the request context sends the stored cookies back', async ({ request }) => {
    await request.put('/preferences', { data: { language: 'es', theme: 'dark' } });

    const response = await request.get('/preferences');

    expect(await response.json()).toEqual({ language: 'es', theme: 'dark' });
  });

  test('PUT fills missing fields with the defaults', async ({ request }) => {
    const response = await request.put('/preferences', { data: { theme: 'dark' } });

    expect(await response.json()).toEqual({ language: 'en', theme: 'dark' });
  });

  test('PUT rejects an unsupported value with 422', async ({ request }) => {
    const response = await request.put('/preferences', { data: { language: 'fr' } });

    await expect(response).toHaveValidationErrorFor('language');
  });

  test('DELETE expires the cookies with 204', async ({ request }) => {
    await request.put('/preferences', { data: { language: 'es', theme: 'dark' } });

    const response = await request.delete('/preferences');

    await expect(response).toHaveStatus(204);
    const cookies = response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === 'set-cookie')
      .map((header) => header.value);
    expect(cookies).toEqual([
      expect.stringMatching(/^language="?"?;.*Max-Age=0/i),
      expect.stringMatching(/^theme="?"?;.*Max-Age=0/i),
    ]);
    expect(await (await request.get('/preferences')).json()).toEqual(DEFAULTS);
  });
});

test.describe('POST /contact', () => {
  const message = { name: 'Ann', email: 'ann@example.test', message: 'Do you rent the foam swords?' };

  test('accepts a form-urlencoded message with 201 @smoke', async ({ request }) => {
    const response = await request.post('/contact', { form: message });

    await expect(response).toHaveStatus(201);
    expect((await response.json()) as ContactOut).toEqual({
      id: 1,
      ...message,
      received_at: expect.any(String),
    });
  });

  test('assigns consecutive ids', async ({ request }) => {
    await request.post('/contact', { form: message });

    const second = await request.post('/contact', { form: message });

    expect(((await second.json()) as ContactOut).id).toBe(2);
  });

  test('rejects missing fields with 422', async ({ request }) => {
    const response = await request.post('/contact', { form: { name: 'Ann' } });

    await expect(response).toHaveValidationErrorFor('email');
    await expect(response).toHaveValidationErrorFor('message');
  });

  test('rejects an invalid email with 422', async ({ request }) => {
    const response = await request.post('/contact', { form: { ...message, email: 'not-an-email' } });

    await expect(response).toHaveValidationErrorFor('email');
  });

  test('rejects an empty message with 422', async ({ request }) => {
    const response = await request.post('/contact', { form: { ...message, message: '' } });

    await expect(response).toHaveValidationErrorFor('message');
  });

  test('a JSON body does not satisfy the form fields', async ({ request }) => {
    const response = await request.post('/contact', { data: message });

    await expect(response).toHaveValidationErrorFor('name');
  });
});
