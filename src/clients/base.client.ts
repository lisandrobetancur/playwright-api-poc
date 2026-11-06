import type { APIRequestContext } from '@playwright/test';

/**
 * Cliente base: recibe el APIRequestContext de Playwright (que ya trae
 * baseURL y headers definidos en playwright.config.ts).
 */
export abstract class BaseClient {
  constructor(protected readonly request: APIRequestContext) {}
}
