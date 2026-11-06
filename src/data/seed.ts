/**
 * Predictable seed data restored by `POST /__reset`. IDs are stable after every reset.
 * Source: Prop Room API README ("Seed data at a glance").
 */

export type RoleName = 'admin' | 'clerk' | 'viewer';

export const users = {
  admin: { id: 1, email: 'admin@proproom.test', password: 'Admin123!', role: 'admin' },
  clerk: { id: 2, email: 'clerk@proproom.test', password: 'Clerk123!', role: 'warehouse_clerk' },
  viewer: { id: 3, email: 'viewer@proproom.test', password: 'Viewer123!', role: 'viewer' },
} as const satisfies Record<RoleName, { id: number; email: string; password: string; role: string }>;

export const products = {
  chair: { id: 1, sku: 'FUR-CHAIR-001', stock: { main: 40, stage: 12 }, reorderLevel: 10, hasPhoto: true },
  table: { id: 2, sku: 'FUR-TABLE-002', stock: { main: 6, stage: 0 }, reorderLevel: 2 },
  lamp: { id: 3, sku: 'LGT-LAMP-001', stock: { main: 12, stage: 2 }, reorderLevel: 5 },
  spotlight: { id: 4, sku: 'LGT-SPOT-002', stock: { main: 3, stage: 1 }, reorderLevel: 4, lowStock: true },
  curtain: { id: 5, sku: 'TEX-CURT-001', stock: { main: 100, stage: 0 }, reorderLevel: 20 },
  sword: { id: 6, sku: 'HND-SWORD-001', stock: { main: 8, stage: 4 }, reorderLevel: 10 },
  /** Inactive and without history: the only product that can be deleted. */
  bookSet: { id: 7, sku: 'HND-BOOK-002', stock: { main: 0, stage: 0 }, reorderLevel: 0, active: false },
  tape: { id: 8, sku: 'CON-TAPE-001', stock: { main: 25, stage: 0 }, reorderLevel: 30, lowStock: true },
} as const;

export const PRODUCT_COUNT = 8;
export const MISSING_ID = 999_999;

export const categories = {
  furniture: { id: 1, name: 'Furniture' },
  lighting: { id: 2, name: 'Lighting' },
  textiles: { id: 3, name: 'Textiles' },
  handProps: { id: 4, name: 'Hand props' },
  consumables: { id: 5, name: 'Consumables' },
} as const;

export const suppliers = {
  acme: { id: 1, name: 'Acme Stage Supply', country: 'USA' },
  northwind: { id: 2, name: 'Northwind Textiles', country: 'UK' },
  lumen: { id: 3, name: 'Lumen Lighting Co.', country: 'Germany' },
} as const;

export const warehouses = {
  main: { id: 1, code: 'WH-MAIN' },
  stage: { id: 2, code: 'WH-STAGE' },
  /** Empty: it can be deleted. */
  annex: { id: 3, code: 'WH-ANNEX' },
} as const;

/** One opening `in` movement per non-zero stock level. */
export const MOVEMENT_COUNT = 11;

export const purchaseOrders = {
  draft: { id: 1, number: 'PO-00001', status: 'draft', total: 765 },
  submitted: { id: 2, number: 'PO-00002', status: 'submitted', total: 800 },
  cancelled: { id: 3, number: 'PO-00003', status: 'cancelled' },
} as const;
