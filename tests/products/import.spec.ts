import { test, expect } from '@src/fixtures/api.fixture';
import type { ImportResult, Product } from '@src/api/types';
import { PRODUCT_COUNT, products } from '@src/data/seed';
import { TINY_PNG, csv, fileForm, oversizedBuffer } from './helpers';

/** Two valid rows followed by four invalid ones (duplicate SKU, bad SKU, repeated SKU, unknown category). */
const MIXED_CSV = csv(
  'HND-CUP-003,Tin cup,4,1,4.5,unit,5,Dented,metal|period',
  `${products.chair.sku},Duplicate chair,1,,10,,,,`,
  'bad sku,Broken row,1,,10,,,,',
  'CON-PAINT-002,Black paint,5,,22,set,3,,',
  'HND-CUP-003,Same SKU again,4,,1,,,,',
  'HND-HAT-004,Top hat,99,,15,,,,',
);

const csvFile = (content: string | Buffer, mimeType = 'text/csv') =>
  fileForm('products.csv', mimeType, content);

test.describe('POST /products/import', () => {
  test('creates the valid rows and reports the invalid ones @smoke', async ({ admin }) => {
    const response = await admin.post('/products/import', { multipart: csvFile(MIXED_CSV) });

    await expect(response).toHaveStatus(200);
    const result = (await response.json()) as ImportResult;
    expect(result).toMatchObject({
      dry_run: false,
      rows: 6,
      created: 2,
      created_ids: [PRODUCT_COUNT + 1, PRODUCT_COUNT + 2],
    });
    expect(result.errors.map(({ row, sku }) => ({ row, sku }))).toEqual([
      { row: 2, sku: products.chair.sku },
      { row: 3, sku: 'bad sku' },
      { row: 5, sku: 'HND-CUP-003' },
      { row: 6, sku: 'HND-HAT-004' },
    ]);
  });

  test('each error explains why the row was rejected', async ({ admin }) => {
    const response = await admin.post('/products/import', { multipart: csvFile(MIXED_CSV) });

    const messages = ((await response.json()) as ImportResult).errors.map((error) => error.message);
    expect(messages[0]).toContain('already exists');
    expect(messages[1]).toMatch(/^sku: /);
    expect(messages[2]).toContain('repeated in the file');
    expect(messages[3]).toContain('Category 99 does not exist');
  });

  test('imported products are saved with their CSV values', async ({ admin, request }) => {
    const result = (await (
      await admin.post('/products/import', { multipart: csvFile(MIXED_CSV) })
    ).json()) as ImportResult;

    const product = (await (await request.get(`/products/${result.created_ids[0]}`)).json()) as Product;
    expect(product).toMatchObject({
      sku: 'HND-CUP-003',
      name: 'Tin cup',
      category_id: 4,
      supplier_id: 1,
      unit_price: 4.5,
      unit: 'unit',
      reorder_level: 5,
      description: 'Dented',
      tags: ['metal', 'period'],
    });
  });

  test('dry_run=true validates without saving anything', async ({ admin, request }) => {
    const response = await admin.post('/products/import', {
      params: { dry_run: true },
      multipart: csvFile(MIXED_CSV),
    });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toMatchObject({ dry_run: true, rows: 6, created: 2, created_ids: [] });
    expect((await request.head('/products')).headers()['x-total-count']).toBe(String(PRODUCT_COUNT));
  });

  test('a header-only file imports nothing', async ({ admin }) => {
    const response = await admin.post('/products/import', { multipart: csvFile(csv()) });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toEqual({
      dry_run: false,
      rows: 0,
      created: 0,
      created_ids: [],
      errors: [],
    });
  });

  test('accepts a UTF-8 BOM and a text/plain file', async ({ admin }) => {
    const content = '﻿' + 'sku,name,category_id,unit_price\nHND-FAN-005,Paper fan,4,3\n';

    const response = await admin.post('/products/import', { multipart: csvFile(content, 'text/plain') });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toMatchObject({ created: 1, errors: [] });
  });

  test('missing required columns is a 400', async ({ admin }) => {
    const response = await admin.post('/products/import', { multipart: csvFile('foo,bar\n1,2\n') });
    await expect(response).toBeApiError(400, 'missing required columns: sku, name, category_id, unit_price');
  });

  test('a non-UTF-8 file is a 400', async ({ admin }) => {
    const latin1 = Buffer.from('sku,name,category_id,unit_price\nHND-X-001,Caf\xe9,4,1\n', 'latin1');
    const response = await admin.post('/products/import', { multipart: csvFile(latin1) });
    await expect(response).toBeApiError(400, 'UTF-8');
  });

  test('a non-CSV file is a 415', async ({ admin }) => {
    const response = await admin.post('/products/import', {
      multipart: fileForm('photo.png', 'image/png', TINY_PNG),
    });
    await expect(response).toBeApiError(415, 'Expected a CSV file');
  });

  test('a file above MAX_UPLOAD_BYTES is a 413', async ({ admin }) => {
    const header = Buffer.from('sku,name,category_id,unit_price\n');
    const content = Buffer.concat([header, oversizedBuffer('#')]);

    const response = await admin.post('/products/import', { multipart: csvFile(content) });

    await expect(response).toBeApiError(413, 'exceeds');
  });

  test('a request without a file is a 422', async ({ admin }) => {
    const response = await admin.post('/products/import', { multipart: { other: 'value' } });
    await expect(response).toHaveValidationErrorFor('file');
  });

  test('anonymous is a 401', async ({ request }) => {
    const response = await request.post('/products/import', { multipart: csvFile(MIXED_CSV) });
    await expect(response).toBeApiError(401);
  });

  test('clerk is a 403', async ({ clerk }) => {
    const response = await clerk.post('/products/import', { multipart: csvFile(MIXED_CSV) });
    await expect(response).toBeApiError(403);
  });

  test('viewer is a 403', async ({ viewer }) => {
    const response = await viewer.post('/products/import', { multipart: csvFile(MIXED_CSV) });
    await expect(response).toBeApiError(403);
  });
});
