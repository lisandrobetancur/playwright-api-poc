import type { CategoryIn, ProductCreate, PurchaseOrderCreate, SupplierIn, WarehouseIn } from '../api/types';
import { categories, products, suppliers, warehouses } from './seed';

let counter = 0;

/** Short unique suffix (uppercase letters and digits) so created records never collide. */
export function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now().toString(36)}${counter.toString(36)}`.toUpperCase();
}

export function buildProduct(overrides: Partial<ProductCreate> = {}): ProductCreate {
  const id = uniqueSuffix();
  return {
    sku: `TST-${id}`.slice(0, 32),
    name: `Test prop ${id}`,
    description: 'Created by the Playwright suite',
    category_id: categories.handProps.id,
    supplier_id: suppliers.acme.id,
    unit_price: 19.99,
    unit: 'unit',
    reorder_level: 5,
    tags: ['test', 'playwright'],
    dimensions: { width_cm: 10, height_cm: 20, depth_cm: 5 },
    active: true,
    ...overrides,
  };
}

export function buildCategory(overrides: Partial<CategoryIn> = {}): CategoryIn {
  return {
    name: `Test category ${uniqueSuffix()}`,
    description: 'Created by the Playwright suite',
    ...overrides,
  };
}

export function buildSupplier(overrides: Partial<SupplierIn> = {}): SupplierIn {
  const id = uniqueSuffix();
  return {
    name: `Test supplier ${id}`,
    email: `supplier-${id.toLowerCase()}@example.test`,
    phone: '+1 555 0100',
    country: 'Colombia',
    ...overrides,
  };
}

export function buildWarehouse(overrides: Partial<WarehouseIn> = {}): WarehouseIn {
  return {
    code: `WH-${uniqueSuffix()}`.slice(0, 20),
    name: 'Test warehouse',
    city: 'Medellín',
    active: true,
    ...overrides,
  };
}

export function buildPurchaseOrder(overrides: Partial<PurchaseOrderCreate> = {}): PurchaseOrderCreate {
  return {
    supplier_id: suppliers.acme.id,
    warehouse_id: warehouses.main.id,
    notes: 'Created by the Playwright suite',
    lines: [
      { product_id: products.chair.id, quantity: 4, unit_cost: 25 },
      { product_id: products.lamp.id, quantity: 2, unit_cost: 40 },
    ],
    ...overrides,
  };
}

export function buildUserRegistration(
  overrides: Partial<{ email: string; password: string; name: string }> = {},
) {
  const id = uniqueSuffix().toLowerCase();
  return { email: `user-${id}@example.test`, password: 'Secret123!', name: `Test user ${id}`, ...overrides };
}
