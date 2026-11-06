import { test as base, type APIRequestContext } from '@playwright/test';
import type { TokenPair } from '../api/types';
import { users, type RoleName } from '../data/seed';
import { env } from '../support/env';

export { expect } from '../support/assertions';

export type Credentials = { email: string; password: string };

type Options = {
  /** Restore the seed data with `POST /__reset` before each test. Disable with `test.use({ resetData: false })`. */
  resetData: boolean;
};

type ApiFixtures = {
  /** Auto fixture that performs the reset (when `resetData` is true). */
  seed: void;
  /** Log in with JSON credentials and return the token pair. Asserts the login succeeded. */
  login: (who: RoleName | Credentials, extra?: { expires_in?: number }) => Promise<TokenPair>;
  /** New request context that sends `Authorization: Bearer <token>`. Disposed after the test. */
  withToken: (accessToken: string) => Promise<APIRequestContext>;
  /** New request context with arbitrary extra headers. Disposed after the test. */
  withHeaders: (headers: Record<string, string>) => Promise<APIRequestContext>;
  /** Request contexts already authenticated as each seed user. */
  admin: APIRequestContext;
  clerk: APIRequestContext;
  viewer: APIRequestContext;
  /** Request context that sends the valid `X-API-Key` header (supplier writes). */
  apiKeyClient: APIRequestContext;
};

/**
 * Import `test` and `expect` from here instead of '@playwright/test'.
 *
 * - `request` (built in) is the anonymous client.
 * - `admin` / `clerk` / `viewer` log in once per test, after the reset (which also clears revoked tokens,
 *   idempotency keys, rate limits and jobs).
 */
export const test = base.extend<Options & ApiFixtures>({
  resetData: [true, { option: true }],

  seed: [
    async ({ request, resetData }, use) => {
      if (resetData) {
        const response = await request.post('/__reset');
        if (!response.ok()) {
          throw new Error(`POST /__reset failed with ${response.status()}: ${await response.text()}`);
        }
      }
      await use();
    },
    { auto: true },
  ],

  login: async ({ request, seed: _seed }, use) => {
    await use(async (who, extra = {}) => {
      const credentials = typeof who === 'string' ? users[who] : who;
      const response = await request.post('/auth/login', {
        data: { email: credentials.email, password: credentials.password, ...extra },
      });
      if (!response.ok()) {
        throw new Error(
          `Login as ${credentials.email} failed with ${response.status()}: ${await response.text()}`,
        );
      }
      return (await response.json()) as TokenPair;
    });
  },

  withHeaders: async ({ playwright, baseURL }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (headers) => {
      const context = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { Accept: 'application/json', ...headers },
      });
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((context) => context.dispose()));
  },

  withToken: async ({ withHeaders }, use) => {
    await use((accessToken) => withHeaders({ Authorization: `Bearer ${accessToken}` }));
  },

  admin: async ({ login, withToken }, use) => {
    await use(await withToken((await login('admin')).access_token));
  },

  clerk: async ({ login, withToken }, use) => {
    await use(await withToken((await login('clerk')).access_token));
  },

  viewer: async ({ login, withToken }, use) => {
    await use(await withToken((await login('viewer')).access_token));
  },

  apiKeyClient: async ({ withHeaders }, use) => {
    await use(await withHeaders({ 'X-API-Key': env.apiKey }));
  },
});
