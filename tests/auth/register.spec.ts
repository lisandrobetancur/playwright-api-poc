import { test, expect } from '@src/fixtures/api.fixture';
import { users } from '@src/data/seed';
import { buildUserRegistration } from '@src/data/factories';
import type { User, UserPage } from '@src/api/types';

test.describe('POST /auth/register', () => {
  test('creates a viewer account and answers 201 with Location @smoke', async ({ request }) => {
    const registration = buildUserRegistration();

    const response = await request.post('/auth/register', { data: registration });

    await expect(response).toHaveStatus(201);
    const user = (await response.json()) as User;
    expect(user).toEqual({
      id: expect.any(Number),
      email: registration.email,
      name: registration.name,
      role: 'viewer',
      created_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
    });
    expect(user.id).toBeGreaterThan(users.viewer.id);
    expect(response.headers()['location']).toBe(`/users/${user.id}`);
  });

  test('never exposes the password in the response', async ({ request }) => {
    const response = await request.post('/auth/register', { data: buildUserRegistration() });

    await expect(response).toHaveStatus(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty('password');
    expect(body).not.toHaveProperty('password_hash');
  });

  test('the new account can log in and read itself through Location', async ({
    request,
    login,
    withToken,
  }) => {
    const registration = buildUserRegistration();
    const created = await request.post('/auth/register', { data: registration });
    await expect(created).toHaveStatus(201);

    const client = await withToken((await login(registration)).access_token);
    const self = await client.get(created.headers()['location']);

    await expect(self).toHaveStatus(200);
    expect(((await self.json()) as User).email).toBe(registration.email);
  });

  test('stores the email in lowercase', async ({ request }) => {
    const registration = buildUserRegistration();

    const response = await request.post('/auth/register', {
      data: { ...registration, email: registration.email.toUpperCase() },
    });

    await expect(response).toHaveStatus(201);
    expect(((await response.json()) as User).email).toBe(registration.email.toLowerCase());
  });

  test('ignores a role in the body: self-registration is always viewer', async ({ request }) => {
    const response = await request.post('/auth/register', {
      data: { ...buildUserRegistration(), role: 'admin' },
    });

    await expect(response).toHaveStatus(201);
    expect(((await response.json()) as User).role).toBe('viewer');
  });

  test('the new user appears in the admin user list', async ({ request, admin }) => {
    const created = (await (
      await request.post('/auth/register', { data: buildUserRegistration() })
    ).json()) as User;

    const page = (await (await admin.get('/users', { params: { limit: 100 } })).json()) as UserPage;

    expect(page.total).toBe(4);
    expect(page.items.map((user) => user.id)).toContain(created.id);
  });

  test('rejects an email that is already registered with 409', async ({ request }) => {
    const registration = buildUserRegistration();
    await expect(await request.post('/auth/register', { data: registration })).toHaveStatus(201);

    const response = await request.post('/auth/register', { data: registration });

    await expect(response).toBeApiError(409, 'already registered');
  });

  test('detects duplicates regardless of email case', async ({ request }) => {
    const response = await request.post('/auth/register', {
      data: buildUserRegistration({ email: users.admin.email.toUpperCase() }),
    });

    await expect(response).toBeApiError(409, `'${users.admin.email}' is already registered`);
  });

  for (const [field, value] of [
    ['email', 'not-an-email'],
    ['email', 'two words@example.test'],
    ['name', 'X'],
    ['name', 'N'.repeat(121)],
    ['password', 'short'],
    ['password', 'p'.repeat(129)],
  ] as const) {
    test(`rejects an invalid ${field} (${value.length > 20 ? `${value.length} chars` : value}) with 422`, async ({
      request,
    }) => {
      const response = await request.post('/auth/register', {
        data: buildUserRegistration({ [field]: value }),
      });

      await expect(response).toHaveValidationErrorFor(['body', field]);
    });
  }

  test('reports every missing field at once', async ({ request }) => {
    const response = await request.post('/auth/register', { data: {} });

    await expect(response).toHaveValidationErrorFor('email');
    await expect(response).toHaveValidationErrorFor('name');
    await expect(response).toHaveValidationErrorFor('password');
  });

  test('rejects a non-JSON content type with 415', async ({ request }) => {
    const response = await request.post('/auth/register', { form: buildUserRegistration() });

    await expect(response).toBeApiError(415, 'application/json');
  });

  test('rejects a malformed JSON body with 400', async ({ request }) => {
    const response = await request.post('/auth/register', {
      headers: { 'Content-Type': 'application/json' },
      // A Buffer is sent verbatim; a string would be JSON-encoded by Playwright.
      data: Buffer.from("{'email': 'single-quotes@example.test'}"),
    });

    await expect(response).toBeApiError(400, 'not valid JSON');
  });
});
