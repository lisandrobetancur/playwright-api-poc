import type { APIRequestContext } from '@playwright/test';
import { test, expect } from '@src/fixtures/api.fixture';
import type { Job, LowStockAlert, ReportRequest } from '@src/api/types';
import { products } from '@src/data/seed';

/** Long enough that the job is never finished while a test runs (the reset clears it afterwards). */
const SLOW = 60;

async function startReport(client: APIRequestContext, body: ReportRequest) {
  const response = await client.post('/reports', { data: body });
  await expect(response).toHaveStatus(202);
  return { response, job: (await response.json()) as Job };
}

/** Poll `GET /jobs/{id}` until the job reports `completed`, then return it. */
async function waitForCompletion(client: APIRequestContext, jobId: string): Promise<Job> {
  let job: Job | undefined;
  await expect
    .poll(
      async () => {
        const response = await client.get(`/jobs/${jobId}`);
        await expect(response).toHaveStatus(200);
        job = (await response.json()) as Job;
        return job.status;
      },
      { intervals: [200, 250, 500], timeout: 5_000 },
    )
    .toBe('completed');
  return job!;
}

test.describe('POST /reports', () => {
  test('starts a job: 202 with Location and Retry-After @smoke', async ({ viewer }) => {
    const { response, job } = await startReport(viewer, { type: 'inventory', duration_seconds: SLOW });

    expect(response.headers()['location']).toBe(`/jobs/${job.id}`);
    expect(response.headers()['retry-after']).toBe('30'); // ceil(duration / 2)
    expect(job).toMatchObject({
      type: 'inventory',
      format: 'csv',
      status: 'pending',
      progress: 0,
      download_url: null,
    });
  });

  test('Retry-After is at least 1 second for short jobs', async ({ viewer }) => {
    const { response } = await startReport(viewer, { type: 'movements', duration_seconds: 0.5 });

    expect(response.headers()['retry-after']).toBe('1');
  });

  test('a zero-duration job is completed immediately', async ({ viewer }) => {
    const { job } = await startReport(viewer, { type: 'low_stock', duration_seconds: 0 });

    expect(job).toMatchObject({
      status: 'completed',
      progress: 100,
      download_url: `/jobs/${job.id}/download`,
    });
  });

  test('rejects anonymous callers with 401', async ({ request }) => {
    const response = await request.post('/reports', { data: { type: 'inventory' } });

    await expect(response).toBeApiError(401);
    expect(response.headers()['www-authenticate']).toBeTruthy();
  });

  test('rejects an unknown report type with 422', async ({ viewer }) => {
    const response = await viewer.post('/reports', { data: { type: 'sales' } });

    await expect(response).toHaveValidationErrorFor('type');
  });

  test('rejects an unknown format with 422', async ({ viewer }) => {
    const response = await viewer.post('/reports', { data: { type: 'inventory', format: 'xlsx' } });

    await expect(response).toHaveValidationErrorFor('format');
  });

  test('rejects a duration outside 0-60 seconds with 422', async ({ viewer }) => {
    for (const duration_seconds of [-1, 61]) {
      const response = await viewer.post('/reports', { data: { type: 'inventory', duration_seconds } });
      await expect(response).toHaveValidationErrorFor('duration_seconds');
    }
  });

  test('rejects a missing type with 422', async ({ viewer }) => {
    const response = await viewer.post('/reports', { data: { format: 'csv' } });

    await expect(response).toHaveValidationErrorFor('type');
  });
});

