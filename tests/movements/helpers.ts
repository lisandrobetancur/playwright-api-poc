import type { APIRequestContext } from '@playwright/test';
import { expect } from '@src/fixtures/api.fixture';
import type { StockLevel } from '@src/api/types';

/** Seed movements are all stamped 2026-01-01T00:00:00; anything after this instant was created by the test. */
export const AFTER_SEED = '2026-01-01T00:00:01';

/** Current quantity of a product in one warehouse (a missing level counts as 0). */
export async function stockOf(
  client: APIRequestContext,
  productId: number,
  warehouseId: number,
): Promise<number> {
  const response = await client.get(`/warehouses/${warehouseId}/stock/${productId}`);
  await expect(response).toHaveStatus(200);
  return ((await response.json()) as StockLevel).quantity;
}
