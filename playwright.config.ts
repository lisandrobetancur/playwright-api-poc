import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

const isCI = !!process.env.CI;

/**
 * Playwright configuration for API testing only.
 * No browsers are used: tests rely on the `request` fixture (APIRequestContext).
 * Docs: https://playwright.dev/docs/api-testing
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 2 : undefined,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: isCI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.API_BASE_URL || 'https://jsonplaceholder.typicode.com',
    extraHTTPHeaders: {
      Accept: 'application/json',
      ...(process.env.API_TOKEN ? { Authorization: `Bearer ${process.env.API_TOKEN}` } : {}),
    },
    ignoreHTTPSErrors: false,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'api',
      testMatch: /.*\.spec\.ts/,
    },
  ],
});
