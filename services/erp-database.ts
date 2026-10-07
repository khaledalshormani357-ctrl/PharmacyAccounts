// Smart Pharmacy ERP — Complete Database Service
// The in-memory repository is persisted to device storage so data survives restarts.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { toBaseQuantity, priceForUnit, isValidIsoDate, isValidUnitQuantity } from './unit-conversion';

// ═══════════════════════════════════════════════════════════
// TYPES & INTERFACES
// ═══════════════════════════════════════════════════════════

export type TransactionType =
  | 'PURCHASE' | 'SALE' | 'SALE_RETURN' | 'PURCHASE_RETURN'
  | 'OPENING' | 'ADJUSTMENT_IN' | 'ADJUSTMENT_OUT'
  | 'DAMAGE' | 'EXPIRED' | 'WRITE_OFF'
  | 'TRANSFER_IN' | 'TRANSFER_OUT';

export type SaleType = 'cash' | 'credit' | 'mixed';
export type UserRole = 'ADMIN' | 'PHARMACIST' | 'CASHIER' | 'STOREKEEPER' | 'ACCOUNTANT';
export type MovementClass = 'FAST' | 'NORMAL' | 'SLOW' | 'DEAD';
export type AbcClass = 'A' | 'B' | 'C';
export type ShiftStatus = 'OPEN' | 'CLOSED';
export type BatchStatus = 'ACTIVE' | 'EXPIRED' | 'DEPLETED' | 'RECALLED';

// ─── Pharmacy ─────────────────────────────────────────────
export interface Pharmacy {
  id: number;
  name: string;
  owner_name: string;
  license_number: string;
  phone: string;
  address: string;
  currency: string;
  currency_symbol: string;
  tax_number: string;
  receipt_header: string;
  receipt_footer: string;
  created_at: string;
}

// ─── Users & Roles ────────────────────────────────────────
export interface User {
  id: number;
  username: string;
  password_hash: string;
  full_name: string;
  role: UserRole;
  phone: string | null;
  active: boolean;
  last_login: string | null;
  created_at: string;
}

// ─── Products ─────────────────────────────────────────────
export interface Product {
  id: number;
  barcode: string | null;
  internal_code: string | null;
  trade_name: string;
  generic_name: string | null;
  active_ingredient: string | null;
  strength: string | null;
  dosage_form: string | null;
  manufacturer: string | null;
  category: string | null;
  prescription_required: boolean;
  controlled: boolean;
  inventory_unit: string;
  minimum_stock: number;
  reorder_level: number;
  selling_price: number;
  default_purchase_price: number;
  active: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProductUnit {
  id: number;
  product_id: number;
  unit_name: string;
  conversion_factor: number; // how many inventory_units in this unit
  /** Optional parent relationship; absent in legacy v1 snapshots. */
  parent_unit_name?: string | null;
  quantity_per_parent?: number | null;
  /** Null/undefined means derive from the product's base price. */
  sale_price?: number | null;
  purchase_price?: number | null;
  is_purchase_default: boolean;
  is_sale_default: boolean;
}

// ─── Batches ──────────────────────────────────────────────
export interface Batch {
  id: number;
  product_id: number;
  batch_number: string;
  expiry_date: string;
  received_date: string;
  purchase_price: number;
  selling_price: number | null;
  quantity: number;        // current qty in inventory_unit
  initial_quantity: number;
  supplier_id: number | null;
  purchase_id: number | null;
  status: BatchStatus;
  notes: string | null;
  is_opening?: boolean;
  created_at: string;
}

// ─── Stock Movements ──────────────────────────────────────
export interface StockMovement {
  id: number;
  product_id: number;
  batch_id: number | null;
  type: TransactionType;
  quantity: number;        // positive = in, negative = out
  unit: string;
  quantity_in_inventory_unit: number;
  reference_type: string | null;
  reference_id: number | null;
  note: string | null;
  user_id: number | null;
  created_at: string;
}

// ─── Sales ────────────────────────────────────────────────
export interface Sale {
  id: number;
  invoice_number: string;
  sale_type: SaleType;
  customer_id: number | null;
  customer_name: string | null;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  change_given: number;
  remaining: number;
  cogs: number;
  gross_profit: number;
  date: string;
  shift_id: number | null;
  user_id: number | null;
  notes: string | null;
  cancelled: boolean;
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  created_at: string;
}

export interface SaleItem {
  id: number;
  sale_id: number;
  product_id: number;
  product_name: string;
  batch_id: number | null;
  unit: string;
  unit_name?: string;
  quantity: number;
  quantity_entered?: number;
  /** Conversion snapshot to the base inventory unit. */
  conversion_factor?: number;
  quantity_in_inventory_unit: number;
  unit_price: number;
  /** Cost per base inventory unit at the time this sale was allocated. */
  base_purchase_price?: number;
  discount: number;
  line_total: number;
  cogs: number;
}

export interface SaleBatchAllocation {
  id: number;
  sale_item_id: number;
  batch_id: number;
  quantity_allocated: number;
  purchase_price: number;
}

export interface SalePayment {
  id: number;
  sale_id: number;
  amount: number;
  payment_method: string;
  date: string;
  note: string | null;
  created_at: string;
}

// ─── Purchases ────────────────────────────────────────────
export interface Purchase {
  id: number;
  invoice_number: string;
  supplier_id: number | null;
  supplier_name: string | null;
  date: string;
  subtotal: number;
  discount: number;
  total: number;
  amount_paid: number;
  remaining: number;
  notes: string | null;
  cancelled: boolean;
  cancelled_by: number | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  user_id: number | null;
  created_at: string;
}

export interface PurchaseItem {
  id: number;
  purchase_id: number;
  product_id: number;
  product_name: string;
  batch_number: string;
  expiry_date: string;
  unit: string;
  unit_name?: string;
  quantity: number;
  quantity_entered?: number;
  batch_id?: number;
  conversion_factor?: number;
  quantity_in_inventory_unit: number;
  purchase_price: number;
  base_purchase_price?: number;
  free_quantity: number;
  discount: number;
  line_total: number;
}

export interface ReturnBatchAllocation {
  batch_id: number;
  quantity: number;
}

export interface SaleReturnItem {
  id: number;
  return_id: number;
  sale_item_id: number;
  product_id: number;
  product_name: string;
  unit: string;
  quantity: number;
  conversion_factor: number;
  quantity_in_inventory_unit: number;
  refund_amount: number;
  returned_cogs: number;
  batch_allocations: ReturnBatchAllocation[];
}

export interface SaleReturn {
  id: number;
  sale_id: number;
  invoice_number: string;
  total: number;
  cash_refund: number;
  credit_reduction: number;
  date: string;
  created_at: string;
  items: SaleReturnItem[];
}

export interface PurchaseReturnItem {
  id: number;
  return_id: number;
  purchase_item_id: number;
  product_id: number;
  product_name: string;
  unit: string;
  quantity: number;
  conversion_factor: number;
  quantity_in_inventory_unit: number;
  refund_amount: number;
  batch_id: number;
}

export interface PurchaseReturn {
  id: number;
  purchase_id: number;
  invoice_number: string;
  total: number;
  cash_refund: number;
  payable_reduction: number;
  date: string;
  created_at: string;
  items: PurchaseReturnItem[];
}

// ─── Customers ────────────────────────────────────────────
export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  credit_limit: number;
  balance: number;        // positive = owes us
  notes: string | null;
  created_at: string;
}

export interface CustomerTransaction {
  id: number;
  customer_id: number;
  type: 'sale' | 'payment' | 'return' | 'adjustment';
  amount: number;
  balance_after: number;
  reference_id: number | null;
  note: string | null;
  date: string;
  created_at: string;
}

// ─── Suppliers ────────────────────────────────────────────
export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  address: string | null;
  credit_limit: number;
  balance: number;        // positive = we owe them
  notes: string | null;
  created_at: string;
}

export interface SupplierTransaction {
  id: number;
  supplier_id: number;
  type: 'purchase' | 'payment' | 'return' | 'adjustment';
  amount: number;
  balance_after: number;
  reference_id: number | null;
  note: string | null;
  date: string;
  created_at: string;
}

// ─── Cashbox ──────────────────────────────────────────────
export interface CashTransaction {
  id: number;
  type: 'SALE_CASH' | 'COLLECTION' | 'PURCHASE_PAYMENT' | 'SUPPLIER_PAYMENT'
      | 'CUSTOMER_REFUND' | 'PURCHASE_RETURN' | 'EXPENSE' | 'WITHDRAWAL' | 'DEPOSIT' | 'OPENING' | 'CLOSING' | 'ADJUSTMENT';
  amount: number;         // positive = in, negative = out
  reference_type: string | null;
  reference_id: number | null;
  shift_id: number | null;
  note: string | null;
  user_id: number | null;
  date: string;
  created_at: string;
}

// ─── Shifts ───────────────────────────────────────────────
export interface Shift {
  id: number;
  user_id: number | null;
  user_name: string | null;
  opening_cash: number;
  expected_cash: number | null;
  actual_cash: number | null;
  difference: number | null;
  difference_reason: string | null;
  total_sales: number;
  total_collections: number;
  total_expenses: number;
  total_purchases_paid: number;
  status: ShiftStatus;
  opened_at: string;
  closed_at: string | null;
  notes: string | null;
}

// ─── Expenses ─────────────────────────────────────────────
export interface Expense {
  id: number;
  category: string;
  amount: number;
  date: string;
  shift_id: number | null;
  note: string | null;
  user_id: number | null;
  created_at: string;
}

// ─── Audit ────────────────────────────────────────────────
export interface AuditLog {
  id: number;
  user_id: number | null;
  user_name: string | null;
  action: string;
  entity: string;
  entity_id: number | null;
  before_data: string | null;
  after_data: string | null;
  reason: string | null;
  ip: string | null;
  created_at: string;
}

// ─── Settings ─────────────────────────────────────────────
export interface Setting {
  key: string;
  value: string;
}

// ─── Report Types ─────────────────────────────────────────
export interface DashboardKpis {
  todaySales: number;
  todayCashSales: number;
  todayCreditSales: number;
  todayCollections: number;
  todayExpenses: number;
  todayPurchases: number;
  todayGrossProfit: number;
  cashBalance: number;
  totalCustomerDebt: number;
  totalSupplierDebt: number;
  lowStockCount: number;
  expiringCount: number;
  expiredCount: number;
  outOfStockCount: number;
  openShiftId: number | null;
  recentSales: Sale[];
}

export interface ReportSummary {
  cashSales: number;
  creditSales: number;
  totalSales: number;
  collections: number;
  totalExpenses: number;
  totalPurchases: number;
  grossProfit: number;
  netCash: number;
  transactionCount: number;
  cogs: number;
}

export interface ExpiryRadarItem {
  product_id: number;
  product_name: string;
  batch_id: number;
  batch_number: string;
  expiry_date: string;
  days_to_expiry: number;
  quantity: number;
  unit: string;
  stock_value: number;
  group: 'expired' | '30' | '60' | '90' | 'ok';
}

export interface InventoryItem {
  product_id: number;
  trade_name: string;
  generic_name: string | null;
  barcode: string | null;
  category: string | null;
  inventory_unit: string;
  selling_price: number;
  total_quantity: number;
  minimum_stock: number;
  reorder_level: number;
  status: 'ok' | 'low' | 'out' | 'expiring' | 'expired';
  nearest_expiry: string | null;
  days_to_nearest_expiry: number | null;
  batches: Batch[];
}

// ═══════════════════════════════════════════════════════════
// IN-MEMORY STORE
// ═══════════════════════════════════════════════════════════

