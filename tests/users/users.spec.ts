import { test, expect } from '@src/fixtures/api.fixture';
import { MISSING_ID, users } from '@src/data/seed';
import { buildUserRegistration } from '@src/data/factories';
import type { User, UserPage, UserRole } from '@src/api/types';
import type { APIRequestContext } from '@playwright/test';

const SEED_USER_COUNT = 3;

/** Register `count` extra viewers through the public endpoint. */
async function registerViewers(request: APIRequestContext, count: number): Promise<User[]> {
  const created: User[] = [];
  for (let i = 0; i < count; i += 1) {
    const response = await request.post('/auth/register', { data: buildUserRegistration() });
    await expect(response).toHaveStatus(201);
    created.push((await response.json()) as User);
  }
  return created;
}

/** Parse an RFC 8288 `Link` header into `{ rel: url }`. */
function parseLinks(header: string | undefined): Record<string, string> {
  const links: Record<string, string> = {};
  for (const part of (header ?? '').split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}

test.describe('GET /users', () => {
  test('lists the seed users ordered by id with pagination metadata @smoke', async ({ admin }) => {
    const response = await admin.get('/users');

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as UserPage;
    expect(page).toMatchObject({ total: SEED_USER_COUNT, limit: 10, offset: 0 });
    expect(page.items).toEqual([
      expect.objectContaining({ id: users.admin.id, email: users.admin.email, role: 'admin' }),
      expect.objectContaining({ id: users.clerk.id, email: users.clerk.email, role: 'warehouse_clerk' }),
      expect.objectContaining({ id: users.viewer.id, email: users.viewer.email, role: 'viewer' }),
    ]);
    expect(response.headers()['x-total-count']).toBe(String(SEED_USER_COUNT));
  });

  test('items follow the User schema and never expose passwords', async ({ admin }) => {
    const page = (await (await admin.get('/users')).json()) as UserPage;

    for (const user of page.items) {
      expect(Object.keys(user).sort()).toEqual(['created_at', 'email', 'id', 'name', 'role']);
    }
  });

  for (const role of ['admin', 'warehouse_clerk', 'viewer'] as const satisfies readonly UserRole[]) {
    test(`filters by role=${role}`, async ({ admin }) => {
      const response = await admin.get('/users', { params: { role } });

      await expect(response).toHaveStatus(200);
      const page = (await response.json()) as UserPage;
      expect(page.total).toBe(1);
      expect(page.items.map((user) => user.role)).toEqual([role]);
    });
  }

  test('the role filter counts registered viewers', async ({ admin, request }) => {
    await registerViewers(request, 2);

    const page = (await (await admin.get('/users', { params: { role: 'viewer' } })).json()) as UserPage;

    expect(page.total).toBe(3);
    expect(page.items.every((user) => user.role === 'viewer')).toBe(true);
  });

  test('paginates with limit and offset', async ({ admin }) => {
    const response = await admin.get('/users', { params: { limit: 2, offset: 1 } });

    await expect(response).toHaveStatus(200);
    const page = (await response.json()) as UserPage;
    expect(page).toMatchObject({ total: SEED_USER_COUNT, limit: 2, offset: 1 });
    expect(page.items.map((user) => user.id)).toEqual([users.clerk.id, users.viewer.id]);
  });

  test('returns an empty page past the end', async ({ admin }) => {
    const page = (await (await admin.get('/users', { params: { offset: 50 } })).json()) as UserPage;

    expect(page.items).toEqual([]);
    expect(page.total).toBe(SEED_USER_COUNT);
  });

  test('walking the pages returns every user exactly once', async ({ admin, request }) => {
    await registerViewers(request, 4);
    const seen: number[] = [];

    for (let offset = 0; offset < SEED_USER_COUNT + 4; offset += 3) {
      const page = (await (await admin.get('/users', { params: { limit: 3, offset } })).json()) as UserPage;
      seen.push(...page.items.map((user) => user.id));
    }

    expect(seen).toHaveLength(SEED_USER_COUNT + 4);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test('sends first/next/last Link headers on the first page', async ({ admin }) => {
    const response = await admin.get('/users', { params: { limit: 1 } });

    const links = parseLinks(response.headers()['link']);
    expect(Object.keys(links).sort()).toEqual(['first', 'last', 'next']);
    expect(links.first).toContain('offset=0');
    expect(links.next).toContain('offset=1');
    expect(links.last).toContain('offset=2');
    expect(links.next).toContain('limit=1');
  });

  test('sends a prev but no next link on the last page', async ({ admin }) => {
    const response = await admin.get('/users', { params: { limit: 1, offset: 2 } });

    const links = parseLinks(response.headers()['link']);
    expect(Object.keys(links).sort()).toEqual(['first', 'last', 'prev']);
    expect(links.prev).toContain('offset=1');
  });

  test('keeps the role filter in the Link URLs', async ({ admin, request }) => {
    await registerViewers(request, 2);

    const response = await admin.get('/users', { params: { role: 'viewer', limit: 1 } });

    expect(parseLinks(response.headers()['link']).next).toContain('role=viewer');
  });

  for (const [param, value] of [
    ['limit', 0],
    ['limit', 101],
    ['limit', 'ten'],
    ['offset', -1],
    ['role', 'superuser'],
  ] as const) {
    test(`rejects ${param}=${value} with 422`, async ({ admin }) => {
      const response = await admin.get('/users', { params: { [param]: value } });

      await expect(response).toHaveValidationErrorFor(['query', param]);
    });
  }

  test('accepts the maximum limit of 100', async ({ admin }) => {
    const response = await admin.get('/users', { params: { limit: 100 } });

    await expect(response).toHaveStatus(200);
    expect(((await response.json()) as UserPage).limit).toBe(100);
  });
});

test.describe('GET /users/{id}', () => {
  test('returns any user to an admin @smoke', async ({ admin }) => {
    const response = await admin.get(`/users/${users.clerk.id}`);

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as User).toEqual({
      id: users.clerk.id,
      email: users.clerk.email,
      name: expect.any(String),
      role: users.clerk.role,
      created_at: expect.any(String),
    });
  });

  test('returns the same data as /auth/me for yourself', async ({ viewer }) => {
    const me = await (await viewer.get('/auth/me')).json();

    const response = await viewer.get(`/users/${users.viewer.id}`);

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toEqual(me);
  });

  test('answers 404 for a missing user', async ({ admin }) => {
    await expect(await admin.get(`/users/${MISSING_ID}`)).toBeApiError(404, `User ${MISSING_ID} not found`);
  });

  test('answers 422 for a non-integer id', async ({ admin }) => {
    await expect(await admin.get('/users/abc')).toHaveValidationErrorFor(['path', 'user_id']);
  });
});

test.describe('PATCH /users/{id}', () => {
  test('lets a user rename themselves @smoke', async ({ viewer }) => {
    const response = await viewer.patch(`/users/${users.viewer.id}`, { data: { name: 'Vera Renamed' } });

    await expect(response).toHaveStatus(200);
    expect((await response.json()) as User).toMatchObject({
      id: users.viewer.id,
      name: 'Vera Renamed',
      role: 'viewer',
    });
    const reread = (await (await viewer.get('/auth/me')).json()) as User;
    expect(reread.name).toBe('Vera Renamed');
  });

  test('changing the password switches which password logs in', async ({ clerk, request }) => {
    const newPassword = 'NewClerk456!';
    await expect(
      await clerk.patch(`/users/${users.clerk.id}`, { data: { password: newPassword } }),
    ).toHaveStatus(200);

    const withNew = await request.post('/auth/login', {
      data: { email: users.clerk.email, password: newPassword },
    });
    const withOld = await request.post('/auth/login', {
      data: { email: users.clerk.email, password: users.clerk.password },
    });

    await expect(withNew).toHaveStatus(200);
    await expect(withOld).toBeApiError(401);
  });

  test('never returns the password', async ({ clerk }) => {
    const response = await clerk.patch(`/users/${users.clerk.id}`, { data: { password: 'Another789!' } });

    expect(Object.keys((await response.json()) as User).sort()).toEqual([
      'created_at',
      'email',
      'id',
      'name',
      'role',
    ]);
  });

  test('lets an admin rename another user', async ({ admin }) => {
    const response = await admin.patch(`/users/${users.clerk.id}`, { data: { name: 'Carl Renamed' } });

    await expect(response).toHaveStatus(200);
    expect(((await response.json()) as User).name).toBe('Carl Renamed');
  });

  test('lets an admin change a role', async ({ admin }) => {
    const response = await admin.patch(`/users/${users.viewer.id}`, { data: { role: 'warehouse_clerk' } });

    await expect(response).toHaveStatus(200);
    expect(((await response.json()) as User).role).toBe('warehouse_clerk');
  });

  test('a role change applies to tokens already issued', async ({ admin, viewer }) => {
    await expect(await viewer.get('/users')).toBeApiError(403);

    await expect(await admin.patch(`/users/${users.viewer.id}`, { data: { role: 'admin' } })).toHaveStatus(
      200,
    );

    await expect(await viewer.get('/users')).toHaveStatus(200);
  });

  test('an empty body changes nothing', async ({ admin }) => {
    const before = await (await admin.get(`/users/${users.clerk.id}`)).json();

    const response = await admin.patch(`/users/${users.clerk.id}`, { data: {} });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toEqual(before);
  });

  test('only the sent fields change', async ({ admin }) => {
    const before = (await (await admin.get(`/users/${users.clerk.id}`)).json()) as User;

    const after = (await (
      await admin.patch(`/users/${users.clerk.id}`, { data: { name: 'Only Name' } })
    ).json()) as User;

    expect(after).toEqual({ ...before, name: 'Only Name' });
  });

  test('forbids non-admins from changing their own role', async ({ viewer }) => {
    const response = await viewer.patch(`/users/${users.viewer.id}`, { data: { role: 'admin' } });

    await expect(response).toBeApiError(403, 'Only admins can change roles');
    const me = (await (await viewer.get('/auth/me')).json()) as User;
    expect(me.role).toBe('viewer');
  });

  test('answers 404 for a missing user', async ({ admin }) => {
    const response = await admin.patch(`/users/${MISSING_ID}`, { data: { name: 'Nobody' } });

    await expect(response).toBeApiError(404, `User ${MISSING_ID} not found`);
  });

  for (const [field, value] of [
    ['name', 'X'],
    ['name', 'N'.repeat(121)],
    ['password', 'short'],
    ['role', 'superuser'],
  ] as const) {
    test(`rejects an invalid ${field} (${value.length > 20 ? `${value.length} chars` : value}) with 422`, async ({
      admin,
    }) => {
      const response = await admin.patch(`/users/${users.clerk.id}`, { data: { [field]: value } });

      await expect(response).toHaveValidationErrorFor(['body', field]);
    });
  }

  test('rejects a non-JSON content type with 415', async ({ admin }) => {
    const response = await admin.patch(`/users/${users.clerk.id}`, { form: { name: 'Form Name' } });

    await expect(response).toBeApiError(415, 'application/json');
  });

  test('rejects a malformed JSON body with 400', async ({ admin }) => {
    const response = await admin.patch(`/users/${users.clerk.id}`, {
      headers: { 'Content-Type': 'application/json' },
      // A Buffer is sent verbatim; a string would be JSON-encoded by Playwright.
      data: Buffer.from('{"name": "Broken"'),
    });

    await expect(response).toBeApiError(400, 'not valid JSON');
  });
});

test.describe('DELETE /users/{id}', () => {
  test('lets an admin delete a user (204, then 404) @smoke', async ({ admin }) => {
    const response = await admin.delete(`/users/${users.viewer.id}`);

    await expect(response).toHaveStatus(204);
    expect(await response.body()).toHaveLength(0);
    await expect(await admin.get(`/users/${users.viewer.id}`)).toBeApiError(404);
  });

  test('a deleted user disappears from the list', async ({ admin }) => {
    await admin.delete(`/users/${users.clerk.id}`);

    const page = (await (await admin.get('/users')).json()) as UserPage;

    expect(page.total).toBe(SEED_USER_COUNT - 1);
    expect(page.items.map((user) => user.id)).not.toContain(users.clerk.id);
  });

  test("a deleted user's tokens stop working", async ({ admin, viewer }) => {
    await expect(await admin.delete(`/users/${users.viewer.id}`)).toHaveStatus(204);

    await expect(await viewer.get('/auth/me')).toBeApiError(401, 'User no longer exists');
  });

  test('a deleted user can no longer log in', async ({ admin, request }) => {
    await admin.delete(`/users/${users.viewer.id}`);

    const response = await request.post('/auth/login', {
      data: { email: users.viewer.email, password: users.viewer.password },
    });

    await expect(response).toBeApiError(401);
  });

  test('a deleted email can be registered again', async ({ admin, request }) => {
    await admin.delete(`/users/${users.viewer.id}`);

    const response = await request.post('/auth/register', {
      data: buildUserRegistration({ email: users.viewer.email }),
    });

    await expect(response).toHaveStatus(201);
  });

  test('forbids an admin from deleting themselves (409)', async ({ admin }) => {
    const response = await admin.delete(`/users/${users.admin.id}`);

    await expect(response).toBeApiError(409, 'cannot delete yourself');
    await expect(await admin.get(`/users/${users.admin.id}`)).toHaveStatus(200);
  });

  test('answers 404 for a missing user', async ({ admin }) => {
    await expect(await admin.delete(`/users/${MISSING_ID}`)).toBeApiError(
      404,
      `User ${MISSING_ID} not found`,
    );
  });
});
