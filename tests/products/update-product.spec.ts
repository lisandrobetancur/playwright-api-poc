import { test, expect } from '@src/fixtures/api.fixture';
import type { Product, ProductReplace, ProductUpdate } from '@src/api/types';
import { MISSING_ID, categories, products, suppliers } from '@src/data/seed';
import { buildProduct } from '@src/data/factories';

const table = products.table;

/** A full replacement for the table that keeps its SKU. */
function replacement(overrides: Partial<ProductReplace> = {}): ProductReplace {
  return buildProduct({ sku: table.sku, category_id: categories.furniture.id, ...overrides });
}

test.describe('PUT /products/{id}', () => {
  test('admin replaces a product and the version is bumped @smoke', async ({ admin }) => {
    const body = replacement({ name: 'Banquet table', unit_price: 150 });

    const response = await admin.put(`/products/${table.id}`, { data: body });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toMatchObject({ ...body, id: table.id, version: 2 });
    expect(response.headers()['etag']).toBe(`"product-${table.id}-v2"`);
  });

  test('the replacement is persisted', async ({ admin, request }) => {
    await admin.put(`/products/${table.id}`, { data: replacement({ name: 'Banquet table' }) });

    const product = (await (await request.get(`/products/${table.id}`)).json()) as Product;
    expect(product.name).toBe('Banquet table');
  });

  test('omitted optional fields are reset to their defaults', async ({ admin }) => {
    const body: ProductReplace = {
      sku: table.sku,
      name: 'Bare table',
      category_id: categories.furniture.id,
      unit_price: 99,
    };

    const response = await admin.put(`/products/${table.id}`, { data: body });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toMatchObject({
      description: '',
      supplier_id: null,
      tags: [],
      dimensions: null,
      reorder_level: 0,
      unit: 'unit',
      active: true,
    });
  });

  test('a matching If-Match is accepted', async ({ admin, request }) => {
    const etag = (await request.get(`/products/${table.id}`)).headers()['etag'];

    const response = await admin.put(`/products/${table.id}`, {
      data: replacement(),
      headers: { 'If-Match': etag },
    });

    await expect(response).toHaveStatus(200);
  });

  test('a stale If-Match is a 412', async ({ admin, request }) => {
    const etag = (await request.get(`/products/${table.id}`)).headers()['etag'];
    await admin.put(`/products/${table.id}`, { data: replacement() });

    const response = await admin.put(`/products/${table.id}`, {
      data: replacement(),
      headers: { 'If-Match': etag },
    });

    await expect(response).toBeApiError(412, 'If-Match');
  });

  test("another product's SKU is a 409", async ({ admin }) => {
    const response = await admin.put(`/products/${table.id}`, {
      data: replacement({ sku: products.chair.sku }),
    });
    await expect(response).toBeApiError(409, 'already exists');
  });

  test('a missing required field is a 422', async ({ admin }) => {
    const { unit_price: _price, ...incomplete } = replacement();
    const response = await admin.put(`/products/${table.id}`, { data: incomplete });
    await expect(response).toHaveValidationErrorFor('unit_price');
  });

  test('an unknown category is a 422', async ({ admin }) => {
    const response = await admin.put(`/products/${table.id}`, { data: replacement({ category_id: 99 }) });
    await expect(response).toBeApiError(422, 'Category 99 does not exist');
  });

  test('an unknown product is a 404', async ({ admin }) => {
    const response = await admin.put(`/products/${MISSING_ID}`, { data: replacement() });
    await expect(response).toBeApiError(404, 'not found');
  });

  test('a non-JSON body is a 415', async ({ admin }) => {
    const response = await admin.put(`/products/${table.id}`, {
      data: 'name=Table',
      headers: { 'Content-Type': 'text/plain' },
    });
    await expect(response).toBeApiError(415);
  });

  test('anonymous is a 401', async ({ request }) => {
    const response = await request.put(`/products/${table.id}`, { data: replacement() });
    await expect(response).toBeApiError(401);
  });

  test('clerk is a 403', async ({ clerk }) => {
    const response = await clerk.put(`/products/${table.id}`, { data: replacement() });
    await expect(response).toBeApiError(403);
  });

  test('viewer is a 403', async ({ viewer }) => {
    const response = await viewer.put(`/products/${table.id}`, { data: replacement() });
    await expect(response).toBeApiError(403);
  });
});