const store = {
  settings: {} as Record<string, string>,
  pharmacy: null as Pharmacy | null,
  users: [] as User[],
  products: [] as Product[],
  productUnits: [] as ProductUnit[],
  batches: [] as Batch[],
  stockMovements: [] as StockMovement[],
  sales: [] as Sale[],
  saleItems: [] as SaleItem[],
  saleBatchAllocations: [] as SaleBatchAllocation[],
  salePayments: [] as SalePayment[],
  saleReturns: [] as SaleReturn[],
  purchases: [] as Purchase[],
  purchaseItems: [] as PurchaseItem[],
  purchaseReturns: [] as PurchaseReturn[],
  customers: [] as Customer[],
  customerTransactions: [] as CustomerTransaction[],
  suppliers: [] as Supplier[],
  supplierTransactions: [] as SupplierTransaction[],
  cashTransactions: [] as CashTransaction[],
  shifts: [] as Shift[],
  expenses: [] as Expense[],
  auditLogs: [] as AuditLog[],
};

const ids = {
  products: 1, productUnits: 1, batches: 1, stockMovements: 1,
  sales: 1, saleItems: 1, saleAllocations: 1, salePayments: 1,
  saleReturns: 1, saleReturnItems: 1, purchaseReturns: 1, purchaseReturnItems: 1,
  purchases: 1, purchaseItems: 1,
  customers: 1, customerTx: 1,
  suppliers: 1, supplierTx: 1,
  cashTx: 1, shifts: 1, expenses: 1, auditLogs: 1, users: 1,
};

let invoiceCounter = 1000;
let setupDone = false;
const STORE_KEY = '@pharmacy_accounts/store/v1';
let persistQueue: Promise<void> = Promise.resolve();

// ─── Helpers ──────────────────────────────────────────────
const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
const today = () => new Date().toISOString().split('T')[0];
export const getToday = today;

function persistStore(): void {
  const snapshot = JSON.stringify({ store, ids, invoiceCounter });
  persistQueue = persistQueue
    .catch(() => undefined)
    .then(() => AsyncStorage.setItem(STORE_KEY, snapshot))
    .catch(() => undefined);
}

async function hydrateStore(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { store?: typeof store; ids?: typeof ids; invoiceCounter?: number };
    if (saved.store) {
      Object.keys(store).forEach((key) => {
        const value = saved.store?.[key as keyof typeof store];
        if (value !== undefined) (store as any)[key] = value;
      });
    }
    if (saved.ids) Object.assign(ids, saved.ids);
    if (typeof saved.invoiceCounter === 'number') invoiceCounter = saved.invoiceCounter;
  } catch {
    // A corrupt local snapshot must not prevent the app from opening.
  }
}

function simpleHash(password: string): string {
  let h = 0;
  for (let i = 0; i < password.length; i++) {
    h = ((h << 5) - h + password.charCodeAt(i)) | 0;
  }
  return `ph_${Math.abs(h).toString(16)}`;
}

function nextInvoice(): string {
  return `INV-${String(++invoiceCounter).padStart(6, '0')}`;
}

// ═══════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════

function initDefaults() {
  if (setupDone) return;
  setupDone = true;

  // Default settings
  const defaultSettings: Record<string, string> = {
    pharmacy_name: '',
    owner_name: '',
    currency: 'ر.س',
    currency_symbol: 'ر.س',
    theme: 'light',
    pin_enabled: 'false',
    pin_code: '',
    language: 'ar',
    dead_stock_days: '90',
    tax_rate: '0',
    receipt_size: 'A5',
    setup_done: 'false',
  };
  Object.entries(defaultSettings).forEach(([k, v]) => {
    if (!(k in store.settings)) store.settings[k] = v;
  });
}

initDefaults();
export const databaseReady: Promise<void> = hydrateStore();

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════

export function getSetting(key: string): string | null {
  return store.settings[key] ?? null;
}

export function setSetting(key: string, value: string): void {
  store.settings[key] = value;
  persistStore();
}

export function getAllSettings(): Record<string, string> {
  return { ...store.settings };
}

export function isSetupDone(): boolean {
  return store.settings['setup_done'] === 'true';
}

export function completeSetup(data: {
  pharmacy_name: string;
  owner_name: string;
  currency: string;
  currency_symbol: string;
  admin_username: string;
  admin_password: string;
  opening_cash: number;
}): void {
  setSetting('pharmacy_name', data.pharmacy_name);
  setSetting('owner_name', data.owner_name);
  setSetting('currency', data.currency);
  setSetting('currency_symbol', data.currency_symbol);
  setSetting('setup_done', 'true');

  // Create admin user
  const user: User = {
    id: ids.users++,
    username: data.admin_username,
    password_hash: simpleHash(data.admin_password),
    full_name: data.owner_name || 'المدير',
    role: 'ADMIN',
    phone: null,
    active: true,
    last_login: now(),
    created_at: now(),
  };
  store.users.push(user);

  // Opening cash
  if (data.opening_cash > 0) {
    store.cashTransactions.push({
      id: ids.cashTx++,
      type: 'OPENING',
      amount: data.opening_cash,
      reference_type: null,
      reference_id: null,
      shift_id: null,
      note: 'رصيد افتتاحي',
      user_id: user.id,
      date: today(),
      created_at: now(),
    });
  }

  addAuditLog({ action: 'SETUP_COMPLETE', entity: 'pharmacy', entity_id: 1,
    after_data: JSON.stringify({ pharmacy_name: data.pharmacy_name }) });
}

// ═══════════════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════════════

export interface AuthResult {
  success: boolean;
  user?: User;
  error?: string;
}

export function authenticateUser(username: string, password: string): AuthResult {
  // Demo bypass in preview
  if (!isSetupDone()) {
    return { success: false, error: 'يجب إكمال الإعداد الأولي أولاً' };
  }
  const user = store.users.find(u => u.username === username && u.active);
  if (!user) return { success: false, error: 'المستخدم غير موجود' };
  if (user.password_hash !== simpleHash(password)) {
    return { success: false, error: 'كلمة المرور غير صحيحة' };
  }
  user.last_login = now();
  addAuditLog({ action: 'LOGIN', entity: 'user', entity_id: user.id, user_id: user.id });
  return { success: true, user };
}

export function getUsers(): User[] {
  return [...store.users];
}

export function addUser(data: {
  username: string; password: string; full_name: string; role: UserRole; phone?: string;
}): User {
  const user: User = {
    id: ids.users++,
    username: data.username,
    password_hash: simpleHash(data.password),
    full_name: data.full_name,
    role: data.role,
    phone: data.phone ?? null,
    active: true,
    last_login: null,
    created_at: now(),
  };
  store.users.push(user);
  persistStore();
  return user;
}

export function updateUser(id: number, data: Partial<Pick<User, 'full_name' | 'role' | 'phone' | 'active'> & { password: string }>): void {
  const user = store.users.find(u => u.id === id);
  if (!user) return;
  if (data.full_name !== undefined) user.full_name = data.full_name;
  if (data.role !== undefined) user.role = data.role;
  if (data.phone !== undefined) user.phone = data.phone;
  if (data.active !== undefined) user.active = data.active;
  if (data.password) user.password_hash = simpleHash(data.password);
  addAuditLog({ action: 'USER_UPDATE', entity: 'user', entity_id: id, after_data: JSON.stringify({ username: user.username, active: user.active, role: user.role }) });
  persistStore();
}

// ═══════════════════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════════════════

export function getProducts(opts?: {
  search?: string; category?: string; activeOnly?: boolean;
}): Product[] {
  let result = [...store.products];
  if (opts?.activeOnly !== false) result = result.filter(p => p.active);
  if (opts?.search) {
    const q = opts.search.toLowerCase();
    result = result.filter(p =>
      p.trade_name.toLowerCase().includes(q) ||
      (p.generic_name || '').toLowerCase().includes(q) ||
      (p.active_ingredient || '').toLowerCase().includes(q) ||
      (p.barcode || '').includes(q) ||
      (p.internal_code || '').includes(q) ||
      (p.manufacturer || '').toLowerCase().includes(q)
    );
  }
  if (opts?.category) result = result.filter(p => p.category === opts.category);
  return result.sort((a, b) => a.trade_name.localeCompare(b.trade_name, 'ar'));
}

export function getProduct(id: number): Product | null {
  return store.products.find(p => p.id === id) ?? null;
}

export function getProductByBarcode(barcode: string): Product | null {
  return store.products.find(p => p.barcode === barcode) ?? null;
}

export function addProduct(data: Omit<Product, 'id' | 'created_at' | 'updated_at'>): Product {
  const product: Product = {
    ...data,
    id: ids.products++,
    created_at: now(),
    updated_at: now(),
  };
  store.products.push(product);
  addAuditLog({ action: 'PRODUCT_CREATE', entity: 'product', entity_id: product.id,
    after_data: JSON.stringify({ name: product.trade_name }) });
  return product;
}

export function updateProduct(id: number, data: Partial<Product>): void {
  const p = store.products.find(p => p.id === id);
  if (p) {
    const before = JSON.stringify(p);
    Object.assign(p, { ...data, updated_at: now() });
    addAuditLog({ action: 'PRODUCT_UPDATE', entity: 'product', entity_id: id,
      before_data: before, after_data: JSON.stringify(p) });
  }
}

export function getProductUnits(product_id: number): ProductUnit[] {
  return store.productUnits.filter(u => u.product_id === product_id);
}

export function getProductUnit(product_id: number, unit_name: string): ProductUnit | null {
  const product = getProduct(product_id);
  if (!product) return null;
  const configured = store.productUnits.find(u => u.product_id === product_id && u.unit_name === unit_name);
  if (configured) return configured.conversion_factor > 0 ? configured : null;
  return unit_name === product.inventory_unit
    ? { id: -1, product_id, unit_name, conversion_factor: 1, parent_unit_name: null, quantity_per_parent: 1,
        sale_price: null, purchase_price: null, is_purchase_default: true, is_sale_default: true }
    : null;
}

export function getUnitConversionFactor(product_id: number, unit_name: string): number | null {
  return getProductUnit(product_id, unit_name)?.conversion_factor ?? null;
}

export function getUnitPrice(product_id: number, unit_name: string, kind: 'sale' | 'purchase'): number | null {
  const product = getProduct(product_id);
  const unit = getProductUnit(product_id, unit_name);
  if (!product || !unit) return null;
  const basePrice = kind === 'sale' ? product.selling_price : product.default_purchase_price;
  const override = kind === 'sale' ? unit.sale_price : unit.purchase_price;
  return priceForUnit(basePrice, unit.conversion_factor, unit_name === product.inventory_unit ? basePrice : override);
}

export function hasProductStockHistory(product_id: number): boolean {
  return store.batches.some(batch => batch.product_id === product_id) ||
    store.stockMovements.some(movement => movement.product_id === product_id) ||
    store.saleItems.some(item => item.product_id === product_id) ||
    store.purchaseItems.some(item => item.product_id === product_id);
}

export interface OpeningStockInput {
  product_id: number;
  unit: string;
  quantity: number;
  unit_cost: number;
  batch_number?: string;
  expiry_date?: string;
  user_id?: number | null;
}

export type OpeningStockResult = { success: true; batch: Batch; base_quantity: number } | { success: false; error: string };

