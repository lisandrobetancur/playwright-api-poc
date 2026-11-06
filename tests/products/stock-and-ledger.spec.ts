import { test, expect } from '@src/fixtures/api.fixture';
import type { Ledger, Product, StockLevel, StockOut, StockTransfer } from '@src/api/types';
import { MISSING_ID, MOVEMENT_COUNT, products, warehouses } from '@src/data/seed';
import { buildProduct } from '@src/data/factories';

const chair = products.chair;
const chairTotal = chair.stock.main + chair.stock.stage;

test.describe('GET /products/{id}/stock', () => {
  test('lists the quantity in every warehouse, including empty ones @smoke', async ({ viewer }) => {
    const response = await viewer.get(`/products/${chair.id}/stock`);

    await expect(response).toHaveStatus(200);
    const levels = (await response.json()) as StockLevel[];
    expect(levels.map(({ warehouse_id, quantity }) => ({ warehouse_id, quantity }))).toEqual([
      { warehouse_id: warehouses.main.id, quantity: chair.stock.main },
      { warehouse_id: warehouses.stage.id, quantity: chair.stock.stage },
      { warehouse_id: warehouses.annex.id, quantity: 0 },
    ]);
  });

  test('each level carries product details and a version', async ({ viewer }) => {
    const levels = (await (await viewer.get(`/products/${chair.id}/stock`)).json()) as StockLevel[];

    expect(levels[0]).toMatchObject({
      product_id: chair.id,
      sku: chair.sku,
      product_name: 'Wooden chair',
      reorder_level: chair.reorderLevel,
      version: 1,
    });
    expect(levels[2]).toMatchObject({ quantity: 0, version: 0, updated_at: null });
  });

  test('a new product has zero stock everywhere', async ({ admin }) => {
    const created = (await (await admin.post('/products', { data: buildProduct() })).json()) as Product;

    const levels = (await (await admin.get(`/products/${created.id}/stock`)).json()) as StockLevel[];

    expect(levels.map((level) => level.quantity)).toEqual([0, 0, 0]);
  });

  test('clerk and admin can read it too', async ({ admin, clerk }) => {
    await expect(await admin.get(`/products/${chair.id}/stock`)).toHaveStatus(200);
    await expect(await clerk.get(`/products/${chair.id}/stock`)).toHaveStatus(200);
  });

  test('anonymous is a 401', async ({ request }) => {
    const response = await request.get(`/products/${chair.id}/stock`);
    await expect(response).toBeApiError(401);
  });

  test('an unknown product is a 404', async ({ viewer }) => {
    const response = await viewer.get(`/products/${MISSING_ID}/stock`);
    await expect(response).toBeApiError(404, 'not found');
  });
});