test.describe('GET /jobs/{id}', () => {
  test('an unfinished job carries Retry-After: 1 and no download_url', async ({ viewer }) => {
    const { job } = await startReport(viewer, { type: 'inventory', duration_seconds: SLOW });

    const response = await viewer.get(`/jobs/${job.id}`);

    await expect(response).toHaveStatus(200);
    expect(response.headers()['retry-after']).toBe('1');
    expect(((await response.json()) as Job).download_url).toBeNull();
  });

  test('progresses to completed with a download_url @smoke', async ({ viewer }) => {
    const { job } = await startReport(viewer, { type: 'inventory', duration_seconds: 1 });

    const done = await waitForCompletion(viewer, job.id);

    expect(done).toMatchObject({ id: job.id, progress: 100, download_url: `/jobs/${job.id}/download` });
  });

  test('a completed job has no Retry-After header', async ({ viewer }) => {
    const { job } = await startReport(viewer, { type: 'inventory', duration_seconds: 0 });

    const response = await viewer.get(`/jobs/${job.id}`);

    await expect(response).toHaveStatus(200);
    expect(response.headers()['retry-after']).toBeUndefined();
  });

  test('passes through running before it completes', async ({ viewer }) => {
    const { job } = await startReport(viewer, { type: 'movements', duration_seconds: 1 });

    await expect
      .poll(async () => ((await (await viewer.get(`/jobs/${job.id}`)).json()) as Job).status, {
        intervals: [100],
        timeout: 2_000,
      })
      .toBe('running');
  });

  test('any role can poll a job created by another user', async ({ admin, viewer }) => {
    const { job } = await startReport(admin, { type: 'inventory', duration_seconds: 0 });

    await expect(await viewer.get(`/jobs/${job.id}`)).toHaveStatus(200);
  });

  test('an unknown job gives 404', async ({ viewer }) => {
    await expect(await viewer.get('/jobs/does-not-exist')).toBeApiError(404, 'not found');
  });

  test('anonymous polling gives 401', async ({ viewer, request }) => {
    const { job } = await startReport(viewer, { type: 'inventory', duration_seconds: 0 });

    await expect(await request.get(`/jobs/${job.id}`)).toBeApiError(401);
  });

  test('the reset clears every job', async ({ viewer, request, login, withToken }) => {
    const { job } = await startReport(viewer, { type: 'inventory', duration_seconds: 0 });

    await expect(await request.post('/__reset')).toHaveStatus(200);

    const client = await withToken((await login('viewer')).access_token);
    await expect(await client.get(`/jobs/${job.id}`)).toBeApiError(404);
  });
});

test.describe('GET /jobs/{id}/download', () => {
  test('downloads the inventory report as a CSV attachment @smoke', async ({ viewer }) => {
    const { job } = await startReport(viewer, { type: 'inventory', format: 'csv', duration_seconds: 1 });
    const done = await waitForCompletion(viewer, job.id);

    const response = await viewer.get(done.download_url!);

    await expect(response).toHaveStatus(200);
    expect(response.headers()['content-type']).toContain('text/csv');
    expect(response.headers()['content-disposition']).toBe('attachment; filename="inventory-report.csv"');
    const [header, ...rows] = (await response.text()).trim().split('\n');
    expect(header).toBe('sku,name,warehouse,quantity,value');
    expect(rows).toContainEqual(expect.stringMatching(/^FUR-CHAIR-001,Wooden chair,WH-MAIN,40,/));
  });

  test('downloads the low-stock report as a JSON attachment', async ({ viewer }) => {
    const { job } = await startReport(viewer, { type: 'low_stock', format: 'json', duration_seconds: 0 });

    const response = await viewer.get(`/jobs/${job.id}/download`);

    await expect(response).toHaveStatus(200);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headers()['content-disposition']).toBe('attachment; filename="low-stock-report.json"');
    const rows = (await response.json()) as Omit<LowStockAlert, 'product_id' | 'warehouse_id'>[];
    expect(rows.map((row) => row.sku)).toEqual([products.spotlight.sku, products.tape.sku]);
    expect(rows[0]).toEqual({
      sku: products.spotlight.sku,
      name: expect.any(String),
      quantity: 4,
      reorder_level: 4,
      shortage: 0,
    });
  });

  test('downloads the movements report with one row per seed movement', async ({ viewer }) => {
    const { job } = await startReport(viewer, { type: 'movements', format: 'csv', duration_seconds: 0 });

    const response = await viewer.get(`/jobs/${job.id}/download`);

    await expect(response).toHaveStatus(200);
    expect(response.headers()['content-disposition']).toContain('filename="movements-report.csv"');
    const lines = (await response.text()).trim().split('\n');
    expect(lines[0]).toBe(
      'id,type,product_id,from_warehouse_id,to_warehouse_id,quantity,reference,created_at',
    );
    expect(lines).toHaveLength(1 + 11);
  });

  test('gives 409 with Retry-After while the job is unfinished', async ({ viewer }) => {
    const { job } = await startReport(viewer, { type: 'inventory', duration_seconds: SLOW });

    const response = await viewer.get(`/jobs/${job.id}/download`);

    await expect(response).toBeApiError(409, /still (pending|running)/);
    expect(response.headers()['retry-after']).toBe('1');
  });

  test('gives 404 for an unknown job', async ({ viewer }) => {
    await expect(await viewer.get('/jobs/does-not-exist/download')).toBeApiError(404);
  });

  test('gives 401 to anonymous callers', async ({ viewer, request }) => {
    const { job } = await startReport(viewer, { type: 'inventory', duration_seconds: 0 });

    await expect(await request.get(`/jobs/${job.id}/download`)).toBeApiError(401);
  });
});