/** Creates a physical opening batch without creating a purchase, payable, or cash movement. */
export function createOpeningStock(data: OpeningStockInput): OpeningStockResult {
  const product = getProduct(data.product_id);
  if (!product) return { success: false, error: 'الدواء غير موجود' };
  const factor = getUnitConversionFactor(data.product_id, data.unit);
  if (factor === null) return { success: false, error: `الوحدة ${data.unit} غير معرفة لهذا الدواء` };
  if (!isValidUnitQuantity(data.quantity, data.unit)) return { success: false, error: 'أدخل كمية افتتاحية صحيحة للوحدة المختارة' };
  if (!Number.isFinite(data.unit_cost) || data.unit_cost < 0) return { success: false, error: 'أدخل تكلفة افتتاحية صحيحة' };
  const baseQuantity = toBaseQuantity(data.quantity, factor);
  const expiry = data.expiry_date?.trim() || '';
  if (expiry && !isValidIsoDate(expiry)) return { success: false, error: 'تاريخ انتهاء الرصيد الافتتاحي غير صحيح' };
  const batch: Batch = {
    id: ids.batches++, product_id: product.id,
    batch_number: data.batch_number?.trim() || `OPEN-${product.id}-${Date.now()}-${ids.batches}`,
    expiry_date: expiry, received_date: today(), purchase_price: data.unit_cost / factor,
    selling_price: product.selling_price, quantity: baseQuantity, initial_quantity: baseQuantity,
    supplier_id: null, purchase_id: null, status: expiry && expiry <= today() ? 'EXPIRED' : 'ACTIVE',
    notes: 'الرصيد الافتتاحي', is_opening: true, created_at: now(),
  };
  store.batches.push(batch);
  store.stockMovements.push({
    id: ids.stockMovements++, product_id: product.id, batch_id: batch.id,
    type: 'OPENING', quantity: baseQuantity, unit: product.inventory_unit,
    quantity_in_inventory_unit: baseQuantity, reference_type: 'opening_stock',
    reference_id: batch.id, note: `الرصيد الافتتاحي: ${data.quantity} ${data.unit}`,
    user_id: data.user_id ?? null, created_at: now(),
  });
  addAuditLog({ action: 'OPENING_STOCK_CREATE', entity: 'batch', entity_id: batch.id,
    user_id: data.user_id, after_data: JSON.stringify({ product_id: product.id, unit: data.unit,
      quantity: data.quantity, conversion_factor: factor, base_quantity: baseQuantity, unit_cost: data.unit_cost, batch_number: batch.batch_number }) });
  persistStore();
  return { success: true, batch, base_quantity: baseQuantity };
}

export function canEditOpeningStock(batch_id: number): boolean {
  const batch = store.batches.find(entry => entry.id === batch_id && entry.is_opening);
  if (!batch) return false;
  const hasOtherMovement = store.stockMovements.some(movement => movement.product_id === batch.product_id &&
    !(movement.batch_id === batch.id && movement.type === 'OPENING'));
  const hasSalesOrPurchases = store.saleItems.some(item => item.product_id === batch.product_id) ||
    store.purchaseItems.some(item => item.product_id === batch.product_id);
  return !hasOtherMovement && !hasSalesOrPurchases;
}

export function updateOpeningStock(data: {
  batch_id: number; base_quantity: number; unit_cost_per_base: number;
  batch_number?: string; expiry_date?: string;
}): { success: true; batch: Batch } | { success: false; error: string } {
  const batch = store.batches.find(entry => entry.id === data.batch_id && entry.is_opening);
  const product = batch ? getProduct(batch.product_id) : null;
  if (!batch || !product) return { success: false, error: 'دفعة الرصيد الافتتاحي غير موجودة' };
  if (!canEditOpeningStock(batch.id)) return { success: false, error: 'حدثت معاملات لاحقة؛ استخدم تسوية مخزون صريحة بدل تغيير الرصيد الافتتاحي' };
  if (!isValidUnitQuantity(data.base_quantity, product.inventory_unit, true) || !Number.isFinite(data.unit_cost_per_base) || data.unit_cost_per_base < 0) {
    return { success: false, error: 'تحقق من الكمية والتكلفة بوحدة المخزون الأساسية' };
  }
  const expiry = data.expiry_date?.trim() || '';
  if (expiry && !isValidIsoDate(expiry)) return { success: false, error: 'تاريخ انتهاء الرصيد الافتتاحي غير صحيح' };
  const before = { ...batch };
  batch.batch_number = data.batch_number?.trim() || batch.batch_number;
  batch.expiry_date = expiry;
  batch.purchase_price = data.unit_cost_per_base;
  batch.quantity = data.base_quantity;
  batch.initial_quantity = data.base_quantity;
  batch.status = data.base_quantity <= 0 ? 'DEPLETED' : expiry && expiry <= today() ? 'EXPIRED' : 'ACTIVE';
  const movement = store.stockMovements.find(entry => entry.batch_id === batch.id && entry.type === 'OPENING');
  if (movement) {
    movement.quantity = data.base_quantity;
    movement.quantity_in_inventory_unit = data.base_quantity;
    movement.note = `تعديل الرصيد الافتتاحي: ${data.base_quantity} ${product.inventory_unit}`;
  }
  addAuditLog({ action: 'OPENING_STOCK_UPDATE', entity: 'batch', entity_id: batch.id,
    before_data: JSON.stringify(before), after_data: JSON.stringify(batch) });
  persistStore();
  return { success: true, batch };
}

export function addProductUnit(data: Omit<ProductUnit, 'id'>): ProductUnit {
  const unit: ProductUnit = { ...data, id: ids.productUnits++ };
  store.productUnits.push(unit);
  persistStore();
  return unit;
}

export function replaceProductUnits(product_id: number, units: Omit<ProductUnit, 'id' | 'product_id'>[]): ProductUnit[] {
  store.productUnits = store.productUnits.filter(u => u.product_id !== product_id);
  const saved = units.map(unit => addProductUnit({ ...unit, product_id }));
  addAuditLog({ action: 'PRODUCT_UNITS_UPDATE', entity: 'product', entity_id: product_id,
    after_data: JSON.stringify(saved) });
  persistStore();
  return saved;
}

export function getOpeningBalance(): number {
  return store.cashTransactions
    .filter(t => t.type === 'OPENING')
    .reduce((sum, t) => sum + t.amount, 0);
}

export function addOpeningBalance(amount: number, note = 'رصيد افتتاحي إضافي', user_id?: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return false;
  store.cashTransactions.push({
    id: ids.cashTx++, type: 'OPENING', amount, reference_type: null, reference_id: null,
    shift_id: null, note, user_id: user_id ?? null, date: today(), created_at: now(),
  });
  addAuditLog({ action: 'OPENING_BALANCE_ADD', entity: 'cashbox', entity_id: null,
    after_data: JSON.stringify({ amount, note }) });
  persistStore();
  return true;
}

export function getProductCategories(): string[] {
  const cats = new Set(store.products.map(p => p.category).filter(Boolean) as string[]);
  return Array.from(cats).sort();
}

// ─── Product Alternatives ─────────────────────────────────
export function getProductAlternatives(product_id: number): Product[] {
  const p = getProduct(product_id);
  if (!p || !p.active_ingredient) return [];
  const q = (p.active_ingredient || '').toLowerCase();
  return store.products.filter(alt =>
    alt.id !== product_id && alt.active &&
    (alt.active_ingredient || '').toLowerCase() === q
  );
}

// ═══════════════════════════════════════════════════════════
// BATCHES & INVENTORY
// ═══════════════════════════════════════════════════════════

export function getBatches(product_id: number, activeOnly = true): Batch[] {
  let result = store.batches.filter(b => b.product_id === product_id);
  if (activeOnly) result = result.filter(b => b.status === 'ACTIVE' && b.quantity > 0);
  // FEFO order
  return result.sort((a, b) => (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31'));
}

export function getAllBatches(opts?: { status?: BatchStatus }): Batch[] {
  let result = [...store.batches];
  if (opts?.status) result = result.filter(b => b.status === opts.status);
  return result;
}

export function getBatch(id: number): Batch | null {
  return store.batches.find(b => b.id === id) ?? null;
}

export function getProductStock(product_id: number): number {
  return store.batches
    .filter(b => b.product_id === product_id && b.status === 'ACTIVE')
    .reduce((s, b) => s + b.quantity, 0);
}

export function getInventoryList(opts?: {
  search?: string; status?: string; category?: string;
}): InventoryItem[] {
  const products = getProducts({ search: opts?.search, category: opts?.category });
  const todayStr = today();

  return products.map(p => {
    const batches = getBatches(p.id, false).filter(b => b.status === 'ACTIVE');
    const totalQty = batches.reduce((s, b) => s + b.quantity, 0);
    const activeBatches = batches.filter(b => b.quantity > 0);

    // Find nearest expiry
    let nearestExpiry: string | null = null;
    let daysToNearest: number | null = null;
    const expiringBatches = activeBatches.filter(b => !!b.expiry_date);
    if (expiringBatches.length > 0) {
      const sorted = [...expiringBatches].sort((a, b) => a.expiry_date.localeCompare(b.expiry_date));
      nearestExpiry = sorted[0].expiry_date;
      const diff = new Date(nearestExpiry).getTime() - new Date(todayStr).getTime();
      daysToNearest = Math.ceil(diff / (1000 * 60 * 60 * 24));
    }

    let status: InventoryItem['status'] = 'ok';
    if (totalQty === 0) status = 'out';
    else if (totalQty <= p.minimum_stock) status = 'low';
    if (daysToNearest !== null) {
      if (daysToNearest <= 0) status = 'expired';
      else if (daysToNearest <= 90) status = 'expiring';
    }

    return {
      product_id: p.id,
      trade_name: p.trade_name,
      generic_name: p.generic_name,
      barcode: p.barcode,
      category: p.category,
      inventory_unit: p.inventory_unit,
      selling_price: p.selling_price,
      total_quantity: totalQty,
      minimum_stock: p.minimum_stock,
      reorder_level: p.reorder_level,
      status,
      nearest_expiry: nearestExpiry,
      days_to_nearest_expiry: daysToNearest,
      batches: activeBatches,
    };
  }).filter(item => {
    if (!opts?.status || opts.status === 'all') return true;
    if (opts.status === 'ok') return item.status === 'ok';
    if (opts.status === 'low') return item.status === 'low';
    if (opts.status === 'out') return item.status === 'out';
    if (opts.status === 'expiring') return item.status === 'expiring';
    if (opts.status === 'expired') return item.status === 'expired';
    return true;
  });
}

// ─── Expiry Radar ─────────────────────────────────────────
export function getExpiryRadar(): ExpiryRadarItem[] {
  const todayStr = today();
  const items: ExpiryRadarItem[] = [];

  store.batches.forEach(b => {
    if (b.status !== 'ACTIVE' || b.quantity <= 0 || !b.expiry_date) return;
    const product = getProduct(b.product_id);
    if (!product) return;
    const diff = new Date(b.expiry_date).getTime() - new Date(todayStr).getTime();
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24));

    let group: ExpiryRadarItem['group'] = 'ok';
    if (days <= 0) group = 'expired';
    else if (days <= 30) group = '30';
    else if (days <= 60) group = '60';
    else if (days <= 90) group = '90';

    if (group !== 'ok') {
      items.push({
        product_id: b.product_id,
        product_name: product.trade_name,
        batch_id: b.id,
        batch_number: b.batch_number,
        expiry_date: b.expiry_date,
        days_to_expiry: days,
        quantity: b.quantity,
        unit: product.inventory_unit,
        stock_value: b.quantity * b.purchase_price,
        group,
      });
    }
  });

  return items.sort((a, b) => a.days_to_expiry - b.days_to_expiry);
}

// ─── Dead Stock ───────────────────────────────────────────
export function getDeadStock(days = 90): InventoryItem[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);
  const cutoffStr = cutoff.toISOString().split('T')[0];

  const recentProducts = new Set(
    store.stockMovements
      .filter(m => m.created_at >= cutoffStr && m.quantity < 0)
      .map(m => m.product_id)
  );

  return getInventoryList().filter(item =>
    item.total_quantity > 0 && !recentProducts.has(item.product_id)
  );
}

// ─── Reorder Suggestions ─────────────────────────────────
export interface ReorderSuggestion {
  product_id: number;
  trade_name: string;
  current_stock: number;
  minimum_stock: number;
  reorder_level: number;
  inventory_unit: string;
  suggested_quantity: number;
  reason: string;
}

export function getReorderSuggestions(): ReorderSuggestion[] {
  return getInventoryList()
    .filter(item => item.total_quantity <= item.reorder_level)
    .map(item => {
      const suggested = Math.max(item.reorder_level * 2 - item.total_quantity, item.minimum_stock);
      return {
        product_id: item.product_id,
        trade_name: item.trade_name,
        current_stock: item.total_quantity,
        minimum_stock: item.minimum_stock,
        reorder_level: item.reorder_level,
        inventory_unit: item.inventory_unit,
        suggested_quantity: suggested,
        reason: item.total_quantity === 0
          ? 'نفد المخزون'
          : item.total_quantity <= item.minimum_stock
          ? 'أقل من الحد الأدنى'
          : 'أقل من نقطة إعادة الطلب',
      };
    });
}

