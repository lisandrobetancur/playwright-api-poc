import { test as base } from '@playwright/test';
import { PostsClient } from '../clients/posts.client';

type ApiFixtures = {
  postsClient: PostsClient;
};

/**
 * Extiende el `test` de Playwright con clientes de API listos para usar.
 * Importa `test` y `expect` desde aquí en lugar de '@playwright/test'.
 */
export const test = base.extend<ApiFixtures>({
  postsClient: async ({ request }, use) => {
    await use(new PostsClient(request));
  },
});

export { expect } from '@playwright/test';