test.describe('GET /products/{id}/ledger', () => {
  test('lists the opening movements with a running balance @smoke', async ({ viewer }) => {
    const response = await viewer.get(`/products/${chair.id}/ledger`);

    await expect(response).toHaveStatus(200);
    const ledger = (await response.json()) as Ledger;
    expect(ledger).toMatchObject({ product_id: chair.id, warehouse_id: null, balance: chairTotal });
    expect(
      ledger.entries.map(({ type, warehouse_id, change, balance, reference }) => ({
        type,
        warehouse_id,
        change,
        balance,
        reference,
      })),
    ).toEqual([
      {
        type: 'in',
        warehouse_id: warehouses.main.id,
        change: chair.stock.main,
        balance: chair.stock.main,
        reference: 'OPENING',
      },
      {
        type: 'in',
        warehouse_id: warehouses.stage.id,
        change: chair.stock.stage,
        balance: chairTotal,
        reference: 'OPENING',
      },
    ]);
  });

  test('the balance matches total_stock', async ({ viewer, request }) => {
    const ledger = (await (await viewer.get(`/products/${products.spotlight.id}/ledger`)).json()) as Ledger;
    const product = (await (await request.get(`/products/${products.spotlight.id}`)).json()) as Product;

    expect(ledger.balance).toBe(product.total_stock);
  });

  test('new movements are appended and the running balance follows them', async ({ clerk }) => {
    const out: StockOut = {
      type: 'out',
      product_id: chair.id,
      warehouse_id: warehouses.main.id,
      quantity: 5,
    };
    await expect(await clerk.post('/movements', { data: out })).toHaveStatus(201);

    const ledger = (await (await clerk.get(`/products/${chair.id}/ledger`)).json()) as Ledger;

    expect(ledger.entries).toHaveLength(3);
    expect(ledger.entries[2]).toMatchObject({
      movement_id: MOVEMENT_COUNT + 1,
      type: 'out',
      warehouse_id: warehouses.main.id,
      change: -5,
      balance: chairTotal - 5,
    });
    expect(ledger.balance).toBe(chairTotal - 5);
  });

  test('a transfer does not change the overall balance', async ({ clerk }) => {
    const transfer: StockTransfer = {
      type: 'transfer',
      product_id: chair.id,
      from_warehouse_id: warehouses.main.id,
      to_warehouse_id: warehouses.stage.id,
      quantity: 3,
    };
    await expect(await clerk.post('/movements', { data: transfer })).toHaveStatus(201);

    const ledger = (await (await clerk.get(`/products/${chair.id}/ledger`)).json()) as Ledger;

    expect(ledger.entries.at(-1)).toMatchObject({ type: 'transfer', change: 0, balance: chairTotal });
    expect(ledger.balance).toBe(chairTotal);
  });

  test('warehouse_id scopes the entries and the balance to one warehouse', async ({ viewer }) => {
    const response = await viewer.get(`/products/${chair.id}/ledger`, {
      params: { warehouse_id: warehouses.stage.id },
    });

    await expect(response).toHaveStatus(200);
    const ledger = (await response.json()) as Ledger;
    expect(ledger).toMatchObject({ warehouse_id: warehouses.stage.id, balance: chair.stock.stage });
    expect(ledger.entries).toHaveLength(1);
    expect(ledger.entries[0]).toMatchObject({ warehouse_id: warehouses.stage.id, change: chair.stock.stage });
  });

  test('a scoped ledger shows a transfer as a signed change on each side', async ({ clerk }) => {
    const transfer: StockTransfer = {
      type: 'transfer',
      product_id: chair.id,
      from_warehouse_id: warehouses.main.id,
      to_warehouse_id: warehouses.stage.id,
      quantity: 3,
    };
    await clerk.post('/movements', { data: transfer });

    const main = (await (
      await clerk.get(`/products/${chair.id}/ledger`, { params: { warehouse_id: warehouses.main.id } })
    ).json()) as Ledger;
    const stage = (await (
      await clerk.get(`/products/${chair.id}/ledger`, { params: { warehouse_id: warehouses.stage.id } })
    ).json()) as Ledger;

    expect(main.entries.at(-1)).toMatchObject({
      type: 'transfer',
      change: -3,
      balance: chair.stock.main - 3,
    });
    expect(stage.entries.at(-1)).toMatchObject({
      type: 'transfer',
      change: 3,
      balance: chair.stock.stage + 3,
    });
  });

  test('a warehouse without movements gives an empty ledger', async ({ viewer }) => {
    const response = await viewer.get(`/products/${chair.id}/ledger`, {
      params: { warehouse_id: warehouses.annex.id },
    });

    await expect(response).toHaveStatus(200);
    expect(await response.json()).toMatchObject({ entries: [], balance: 0 });
  });

  test('a product without history gives an empty ledger', async ({ viewer }) => {
    const response = await viewer.get(`/products/${products.bookSet.id}/ledger`);
    expect(await response.json()).toEqual({
      product_id: products.bookSet.id,
      warehouse_id: null,
      entries: [],
      balance: 0,
    });
  });

  test('an unknown warehouse is a 404', async ({ viewer }) => {
    const response = await viewer.get(`/products/${chair.id}/ledger`, {
      params: { warehouse_id: MISSING_ID },
    });
    await expect(response).toBeApiError(404, `Warehouse ${MISSING_ID} not found`);
  });

  test('a non-numeric warehouse_id is a 422', async ({ viewer }) => {
    const response = await viewer.get(`/products/${chair.id}/ledger`, { params: { warehouse_id: 'main' } });
    await expect(response).toHaveValidationErrorFor('warehouse_id');
  });

  test('an unknown product is a 404', async ({ viewer }) => {
    const response = await viewer.get(`/products/${MISSING_ID}/ledger`);
    await expect(response).toBeApiError(404, 'not found');
  });

  test('anonymous is a 401', async ({ request }) => {
    const response = await request.get(`/products/${chair.id}/ledger`);
    await expect(response).toBeApiError(401);
  });
});