// ─── ABC Analysis ─────────────────────────────────────────
export interface AbcItem {
  product_id: number;
  trade_name: string;
  total_revenue: number;
  revenue_pct: number;
  cumulative_pct: number;
  abc_class: AbcClass;
}

export function getAbcAnalysis(dateFrom: string, dateTo: string): AbcItem[] {
  const revenueMap: Record<number, number> = {};
  store.saleItems.forEach(si => {
    const sale = store.sales.find(s => s.id === si.sale_id);
    if (!sale || sale.cancelled) return;
    if (sale.date < dateFrom || sale.date > dateTo) return;
    revenueMap[si.product_id] = (revenueMap[si.product_id] || 0) + si.line_total;
  });

  const items = Object.entries(revenueMap)
    .map(([pid, rev]) => {
      const product = getProduct(Number(pid));
      return { product_id: Number(pid), trade_name: product?.trade_name || 'غير محدد', total_revenue: rev };
    })
    .sort((a, b) => b.total_revenue - a.total_revenue);

  const totalRev = items.reduce((s, i) => s + i.total_revenue, 0);
  let cumulative = 0;
  return items.map(item => {
    const pct = totalRev > 0 ? (item.total_revenue / totalRev) * 100 : 0;
    cumulative += pct;
    const abc_class: AbcClass = cumulative <= 70 ? 'A' : cumulative <= 90 ? 'B' : 'C';
    return { ...item, revenue_pct: pct, cumulative_pct: cumulative, abc_class };
  });
}

// ═══════════════════════════════════════════════════════════
// FEFO ALLOCATION
// ═══════════════════════════════════════════════════════════

interface FefoAllocation {
  batch_id: number;
  batch_number: string;
  expiry_date: string;
  quantity: number;
  purchase_price: number;
}

function allocateFefo(product_id: number, quantityNeeded: number, reserved: Map<number, number> = new Map()): FefoAllocation[] | null {
  // Get active non-expired batches sorted by expiry (FEFO)
  const todayStr = today();
  const batches = store.batches
    .filter(b =>
      b.product_id === product_id &&
      b.status === 'ACTIVE' &&
      b.quantity - (reserved.get(b.id) || 0) > 0 &&
      (!b.expiry_date || b.expiry_date > todayStr)
    )
    .sort((a, b) => (a.expiry_date || '9999-12-31').localeCompare(b.expiry_date || '9999-12-31'));

  const available = batches.reduce((s, b) => s + b.quantity - (reserved.get(b.id) || 0), 0);
  if (available < quantityNeeded) return null; // insufficient stock

  const allocations: FefoAllocation[] = [];
  let remaining = quantityNeeded;

  for (const batch of batches) {
    if (remaining <= 0) break;
    const take = Math.min(batch.quantity - (reserved.get(batch.id) || 0), remaining);
    allocations.push({
      batch_id: batch.id,
      batch_number: batch.batch_number,
      expiry_date: batch.expiry_date,
      quantity: take,
      purchase_price: batch.purchase_price,
    });
    remaining -= take;
  }

  return allocations;
}

// ═══════════════════════════════════════════════════════════
// SALES — ATOMIC
// ═══════════════════════════════════════════════════════════

export interface NewSaleItem {
  product_id: number;
  unit: string;
  quantity: number;
  unit_price: number;
  discount: number;
}

export interface NewSale {
  sale_type: SaleType;
  customer_id?: number | null;
  items: NewSaleItem[];
  discount: number;
  amount_paid: number;
  notes?: string;
  user_id?: number | null;
  shift_id?: number | null;
  date?: string;
}

export interface SaleResult {
  success: boolean;
  sale?: Sale;
  error?: string;
}

export function createSale(data: NewSale): SaleResult {
  try {
    if (!data.items.length) return { success: false, error: 'أضف صنفًا واحدًا على الأقل' };
    if (!Number.isFinite(data.discount) || data.discount < 0 || !Number.isFinite(data.amount_paid) || data.amount_paid < 0) {
      return { success: false, error: 'قيمة الخصم أو المبلغ المدفوع غير صحيحة' };
    }
    // Validate items and resolve units
    const resolvedItems: (NewSaleItem & { qty_in_inv_unit: number; allocations: FefoAllocation[] })[] = [];
    const reserved = new Map<number, number>();

    for (const item of data.items) {
      const product = getProduct(item.product_id);
      if (!product) return { success: false, error: `منتج غير موجود: ${item.product_id}` };
      if (!isValidUnitQuantity(item.quantity, item.unit) || !Number.isFinite(item.unit_price) || item.unit_price < 0 ||
          !Number.isFinite(item.discount) || item.discount < 0 || item.discount > item.quantity * item.unit_price) {
        return { success: false, error: `تحقق من الكمية والسعر والخصم للصنف ${product.trade_name}` };
      }
      const factor = getUnitConversionFactor(item.product_id, item.unit);
      if (factor === null) return { success: false, error: `الوحدة ${item.unit} غير معرفة للصنف ${product.trade_name}` };
      const qtyInInvUnit = toBaseQuantity(item.quantity, factor);

      // FEFO allocation
      const allocs = allocateFefo(item.product_id, qtyInInvUnit, reserved);
      if (!allocs) {
        return { success: false, error: `المخزون غير كافٍ: ${product.trade_name}` };
      }
      allocs.forEach(allocation => reserved.set(allocation.batch_id, (reserved.get(allocation.batch_id) || 0) + allocation.quantity));

      resolvedItems.push({ ...item, qty_in_inv_unit: qtyInInvUnit, allocations: allocs });
    }

    // Calculate totals
    let subtotal = 0;
    for (const item of resolvedItems) {
      const lineTotal = item.quantity * item.unit_price - item.discount;
      subtotal += lineTotal;
    }
    if (data.discount > subtotal) return { success: false, error: 'خصم الفاتورة أكبر من مجموع الأصناف' };
    const total = subtotal - data.discount;
    const amountPaid = Math.min(data.amount_paid, total);
    const remaining = total - amountPaid;
    const changeGiven = data.amount_paid > total ? data.amount_paid - total : 0;

    const saleDate = data.date || today();
    if (!isValidIsoDate(saleDate)) return { success: false, error: 'تاريخ فاتورة البيع غير صحيح' };
    if (!Number.isFinite(data.amount_paid) || data.amount_paid < 0) return { success: false, error: 'المبلغ المدفوع غير صحيح' };
    // Create sale record
    const sale: Sale = {
      id: ids.sales++,
      invoice_number: nextInvoice(),
      sale_type: data.sale_type,
      customer_id: data.customer_id ?? null,
      customer_name: data.customer_id
        ? (store.customers.find(c => c.id === data.customer_id)?.name ?? null)
        : null,
      subtotal,
      discount: data.discount,
      total,
      amount_paid: amountPaid,
      change_given: changeGiven,
      remaining,
      cogs: 0,
      gross_profit: 0,
      date: saleDate,
      shift_id: data.shift_id ?? null,
      user_id: data.user_id ?? null,
      notes: data.notes ?? null,
      cancelled: false,
      cancelled_by: null,
      cancelled_at: null,
      cancel_reason: null,
      created_at: now(),
    };

    let totalCogs = 0;

    // Create sale items + batch allocations + stock movements
    for (const item of resolvedItems) {
      const lineTotal = item.quantity * item.unit_price - item.discount;
      let itemCogs = 0;

      for (const alloc of item.allocations) {
        itemCogs += alloc.quantity * alloc.purchase_price;
      }

      const saleItem: SaleItem = {
        id: ids.saleItems++,
        sale_id: sale.id,
        product_id: item.product_id,
        product_name: getProduct(item.product_id)?.trade_name ?? '',
        batch_id: item.allocations[0]?.batch_id ?? null,
        unit: item.unit,
        quantity: item.quantity,
        unit_name: item.unit,
        quantity_entered: item.quantity,
        conversion_factor: item.qty_in_inv_unit / item.quantity,
        quantity_in_inventory_unit: item.qty_in_inv_unit,
        unit_price: item.unit_price,
        base_purchase_price: item.qty_in_inv_unit > 0 ? itemCogs / item.qty_in_inv_unit : 0,
        discount: item.discount,
        line_total: lineTotal,
        cogs: itemCogs,
      };
      store.saleItems.push(saleItem);
      totalCogs += itemCogs;

      // Batch allocations + deduct stock
      for (const alloc of item.allocations) {
        store.saleBatchAllocations.push({
          id: ids.saleAllocations++,
          sale_item_id: saleItem.id,
          batch_id: alloc.batch_id,
          quantity_allocated: alloc.quantity,
          purchase_price: alloc.purchase_price,
        });

        // Deduct from batch
        const batch = store.batches.find(b => b.id === alloc.batch_id);
        if (batch) {
          batch.quantity -= alloc.quantity;
          if (batch.quantity <= 0) {
            batch.quantity = 0;
            batch.status = 'DEPLETED';
          }
        }

        // Stock movement
        store.stockMovements.push({
          id: ids.stockMovements++,
          product_id: item.product_id,
          batch_id: alloc.batch_id,
          type: 'SALE',
          quantity: -alloc.quantity,
          unit: getProduct(item.product_id)?.inventory_unit ?? 'قطعة',
          quantity_in_inventory_unit: -alloc.quantity,
          reference_type: 'sale',
          reference_id: sale.id,
          note: null,
          user_id: data.user_id ?? null,
          created_at: now(),
        });
      }
    }

    // Update sale COGS and profit
    sale.cogs = totalCogs;
    sale.gross_profit = total - totalCogs;
    store.sales.push(sale);

    // Customer balance for credit sales
    if ((data.sale_type === 'credit' || remaining > 0) && data.customer_id) {
      const customer = store.customers.find(c => c.id === data.customer_id);
      if (customer) {
        customer.balance += remaining;
        store.customerTransactions.push({
          id: ids.customerTx++,
          customer_id: data.customer_id,
          type: 'sale',
          amount: total,
          balance_after: customer.balance,
          reference_id: sale.id,
          note: `فاتورة ${sale.invoice_number}`,
          date: saleDate,
          created_at: now(),
        });
        if (amountPaid > 0) {
          store.customerTransactions.push({
            id: ids.customerTx++,
            customer_id: data.customer_id,
            type: 'payment',
            amount: -amountPaid,
            balance_after: customer.balance,
            reference_id: sale.id,
            note: `دفعة من فاتورة ${sale.invoice_number}`,
            date: saleDate,
            created_at: now(),
          });
        }
      }
    }

    // Cash transaction
    if (amountPaid > 0) {
      store.cashTransactions.push({
        id: ids.cashTx++,
        type: 'SALE_CASH',
        amount: amountPaid,
        reference_type: 'sale',
        reference_id: sale.id,
        shift_id: data.shift_id ?? null,
        note: `بيع نقدي - ${sale.invoice_number}`,
        user_id: data.user_id ?? null,
        date: saleDate,
        created_at: now(),
      });
    }

    // Update shift totals
    if (data.shift_id) {
      const shift = store.shifts.find(s => s.id === data.shift_id);
      if (shift) {
        shift.total_sales += total;
        shift.expected_cash = (shift.expected_cash || shift.opening_cash) + amountPaid;
      }
    }

    addAuditLog({
      action: 'SALE_CREATE', entity: 'sale', entity_id: sale.id,
      after_data: JSON.stringify({ invoice: sale.invoice_number, total }),
    });

    return { success: true, sale };
  } catch (e: any) {
    return { success: false, error: e?.message || 'خطأ غير متوقع' };
  }
}

