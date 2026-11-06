import { test, expect } from '@src/fixtures/api.fixture';
import { users } from '@src/data/seed';
import type { TokenPair, User } from '@src/api/types';
import { JWT_PATTERN, decodeJwtPayload, tamperSignature, waitForExpiry } from './helpers';

const DEFAULT_ACCESS_TTL = 900;
const DEFAULT_REFRESH_TTL = 86_400;

test.describe('POST /auth/login', () => {
  test('returns a bearer token pair for valid credentials @smoke', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { email: users.admin.email, password: users.admin.password },
    });

    await expect(response).toHaveStatus(200);
    const tokens = (await response.json()) as TokenPair;
    expect(tokens).toEqual({
      access_token: expect.stringMatching(JWT_PATTERN),
      refresh_token: expect.stringMatching(JWT_PATTERN),
      token_type: 'bearer',
      expires_in: DEFAULT_ACCESS_TTL,
      refresh_expires_in: DEFAULT_REFRESH_TTL,
    });
    expect(tokens.access_token).not.toBe(tokens.refresh_token);
  });

  test('issues tokens whose claims identify the user, role and token type', async ({ login }) => {
    const tokens = await login('clerk');

    const access = decodeJwtPayload(tokens.access_token);
    const refresh = decodeJwtPayload(tokens.refresh_token);
    expect(access).toMatchObject({ sub: String(users.clerk.id), role: users.clerk.role, type: 'access' });
    expect(refresh).toMatchObject({ sub: String(users.clerk.id), type: 'refresh' });
    expect(Number(access.exp) - Number(access.iat)).toBe(DEFAULT_ACCESS_TTL);
    expect(access.jti).not.toBe(refresh.jti);
  });

  test('issues a fresh token pair on every login', async ({ login }) => {
    const first = await login('viewer');
    const second = await login('viewer');

    expect(second.access_token).not.toBe(first.access_token);
    expect(second.refresh_token).not.toBe(first.refresh_token);
  });

  test('treats the email as case-insensitive', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { email: users.viewer.email.toUpperCase(), password: users.viewer.password },
    });

    await expect(response).toHaveStatus(200);
  });

  test('honours a custom expires_in for the access token', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { email: users.admin.email, password: users.admin.password, expires_in: 60 },
    });

    await expect(response).toHaveStatus(200);
    const tokens = (await response.json()) as TokenPair;
    expect(tokens.expires_in).toBe(60);
    expect(tokens.refresh_expires_in).toBe(DEFAULT_REFRESH_TTL);
    const claims = decodeJwtPayload(tokens.access_token);
    expect(Number(claims.exp) - Number(claims.iat)).toBe(60);
  });

  test('rejects a wrong password with 401 and a Bearer challenge', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { email: users.admin.email, password: 'wrong-password' },
    });

    await expect(response).toBeApiError(401, 'Invalid email or password');
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });

  test('rejects an unknown email with the same 401 message', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { email: 'nobody@proproom.test', password: users.admin.password },
    });

    await expect(response).toBeApiError(401, 'Invalid email or password');
  });

  test('rejects a password with different case', async ({ request }) => {
    const response = await request.post('/auth/login', {
      data: { email: users.admin.email, password: users.admin.password.toLowerCase() },
    });

    await expect(response).toBeApiError(401);
  });

  test('rejects a non-JSON content type with 415', async ({ request }) => {
    const response = await request.post('/auth/login', {
      form: { email: users.admin.email, password: users.admin.password },
    });

    await expect(response).toBeApiError(415, 'application/json');
  });

  test('rejects a malformed JSON body with 400', async ({ request }) => {
    const response = await request.post('/auth/login', {
      headers: { 'Content-Type': 'application/json' },
      // A Buffer is sent verbatim; a string would be JSON-encoded by Playwright.
      data: Buffer.from('{"email": "admin@proproom.test", '),
    });

    await expect(response).toBeApiError(400, 'not valid JSON');
  });

  test('rejects a missing password with 422', async ({ request }) => {
    const response = await request.post('/auth/login', { data: { email: users.admin.email } });

    await expect(response).toHaveValidationErrorFor(['body', 'password']);
  });

  test('rejects a missing email with 422', async ({ request }) => {
    const response = await request.post('/auth/login', { data: { password: users.admin.password } });

    await expect(response).toHaveValidationErrorFor(['body', 'email']);
  });

  for (const expiresIn of [0, 86_401]) {
    test(`rejects expires_in=${expiresIn} (outside 1..86400) with 422`, async ({ request }) => {
      const response = await request.post('/auth/login', {
        data: { email: users.admin.email, password: users.admin.password, expires_in: expiresIn },
      });

      await expect(response).toHaveValidationErrorFor('expires_in');
    });
  }
});