test.describe('PATCH /products/{id}', () => {
  const lamp = products.lamp;

  test('admin changes only the fields sent @smoke', async ({ admin, request }) => {
    const before = (await (await request.get(`/products/${lamp.id}`)).json()) as Product;
    const patch: ProductUpdate = { unit_price: 33.3, tags: ['period'] };

    const response = await admin.patch(`/products/${lamp.id}`, { data: patch });

    await expect(response).toHaveStatus(200);
    const after = (await response.json()) as Product;
    expect(after).toMatchObject({
      ...patch,
      name: before.name,
      sku: before.sku,
      version: before.version + 1,
    });
    expect(response.headers()['etag']).toBe(`"product-${lamp.id}-v2"`);
  });

  test('accepts application/merge-patch+json', async ({ admin }) => {
    const response = await admin.patch(`/products/${lamp.id}`, {
      data: JSON.stringify({ unit_price: 31.5 }),
      headers: { 'Content-Type': 'application/merge-patch+json' },
    });

    await expect(response).toHaveStatus(200);
    expect(((await response.json()) as Product).unit_price).toBe(31.5);
  });

  test('null removes a nullable field (supplier)', async ({ admin }) => {
    const response = await admin.patch(`/products/${lamp.id}`, {
      data: JSON.stringify({ supplier_id: null }),
      headers: { 'Content-Type': 'application/merge-patch+json' },
    });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toMatchObject({ supplier_id: null, supplier: null });
  });

  test('null on a required field is a 422', async ({ admin }) => {
    const response = await admin.patch(`/products/${lamp.id}`, { data: { name: null } });
    await expect(response).toBeApiError(422, "Field 'name' cannot be null");
  });

  test('changing the supplier updates the nested reference', async ({ admin }) => {
    const response = await admin.patch(`/products/${lamp.id}`, { data: { supplier_id: suppliers.acme.id } });
    expect(((await response.json()) as Product).supplier).toEqual({
      id: suppliers.acme.id,
      name: suppliers.acme.name,
    });
  });

  test('an invalid value is a 422', async ({ admin }) => {
    const response = await admin.patch(`/products/${lamp.id}`, { data: { reorder_level: -5 } });
    await expect(response).toHaveValidationErrorFor('reorder_level');
  });

  test('an unknown supplier is a 422', async ({ admin }) => {
    const response = await admin.patch(`/products/${lamp.id}`, { data: { supplier_id: 99 } });
    await expect(response).toBeApiError(422, 'Supplier 99 does not exist');
  });

  test("another product's SKU is a 409", async ({ admin }) => {
    const response = await admin.patch(`/products/${lamp.id}`, { data: { sku: products.chair.sku } });
    await expect(response).toBeApiError(409, 'already exists');
  });

  test('a matching If-Match is accepted, also as a weak ETag or *', async ({ admin }) => {
    const etag = `"product-${lamp.id}-v1"`;
    await expect(
      await admin.patch(`/products/${lamp.id}`, { data: { name: 'Lamp A' }, headers: { 'If-Match': etag } }),
    ).toHaveStatus(200);
    await expect(
      await admin.patch(`/products/${lamp.id}`, {
        data: { name: 'Lamp B' },
        headers: { 'If-Match': `W/"product-${lamp.id}-v2"` },
      }),
    ).toHaveStatus(200);
    await expect(
      await admin.patch(`/products/${lamp.id}`, { data: { name: 'Lamp C' }, headers: { 'If-Match': '*' } }),
    ).toHaveStatus(200);
  });

  test('a stale If-Match is a 412 and nothing changes', async ({ admin, request }) => {
    const response = await admin.patch(`/products/${lamp.id}`, {
      data: { name: 'Should not be saved' },
      headers: { 'If-Match': '"product-3-v0"' },
    });

    await expect(response).toBeApiError(412);
    const product = (await (await request.get(`/products/${lamp.id}`)).json()) as Product;
    expect(product).toMatchObject({ name: 'Oil lamp replica', version: 1 });
  });

  test('an unknown product is a 404', async ({ admin }) => {
    const response = await admin.patch(`/products/${MISSING_ID}`, { data: { name: 'Ghost' } });
    await expect(response).toBeApiError(404, 'not found');
  });

  test('a non-JSON body is a 415', async ({ admin }) => {
    const response = await admin.patch(`/products/${lamp.id}`, { form: { name: 'Lamp' } });
    await expect(response).toBeApiError(415);
  });

  test('anonymous is a 401', async ({ request }) => {
    const response = await request.patch(`/products/${lamp.id}`, { data: { name: 'Lamp' } });
    await expect(response).toBeApiError(401);
  });

  test('clerk is a 403', async ({ clerk }) => {
    const response = await clerk.patch(`/products/${lamp.id}`, { data: { name: 'Lamp' } });
    await expect(response).toBeApiError(403);
  });

  test('viewer is a 403', async ({ viewer }) => {
    const response = await viewer.patch(`/products/${lamp.id}`, { data: { name: 'Lamp' } });
    await expect(response).toBeApiError(403);
  });
});
