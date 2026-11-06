import { test, expect } from '@src/fixtures/api.fixture';
import { users, type RoleName } from '@src/data/seed';
import type { APIRequestContext, APIResponse } from '@playwright/test';

/**
 * Role matrix for /users. Admins can do everything; other roles only read or update themselves.
 * `self` means the caller's own id, `other` another seed user's id.
 */
type Call = (client: APIRequestContext, id: number) => Promise<APIResponse>;

const calls: Record<string, Call> = {
  'GET /users': (client) => client.get('/users'),
  'GET /users/{id}': (client, id) => client.get(`/users/${id}`),
  'PATCH /users/{id}': (client, id) => client.patch(`/users/${id}`, { data: { name: 'Matrix Name' } }),
  'DELETE /users/{id}': (client, id) => client.delete(`/users/${id}`),
};

const otherOf: Record<RoleName, RoleName> = { admin: 'clerk', clerk: 'viewer', viewer: 'clerk' };

/** Expected status per endpoint, role and target. */
const matrix: { call: keyof typeof calls; target: 'self' | 'other'; expected: Record<RoleName, number> }[] = [
  { call: 'GET /users', target: 'self', expected: { admin: 200, clerk: 403, viewer: 403 } },
  { call: 'GET /users/{id}', target: 'self', expected: { admin: 200, clerk: 200, viewer: 200 } },
  { call: 'GET /users/{id}', target: 'other', expected: { admin: 200, clerk: 403, viewer: 403 } },
  { call: 'PATCH /users/{id}', target: 'self', expected: { admin: 200, clerk: 200, viewer: 200 } },
  { call: 'PATCH /users/{id}', target: 'other', expected: { admin: 200, clerk: 403, viewer: 403 } },
  { call: 'DELETE /users/{id}', target: 'self', expected: { admin: 409, clerk: 403, viewer: 403 } },
  { call: 'DELETE /users/{id}', target: 'other', expected: { admin: 204, clerk: 403, viewer: 403 } },
];

const forbiddenDetail: Record<keyof typeof calls, string> = {
  'GET /users': 'Admin role required',
  'GET /users/{id}': 'You can only access your own user',
  'PATCH /users/{id}': 'You can only access your own user',
  'DELETE /users/{id}': 'Admin role required',
};

test.describe('/users role matrix', () => {
  for (const { call, target, expected } of matrix) {
    test.describe(`${call} on ${target}`, () => {
      for (const role of ['admin', 'clerk', 'viewer'] as const) {
        test(`${role} gets ${expected[role]}`, async ({ login, withToken }) => {
          const client = await withToken((await login(role)).access_token);
          const id = users[target === 'self' ? role : otherOf[role]].id;

          const response = await calls[call](client, id);

          if (expected[role] === 403) {
            await expect(response).toBeApiError(403, forbiddenDetail[call]);
          } else {
            await expect(response).toHaveStatus(expected[role]);
          }
        });
      }
    });
  }

  test.describe('anonymous callers', () => {
    for (const call of Object.keys(calls) as (keyof typeof calls)[]) {
      test(`${call} without a token gives 401 with a Bearer challenge`, async ({ request }) => {
        const response = await calls[call](request, users.viewer.id);

        await expect(response).toBeApiError(401, 'Missing Bearer token');
        expect(response.headers()['www-authenticate']).toBe('Bearer');
      });
    }
  });

  test('a non-admin probing a missing id gets 403, not 404 (no user enumeration)', async ({ viewer }) => {
    await expect(await viewer.get('/users/999999')).toBeApiError(403);
  });

  test('a clerk cannot change roles, even their own', async ({ clerk }) => {
    const response = await clerk.patch(`/users/${users.clerk.id}`, { data: { role: 'admin' } });

    await expect(response).toBeApiError(403, 'Only admins can change roles');
  });

  test('an API key does not grant access to /users', async ({ apiKeyClient }) => {
    await expect(await apiKeyClient.get('/users')).toBeApiError(401, 'Missing Bearer token');
  });
});
