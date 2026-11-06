import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '@src/fixtures/api.fixture';
import { uniqueSuffix } from '@src/data/factories';

const LIMIT = 5; // RATE_LIMIT default

type RateLimitOut = { client: string; limit: number; remaining: number; reset_in_seconds: number };

const hit = (request: APIRequestContext, clientId: string) =>
  request.get('/rate-limited', { headers: { 'X-Client-Id': clientId } });

test.describe('GET /rate-limited', () => {
  test('reports the limit, remaining calls and reset in headers and body', async ({ request }) => {
    const clientId = `pw-${uniqueSuffix()}`;

    const response = await hit(request, clientId);

    await expect(response).toHaveStatus(200);
    const headers = response.headers();
    expect(headers['x-ratelimit-limit']).toBe(String(LIMIT));
    expect(headers['x-ratelimit-remaining']).toBe(String(LIMIT - 1));
    expect(Number(headers['x-ratelimit-reset'])).toBeGreaterThanOrEqual(1);
    expect((await response.json()) as RateLimitOut).toMatchObject({
      client: clientId,
      limit: LIMIT,
      remaining: LIMIT - 1,
    });
  });

  test('counts down and answers 429 + Retry-After on the 6th call @smoke', async ({ request }) => {
    const clientId = `pw-${uniqueSuffix()}`;
    for (let remaining = LIMIT - 1; remaining >= 0; remaining--) {
      const response = await hit(request, clientId);
      await expect(response).toHaveStatus(200);
      expect(response.headers()['x-ratelimit-remaining']).toBe(String(remaining));
    }

    const blocked = await hit(request, clientId);

    await expect(blocked).toBeApiError(429, 'Too many requests');
    expect(Number(blocked.headers()['retry-after'])).toBeGreaterThanOrEqual(1);
    expect(blocked.headers()['x-ratelimit-remaining']).toBe('0');
    expect(blocked.headers()['x-ratelimit-limit']).toBe(String(LIMIT));
  });

  test('buckets are isolated by X-Client-Id', async ({ request }) => {
    const exhausted = `pw-${uniqueSuffix()}`;
    for (let i = 0; i <= LIMIT; i++) await hit(request, exhausted);
    await expect(await hit(request, exhausted)).toHaveStatus(429);

    const other = await hit(request, `pw-${uniqueSuffix()}`);

    await expect(other).toHaveStatus(200);
    expect(other.headers()['x-ratelimit-remaining']).toBe(String(LIMIT - 1));
  });

  test('the reset clears the rate limits', async ({ request }) => {
    const clientId = `pw-${uniqueSuffix()}`;
    for (let i = 0; i < LIMIT; i++) await hit(request, clientId);
    await expect(await hit(request, clientId)).toHaveStatus(429);

    await expect(await request.post('/__reset')).toHaveStatus(200);

    await expect(await hit(request, clientId)).toHaveStatus(200);
  });
});
