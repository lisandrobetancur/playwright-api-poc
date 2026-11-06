import { test, expect } from '@src/fixtures/api.fixture';

test.describe('Health', () => {
  test('GET /health reports the API is alive @smoke', async ({ request }) => {
    const response = await request.get('/health');

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toEqual(expect.objectContaining({ status: expect.any(String) }));
  });

  test('HEAD /health answers 200 without a body', async ({ request }) => {
    const response = await request.head('/health');

    await expect(response).toHaveStatus(200);
    expect(await response.body()).toHaveLength(0);
  });

  test('every response carries X-Request-ID, echoing the one sent', async ({ request }) => {
    const generated = await request.get('/health');
    expect(generated.headers()['x-request-id']).toBeTruthy();

    const echoed = await request.get('/health', { headers: { 'X-Request-ID': 'playwright-req-1' } });
    expect(echoed.headers()['x-request-id']).toBe('playwright-req-1');
  });

  test('the seeded users can log in after a reset @smoke', async ({ admin, clerk, viewer }) => {
    for (const [client, role] of [
      [admin, 'admin'],
      [clerk, 'warehouse_clerk'],
      [viewer, 'viewer'],
    ] as const) {
      const response = await client.get('/auth/me');
      await expect(response).toHaveStatus(200);
      expect((await response.json()).role).toBe(role);
    }
  });
});
