import { test, expect } from '@src/fixtures/api.fixture';
import { users } from '@src/data/seed';
import type { Schemas, User } from '@src/api/types';
import { basicAuth, setCookieFor, waitForExpiry } from './helpers';

type ApiKeyClient = Schemas['ApiKeyClient'];

const BASIC_CHALLENGE = 'Basic realm="prop-room"';

test.describe('GET /auth/basic (HTTP Basic)', () => {
  test('returns the user for valid Basic credentials @smoke', async ({ withHeaders }) => {
    const client = await withHeaders({ Authorization: basicAuth(users.admin.email, users.admin.password) });

    const response = await client.get('/auth/basic');

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as User).toMatchObject({
      id: users.admin.id,
      email: users.admin.email,
      role: users.admin.role,
    });
  });

  test('works with Playwright httpCredentials too', async ({ playwright, baseURL }) => {
    const client = await playwright.request.newContext({
      baseURL,
      httpCredentials: { username: users.clerk.email, password: users.clerk.password, send: 'always' },
    });

    const response = await client.get('/auth/basic');

    await expect(response).toHaveStatus(200);
    expect(((await response.json()) as User).email).toBe(users.clerk.email);
    await client.dispose();
  });

  test('requires credentials (401 with a Basic challenge)', async ({ request }) => {
    const response = await request.get('/auth/basic');

    await expect(response).toBeApiError(401, 'Missing Basic credentials');
    expect(response.headers()['www-authenticate']).toBe(BASIC_CHALLENGE);
  });

  test('rejects a wrong password', async ({ withHeaders }) => {
    const client = await withHeaders({ Authorization: basicAuth(users.admin.email, 'wrong-password') });

    const response = await client.get('/auth/basic');

    await expect(response).toBeApiError(401, 'Invalid username or password');
    expect(response.headers()['www-authenticate']).toBe(BASIC_CHALLENGE);
  });

  test('rejects an unknown user', async ({ withHeaders }) => {
    const client = await withHeaders({ Authorization: basicAuth('nobody@proproom.test', 'Whatever1!') });

    await expect(await client.get('/auth/basic')).toBeApiError(401, 'Invalid username or password');
  });

  test('rejects a malformed Basic header', async ({ withHeaders }) => {
    const client = await withHeaders({ Authorization: 'Basic %%%not-base64%%%' });

    const response = await client.get('/auth/basic');

    await expect(response).toBeApiError(401);
    expect(response.headers()['www-authenticate']).toBe(BASIC_CHALLENGE);
  });

  test('does not accept a Bearer token', async ({ login, withToken }) => {
    const client = await withToken((await login('admin')).access_token);

    await expect(await client.get('/auth/basic')).toBeApiError(401, 'Missing Basic credentials');
  });
});

test.describe('GET /auth/api-key (X-API-Key)', () => {
  test('identifies the API-key client @smoke', async ({ apiKeyClient }) => {
    const response = await apiKeyClient.get('/auth/api-key');

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as ApiKeyClient).toEqual({ client: 'client-1', auth_method: 'api_key' });
  });

  test('requires the X-API-Key header (401 with an ApiKey challenge)', async ({ request }) => {
    const response = await request.get('/auth/api-key');

    await expect(response).toBeApiError(401, 'Missing X-API-Key header');
    expect(response.headers()['www-authenticate']).toBe('ApiKey');
  });

  test('rejects an invalid key', async ({ withHeaders }) => {
    const client = await withHeaders({ 'X-API-Key': 'wrong-key' });

    const response = await client.get('/auth/api-key');

    await expect(response).toBeApiError(401, 'Invalid API key');
    expect(response.headers()['www-authenticate']).toBe('ApiKey');
  });

  test('does not accept a Bearer token instead of the key', async ({ admin }) => {
    await expect(await admin.get('/auth/api-key')).toBeApiError(401, 'Missing X-API-Key header');
  });
});

