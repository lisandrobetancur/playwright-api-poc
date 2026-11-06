import { test as base } from '@playwright/test';
import { PostsClient } from '../clients/posts.client';

type ApiFixtures = {
  postsClient: PostsClient;
};

/**
 * Extends Playwright's `test` with ready-to-use API clients.
 * Import `test` and `expect` from here instead of '@playwright/test'.
 */
export const test = base.extend<ApiFixtures>({
  postsClient: async ({ request }, use) => {
    await use(new PostsClient(request));
  },
});

export { expect } from '@playwright/test';
