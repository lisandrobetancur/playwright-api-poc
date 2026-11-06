import { test, expect } from '@src/fixtures/api.fixture';
import { tamperSignature } from './helpers';

test.describe('POST /auth/logout', () => {
  test('answers 204 and revokes the access token @smoke', async ({ login, withToken }) => {
    const client = await withToken((await login('clerk')).access_token);

    const response = await client.post('/auth/logout');

    await expect(response).toHaveStatus(204);
    expect(await response.body()).toHaveLength(0);
    const me = await client.get('/auth/me');
    await expect(me).toBeApiError(401, 'Token has been revoked');
    expect(me.headers()['www-authenticate']).toBe('Bearer');
  });

  test('also revokes the refresh token sent in the body', async ({ login, withToken, request }) => {
    const tokens = await login('clerk');
    const client = await withToken(tokens.access_token);

    await expect(
      await client.post('/auth/logout', { data: { refresh_token: tokens.refresh_token } }),
    ).toHaveStatus(204);

    const refresh = await request.post('/auth/refresh', { data: { refresh_token: tokens.refresh_token } });
    await expect(refresh).toBeApiError(401, 'Token has been revoked');
  });

  test('leaves the refresh token usable when it is not sent', async ({ login, withToken, request }) => {
    const tokens = await login('clerk');
    await expect(await (await withToken(tokens.access_token)).post('/auth/logout')).toHaveStatus(204);

    const refresh = await request.post('/auth/refresh', { data: { refresh_token: tokens.refresh_token } });

    await expect(refresh).toHaveStatus(200);
  });

  test('only revokes the given session, not other tokens of the same user', async ({ login, withToken }) => {
    const first = await withToken((await login('viewer')).access_token);
    const second = await withToken((await login('viewer')).access_token);

    await expect(await first.post('/auth/logout')).toHaveStatus(204);

    await expect(await second.get('/auth/me')).toHaveStatus(200);
  });

  test('ignores an invalid refresh token in the body and still logs out', async ({ login, withToken }) => {
    const tokens = await login('clerk');
    const client = await withToken(tokens.access_token);

    const response = await client.post('/auth/logout', {
      data: { refresh_token: tamperSignature(tokens.refresh_token) },
    });

    await expect(response).toHaveStatus(204);
    await expect(await client.get('/auth/me')).toBeApiError(401, 'Token has been revoked');
  });

  test('requires a Bearer token', async ({ request }) => {
    const response = await request.post('/auth/logout');

    await expect(response).toBeApiError(401, 'Missing Bearer token');
    expect(response.headers()['www-authenticate']).toBe('Bearer');
  });

  test('rejects a token that was already logged out', async ({ login, withToken }) => {
    const client = await withToken((await login('clerk')).access_token);
    await expect(await client.post('/auth/logout')).toHaveStatus(204);

    const again = await client.post('/auth/logout');

    await expect(again).toBeApiError(401, 'Token has been revoked');
  });

  test('rejects a refresh token in the Authorization header', async ({ login, withToken }) => {
    const { refresh_token } = await login('clerk');

    const response = await (await withToken(refresh_token)).post('/auth/logout');

    await expect(response).toBeApiError(401, /Expected an? access token/);
  });
});