export function cancelSale(id: number, reason: string, user_id?: number): void {
  const sale = store.sales.find(s => s.id === id);
  if (!sale || sale.cancelled || store.saleReturns.some(entry => entry.sale_id === id)) return;

  const before = JSON.stringify(sale);
  sale.cancelled = true;
  sale.cancelled_by = user_id ?? null;
  sale.cancelled_at = now();
  sale.cancel_reason = reason;

  // Reverse stock movements
  store.saleItems
    .filter(si => si.sale_id === id)
    .forEach(si => {
      store.saleBatchAllocations
        .filter(a => a.sale_item_id === si.id)
        .forEach(alloc => {
          const batch = store.batches.find(b => b.id === alloc.batch_id);
          if (batch) {
            batch.quantity += alloc.quantity_allocated;
            batch.status = batch.expiry_date && batch.expiry_date <= today() ? 'EXPIRED' : 'ACTIVE';
          }
          store.stockMovements.push({
            id: ids.stockMovements++,
            product_id: si.product_id,
            batch_id: alloc.batch_id,
            type: 'SALE_RETURN',
            quantity: alloc.quantity_allocated,
            unit: getProduct(si.product_id)?.inventory_unit ?? 'قطعة',
            quantity_in_inventory_unit: alloc.quantity_allocated,
            reference_type: 'sale_cancel',
            reference_id: id,
            note: `إلغاء فاتورة ${sale.invoice_number}`,
            user_id: user_id ?? null,
            created_at: now(),
          });
        });
    });

  // Reverse customer balance
  if (sale.remaining > 0 && sale.customer_id) {
    const customer = store.customers.find(c => c.id === sale.customer_id);
    if (customer) customer.balance -= sale.remaining;
  }

  // Reverse cash
  if (sale.amount_paid > 0) {
    store.cashTransactions.push({
      id: ids.cashTx++,
      type: 'SALE_CASH',
      amount: -sale.amount_paid,
      reference_type: 'sale_cancel',
      reference_id: id,
      shift_id: sale.shift_id,
      note: `إلغاء ${sale.invoice_number}`,
      user_id: user_id ?? null,
      date: today(),
      created_at: now(),
    });
  }

  addAuditLog({ action: 'SALE_CANCEL', entity: 'sale', entity_id: id,
    before_data: before, reason });
}

export function getSales(opts?: {
  dateFrom?: string; dateTo?: string; customer_id?: number;
  sale_type?: SaleType; limit?: number; includeCancelled?: boolean;
}): Sale[] {
  let result = [...store.sales];
  if (!opts?.includeCancelled) result = result.filter(s => !s.cancelled);
  if (opts?.dateFrom) result = result.filter(s => s.date >= opts.dateFrom!);
  if (opts?.dateTo) result = result.filter(s => s.date <= opts.dateTo!);
  if (opts?.customer_id) result = result.filter(s => s.customer_id === opts.customer_id);
  if (opts?.sale_type) result = result.filter(s => s.sale_type === opts.sale_type);
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (opts?.limit) result = result.slice(0, opts.limit);
  return result;
}

export function getSale(id: number): Sale | null {
  return store.sales.find(s => s.id === id) ?? null;
}

export function getSaleItems(sale_id: number): SaleItem[] {
  return store.saleItems.filter(si => si.sale_id === sale_id);
}

export function getSaleItemReturnableQuantity(sale_item_id: number): number {
  const item = store.saleItems.find(line => line.id === sale_item_id);
  if (!item) return 0;
  const sale = store.sales.find(entry => entry.id === item.sale_id);
  if (!sale || sale.cancelled) return 0;
  const returned = store.saleReturns.flatMap(entry => entry.items)
    .filter(line => line.sale_item_id === sale_item_id)
    .reduce((sum, line) => sum + line.quantity, 0);
  return Math.max(0, item.quantity - returned);
}

export function getSaleReturns(sale_id: number): SaleReturn[] {
  return store.saleReturns.filter(entry => entry.sale_id === sale_id);
}

export interface NewSaleReturn {
  sale_id: number;
  items: { sale_item_id: number; quantity: number }[];
  user_id?: number | null;
}

export type ReturnResult<T> = { success: true; record: T } | { success: false; error: string };

export function createSaleReturn(data: NewSaleReturn): ReturnResult<SaleReturn> {
  const sale = store.sales.find(entry => entry.id === data.sale_id);
  if (!sale || sale.cancelled) return { success: false, error: 'الفاتورة غير موجودة أو ملغاة' };
  if (!data.items.length) return { success: false, error: 'اختر صنفًا واحدًا على الأقل للمرتجع' };
  const prepared: { item: SaleItem; quantity: number; factor: number; baseQuantity: number; amount: number; returnedCogs: number; allocations: ReturnBatchAllocation[] }[] = [];
  const seen = new Set<number>();
  for (const request of data.items) {
    if (seen.has(request.sale_item_id)) return { success: false, error: 'لا تكرر الصنف نفسه في المرتجع' };
    seen.add(request.sale_item_id);
    const item = store.saleItems.find(line => line.id === request.sale_item_id && line.sale_id === sale.id);
    if (!item || !isValidUnitQuantity(request.quantity, item.unit_name || item.unit) || request.quantity > getSaleItemReturnableQuantity(request.sale_item_id)) {
      return { success: false, error: 'كمية المرتجع أكبر من الكمية المتبقية من الفاتورة' };
    }
    const factor = item.conversion_factor ?? (item.quantity > 0 ? item.quantity_in_inventory_unit / item.quantity : 1);
    if (!Number.isFinite(factor) || factor <= 0) return { success: false, error: 'معامل الوحدة التاريخي غير صالح' };
    const baseQuantity = toBaseQuantity(request.quantity, factor);
    const invoiceDiscountShare = sale.subtotal > 0 ? sale.discount * item.line_total / sale.subtotal : 0;
    const netLineAmount = Math.max(0, item.line_total - invoiceDiscountShare);
    const amount = item.quantity > 0 ? request.quantity * netLineAmount / item.quantity : 0;

    const sourceAllocations = store.saleBatchAllocations.filter(allocation => allocation.sale_item_id === item.id);
    let remainingBase = baseQuantity;
    const allocations: ReturnBatchAllocation[] = [];
    for (const source of sourceAllocations) {
      const alreadyReturned = store.saleReturns.flatMap(entry => entry.items)
        .filter(line => line.sale_item_id === item.id)
        .flatMap(line => line.batch_allocations)
        .filter(allocation => allocation.batch_id === source.batch_id)
        .reduce((sum, allocation) => sum + allocation.quantity, 0);
      const availableToRestore = Math.max(0, source.quantity_allocated - alreadyReturned);
      const amountFromBatch = Math.min(availableToRestore, remainingBase);
      if (amountFromBatch > 0) allocations.push({ batch_id: source.batch_id, quantity: amountFromBatch });
      remainingBase -= amountFromBatch;
    }
    if (remainingBase > 1e-8) return { success: false, error: 'تعذر مطابقة المرتجع مع دفعات البيع الأصلية' };
    if (allocations.some(allocation => !store.batches.some(batch => batch.id === allocation.batch_id))) {
      return { success: false, error: 'إحدى دفعات البيع الأصلية لم تعد موجودة' };
    }
    const returnedCogs = baseQuantity * (item.base_purchase_price ?? (item.quantity_in_inventory_unit > 0 ? item.cogs / item.quantity_in_inventory_unit : 0));
    prepared.push({ item, quantity: request.quantity, factor, baseQuantity, amount, returnedCogs, allocations });
  }

  const total = prepared.reduce((sum, line) => sum + line.amount, 0);
  const priorCreditReduction = store.saleReturns.filter(entry => entry.sale_id === sale.id).reduce((sum, entry) => sum + entry.credit_reduction, 0);
  const creditReduction = sale.customer_id ? Math.min(total, Math.max(0, sale.remaining - priorCreditReduction)) : 0;
  const cashRefund = Math.max(0, total - creditReduction);
  const returnId = ids.saleReturns++;
  const items: SaleReturnItem[] = prepared.map(line => ({
    id: ids.saleReturnItems++, return_id: returnId, sale_item_id: line.item.id,
    product_id: line.item.product_id, product_name: line.item.product_name,
    unit: line.item.unit_name || line.item.unit, quantity: line.quantity,
    conversion_factor: line.factor, quantity_in_inventory_unit: line.baseQuantity,
    refund_amount: line.amount, returned_cogs: line.returnedCogs, batch_allocations: line.allocations,
  }));
  const record: SaleReturn = { id: returnId, sale_id: sale.id, invoice_number: sale.invoice_number,
    total, cash_refund: cashRefund, credit_reduction: creditReduction, date: today(), created_at: now(), items };

  for (const line of items) {
    for (const allocation of line.batch_allocations) {
      const batch = store.batches.find(entry => entry.id === allocation.batch_id)!;
      batch.quantity += allocation.quantity;
      batch.status = batch.expiry_date && batch.expiry_date <= today() ? 'EXPIRED' : 'ACTIVE';
      store.stockMovements.push({ id: ids.stockMovements++, product_id: line.product_id, batch_id: batch.id,
        type: 'SALE_RETURN', quantity: allocation.quantity,
        unit: getProduct(line.product_id)?.inventory_unit ?? 'قطعة',
        quantity_in_inventory_unit: allocation.quantity, reference_type: 'sale_return', reference_id: returnId,
        note: `مرتجع من فاتورة ${sale.invoice_number}`, user_id: data.user_id ?? null, created_at: now() });
    }
  }
  store.saleReturns.push(record);
  if (sale.customer_id && creditReduction > 0) {
    const customer = store.customers.find(entry => entry.id === sale.customer_id);
    if (customer) {
      customer.balance -= creditReduction;
      store.customerTransactions.push({ id: ids.customerTx++, customer_id: customer.id, type: 'return',
        amount: -creditReduction, balance_after: customer.balance, reference_id: returnId,
        note: `مرتجع فاتورة ${sale.invoice_number}`, date: today(), created_at: now() });
    }
  }
  if (cashRefund > 0) {
    store.cashTransactions.push({ id: ids.cashTx++, type: 'CUSTOMER_REFUND', amount: -cashRefund,
      reference_type: 'sale_return', reference_id: returnId, shift_id: sale.shift_id,
      note: `رد مبلغ مرتجع فاتورة ${sale.invoice_number}`, user_id: data.user_id ?? null, date: today(), created_at: now() });
    if (sale.shift_id) {
      const shift = store.shifts.find(entry => entry.id === sale.shift_id && entry.status === 'OPEN');
      if (shift) shift.expected_cash = (shift.expected_cash ?? shift.opening_cash) - cashRefund;
    }
  }
  addAuditLog({ action: 'SALE_RETURN_CREATE', entity: 'sale_return', entity_id: returnId, user_id: data.user_id,
    after_data: JSON.stringify({ sale_id: sale.id, total, items }) });
  return { success: true, record };
}

// ═══════════════════════════════════════════════════════════
// PURCHASES — ATOMIC
// ═══════════════════════════════════════════════════════════

export interface NewPurchaseItem {
  product_id: number;
  batch_number: string;
  expiry_date: string;
  unit: string;
  quantity: number;
  purchase_price: number;
  free_quantity: number;
  discount: number;
}

export interface NewPurchase {
  supplier_id?: number | null;
  invoice_number?: string;
  date?: string;
  items: NewPurchaseItem[];
  discount: number;
  amount_paid: number;
  notes?: string;
  user_id?: number | null;
}

export interface PurchaseResult {
  success: boolean;
  purchase?: Purchase;
  error?: string;
}

