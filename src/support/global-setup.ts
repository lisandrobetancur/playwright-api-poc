import { request } from '@playwright/test';
import { env } from './env';

/** Fails fast with a clear message when the API under test is not reachable. */
export default async function globalSetup(): Promise<void> {
  const context = await request.newContext({ baseURL: env.baseURL });
  try {
    const response = await context.get('/health', { timeout: 10_000 });
    if (!response.ok()) {
      throw new Error(`GET /health answered ${response.status()}`);
    }
  } catch (error) {
    throw new Error(
      `Prop Room API is not reachable at ${env.baseURL}. Start it (make run) or set API_BASE_URL.\n${error}`,
    );
  } finally {
    await context.dispose();
  }
}