test.describe('/auth/session (session cookie)', () => {
  test.describe('POST', () => {
    test('logs in and sets an HttpOnly session cookie @smoke', async ({ request }) => {
      const response = await request.post('/auth/session', {
        data: { email: users.clerk.email, password: users.clerk.password },
      });

      await expect(response).toHaveStatus(200);
      expect((await response.json()) as User).toMatchObject({ id: users.clerk.id, email: users.clerk.email });
      const cookie = setCookieFor(response, 'session');
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/;\s*HttpOnly/i);
      expect(cookie).toMatch(/;\s*SameSite=lax/i);
      expect(cookie).toMatch(/;\s*Path=\//i);
      expect(cookie).toMatch(/;\s*Max-Age=900\b/i);
    });

    test('uses expires_in as the cookie Max-Age', async ({ request }) => {
      const response = await request.post('/auth/session', {
        data: { email: users.clerk.email, password: users.clerk.password, expires_in: 120 },
      });

      await expect(response).toHaveStatus(200);
      expect(setCookieFor(response, 'session')).toMatch(/;\s*Max-Age=120\b/i);
    });

    test('rejects wrong credentials with 401 and sets no cookie', async ({ request }) => {
      const response = await request.post('/auth/session', {
        data: { email: users.clerk.email, password: 'wrong-password' },
      });

      await expect(response).toBeApiError(401, 'Invalid email or password');
      expect(setCookieFor(response, 'session')).toBeUndefined();
    });

    test('rejects a non-JSON content type with 415', async ({ request }) => {
      const response = await request.post('/auth/session', {
        form: { email: users.clerk.email, password: users.clerk.password },
      });

      await expect(response).toBeApiError(415);
    });

    test('rejects a malformed JSON body with 400', async ({ request }) => {
      const response = await request.post('/auth/session', {
        headers: { 'Content-Type': 'application/json' },
        // A Buffer is sent verbatim; a string would be JSON-encoded by Playwright.
        data: Buffer.from('{"email":'),
      });

      await expect(response).toBeApiError(400, 'not valid JSON');
    });

    test('rejects a missing password with 422', async ({ request }) => {
      const response = await request.post('/auth/session', { data: { email: users.clerk.email } });

      await expect(response).toHaveValidationErrorFor(['body', 'password']);
    });
  });

  test.describe('GET', () => {
    test('returns the user of the session cookie kept by the client', async ({ request }) => {
      await request.post('/auth/session', {
        data: { email: users.viewer.email, password: users.viewer.password },
      });

      const response = await request.get('/auth/session');

      await expect(response).toHaveStatus(200);
      expect(((await response.json()) as User).email).toBe(users.viewer.email);
    });

    test('requires the cookie (401 with a Cookie challenge)', async ({ request }) => {
      const response = await request.get('/auth/session');

      await expect(response).toBeApiError(401, 'Missing session cookie');
      expect(response.headers()['www-authenticate']).toBe('Cookie');
    });

    test('rejects a forged cookie value', async ({ withHeaders }) => {
      const client = await withHeaders({ Cookie: 'session=forged-value' });

      await expect(await client.get('/auth/session')).toBeApiError(401, 'Invalid token');
    });

    test('rejects an expired session cookie', async ({ request, withHeaders }) => {
      const created = await request.post('/auth/session', {
        data: { email: users.viewer.email, password: users.viewer.password, expires_in: 1 },
      });
      const cookie = setCookieFor(created, 'session')!.split(';')[0];
      // Send the cookie explicitly: the client jar would drop it itself once Max-Age has passed.
      const client = await withHeaders({ Cookie: cookie });

      await waitForExpiry(1);

      await expect(await client.get('/auth/session')).toBeApiError(401, 'Token has expired');
    });

    test('does not accept a Bearer token', async ({ admin }) => {
      await expect(await admin.get('/auth/session')).toBeApiError(401, 'Missing session cookie');
    });
  });

  test.describe('DELETE', () => {
    test('answers 204 and expires the cookie, ending the session', async ({ request }) => {
      await request.post('/auth/session', {
        data: { email: users.clerk.email, password: users.clerk.password },
      });
      await expect(await request.get('/auth/session')).toHaveStatus(200);

      const response = await request.delete('/auth/session');

      await expect(response).toHaveStatus(204);
      expect(setCookieFor(response, 'session')).toMatch(/;\s*Max-Age=0\b/i);
      await expect(await request.get('/auth/session')).toBeApiError(401, 'Missing session cookie');
    });

    test('is idempotent without a session', async ({ request }) => {
      await expect(await request.delete('/auth/session')).toHaveStatus(204);
    });
  });
});
