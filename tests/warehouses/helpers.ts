import type { APIRequestContext } from '@playwright/test';
import type { StockLevel } from '@src/api/types';

/** The ETag format documented for one stock level. */
export function stockEtag(warehouseId: number, productId: number, version: number): string {
  return `"stock-${warehouseId}-${productId}-v${version}"`;
}

/** GET one stock level and return its body together with its ETag header. */
export async function getStockLevel(
  client: APIRequestContext,
  warehouseId: number,
  productId: number,
): Promise<{ level: StockLevel; etag: string }> {
  const response = await client.get(`/warehouses/${warehouseId}/stock/${productId}`);
  if (!response.ok()) {
    throw new Error(`GET stock level failed with ${response.status()}: ${await response.text()}`);
  }
  return { level: (await response.json()) as StockLevel, etag: response.headers()['etag'] };
}