test.describe('POST /auth/token (OAuth2 password form)', () => {
  test('returns a token pair for form credentials @smoke', async ({ request, withToken }) => {
    const response = await request.post('/auth/token', {
      form: { username: users.clerk.email, password: users.clerk.password },
    });

    await expect(response).toHaveStatus(200);
    const tokens = (await response.json()) as TokenPair;
    expect(tokens).toMatchObject({ token_type: 'bearer', expires_in: DEFAULT_ACCESS_TTL });

    const me = await (await withToken(tokens.access_token)).get('/auth/me');
    expect(((await me.json()) as User).email).toBe(users.clerk.email);
  });

  test('rejects wrong form credentials with 401 and a Bearer challenge', async ({ request }) => {
    const response = await request.post('/auth/token', {
      form: { username: users.clerk.email, password: 'wrong-password' },
    });

    await expect(response).toBeApiError(401, 'Invalid email or password');
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });

  test('requires the username and password form fields (422 for a JSON body)', async ({ request }) => {
    const response = await request.post('/auth/token', {
      data: { username: users.clerk.email, password: users.clerk.password },
    });

    await expect(response).toHaveValidationErrorFor('username');
    await expect(response).toHaveValidationErrorFor('password');
  });
});

test.describe('GET /auth/me', () => {
  for (const role of ['admin', 'clerk', 'viewer'] as const) {
    test(`returns the current ${role} user`, async ({ login, withToken }) => {
      const client = await withToken((await login(role)).access_token);

      const response = await client.get('/auth/me');

      await expect(response).toHaveStatus(200);
      expect((await response.json()) as User).toEqual({
        id: users[role].id,
        email: users[role].email,
        name: expect.any(String),
        role: users[role].role,
        created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      });
    });
  }

  test('requires a Bearer token (401 with challenge)', async ({ request }) => {
    const response = await request.get('/auth/me');

    await expect(response).toBeApiError(401, 'Missing Bearer token');
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });

  test('rejects a token that is not a JWT', async ({ withToken }) => {
    const response = await (await withToken('garbage')).get('/auth/me');

    await expect(response).toBeApiError(401, 'Invalid token');
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });

  test('rejects a token with a tampered signature', async ({ login, withToken }) => {
    const { access_token } = await login('admin');

    const response = await (await withToken(tamperSignature(access_token))).get('/auth/me');

    await expect(response).toBeApiError(401, 'Invalid token');
  });

  test('rejects a refresh token used as an access token', async ({ login, withToken }) => {
    const { refresh_token } = await login('admin');

    const response = await (await withToken(refresh_token)).get('/auth/me');

    await expect(response).toBeApiError(401, /Expected an? access token/);
  });

  test('ignores credentials sent with a non-Bearer scheme', async ({ login, withHeaders }) => {
    const { access_token } = await login('admin');
    const client = await withHeaders({ Authorization: `Token ${access_token}` });

    const response = await client.get('/auth/me');

    await expect(response).toBeApiError(401, 'Missing Bearer token');
  });

  test('rejects an expired access token', async ({ login, withToken }) => {
    const { access_token } = await login('clerk', { expires_in: 1 });
    const client = await withToken(access_token);
    await expect(await client.get('/auth/me')).toHaveStatus(200);

    await waitForExpiry(1);
    const response = await client.get('/auth/me');

    await expect(response).toBeApiError(401, 'Token has expired');
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });
});
