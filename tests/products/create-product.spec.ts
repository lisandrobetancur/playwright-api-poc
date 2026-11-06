import { test, expect } from '@src/fixtures/api.fixture';
import type { Product, ProductCreate } from '@src/api/types';
import { PRODUCT_COUNT, categories, products, suppliers } from '@src/data/seed';
import { buildProduct } from '@src/data/factories';

test.describe('POST /products', () => {
  test('admin creates a product: 201 + Location + ETag @smoke', async ({ admin }) => {
    const body = buildProduct({ category_id: categories.lighting.id, supplier_id: suppliers.lumen.id });

    const response = await admin.post('/products', { data: body });

    await expect(response).toHaveStatus(201);
    const product = (await response.json()) as Product;
    expect(product).toMatchObject({
      ...body,
      category: { id: categories.lighting.id, name: categories.lighting.name },
      supplier: { id: suppliers.lumen.id, name: suppliers.lumen.name },
      total_stock: 0,
      has_photo: false,
      version: 1,
    });
    expect(response.headers()['location']).toBe(`/products/${product.id}`);
    expect(response.headers()['etag']).toBe(`"product-${product.id}-v1"`);
  });

  test('the new product can be fetched and is counted in the list', async ({ admin, request }) => {
    const created = (await (await admin.post('/products', { data: buildProduct() })).json()) as Product;

    const fetched = await request.get(`/products/${created.id}`);
    await expect(fetched).toHaveStatus(200);
    expect(await fetched.json()).toEqual(created);

    const head = await request.head('/products');
    expect(head.headers()['x-total-count']).toBe(String(PRODUCT_COUNT + 1));
  });

  test('omitted optional fields take their defaults', async ({ admin }) => {
    const minimal: ProductCreate = {
      sku: buildProduct().sku,
      name: 'Minimal prop',
      category_id: categories.handProps.id,
      unit_price: 0,
    };

    const response = await admin.post('/products', { data: minimal });

    await expect(response).toHaveStatus(201);
    expect(await response.json()).toMatchObject({
      description: '',
      supplier_id: null,
      supplier: null,
      unit: 'unit',
      reorder_level: 0,
      tags: [],
      dimensions: null,
      active: true,
    });
  });

  test('a duplicate SKU is a 409', async ({ admin }) => {
    const response = await admin.post('/products', { data: buildProduct({ sku: products.chair.sku }) });
    await expect(response).toBeApiError(409, `SKU '${products.chair.sku}' already exists`);
  });

  test.describe('permissions', () => {
    test('anonymous is a 401 with WWW-Authenticate', async ({ request }) => {
      const response = await request.post('/products', { data: buildProduct() });

      await expect(response).toBeApiError(401);
      expect(response.headers()['www-authenticate']).toBeTruthy();
    });

    test('an invalid token is a 401', async ({ withToken }) => {
      const client = await withToken('not-a-real-token');
      const response = await client.post('/products', { data: buildProduct() });
      await expect(response).toBeApiError(401);
    });

    test('clerk is a 403', async ({ clerk }) => {
      const response = await clerk.post('/products', { data: buildProduct() });
      await expect(response).toBeApiError(403);
    });

    test('viewer is a 403', async ({ viewer }) => {
      const response = await viewer.post('/products', { data: buildProduct() });
      await expect(response).toBeApiError(403);
    });
  });

  test.describe('validation', () => {
    test('a lowercase SKU with spaces is a 422', async ({ admin }) => {
      const response = await admin.post('/products', { data: buildProduct({ sku: 'bad sku' }) });
      await expect(response).toHaveValidationErrorFor('sku');
    });

    test('a negative unit_price is a 422', async ({ admin }) => {
      const response = await admin.post('/products', { data: buildProduct({ unit_price: -1 }) });
      await expect(response).toHaveValidationErrorFor('unit_price');
    });

    test('every invalid field is reported', async ({ admin }) => {
      const response = await admin.post('/products', { data: buildProduct({ sku: 'x', unit_price: -1 }) });

      await expect(response).toHaveValidationErrorFor('sku');
      await expect(response).toHaveValidationErrorFor('unit_price');
    });

    test('a missing required field is a 422', async ({ admin }) => {
      const { name: _name, ...withoutName } = buildProduct();
      const response = await admin.post('/products', { data: withoutName });
      await expect(response).toHaveValidationErrorFor('name');
    });

    test('an unknown unit is a 422', async ({ admin }) => {
      const response = await admin.post('/products', { data: { ...buildProduct(), unit: 'gallon' } });
      await expect(response).toHaveValidationErrorFor('unit');
    });

    test('a non-positive nested dimension is a 422 located inside dimensions', async ({ admin }) => {
      const body = buildProduct({ dimensions: { width_cm: 0, height_cm: 20, depth_cm: 5 } });
      const response = await admin.post('/products', { data: body });
      await expect(response).toHaveValidationErrorFor(['dimensions', 'width_cm']);
    });

    test('more than 10 tags is a 422', async ({ admin }) => {
      const tags = Array.from({ length: 11 }, (_, i) => `tag-${i}`);
      const response = await admin.post('/products', { data: buildProduct({ tags }) });
      await expect(response).toHaveValidationErrorFor('tags');
    });

    test('an unknown category is a 422', async ({ admin }) => {
      const response = await admin.post('/products', { data: buildProduct({ category_id: 99 }) });
      await expect(response).toBeApiError(422, 'Category 99 does not exist');
    });

    test('an unknown supplier is a 422', async ({ admin }) => {
      const response = await admin.post('/products', { data: buildProduct({ supplier_id: 99 }) });
      await expect(response).toBeApiError(422, 'Supplier 99 does not exist');
    });
  });

  test.describe('body format', () => {
    test('a form-urlencoded body is a 415', async ({ admin }) => {
      const response = await admin.post('/products', { form: { sku: 'FORM-001', name: 'Form prop' } });
      await expect(response).toBeApiError(415, 'application/json');
    });

    test('malformed JSON is a 400', async ({ admin }) => {
      const response = await admin.post('/products', {
        // A Buffer is sent as-is; a string would be JSON-encoded by Playwright.
        data: Buffer.from('{"sku": '),
        headers: { 'Content-Type': 'application/json' },
      });
      await expect(response).toBeApiError(400, 'not valid JSON');
    });
  });
});
