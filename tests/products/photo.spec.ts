import { test, expect } from '@src/fixtures/api.fixture';
import type { Photo, Product } from '@src/api/types';
import { MISSING_ID, products } from '@src/data/seed';
import { PNG_SIGNATURE, TINY_PNG, fileForm, oversizedBuffer } from './helpers';

const chair = products.chair;
const table = products.table;

const png = (name = 'table.png') => fileForm(name, 'image/png', TINY_PNG);

test.describe('GET /products/{id}/photo', () => {
  test('downloads the binary image with its content type @smoke', async ({ request }) => {
    const response = await request.get(`/products/${chair.id}/photo`);

    await expect(response).toHaveStatus(200);
    expect(response.headers()['content-type']).toBe('image/png');
    const body = await response.body();
    expect(body.subarray(0, PNG_SIGNATURE.length)).toEqual(PNG_SIGNATURE);
    expect(body).toEqual(TINY_PNG);
  });

  test('is served inline by default', async ({ request }) => {
    const response = await request.get(`/products/${chair.id}/photo`);
    expect(response.headers()['content-disposition']).toBe('inline; filename="wooden-chair.png"');
  });

  test('?download=true sends it as an attachment', async ({ request }) => {
    const response = await request.get(`/products/${chair.id}/photo`, { params: { download: true } });
    expect(response.headers()['content-disposition']).toBe('attachment; filename="wooden-chair.png"');
  });

  test('a product without photo is a 404', async ({ request }) => {
    const response = await request.get(`/products/${table.id}/photo`);
    await expect(response).toBeApiError(404, 'has no photo');
  });

  test('an unknown product is a 404', async ({ request }) => {
    const response = await request.get(`/products/${MISSING_ID}/photo`);
    await expect(response).toBeApiError(404, 'not found');
  });
});

test.describe('POST /products/{id}/photo', () => {
  test('clerk uploads a PNG: 201 + Location @smoke', async ({ clerk }) => {
    const response = await clerk.post(`/products/${table.id}/photo`, { multipart: png() });

    await expect(response).toHaveStatus(201);
    expect(response.headers()['location']).toBe(`/products/${table.id}/photo`);
    const photo = (await response.json()) as Photo;
    expect(photo).toEqual({
      product_id: table.id,
      filename: 'table.png',
      content_type: 'image/png',
      size_bytes: TINY_PNG.length,
    });
  });

  test('admin can upload too', async ({ admin }) => {
    const response = await admin.post(`/products/${table.id}/photo`, { multipart: png() });
    await expect(response).toHaveStatus(201);
  });

  test('the uploaded photo can be downloaded and is flagged on the product', async ({ clerk, request }) => {
    await clerk.post(`/products/${table.id}/photo`, { multipart: png() });

    const download = await request.get(`/products/${table.id}/photo`);
    expect(await download.body()).toEqual(TINY_PNG);
    const product = (await (await request.get(`/products/${table.id}`)).json()) as Product;
    expect(product).toMatchObject({ has_photo: true, version: 2 });
  });

  test('a new upload replaces the previous photo', async ({ clerk, request }) => {
    const gif = Buffer.from('GIF89a-not-really-a-gif');

    await clerk.post(`/products/${chair.id}/photo`, { multipart: fileForm('chair.gif', 'image/gif', gif) });

    const download = await request.get(`/products/${chair.id}/photo`);
    expect(download.headers()['content-type']).toBe('image/gif');
    expect(download.headers()['content-disposition']).toContain('filename="chair.gif"');
    expect(await download.body()).toEqual(gif);
  });

  test('a non-image file is a 415', async ({ clerk }) => {
    const response = await clerk.post(`/products/${table.id}/photo`, {
      multipart: fileForm('notes.txt', 'text/plain', 'hello'),
    });
    await expect(response).toBeApiError(415, "Unsupported image type 'text/plain'");
  });

  test('a file above MAX_UPLOAD_BYTES is a 413', async ({ clerk }) => {
    const big = Buffer.concat([TINY_PNG, oversizedBuffer()]);
    const response = await clerk.post(`/products/${table.id}/photo`, {
      multipart: fileForm('huge.png', 'image/png', big),
    });
    await expect(response).toBeApiError(413, 'exceeds');
  });

  test('an empty file is a 422', async ({ clerk }) => {
    const response = await clerk.post(`/products/${table.id}/photo`, {
      multipart: fileForm('empty.png', 'image/png', Buffer.alloc(0)),
    });
    await expect(response).toBeApiError(422, 'File is empty');
  });

  test('a request without a file is a 422', async ({ clerk }) => {
    const response = await clerk.post(`/products/${table.id}/photo`, { multipart: { other: 'value' } });
    await expect(response).toHaveValidationErrorFor('file');
  });

  test('an unknown product is a 404', async ({ clerk }) => {
    const response = await clerk.post(`/products/${MISSING_ID}/photo`, { multipart: png() });
    await expect(response).toBeApiError(404, 'not found');
  });

  test('anonymous is a 401', async ({ request }) => {
    const response = await request.post(`/products/${table.id}/photo`, { multipart: png() });
    await expect(response).toBeApiError(401);
  });

  test('viewer is a 403', async ({ viewer }) => {
    const response = await viewer.post(`/products/${table.id}/photo`, { multipart: png() });
    await expect(response).toBeApiError(403);
  });
});

test.describe('DELETE /products/{id}/photo', () => {
  test('admin removes the photo: 204', async ({ admin, request }) => {
    const response = await admin.delete(`/products/${chair.id}/photo`);

    await expect(response).toHaveStatus(204);
    await expect(await request.get(`/products/${chair.id}/photo`)).toBeApiError(404, 'has no photo');
    const product = (await (await request.get(`/products/${chair.id}`)).json()) as Product;
    expect(product).toMatchObject({ has_photo: false, version: 2 });
  });

  test('a product without photo is a 404', async ({ admin }) => {
    const response = await admin.delete(`/products/${table.id}/photo`);
    await expect(response).toBeApiError(404, 'has no photo');
  });

  test('an unknown product is a 404', async ({ admin }) => {
    const response = await admin.delete(`/products/${MISSING_ID}/photo`);
    await expect(response).toBeApiError(404, 'not found');
  });

  test('anonymous is a 401', async ({ request }) => {
    const response = await request.delete(`/products/${chair.id}/photo`);
    await expect(response).toBeApiError(401);
  });

  test('clerk is a 403', async ({ clerk }) => {
    const response = await clerk.delete(`/products/${chair.id}/photo`);
    await expect(response).toBeApiError(403);
  });

  test('viewer is a 403', async ({ viewer }) => {
    const response = await viewer.delete(`/products/${chair.id}/photo`);
    await expect(response).toBeApiError(403);
  });
});