export function createPurchase(data: NewPurchase): PurchaseResult {
  try {
    if (!data.items.length) return { success: false, error: 'أضف صنفًا واحدًا على الأقل' };
    if (!Number.isFinite(data.discount) || data.discount < 0 || !Number.isFinite(data.amount_paid) || data.amount_paid < 0) {
      return { success: false, error: 'قيمة الخصم أو المبلغ المدفوع غير صحيحة' };
    }
    const purchaseDate = data.date || today();
    if (!isValidIsoDate(purchaseDate)) return { success: false, error: 'تاريخ فاتورة الشراء غير صحيح' };

    let subtotal = 0;
    const resolvedItems: (NewPurchaseItem & { qty_in_inv_unit: number; conversion_factor: number })[] = [];

    for (const item of data.items) {
      const product = getProduct(item.product_id);
      if (!product) return { success: false, error: 'منتج غير موجود' };
      if (!isValidUnitQuantity(item.quantity, item.unit) || !isValidUnitQuantity(item.free_quantity, item.unit, true) ||
          !Number.isFinite(item.purchase_price) || item.purchase_price < 0 || !Number.isFinite(item.discount) ||
          item.discount < 0 || item.discount > item.quantity * item.purchase_price) {
        return { success: false, error: `تحقق من الكمية والسعر والخصم للصنف ${product.trade_name}` };
      }
      const factor = getUnitConversionFactor(item.product_id, item.unit);
      if (factor === null) return { success: false, error: `الوحدة ${item.unit} غير معرفة للصنف ${product.trade_name}` };
      if (!item.batch_number.trim()) return { success: false, error: `أدخل رقم دفعة ${product.trade_name}` };
      if (!isValidIsoDate(item.expiry_date) || item.expiry_date < purchaseDate) {
        return { success: false, error: `أدخل تاريخ انتهاء صحيحًا للصنف ${product.trade_name}` };
      }
      const qtyInInvUnit = toBaseQuantity(item.quantity, factor);
      const lineTotal = item.quantity * item.purchase_price - item.discount;
      subtotal += lineTotal;
      resolvedItems.push({ ...item, qty_in_inv_unit: qtyInInvUnit, conversion_factor: factor });
    }

    if (data.discount > subtotal) return { success: false, error: 'خصم الفاتورة أكبر من مجموع الأصناف' };
    const total = subtotal - data.discount;
    if (data.amount_paid > total) return { success: false, error: 'المبلغ المدفوع أكبر من إجمالي الفاتورة' };
    const remaining = total - data.amount_paid;

    const purchase: Purchase = {
      id: ids.purchases++,
      invoice_number: data.invoice_number || nextInvoice(),
      supplier_id: data.supplier_id ?? null,
      supplier_name: data.supplier_id
        ? (store.suppliers.find(s => s.id === data.supplier_id)?.name ?? null)
        : null,
      date: purchaseDate,
      subtotal,
      discount: data.discount,
      total,
      amount_paid: data.amount_paid,
      remaining,
      notes: data.notes ?? null,
      cancelled: false,
      cancelled_by: null,
      cancelled_at: null,
      cancel_reason: null,
      user_id: data.user_id ?? null,
      created_at: now(),
    };
    store.purchases.push(purchase);

    for (const item of resolvedItems) {
      const product = getProduct(item.product_id)!;
      const lineTotal = item.quantity * item.purchase_price - item.discount;
      const totalQty = (item.quantity + item.free_quantity) * item.conversion_factor;
      const invoiceDiscountShare = subtotal > 0 ? data.discount * lineTotal / subtotal : 0;
      const netLineCost = Math.max(0, lineTotal - invoiceDiscountShare);
      const basePurchasePrice = totalQty > 0 ? netLineCost / totalQty : 0;

      // Find existing batch or create new
      let batch = store.batches.find(b =>
        b.product_id === item.product_id &&
        b.batch_number === item.batch_number &&
        b.expiry_date === item.expiry_date &&
        b.status === 'ACTIVE'
      );

      if (batch) {
        const oldQuantity = batch.quantity;
        batch.purchase_price = oldQuantity + totalQty > 0
          ? ((batch.purchase_price * oldQuantity) + (basePurchasePrice * totalQty)) / (oldQuantity + totalQty)
          : basePurchasePrice;
        batch.quantity += totalQty;
        batch.initial_quantity += totalQty;
      } else {
        batch = {
          id: ids.batches++,
          product_id: item.product_id,
          batch_number: item.batch_number,
          expiry_date: item.expiry_date,
          received_date: purchaseDate,
          purchase_price: basePurchasePrice,
          selling_price: product.selling_price,
          quantity: totalQty,
          initial_quantity: totalQty,
          supplier_id: data.supplier_id ?? null,
          purchase_id: purchase.id,
          status: item.expiry_date <= today() ? 'EXPIRED' : 'ACTIVE',
          notes: null,
          is_opening: false,
          created_at: now(),
        };
        store.batches.push(batch);
      }

      const purchaseItem: PurchaseItem = {
        id: ids.purchaseItems++, purchase_id: purchase.id, product_id: item.product_id,
        product_name: product.trade_name, batch_number: item.batch_number, expiry_date: item.expiry_date,
        unit: item.unit, unit_name: item.unit, quantity: item.quantity, quantity_entered: item.quantity,
        batch_id: batch.id, conversion_factor: item.conversion_factor,
        quantity_in_inventory_unit: totalQty, purchase_price: item.purchase_price,
        base_purchase_price: basePurchasePrice, free_quantity: item.free_quantity,
        discount: item.discount, line_total: lineTotal,
      };
      store.purchaseItems.push(purchaseItem);

      // Stock movement
      store.stockMovements.push({
        id: ids.stockMovements++,
        product_id: item.product_id,
        batch_id: batch.id,
        type: 'PURCHASE',
        quantity: totalQty,
        unit: product.inventory_unit,
        quantity_in_inventory_unit: totalQty,
        reference_type: 'purchase',
        reference_id: purchase.id,
        note: null,
        user_id: data.user_id ?? null,
        created_at: now(),
      });
    }

    // Supplier balance
    if (data.supplier_id && remaining > 0) {
      const supplier = store.suppliers.find(s => s.id === data.supplier_id);
      if (supplier) {
        supplier.balance += remaining;
        store.supplierTransactions.push({
          id: ids.supplierTx++,
          supplier_id: data.supplier_id,
          type: 'purchase',
          amount: total,
          balance_after: supplier.balance,
          reference_id: purchase.id,
          note: `فاتورة شراء ${purchase.invoice_number}`,
          date: purchaseDate,
          created_at: now(),
        });
      }
    }

    // Cash
    if (purchase.amount_paid > 0) {
      store.cashTransactions.push({
        id: ids.cashTx++,
        type: 'PURCHASE_PAYMENT',
        amount: -purchase.amount_paid,
        reference_type: 'purchase',
        reference_id: purchase.id,
        shift_id: null,
        note: `دفعة فاتورة ${purchase.invoice_number}`,
        user_id: data.user_id ?? null,
        date: purchaseDate,
        created_at: now(),
      });
    }

    addAuditLog({
      action: 'PURCHASE_CREATE', entity: 'purchase', entity_id: purchase.id,
      after_data: JSON.stringify({ invoice: purchase.invoice_number, total }),
    });

    return { success: true, purchase };
  } catch (e: any) {
    return { success: false, error: e?.message || 'خطأ غير متوقع' };
  }
}

export function getPurchases(opts?: {
  dateFrom?: string; dateTo?: string; supplier_id?: number; limit?: number;
}): Purchase[] {
  let result = store.purchases.filter(p => !p.cancelled);
  if (opts?.dateFrom) result = result.filter(p => p.date >= opts.dateFrom!);
  if (opts?.dateTo) result = result.filter(p => p.date <= opts.dateTo!);
  if (opts?.supplier_id) result = result.filter(p => p.supplier_id === opts.supplier_id);
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (opts?.limit) result = result.slice(0, opts.limit);
  return result;
}

export function getPurchase(id: number): Purchase | null {
  return store.purchases.find(p => p.id === id) ?? null;
}

export function getPurchaseItems(purchase_id: number): PurchaseItem[] {
  return store.purchaseItems.filter(pi => pi.purchase_id === purchase_id);
}

export function getPurchaseItemReturnableQuantity(purchase_item_id: number): number {
  const item = store.purchaseItems.find(line => line.id === purchase_item_id);
  if (!item) return 0;
  const purchase = store.purchases.find(entry => entry.id === item.purchase_id);
  if (!purchase || purchase.cancelled) return 0;
  const returned = store.purchaseReturns.flatMap(entry => entry.items)
    .filter(line => line.purchase_item_id === purchase_item_id)
    .reduce((sum, line) => sum + line.quantity, 0);
  return Math.max(0, item.quantity + item.free_quantity - returned);
}

export function getPurchaseReturns(purchase_id: number): PurchaseReturn[] {
  return store.purchaseReturns.filter(entry => entry.purchase_id === purchase_id);
}

export interface NewPurchaseReturn {
  purchase_id: number;
  items: { purchase_item_id: number; quantity: number }[];
  user_id?: number | null;
}

export function createPurchaseReturn(data: NewPurchaseReturn): ReturnResult<PurchaseReturn> {
  const purchase = store.purchases.find(entry => entry.id === data.purchase_id);
  if (!purchase || purchase.cancelled) return { success: false, error: 'فاتورة الشراء غير موجودة أو ملغاة' };
  if (!data.items.length) return { success: false, error: 'اختر صنفًا واحدًا على الأقل للمرتجع' };
  const prepared: { item: PurchaseItem; batch: Batch; quantity: number; factor: number; baseQuantity: number; amount: number }[] = [];
  const seen = new Set<number>();
  for (const request of data.items) {
    if (seen.has(request.purchase_item_id)) return { success: false, error: 'لا تكرر الصنف نفسه في المرتجع' };
    seen.add(request.purchase_item_id);
    const item = store.purchaseItems.find(line => line.id === request.purchase_item_id && line.purchase_id === purchase.id);
    if (!item || !isValidUnitQuantity(request.quantity, item.unit_name || item.unit) || request.quantity > getPurchaseItemReturnableQuantity(request.purchase_item_id)) {
      return { success: false, error: 'كمية المرتجع أكبر من الكمية المتبقية من فاتورة الشراء' };
    }
    const factor = item.conversion_factor ?? ((item.quantity + item.free_quantity) > 0
      ? item.quantity_in_inventory_unit / (item.quantity + item.free_quantity) : 1);
    if (!Number.isFinite(factor) || factor <= 0) return { success: false, error: 'معامل الوحدة التاريخي غير صالح' };
    const baseQuantity = toBaseQuantity(request.quantity, factor);
    const batch = store.batches.find(entry => entry.id === item.batch_id) || store.batches.find(entry =>
      entry.product_id === item.product_id && entry.batch_number === item.batch_number && entry.expiry_date === item.expiry_date);
    if (!batch || batch.quantity + 1e-8 < baseQuantity) return { success: false, error: `الرصيد المتاح في دفعة ${item.batch_number} لا يكفي للمرتجع` };
    const invoiceDiscountShare = purchase.subtotal > 0 ? purchase.discount * item.line_total / purchase.subtotal : 0;
    const netLineAmount = Math.max(0, item.line_total - invoiceDiscountShare);
    const receivedQuantity = item.quantity + item.free_quantity;
    const amount = receivedQuantity > 0 ? request.quantity * netLineAmount / receivedQuantity : 0;
    prepared.push({ item, batch, quantity: request.quantity, factor, baseQuantity, amount });
  }

  const total = prepared.reduce((sum, line) => sum + line.amount, 0);
  const priorPayableReduction = store.purchaseReturns.filter(entry => entry.purchase_id === purchase.id)
    .reduce((sum, entry) => sum + entry.payable_reduction, 0);
  const priorCashRefund = store.purchaseReturns.filter(entry => entry.purchase_id === purchase.id)
    .reduce((sum, entry) => sum + entry.cash_refund, 0);
  const supplier = purchase.supplier_id ? store.suppliers.find(entry => entry.id === purchase.supplier_id) : null;
  const payableReduction = supplier ? Math.min(total, Math.max(0, purchase.remaining - priorPayableReduction)) : 0;
  const cashRefund = Math.min(Math.max(0, total - payableReduction), Math.max(0, purchase.amount_paid - priorCashRefund));
  const returnId = ids.purchaseReturns++;
  const items: PurchaseReturnItem[] = prepared.map(line => ({
    id: ids.purchaseReturnItems++, return_id: returnId, purchase_item_id: line.item.id,
    product_id: line.item.product_id, product_name: line.item.product_name,
    unit: line.item.unit_name || line.item.unit, quantity: line.quantity,
    conversion_factor: line.factor, quantity_in_inventory_unit: line.baseQuantity,
    refund_amount: line.amount, batch_id: line.batch.id,
  }));
  const record: PurchaseReturn = { id: returnId, purchase_id: purchase.id, invoice_number: purchase.invoice_number,
    total, cash_refund: cashRefund, payable_reduction: payableReduction, date: today(), created_at: now(), items };

  for (const line of prepared) {
    line.batch.quantity = Math.max(0, line.batch.quantity - line.baseQuantity);
    if (line.batch.quantity <= 0) line.batch.status = 'DEPLETED';
    store.stockMovements.push({ id: ids.stockMovements++, product_id: line.item.product_id, batch_id: line.batch.id,
      type: 'PURCHASE_RETURN', quantity: -line.baseQuantity,
      unit: getProduct(line.item.product_id)?.inventory_unit ?? 'قطعة',
      quantity_in_inventory_unit: -line.baseQuantity, reference_type: 'purchase_return', reference_id: returnId,
      note: `مرتجع إلى المورد من فاتورة ${purchase.invoice_number}`, user_id: data.user_id ?? null, created_at: now() });
  }
  store.purchaseReturns.push(record);
  if (supplier && payableReduction > 0) {
    supplier.balance -= payableReduction;
    store.supplierTransactions.push({ id: ids.supplierTx++, supplier_id: supplier.id, type: 'return',
      amount: -payableReduction, balance_after: supplier.balance, reference_id: returnId,
      note: `مرتجع من فاتورة ${purchase.invoice_number}`, date: today(), created_at: now() });
  }
  if (cashRefund > 0) {
    store.cashTransactions.push({ id: ids.cashTx++, type: 'PURCHASE_RETURN', amount: cashRefund,
      reference_type: 'purchase_return', reference_id: returnId, shift_id: null,
      note: `استرداد مبلغ مرتجع فاتورة ${purchase.invoice_number}`, user_id: data.user_id ?? null, date: today(), created_at: now() });
  }
  addAuditLog({ action: 'PURCHASE_RETURN_CREATE', entity: 'purchase_return', entity_id: returnId, user_id: data.user_id,
    after_data: JSON.stringify({ purchase_id: purchase.id, total, items }) });
  return { success: true, record };
}

