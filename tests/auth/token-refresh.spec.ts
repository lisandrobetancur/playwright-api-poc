import { test, expect } from '@src/fixtures/api.fixture';
import { users } from '@src/data/seed';
import type { TokenPair, User } from '@src/api/types';
import { JWT_PATTERN, tamperSignature } from './helpers';

test.describe('POST /auth/refresh', () => {
  test('exchanges a refresh token for a new, working token pair @smoke', async ({
    login,
    request,
    withToken,
  }) => {
    const original = await login('clerk');

    const response = await request.post('/auth/refresh', { data: { refresh_token: original.refresh_token } });

    await expect(response).toHaveStatus(200);
    const rotated = (await response.json()) as TokenPair;
    expect(rotated).toEqual({
      access_token: expect.stringMatching(JWT_PATTERN),
      refresh_token: expect.stringMatching(JWT_PATTERN),
      token_type: 'bearer',
      expires_in: 900,
      refresh_expires_in: 86_400,
    });
    expect(rotated.access_token).not.toBe(original.access_token);
    expect(rotated.refresh_token).not.toBe(original.refresh_token);

    const me = await (await withToken(rotated.access_token)).get('/auth/me');
    await expect(me).toHaveStatus(200);
    expect(((await me.json()) as User).id).toBe(users.clerk.id);
  });

  test('refresh tokens are single-use: reusing one gives 401 revoked', async ({ login, request }) => {
    const { refresh_token } = await login('clerk');
    await expect(await request.post('/auth/refresh', { data: { refresh_token } })).toHaveStatus(200);

    const reuse = await request.post('/auth/refresh', { data: { refresh_token } });

    await expect(reuse).toBeApiError(401, 'Token has been revoked');
    expect(reuse.headers()['www-authenticate']).toBe('Bearer');
  });

  test('the rotated refresh token can itself be refreshed', async ({ login, request }) => {
    const first = await login('viewer');
    const second = (await (
      await request.post('/auth/refresh', { data: { refresh_token: first.refresh_token } })
    ).json()) as TokenPair;

    const third = await request.post('/auth/refresh', { data: { refresh_token: second.refresh_token } });

    await expect(third).toHaveStatus(200);
  });

  test('rejects an access token used as a refresh token', async ({ login, request }) => {
    const { access_token } = await login('clerk');

    const response = await request.post('/auth/refresh', { data: { refresh_token: access_token } });

    await expect(response).toBeApiError(401, 'Expected a refresh token');
  });

  test('rejects a refresh token that is not a JWT', async ({ request }) => {
    const response = await request.post('/auth/refresh', { data: { refresh_token: 'not-a-token' } });

    await expect(response).toBeApiError(401, 'Invalid token');
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });

  test('rejects a refresh token with a tampered signature', async ({ login, request }) => {
    const { refresh_token } = await login('clerk');

    const response = await request.post('/auth/refresh', {
      data: { refresh_token: tamperSignature(refresh_token) },
    });

    await expect(response).toBeApiError(401, 'Invalid token');
  });

  test('rejects the refresh token of a deleted user', async ({ login, admin, request }) => {
    const { refresh_token } = await login('viewer');
    await expect(await admin.delete(`/users/${users.viewer.id}`)).toHaveStatus(204);

    const response = await request.post('/auth/refresh', { data: { refresh_token } });

    await expect(response).toBeApiError(401, 'User no longer exists');
  });

  test('rejects a missing refresh_token with 422', async ({ request }) => {
    const response = await request.post('/auth/refresh', { data: {} });

    await expect(response).toHaveValidationErrorFor(['body', 'refresh_token']);
  });

  test('rejects a non-JSON content type with 415', async ({ login, request }) => {
    const { refresh_token } = await login('clerk');

    const response = await request.post('/auth/refresh', { form: { refresh_token } });

    await expect(response).toBeApiError(415);
  });

  test('rejects a malformed JSON body with 400', async ({ request }) => {
    const response = await request.post('/auth/refresh', {
      headers: { 'Content-Type': 'application/json' },
      // A Buffer is sent verbatim; a string would be JSON-encoded by Playwright.
      data: Buffer.from('{"refresh_token": '),
    });

    await expect(response).toBeApiError(400, 'not valid JSON');
  });
});
