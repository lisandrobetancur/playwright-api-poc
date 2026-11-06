import { test, expect } from '@src/fixtures/api.fixture';
import type { Movement, MovementPage, StockIn, StockOut, StockTransfer } from '@src/api/types';
import { MISSING_ID, MOVEMENT_COUNT, products, users, warehouses } from '@src/data/seed';
import { stockOf } from './helpers';

const NEW_ID = MOVEMENT_COUNT + 1;

const stockIn: StockIn = {
  type: 'in',
  product_id: products.sword.id,
  warehouse_id: warehouses.main.id,
  quantity: 5,
  reference: 'DELIVERY-9',
};
const stockOut: StockOut = {
  type: 'out',
  product_id: products.sword.id,
  warehouse_id: warehouses.main.id,
  quantity: 3,
};
const transfer: StockTransfer = {
  type: 'transfer',
  product_id: products.sword.id,
  from_warehouse_id: warehouses.main.id,
  to_warehouse_id: warehouses.stage.id,
  quantity: 4,
};

test.describe('POST /movements', () => {
  test.describe('stock effects', () => {
    test('an "in" movement adds stock and returns 201 + Location @smoke', async ({ clerk }) => {
      const response = await clerk.post('/movements', { data: stockIn });

      await expect(response).toHaveStatus(201);
      expect(response.headers()['location']).toBe(`/movements/${NEW_ID}`);
      const movement = (await response.json()) as Movement;
      expect(movement).toMatchObject({
        id: NEW_ID,
        type: 'in',
        product_id: products.sword.id,
        from_warehouse_id: null,
        to_warehouse_id: warehouses.main.id,
        quantity: 5,
        reference: 'DELIVERY-9',
        created_by: users.clerk.id,
      });
      expect(await stockOf(clerk, products.sword.id, warehouses.main.id)).toBe(products.sword.stock.main + 5);
    });

    test('an "out" movement removes stock', async ({ clerk }) => {
      const response = await clerk.post('/movements', { data: stockOut });

      await expect(response).toHaveStatus(201);
      expect(await response.json()).toMatchObject({
        type: 'out',
        from_warehouse_id: warehouses.main.id,
        to_warehouse_id: null,
        quantity: 3,
      });
      expect(await stockOf(clerk, products.sword.id, warehouses.main.id)).toBe(products.sword.stock.main - 3);
    });

    test('a "transfer" moves stock between warehouses @smoke', async ({ clerk }) => {
      const response = await clerk.post('/movements', { data: transfer });

      await expect(response).toHaveStatus(201);
      expect(await response.json()).toMatchObject({
        type: 'transfer',
        from_warehouse_id: warehouses.main.id,
        to_warehouse_id: warehouses.stage.id,
        quantity: 4,
      });
      expect(await stockOf(clerk, products.sword.id, warehouses.main.id)).toBe(products.sword.stock.main - 4);
      expect(await stockOf(clerk, products.sword.id, warehouses.stage.id)).toBe(
        products.sword.stock.stage + 4,
      );
    });

    test('a transfer into a warehouse without a stock level creates it', async ({ clerk }) => {
      const body: StockTransfer = { ...transfer, to_warehouse_id: warehouses.annex.id, quantity: 2 };

      await expect(await clerk.post('/movements', { data: body })).toHaveStatus(201);
      expect(await stockOf(clerk, products.sword.id, warehouses.annex.id)).toBe(2);
    });

    test('the created movement can be read back through its Location', async ({ clerk }) => {
      const created = await clerk.post('/movements', { data: stockIn });
      const fetched = await clerk.get(created.headers()['location']);

      await expect(fetched).toHaveStatus(200);
      expect(await fetched.json()).toEqual(await created.json());
    });

    test('an admin can record movements too', async ({ admin }) => {
      const response = await admin.post('/movements', { data: stockIn });

      await expect(response).toHaveStatus(201);
      expect(((await response.json()) as Movement).created_by).toBe(users.admin.id);
    });
  });

  test.describe('insufficient stock', () => {
    test('taking 2 x product 4 out of warehouse 2 (only 1 there) gives 409', async ({ clerk }) => {
      const body: StockOut = {
        type: 'out',
        product_id: products.spotlight.id,
        warehouse_id: warehouses.stage.id,
        quantity: 2,
      };

      await expect(await clerk.post('/movements', { data: body })).toBeApiError(409, 'insufficient stock');
      expect(await stockOf(clerk, products.spotlight.id, warehouses.stage.id)).toBe(
        products.spotlight.stock.stage,
      );
    });

    test('taking out exactly the available quantity empties the level', async ({ clerk }) => {
      const body: StockOut = {
        type: 'out',
        product_id: products.spotlight.id,
        warehouse_id: warehouses.stage.id,
        quantity: products.spotlight.stock.stage,
      };

      await expect(await clerk.post('/movements', { data: body })).toHaveStatus(201);
      expect(await stockOf(clerk, products.spotlight.id, warehouses.stage.id)).toBe(0);
    });

    test('transferring more than the source holds gives 409 and records nothing', async ({ clerk }) => {
      const body: StockTransfer = { ...transfer, quantity: products.sword.stock.main + 1 };

      await expect(await clerk.post('/movements', { data: body })).toBeApiError(409, 'insufficient stock');
      const page = (await (await clerk.get('/movements')).json()) as MovementPage;
      expect(page.total).toBe(MOVEMENT_COUNT);
      expect(await stockOf(clerk, products.sword.id, warehouses.stage.id)).toBe(products.sword.stock.stage);
    });
  });

  test.describe('references', () => {
    test('a transfer within the same warehouse gives 422', async ({ clerk }) => {
      const body: StockTransfer = { ...transfer, to_warehouse_id: transfer.from_warehouse_id };

      await expect(await clerk.post('/movements', { data: body })).toBeApiError(422, 'must be different');
    });

    test('an unknown product gives 422', async ({ clerk }) => {
      const body: StockIn = { ...stockIn, product_id: MISSING_ID };

      await expect(await clerk.post('/movements', { data: body })).toBeApiError(422, 'does not exist');
    });

    test('an unknown warehouse gives 422', async ({ clerk }) => {
      const body: StockIn = { ...stockIn, warehouse_id: MISSING_ID };

      await expect(await clerk.post('/movements', { data: body })).toBeApiError(422, 'does not exist');
    });

    test('an unknown transfer destination gives 422', async ({ clerk }) => {
      const body: StockTransfer = { ...transfer, to_warehouse_id: MISSING_ID };

      await expect(await clerk.post('/movements', { data: body })).toBeApiError(422, 'does not exist');
    });

    test('an inactive warehouse gives 409', async ({ admin, clerk }) => {
      await expect(
        await admin.patch(`/warehouses/${warehouses.annex.id}`, { data: { active: false } }),
      ).toHaveStatus(200);
      const body: StockIn = { ...stockIn, warehouse_id: warehouses.annex.id };

      await expect(await clerk.post('/movements', { data: body })).toBeApiError(409, 'inactive');
    });
  });

  test.describe('validation', () => {
    test('an unknown type is rejected by the discriminator', async ({ clerk }) => {
      const response = await clerk.post('/movements', { data: { ...stockIn, type: 'teleport' } });

      await expect(response).toHaveStatus(422);
      expect(Array.isArray((await response.json()).detail)).toBe(true);
    });

    test('"in" requires warehouse_id', async ({ clerk }) => {
      const { warehouse_id: _omitted, ...body } = stockIn;

      await expect(await clerk.post('/movements', { data: body })).toHaveValidationErrorFor('warehouse_id');
    });

    test('"transfer" requires from_warehouse_id and to_warehouse_id', async ({ clerk }) => {
      const response = await clerk.post('/movements', {
        data: {
          type: 'transfer',
          product_id: products.sword.id,
          warehouse_id: warehouses.main.id,
          quantity: 1,
        },
      });

      await expect(response).toHaveValidationErrorFor('from_warehouse_id');
      await expect(response).toHaveValidationErrorFor('to_warehouse_id');
    });

    for (const quantity of [0, -1, 100_001]) {
      test(`quantity ${quantity} is out of range`, async ({ clerk }) => {
        await expect(
          await clerk.post('/movements', { data: { ...stockIn, quantity } }),
        ).toHaveValidationErrorFor('quantity');
      });
    }

    test('reference longer than 80 characters is rejected', async ({ clerk }) => {
      const response = await clerk.post('/movements', { data: { ...stockIn, reference: 'R'.repeat(81) } });

      await expect(response).toHaveValidationErrorFor('reference');
    });

    test('a non-JSON content type gives 415', async ({ clerk }) => {
      const response = await clerk.post('/movements', {
        data: JSON.stringify(stockIn),
        headers: { 'Content-Type': 'text/plain' },
      });

      await expect(response).toBeApiError(415, 'unsupported media type');
    });
  });

  test.describe('permissions', () => {
    test('a viewer gets 403', async ({ viewer }) => {
      await expect(await viewer.post('/movements', { data: stockIn })).toBeApiError(403);
    });

    test('an anonymous caller gets 401', async ({ request }) => {
      await expect(await request.post('/movements', { data: stockIn })).toBeApiError(401);
    });
  });

  test.describe('Idempotency-Key', () => {
    test('replaying the same key and body returns the first response without a second movement', async ({
      clerk,
    }) => {
      const headers = { 'Idempotency-Key': 'movement-replay-1' };
      const first = await clerk.post('/movements', { data: stockIn, headers });
      const second = await clerk.post('/movements', { data: stockIn, headers });

      await expect(first).toHaveStatus(201);
      await expect(second).toHaveStatus(201);
      expect(second.headers()['idempotency-replayed']).toBe('true');
      expect(second.headers()['location']).toBe(first.headers()['location']);
      expect(await second.json()).toEqual(await first.json());
      expect(await stockOf(clerk, products.sword.id, warehouses.main.id)).toBe(products.sword.stock.main + 5);
      expect(((await (await clerk.get('/movements')).json()) as MovementPage).total).toBe(MOVEMENT_COUNT + 1);
    });

    test('the first response is not marked as replayed', async ({ clerk }) => {
      const response = await clerk.post('/movements', {
        data: stockIn,
        headers: { 'Idempotency-Key': 'fresh-key' },
      });

      await expect(response).toHaveStatus(201);
      expect(response.headers()['idempotency-replayed']).toBeUndefined();
    });

    test('reusing a key with a different body gives 422', async ({ clerk }) => {
      const headers = { 'Idempotency-Key': 'movement-replay-2' };
      await expect(await clerk.post('/movements', { data: stockIn, headers })).toHaveStatus(201);

      const response = await clerk.post('/movements', { data: { ...stockIn, quantity: 6 }, headers });

      await expect(response).toBeApiError(422, 'different request body');
    });

    test('keys are scoped per user', async ({ admin, clerk }) => {
      const headers = { 'Idempotency-Key': 'shared-key' };
      const byClerk = await clerk.post('/movements', { data: stockIn, headers });
      const byAdmin = await admin.post('/movements', { data: stockIn, headers });

      await expect(byAdmin).toHaveStatus(201);
      expect(byAdmin.headers()['idempotency-replayed']).toBeUndefined();
      expect(((await byAdmin.json()) as Movement).id).not.toBe(((await byClerk.json()) as Movement).id);
    });

    test('a key longer than 255 characters gives 400', async ({ clerk }) => {
      const response = await clerk.post('/movements', {
        data: stockIn,
        headers: { 'Idempotency-Key': 'k'.repeat(256) },
      });

      await expect(response).toBeApiError(400, 'Idempotency-Key');
    });
  });
});