// ═══════════════════════════════════════════════════════════
// CUSTOMERS
// ═══════════════════════════════════════════════════════════

export function getCustomers(search?: string): Customer[] {
  let result = [...store.customers];
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(c =>
      c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)
    );
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export function getCustomer(id: number): Customer | null {
  return store.customers.find(c => c.id === id) ?? null;
}

export function addCustomer(data: {
  name: string; phone?: string; address?: string; credit_limit?: number; notes?: string;
}): Customer {
  const customer: Customer = {
    id: ids.customers++,
    name: data.name,
    phone: data.phone ?? null,
    address: data.address ?? null,
    credit_limit: data.credit_limit ?? 0,
    balance: 0,
    notes: data.notes ?? null,
    created_at: now(),
  };
  store.customers.push(customer);
  return customer;
}

export function updateCustomer(id: number, data: Partial<Customer>): void {
  const c = store.customers.find(c => c.id === id);
  if (c) Object.assign(c, data);
}

export function deleteCustomer(id: number): void {
  store.customers = store.customers.filter(c => c.id !== id);
}

export function recordCustomerPayment(customer_id: number, amount: number, note?: string): void {
  const customer = store.customers.find(c => c.id === customer_id);
  if (!customer) return;
  customer.balance -= amount;
  store.customerTransactions.push({
    id: ids.customerTx++,
    customer_id,
    type: 'payment',
    amount: -amount,
    balance_after: customer.balance,
    reference_id: null,
    note: note ?? 'سداد دين',
    date: today(),
    created_at: now(),
  });
  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'COLLECTION',
    amount,
    reference_type: 'customer_payment',
    reference_id: customer_id,
    shift_id: null,
    note: `تحصيل من ${customer.name}`,
    user_id: null,
    date: today(),
    created_at: now(),
  });
  addAuditLog({ action: 'CUSTOMER_PAYMENT', entity: 'customer', entity_id: customer_id,
    after_data: JSON.stringify({ amount, balance: customer.balance }) });
}

export function getCustomerTransactions(customer_id: number): CustomerTransaction[] {
  return store.customerTransactions
    .filter(t => t.customer_id === customer_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ═══════════════════════════════════════════════════════════
// SUPPLIERS
// ═══════════════════════════════════════════════════════════

export function getSuppliers(search?: string): Supplier[] {
  let result = [...store.suppliers];
  if (search) {
    const q = search.toLowerCase();
    result = result.filter(s =>
      s.name.toLowerCase().includes(q) || (s.phone || '').includes(q)
    );
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
}

export function getSupplier(id: number): Supplier | null {
  return store.suppliers.find(s => s.id === id) ?? null;
}

export function addSupplier(data: {
  name: string; phone?: string; address?: string; credit_limit?: number; notes?: string;
}): Supplier {
  const supplier: Supplier = {
    id: ids.suppliers++,
    name: data.name,
    phone: data.phone ?? null,
    address: data.address ?? null,
    credit_limit: data.credit_limit ?? 0,
    balance: 0,
    notes: data.notes ?? null,
    created_at: now(),
  };
  store.suppliers.push(supplier);
  return supplier;
}

export function updateSupplier(id: number, data: Partial<Supplier>): void {
  const s = store.suppliers.find(s => s.id === id);
  if (s) Object.assign(s, data);
}

export function deleteSupplier(id: number): void {
  store.suppliers = store.suppliers.filter(s => s.id !== id);
}

export function recordSupplierPayment(supplier_id: number, amount: number, note?: string): void {
  const supplier = store.suppliers.find(s => s.id === supplier_id);
  if (!supplier) return;
  supplier.balance -= amount;
  store.supplierTransactions.push({
    id: ids.supplierTx++,
    supplier_id,
    type: 'payment',
    amount: -amount,
    balance_after: supplier.balance,
    reference_id: null,
    note: note ?? 'دفعة للمورد',
    date: today(),
    created_at: now(),
  });
  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'SUPPLIER_PAYMENT',
    amount: -amount,
    reference_type: 'supplier_payment',
    reference_id: supplier_id,
    shift_id: null,
    note: `دفعة لـ ${supplier.name}`,
    user_id: null,
    date: today(),
    created_at: now(),
  });
  addAuditLog({ action: 'SUPPLIER_PAYMENT', entity: 'supplier', entity_id: supplier_id,
    after_data: JSON.stringify({ amount, balance: supplier.balance }) });
}

export function getSupplierTransactions(supplier_id: number): SupplierTransaction[] {
  return store.supplierTransactions
    .filter(t => t.supplier_id === supplier_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ═══════════════════════════════════════════════════════════
// EXPENSES — ATOMIC
// ═══════════════════════════════════════════════════════════

export function addExpense(data: {
  category: string; amount: number; date?: string;
  shift_id?: number | null; note?: string; user_id?: number | null;
}): Expense {
  const expenseDate = data.date || today();
  const expense: Expense = {
    id: ids.expenses++,
    category: data.category,
    amount: data.amount,
    date: expenseDate,
    shift_id: data.shift_id ?? null,
    note: data.note ?? null,
    user_id: data.user_id ?? null,
    created_at: now(),
  };
  store.expenses.push(expense);

  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'EXPENSE',
    amount: -data.amount,
    reference_type: 'expense',
    reference_id: expense.id,
    shift_id: data.shift_id ?? null,
    note: `${data.category}: ${data.note || ''}`,
    user_id: data.user_id ?? null,
    date: expenseDate,
    created_at: now(),
  });

  if (data.shift_id) {
    const shift = store.shifts.find(s => s.id === data.shift_id);
    if (shift) shift.total_expenses += data.amount;
  }

  addAuditLog({ action: 'EXPENSE_CREATE', entity: 'expense', entity_id: expense.id,
    after_data: JSON.stringify({ category: data.category, amount: data.amount }) });

  return expense;
}

export function getExpenses(opts?: {
  date?: string; dateFrom?: string; dateTo?: string; category?: string;
}): Expense[] {
  let result = [...store.expenses];
  if (opts?.date) result = result.filter(e => e.date === opts.date);
  if (opts?.dateFrom) result = result.filter(e => e.date >= opts.dateFrom!);
  if (opts?.dateTo) result = result.filter(e => e.date <= opts.dateTo!);
  if (opts?.category) result = result.filter(e => e.category === opts.category);
  return result.sort((a, b) => b.date.localeCompare(a.date));
}

export function deleteExpense(id: number): void {
  const exp = store.expenses.find(e => e.id === id);
  if (!exp) return;
  store.expenses = store.expenses.filter(e => e.id !== id);
  store.cashTransactions = store.cashTransactions.filter(
    t => !(t.reference_type === 'expense' && t.reference_id === id)
  );
  addAuditLog({ action: 'EXPENSE_DELETE', entity: 'expense', entity_id: id });
}

export function getExpenseCategories(): string[] {
  const defaultCats = ['إيجار', 'رواتب', 'مرافق', 'صيانة', 'مستلزمات', 'مواصلات', 'تسويق', 'أخرى'];
  const existing = new Set(store.expenses.map(e => e.category));
  return [...new Set([...defaultCats, ...existing])];
}

export function getExpensesByCategory(dateFrom: string, dateTo: string): { category: string; total: number }[] {
  const map: Record<string, number> = {};
  store.expenses
    .filter(e => e.date >= dateFrom && e.date <= dateTo)
    .forEach(e => { map[e.category] = (map[e.category] || 0) + e.amount; });
  return Object.entries(map)
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

// ═══════════════════════════════════════════════════════════
// CASHBOX
// ═══════════════════════════════════════════════════════════

export function getCashBalance(): number {
  return store.cashTransactions.reduce((s, t) => s + t.amount, 0);
}

export function getCashTransactions(opts?: {
  dateFrom?: string; dateTo?: string; type?: string; limit?: number;
}): CashTransaction[] {
  let result = [...store.cashTransactions];
  if (opts?.dateFrom) result = result.filter(t => t.date >= opts.dateFrom!);
  if (opts?.dateTo) result = result.filter(t => t.date <= opts.dateTo!);
  if (opts?.type) result = result.filter(t => t.type === opts.type);
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (opts?.limit) result = result.slice(0, opts.limit);
  return result;
}

export function addCashDeposit(amount: number, note: string, user_id?: number): void {
  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'DEPOSIT',
    amount,
    reference_type: null,
    reference_id: null,
    shift_id: null,
    note,
    user_id: user_id ?? null,
    date: today(),
    created_at: now(),
  });
}

export function addCashWithdrawal(amount: number, note: string, user_id?: number): void {
  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'WITHDRAWAL',
    amount: -amount,
    reference_type: null,
    reference_id: null,
    shift_id: null,
    note,
    user_id: user_id ?? null,
    date: today(),
    created_at: now(),
  });
}

// ═══════════════════════════════════════════════════════════
// SHIFTS
// ═══════════════════════════════════════════════════════════

export function openShift(data: {
  user_id?: number; user_name?: string; opening_cash: number;
}): Shift {
  const shift: Shift = {
    id: ids.shifts++,
    user_id: data.user_id ?? null,
    user_name: data.user_name ?? null,
    opening_cash: data.opening_cash,
    expected_cash: data.opening_cash,
    actual_cash: null,
    difference: null,
    difference_reason: null,
    total_sales: 0,
    total_collections: 0,
    total_expenses: 0,
    total_purchases_paid: 0,
    status: 'OPEN',
    opened_at: now(),
    closed_at: null,
    notes: null,
  };
  store.shifts.push(shift);

  store.cashTransactions.push({
    id: ids.cashTx++,
    type: 'OPENING',
    amount: 0, // opening_cash already in balance
    reference_type: 'shift',
    reference_id: shift.id,
    shift_id: shift.id,
    note: `فتح وردية - رصيد ${data.opening_cash}`,
    user_id: data.user_id ?? null,
    date: today(),
    created_at: now(),
  });

  return shift;
}

export function closeShift(id: number, actual_cash: number, reason?: string): Shift | null {
  const shift = store.shifts.find(s => s.id === id);
  if (!shift || shift.status !== 'OPEN') return null;

  shift.actual_cash = actual_cash;
  shift.expected_cash = getCashBalance();
  shift.difference = actual_cash - shift.expected_cash;
  shift.difference_reason = reason ?? null;
  shift.status = 'CLOSED';
  shift.closed_at = now();

  addAuditLog({ action: 'SHIFT_CLOSE', entity: 'shift', entity_id: id,
    after_data: JSON.stringify({ actual: actual_cash, expected: shift.expected_cash, diff: shift.difference }) });

  return shift;
}

