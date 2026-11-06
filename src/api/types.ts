import type { components } from './schema';

/**
 * Friendly aliases over the types generated from the OpenAPI contract (`npm run generate:types`).
 * Use them to type `await response.json()`.
 */
export type Schemas = components['schemas'];

export type TokenPair = Schemas['TokenPair'];
export type User = Schemas['UserOut'];
export type UserRole = Schemas['UserRole'];
export type UserPage = Schemas['UserPage'];

export type Product = Schemas['ProductOut'];
export type ProductCreate = Schemas['ProductCreate'];
export type ProductReplace = Schemas['ProductReplace'];
export type ProductUpdate = Schemas['ProductUpdate'];
export type ProductPage = Schemas['ProductPage'];
export type ImportResult = Schemas['ImportResult'];
export type Photo = Schemas['PhotoOut'];
export type Ledger = Schemas['Ledger'];

export type Category = Schemas['CategoryOut'];
export type CategoryIn = Schemas['CategoryIn'];
export type Supplier = Schemas['SupplierOut'];
export type SupplierIn = Schemas['SupplierIn'];
export type SupplierCursorPage = Schemas['SupplierCursorPage'];

export type Warehouse = Schemas['WarehouseOut'];
export type WarehouseIn = Schemas['WarehouseIn'];
export type WarehousePage = Schemas['WarehousePage'];
export type StockLevel = Schemas['StockLevelOut'];
export type StockPage = Schemas['StockPage'];

export type Movement = Schemas['MovementOut'];
export type MovementPage = Schemas['MovementPage'];
export type StockIn = Schemas['StockIn'];
export type StockOut = Schemas['StockOut'];
export type StockTransfer = Schemas['StockTransfer'];

export type PurchaseOrder = Schemas['PurchaseOrderOut'];
export type PurchaseOrderCreate = Schemas['PurchaseOrderCreate'];
export type PurchaseOrderPage = Schemas['PurchaseOrderPage'];

export type Job = Schemas['JobOut'];
export type ReportRequest = Schemas['ReportRequest'];
export type LowStockAlert = Schemas['LowStockAlert'];

export type ApiKeyClient = Schemas['ApiKeyClient'];
export type Echo = Schemas['EchoOut'];
export type Chaos = Schemas['ChaosOut'];
export type RateLimit = Schemas['RateLimitOut'];
export type Preferences = Schemas['Preferences'];
export type Contact = Schemas['ContactOut'];
export type ValidationError = Schemas['ValidationError'];
