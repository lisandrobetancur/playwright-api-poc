import type { APIResponse } from '@playwright/test';
import type { Product, ProductPage } from '@src/api/types';

/** Upload limit of the API (`MAX_UPLOAD_BYTES`, default 2 MiB). */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES ?? 2_097_152);

/** A valid 1x1 PNG: the same image the seed attaches to product 1. */
export const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
  'base64',
);

export const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A buffer one byte above the upload limit. */
export function oversizedBuffer(fill = 'a'): Buffer {
  return Buffer.alloc(MAX_UPLOAD_BYTES + 1, fill);
}

export const CSV_HEADER = 'sku,name,category_id,supplier_id,unit_price,unit,reorder_level,description,tags';

/** Builds a CSV document from the standard import header and the given data rows. */
export function csv(...rows: string[]): string {
  return [CSV_HEADER, ...rows].join('\n') + '\n';
}

/** Multipart form with a single `file` field, as expected by the upload endpoints. */
export function fileForm(name: string, mimeType: string, content: string | Buffer) {
  return { file: { name, mimeType, buffer: Buffer.isBuffer(content) ? content : Buffer.from(content) } };
}

/** Ids of the products in a list response. */
export async function productIds(response: APIResponse): Promise<number[]> {
  const page = (await response.json()) as ProductPage;
  return page.items.map((product: Product) => product.id);
}

/** Parses an RFC 8288 `Link` header into `{ rel: url }`. */
export function parseLinks(header: string | undefined): Record<string, string> {
  const links: Record<string, string> = {};
  for (const part of (header ?? '').split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="([^"]+)"/);
    if (match) links[match[2]] = match[1];
  }
  return links;
}