export function getShifts(limit?: number): Shift[] {
  const result = [...store.shifts].sort((a, b) => b.opened_at.localeCompare(a.opened_at));
  return limit ? result.slice(0, limit) : result;
}

export function getOpenShift(): Shift | null {
  return store.shifts.find(s => s.status === 'OPEN') ?? null;
}

// ═══════════════════════════════════════════════════════════
// REPORTS
// ═══════════════════════════════════════════════════════════

export function getReportSummary(dateFrom: string, dateTo: string): ReportSummary {
  const sales = getSales({ dateFrom, dateTo });
  const expenses = getExpenses({ dateFrom, dateTo });
  const saleReturns = store.saleReturns.filter(entry => entry.date >= dateFrom && entry.date <= dateTo);
  const purchaseReturns = store.purchaseReturns.filter(entry => entry.date >= dateFrom && entry.date <= dateTo);

  const grossCashSales = sales.filter(s => s.sale_type === 'cash').reduce((a, s) => a + s.total, 0);
  const grossCreditSales = sales.filter(s => s.sale_type === 'credit').reduce((a, s) => a + s.total, 0);
  const cashSales = grossCashSales - saleReturns.reduce((sum, entry) => sum + entry.cash_refund, 0);
  const creditSales = grossCreditSales - saleReturns.reduce((sum, entry) => sum + entry.credit_reduction, 0);
  const collections = store.cashTransactions
    .filter(t => t.type === 'COLLECTION' && t.date >= dateFrom && t.date <= dateTo)
    .reduce((a, t) => a + t.amount, 0);
  const totalExpenses = expenses.reduce((a, e) => a + e.amount, 0);
  const totalPurchases = getPurchases({ dateFrom, dateTo }).reduce((a, p) => a + p.total, 0) - purchaseReturns.reduce((sum, entry) => sum + entry.total, 0);
  const totalSales = cashSales + creditSales;
  const cogs = sales.reduce((a, s) => a + s.cogs, 0) - saleReturns.reduce((sum, entry) =>
    sum + entry.items.reduce((itemSum, item) => itemSum + item.returned_cogs, 0), 0);
  const purchaseRefunds = purchaseReturns.reduce((sum, entry) => sum + entry.cash_refund, 0);
  const customerRefunds = saleReturns.reduce((sum, entry) => sum + entry.cash_refund, 0);
  const paidPurchases = getPurchases({ dateFrom, dateTo }).reduce((sum, purchase) => sum + purchase.amount_paid, 0);

  return {
    cashSales,
    creditSales,
    totalSales,
    collections,
    totalExpenses,
    totalPurchases,
    cogs,
    grossProfit: totalSales - cogs,
    netCash: grossCashSales + collections - totalExpenses - paidPurchases - customerRefunds + purchaseRefunds,
    transactionCount: sales.length + saleReturns.length + purchaseReturns.length,
  };
}

export function getDashboardKpis(): DashboardKpis {
  const todayStr = today();
  const summary = getReportSummary(todayStr, todayStr);
  const openShift = getOpenShift();

  const lowStockCount = store.products.filter(p => {
    const qty = getProductStock(p.id);
    return qty > 0 && qty <= p.minimum_stock;
  }).length;

  const outOfStockCount = store.products.filter(p => getProductStock(p.id) === 0).length;
  const radar = getExpiryRadar();
  const expiredCount = radar.filter(r => r.group === 'expired').length;
  const expiringCount = radar.filter(r => r.group !== 'expired').length;

  return {
    todaySales: summary.totalSales,
    todayCashSales: summary.cashSales,
    todayCreditSales: summary.creditSales,
    todayCollections: summary.collections,
    todayExpenses: summary.totalExpenses,
    todayPurchases: summary.totalPurchases,
    todayGrossProfit: summary.grossProfit,
    cashBalance: getCashBalance(),
    totalCustomerDebt: store.customers.reduce((a, c) => a + Math.max(0, c.balance), 0),
    totalSupplierDebt: store.suppliers.reduce((a, s) => a + Math.max(0, s.balance), 0),
    lowStockCount,
    outOfStockCount,
    expiringCount,
    expiredCount,
    openShiftId: openShift?.id ?? null,
    recentSales: getSales({ limit: 8 }),
  };
}

// ═══════════════════════════════════════════════════════════
// STOCK ADJUSTMENTS
// ═══════════════════════════════════════════════════════════

export function adjustStock(data: {
  product_id: number; batch_id: number; quantity_change: number;
  type: TransactionType; note: string; user_id?: number;
}): void {
  const batch = store.batches.find(b => b.id === data.batch_id);
  if (!batch) return;
  batch.quantity += data.quantity_change;
  if (batch.quantity <= 0) { batch.quantity = 0; }

  store.stockMovements.push({
    id: ids.stockMovements++,
    product_id: data.product_id,
    batch_id: data.batch_id,
    type: data.type,
    quantity: data.quantity_change,
    unit: getProduct(data.product_id)?.inventory_unit ?? 'قطعة',
    quantity_in_inventory_unit: data.quantity_change,
    reference_type: 'adjustment',
    reference_id: null,
    note: data.note,
    user_id: data.user_id ?? null,
    created_at: now(),
  });

  addAuditLog({ action: 'STOCK_ADJUST', entity: 'batch', entity_id: data.batch_id,
    after_data: JSON.stringify({ qty: batch.quantity, note: data.note }) });
}

export function getStockMovements(product_id: number): StockMovement[] {
  return store.stockMovements
    .filter(m => m.product_id === product_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ═══════════════════════════════════════════════════════════
// AUDIT LOG
// ═══════════════════════════════════════════════════════════

function addAuditLog(data: {
  action: string; entity: string; entity_id?: number | null;
  user_id?: number | null; user_name?: string | null;
  before_data?: string | null; after_data?: string | null;
  reason?: string | null;
}): void {
  store.auditLogs.push({
    id: ids.auditLogs++,
    user_id: data.user_id ?? null,
    user_name: data.user_name ?? null,
    action: data.action,
    entity: data.entity,
    entity_id: data.entity_id ?? null,
    before_data: data.before_data ?? null,
    after_data: data.after_data ?? null,
    reason: data.reason ?? null,
    ip: null,
    created_at: now(),
  });
  persistStore();
}

export function getAuditLogs(opts?: { limit?: number; entity?: string }): AuditLog[] {
  let result = [...store.auditLogs];
  if (opts?.entity) result = result.filter(l => l.entity === opts.entity);
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (opts?.limit) result = result.slice(0, opts.limit);
  return result;
}

// ═══════════════════════════════════════════════════════════
// BACKUP / RESTORE
// ═══════════════════════════════════════════════════════════

export interface BackupData {
  schema_version: string;
  created_at: string;
  pharmacy_name: string;
  settings: Record<string, string>;
  products: Product[];
  productUnits: ProductUnit[];
  batches: Batch[];
  stockMovements: StockMovement[];
  customers: Customer[];
  suppliers: Supplier[];
  sales: Sale[];
  saleItems: SaleItem[];
  saleBatchAllocations: SaleBatchAllocation[];
  saleReturns: SaleReturn[];
  purchases: Purchase[];
  purchaseItems: PurchaseItem[];
  purchaseReturns: PurchaseReturn[];
  expenses: Expense[];
  cashTransactions: CashTransaction[];
  shifts: Shift[];
  customerTransactions: CustomerTransaction[];
  supplierTransactions: SupplierTransaction[];
  auditLogs: AuditLog[];
}

export function createBackup(): BackupData {
  return {
    schema_version: '1.1.0',
    created_at: now(),
    pharmacy_name: store.settings['pharmacy_name'] || '',
    settings: { ...store.settings },
    products: [...store.products],
    productUnits: [...store.productUnits],
    batches: [...store.batches],
    stockMovements: [...store.stockMovements],
    customers: [...store.customers],
    suppliers: [...store.suppliers],
    sales: [...store.sales],
    saleItems: [...store.saleItems],
    saleBatchAllocations: [...store.saleBatchAllocations],
    saleReturns: [...store.saleReturns],
    purchases: [...store.purchases],
    purchaseItems: [...store.purchaseItems],
    purchaseReturns: [...store.purchaseReturns],
    expenses: [...store.expenses],
    cashTransactions: [...store.cashTransactions],
    shifts: [...store.shifts],
    customerTransactions: [...store.customerTransactions],
    supplierTransactions: [...store.supplierTransactions],
    auditLogs: [...store.auditLogs],
  };
}

export function restoreBackup(data: BackupData): { success: boolean; error?: string } {
  try {
    if (!data.schema_version) return { success: false, error: 'نسخة احتياطية غير صالحة' };
    Object.assign(store.settings, data.settings);
    store.products = data.products || [];
    store.productUnits = data.productUnits || [];
    store.batches = data.batches || [];
    store.stockMovements = data.stockMovements || [];
    store.customers = data.customers || [];
    store.suppliers = data.suppliers || [];
    store.sales = data.sales || [];
    store.saleItems = data.saleItems || [];
    store.saleBatchAllocations = data.saleBatchAllocations || [];
    store.saleReturns = data.saleReturns || [];
    store.purchases = data.purchases || [];
    store.purchaseItems = data.purchaseItems || [];
    store.purchaseReturns = data.purchaseReturns || [];
    store.expenses = data.expenses || [];
    store.cashTransactions = data.cashTransactions || [];
    store.shifts = data.shifts || [];
    store.customerTransactions = data.customerTransactions || [];
    store.supplierTransactions = data.supplierTransactions || [];
    store.auditLogs = data.auditLogs || [];
    addAuditLog({ action: 'RESTORE', entity: 'backup', entity_id: null,
      after_data: JSON.stringify({ from: data.created_at }) });
    return { success: true };
  } catch (e: any) {
    return { success: false, error: e?.message };
  }
}

// ═══════════════════════════════════════════════════════════
// LEGACY COMPATIBILITY (for existing screens)
// ═══════════════════════════════════════════════════════════

export interface Transaction {
  id: number; type: string; amount: number; date: string;
  customer_id: number | null; supplier_id: number | null;
  customer_name?: string; supplier_name?: string;
  note: string | null; invoice_number: string | null;
  discount: number; amount_paid: number; created_at: string;
}

export interface DashboardData {
  cashSales: number; creditSales: number; totalSales: number;
  collections: number; expenses: number; purchases: number;
  balance: number; recentTransactions: Transaction[];
}

export function getDashboardData(date: string): DashboardData {
  const summary = getReportSummary(date, date);
  const recentSales = getSales({ dateFrom: date, dateTo: date, limit: 10 });
  const recentTx: Transaction[] = recentSales.map(s => ({
    id: s.id,
    type: s.sale_type === 'cash' ? 'cash_sale' : 'credit_sale',
    amount: s.total,
    date: s.date,
    customer_id: s.customer_id,
    supplier_id: null,
    customer_name: s.customer_name ?? undefined,
    supplier_name: undefined,
    note: s.notes,
    invoice_number: s.invoice_number,
    discount: s.discount,
    amount_paid: s.amount_paid,
    created_at: s.created_at,
  }));

  return {
    cashSales: summary.cashSales,
    creditSales: summary.creditSales,
    totalSales: summary.totalSales,
    collections: summary.collections,
    expenses: summary.totalExpenses,
    purchases: summary.totalPurchases,
    balance: getCashBalance(),
    recentTransactions: recentTx,
  };
}

export function addTransaction(data: any): number {
  // Legacy bridge for old screens
  if (data.type === 'expense') {
    const exp = addExpense({ category: 'أخرى', amount: data.amount, date: data.date, note: data.note });
    return exp.id;
  }
  return 0;
}

export function getTransactions(filters?: any): Transaction[] {
  return [];
}

export function deleteTransaction(id: number): void {}

export function getTransactionItems(id: number): any[] { return []; }
