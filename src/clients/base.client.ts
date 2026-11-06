import type { APIRequestContext } from '@playwright/test';

/**
 * Base client: receives Playwright's APIRequestContext, which already carries
 * the baseURL and headers defined in playwright.config.ts.
 */
export abstract class BaseClient {
  constructor(protected readonly request: APIRequestContext) {}
}
