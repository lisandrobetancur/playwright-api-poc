import { defineConfig } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '.env'), quiet: true });

const isCI = !!process.env.CI;

/**
 * Playwright configuration for API testing only (no browsers).
 *
 * The Prop Room API keeps its data in memory and `POST /__reset` restores the seed data for the whole
 * server, so tests run serially in a single worker: each test resets the data before it starts.
 * Docs: https://playwright.dev/docs/api-testing
 */
export default defineConfig({
  testDir: './tests',
  globalSetup: './src/support/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: isCI
    ? [['list'], ['html', { open: 'never' }], ['junit', { outputFile: 'test-results/junit.xml' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: process.env.API_BASE_URL || 'http://localhost:8000',
    extraHTTPHeaders: { Accept: 'application/json' },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'api', testMatch: /.*\.spec\.ts/ }],
});
