/**
 * أنواع مشتركة بين عمليات main / preload / renderer.
 * حقول قاعدة البيانات واستجابات IPC تُستخدم بصيغة snake_case
 * لمطابقة عقود rafd-app قدر الإمكان (الوثيقة §7).
 *
 * المرحلة 2: عقد IPC الكامل لكل الكيانات المنقولة (خارطة §6، بدون tenant_id).
 */

/* ------------------------------ أساسيات ------------------------------ */

export interface Product {
  id: number
  name: string
  name_ar: string | null
  price: number
  cost: number
  stock: number
  unit: string
  sku: string | null
  barcode: string | null
  category: string
  min_stock: number
  image_url: string | null
  is_active: number
  supplier_id: number | null
  supplier_name: string | null
  sell_by_weight: number
  created_at: string
}

export interface NewProduct {
  name: string
  name_ar?: string | null
  price: number
  cost?: number
  stock?: number
  unit?: string
  sku?: string | null
  barcode?: string | null
  category?: string
  min_stock?: number
  image_url?: string | null
  supplier_id?: number | null
  supplier_name?: string | null
  /** يُطبَّع إلى 0/1 في المستودع — يقبل boolean القادم من نماذج الواجهة */
  sell_by_weight?: number | boolean
}

export type ProductPatch = Partial<NewProduct> & {
  /** تعطيل/تفعيل يدوي عبر update (يُطبَّع إلى 0/1 في المستودع) */
  is_active?: number | boolean
}

export interface Sale {
  id: number
  invoice_number: string
  total: number
  paid: number
  bank_account_id: number | null
  customer_id: number | null
  created_at: string
}

export interface SaleItem {
  id: number
  sale_id: number
  product_id: number | null
  product_name: string
  quantity: number
  unit_price: number
  total: number
  weight_g: number | null
  sold_by_weight: number
}

/** عنصر داخل "سلة" البيع قبل الإتمام */
export interface SaleItemInput {
  product_id: number
  quantity: number
  weight_g?: number | null
  sold_by_weight?: number | boolean
}

export interface NewSale {
  items: SaleItemInput[]
  paid: number
  customer_id?: number | null
  payment_method?: string
  bank_account_id?: number | null
  /** خصم مبلغ مطلق من subtotal — يخضع لسقف دور cashier (10%) */
  discount?: number
}

export type SalePatch = Partial<Pick<Sale, 'paid' | 'bank_account_id'>>

export interface SaleWithItems {
  sale: Sale
  items: SaleItem[]
}

/* ------------------------------ عملاء ------------------------------ */

export interface Customer {
  id: number
  name: string
  phone: string | null
  email: string | null
  balance: number
  total_purchases: number
  notes: string | null
  created_at: string
}

export type NewCustomer = Partial<Pick<Customer, 'phone' | 'email' | 'balance' | 'total_purchases' | 'notes'>> & {
  name: string
}
export type CustomerPatch = Partial<Omit<NewCustomer, 'name'> & { name: string }>

export type LedgerEntryType = 'sale_credit' | 'payment' | 'adjustment'
export type SupplierLedgerEntryType = 'purchase_credit' | 'payment' | 'adjustment'

export interface LedgerEntry {
  id: number
  customer_id: number
  type: string
  amount: number
  balance_after: number
  reference: string | null
  notes: string | null
  sale_id: number | null
  created_at: string
}

export interface NewLedgerEntry {
  customer_id: number
  amount: number
  type: LedgerEntryType
  reference?: string | null
  notes?: string | null
  sale_id?: number | null
}

/* ------------------------------ موردون ------------------------------ */

export interface Supplier {
  id: number
  name: string
  phone: string | null
  email: string | null
  balance: number
  notes: string | null
  created_at: string
}

export type NewSupplier = Partial<Pick<Supplier, 'phone' | 'email' | 'balance' | 'notes'>> & {
  name: string
}
export type SupplierPatch = Partial<Omit<NewSupplier, 'name'> & { name: string }>

export interface SupplierLedgerEntry {
  id: number
  supplier_id: number
  type: string
  amount: number
  balance_after: number
  reference: string | null
  notes: string | null
  purchase_id: number | null
  created_at: string
}

export interface NewSupplierLedgerEntry {
  supplier_id: number
  amount: number
  type: SupplierLedgerEntryType
  reference?: string | null
  notes?: string | null
  purchase_id?: number | null
}

/* ------------------------------ مشتريات ------------------------------ */

export interface Purchase {
  id: number
  supplier_id: number | null
  supplier_name: string | null
  reference: string | null
  total: number
  paid: number
  status: string
  purchase_date: string | null
  notes: string | null
  created_at: string
}

export interface PurchaseItem {
  id: number
  purchase_id: number
  product_id: number | null
  product_name: string
  quantity: number
  unit: string
  unit_cost: number
  total: number
  units_per_carton: number
  cartons: number
  received_quantity: number
  created_at: string
}

export interface NewPurchaseItem {
  product_id?: number | null
  product_name: string
  quantity: number
  unit?: string
  unit_cost: number
  total?: number
  units_per_carton?: number
  cartons?: number
  received_quantity?: number
}

export interface NewPurchase {
  supplier_id?: number | null
  supplier_name?: string | null
  reference?: string | null
  purchase_date?: string | null
  notes?: string | null
  status?: string
  paid?: number
  items: NewPurchaseItem[]
}

export interface PurchasePatch {
  supplier_id?: number | null
  supplier_name?: string | null
  purchase_date?: string | null
  notes?: string | null
  /** استبدال كامل لبنود الشراء (حذف ثم إدراج) */
  items?: NewPurchaseItem[]
  /** تنفيذ الاستلام الآن (مرة واحدة فقط) */
  receive?: boolean
  /** دفعة إضافية على أمر الشراء */
  pay_amount?: number
  status?: string
}

export interface PurchaseWithItems {
  purchase: Purchase
  items: PurchaseItem[]
}

/* ------------------------------ مصروفات وحسابات وطرفيات ------------------------------ */

export interface Expense {
  id: number
  category: string
  amount: number
  description: string | null
  payment_method: string
  expense_date: string | null
  created_at: string
}

export type NewExpense = Partial<Pick<Expense, 'description' | 'payment_method' | 'expense_date'>> & {
  category: string
  amount: number
}
export type ExpensePatch = Partial<NewExpense>

export interface BankAccount {
  id: number
  bank_name: string
  account_name: string
  account_number: string | null
  iban: string | null
  currency: string
  is_active: number
  notes: string | null
  created_at: string
}

export type NewBankAccount = Partial<
  Pick<BankAccount, 'account_number' | 'iban' | 'currency' | 'notes'>
> & {
  bank_name: string
  account_name: string
  /** يُطبَّع إلى 0/1 في المستودع */
  is_active?: number | boolean
}
export type BankAccountPatch = Partial<NewBankAccount>

export interface PaymentTerminal {
  id: number
  name: string
  provider: string
  terminal_id: string | null
  connection_type: string
  is_active: number
  supports_contactless: number
  notes: string | null
  created_at: string
}

export type NewPaymentTerminal = Partial<
  Pick<PaymentTerminal, 'provider' | 'terminal_id' | 'connection_type' | 'notes'>
> & {
  name: string
  /** تُطبَّع إلى 0/1 في المستودع */
  is_active?: number | boolean
  supports_contactless?: number | boolean
}
export type PaymentTerminalPatch = Partial<NewPaymentTerminal>

/* ------------------------------ مستخدمون وتدقيق وإعدادات ------------------------------ */

/** صف مستخدم آمن للعرض — لا يحمل pin_hash أبدًا عبر IPC */
export interface AppUser {
  id: number
  full_name: string
  role: string
  phone: string | null
  status: string
  avatar_url: string | null
  created_at: string
  updated_at: string
}

export interface NewUser {
  full_name: string
  role?: string
  phone?: string | null
  status?: string
  avatar_url?: string | null
  pin?: string | null
}
export type UserPatch = Partial<NewUser>

export interface AuditLog {
  id: number
  user_id: number | null
  action: string
  entity_type: string | null
  entity_id: number | null
  meta: string | null
  actor_email: string | null
  entity: string | null
  created_at: string
}

export interface AuditFilters {
  user_id?: number
  entity_type?: string
  action?: string
  limit?: number
}

export interface StoreSettings {
  id: number
  name: string | null
  name_ar: string | null
  logo_url: string | null
  primary_color: string
  secondary_color: string
  currency: string
  phone: string | null
  email: string | null
  address: string | null
  tax_number: string | null
  invoice_footer: string | null
  business_type: string
  tax_enabled: number
  tax_rate: number
  tax_mode: string
  enabled_categories: string | null
  custom_categories: string | null
  created_at: string
  updated_at: string
}

export type StoreSettingsPatch = Partial<
  Omit<StoreSettings, 'id' | 'created_at' | 'updated_at' | 'tax_enabled'> & {
    /** يُطبَّع إلى 0/1 في المستودع */
    tax_enabled: number | boolean
  }
>

/* ------------------------------ ترخيص ------------------------------ */

export type LicensePlan = 'trial' | 'starter' | 'pro'

export interface LicenseInfo {
  license_id: string
  plan: LicensePlan
  customer: string
  issued_at: string
  expires_at: string
}

/**
 * §8.3: المنتهِي يبقى activated=true مع expired=true — يفتح التطبيق للقراءة
 * ويتولى قفلَ الكتابة بوابةٌ مركزية في main. expiring_soon تنبيه غير مانع
 * ضمن 7 أيام قبل الانتهاء (تعرضه الواجهة في المرحلة 4).
 */
export type LicenseStatus =
  | {
      activated: true
      info: LicenseInfo
      expired: boolean
      expiring_soon: boolean
      days_left: number
    }
  | { activated: false; reason?: string }

export type ActivateResult =
  | { ok: true; info: LicenseInfo; expired: boolean; expiring_soon: boolean }
  | { ok: false; error: string }

export interface PnlReport {
  startDate: string
  endDate: string
  totalRevenue: number
  totalCogs: number
  totalExpenses: number
  totalPurchases: number
  grossProfit: number
  netProfit: number
  dailyRevenue: Array<{ date: string; amount: number }>
  expensesByCategory: Array<{ category: string; amount: number }>
}

/* ------------------------------ عقد IPC الكامل (§7) ------------------------------ */

/** واجهة الـAPI المعروضة للواجهة عبر contextBridge — المرحلة 2 */
export interface RafdLocalApi {
  license: {
    status(): Promise<LicenseStatus>
    activate(key: string): Promise<ActivateResult>
    /** بصمة الجهاز الحالية (§8.2) — لعرضها للإدارة عند طلب ترخيص مربوط */
    fingerprint(): Promise<string>
  }
  products: {
    list(filters?: { active_only?: boolean; category?: string }): Promise<Product[]>
    create(payload: NewProduct): Promise<Product>
    update(id: number, patch: ProductPatch): Promise<Product>
    delete(id: number): Promise<void>
    restock(productId: number, cartons: number, cartonCost: number, unitsPerCarton: number): Promise<Product>
  }
  customers: {
    list(): Promise<Customer[]>
    create(payload: NewCustomer): Promise<Customer>
    update(id: number, patch: CustomerPatch): Promise<Customer>
    delete(id: number): Promise<void>
  }
  customerLedger: {
    listByCustomer(customer_id: number): Promise<LedgerEntry[]>
    addEntry(payload: NewLedgerEntry): Promise<LedgerEntry>
  }
  suppliers: {
    list(): Promise<Supplier[]>
    create(payload: NewSupplier): Promise<Supplier>
    update(id: number, patch: SupplierPatch): Promise<Supplier>
    delete(id: number): Promise<void>
  }
  supplierLedger: {
    listBySupplier(supplier_id: number): Promise<SupplierLedgerEntry[]>
    addEntry(payload: NewSupplierLedgerEntry): Promise<SupplierLedgerEntry>
  }
  purchases: {
    list(filters?: { supplier_id?: number; status?: string }): Promise<Purchase[]>
    get(id: number): Promise<PurchaseWithItems>
    create(payload: NewPurchase): Promise<PurchaseWithItems>
    update(id: number, patch: PurchasePatch): Promise<PurchaseWithItems>
    delete(id: number): Promise<void>
  }
  expenses: {
    list(): Promise<Expense[]>
    create(payload: NewExpense): Promise<Expense>
    update(id: number, patch: ExpensePatch): Promise<Expense>
    delete(id: number): Promise<void>
  }
  bankAccounts: {
    list(): Promise<BankAccount[]>
    create(payload: NewBankAccount): Promise<BankAccount>
    update(id: number, patch: BankAccountPatch): Promise<BankAccount>
    delete(id: number): Promise<void>
  }
  paymentTerminals: {
    list(): Promise<PaymentTerminal[]>
    create(payload: NewPaymentTerminal): Promise<PaymentTerminal>
    update(id: number, patch: PaymentTerminalPatch): Promise<PaymentTerminal>
    delete(id: number): Promise<void>
  }
  sales: {
    list(filters?: { customer_id?: number }): Promise<Sale[]>
    get(sale_id: number): Promise<SaleWithItems>
    create(payload: NewSale): Promise<SaleWithItems>
    update(id: number, patch: SalePatch): Promise<Sale>
    delete(id: number): Promise<void>
  }
  users: {
    list(): Promise<AppUser[]>
    get(id: number): Promise<AppUser>
    create(payload: NewUser): Promise<AppUser>
    update(id: number, patch: UserPatch): Promise<AppUser>
    delete(id: number): Promise<void>
    login(identifier: string, pin: string): Promise<AppUser>
    /** امتداد صغير عن نص التكليف (موثَّق في تقرير المرحلة 2) */
    current(): Promise<AppUser | null>
    logout(): Promise<void>
  }
  auditLogs: {
    list(filters?: AuditFilters): Promise<AuditLog[]>
  }
  storeSettings: {
    get(): Promise<StoreSettings | null>
    update(patch: StoreSettingsPatch): Promise<StoreSettings>
  }
  printer: {
    printRaw(bytes: Uint8Array): Promise<boolean>
    printHtml(html: string): Promise<boolean>
  }
  files: {
    saveText(filename: string, content: string): Promise<boolean>
    saveBinary(filename: string, data: Uint8Array): Promise<boolean>
  }
  backup: {
    manualSave(): Promise<{ ok: boolean; path?: string; error?: string }>
    restore(filePath?: string): Promise<{ ok: boolean; rollbackPath?: string; error?: string }>
  }
  cloudBackup: {
    upload(): Promise<{ ok: boolean; error?: string; filePath?: string }>
    download(fileName?: string): Promise<{ ok: boolean; rollbackPath?: string; error?: string }>
    status(): Promise<{ lastUpload?: string; fileSize?: number; checksum?: string }>
  }
  reports: {
    getPnl(startDate: string, endDate: string): Promise<PnlReport>
  }
}

export const IPC = {
  licenseStatus: 'license:status',
  licenseActivate: 'license:activate',
  licenseFingerprint: 'license:fingerprint',
  productsList: 'products:list',
  productsCreate: 'products:create',
  productsUpdate: 'products:update',
  productsDelete: 'products:delete',
  productsRestock: 'products:restock',
  customersList: 'customers:list',
  customersCreate: 'customers:create',
  customersUpdate: 'customers:update',
  customersDelete: 'customers:delete',
  customerLedgerList: 'customerLedger:listByCustomer',
  customerLedgerAdd: 'customerLedger:addEntry',
  suppliersList: 'suppliers:list',
  suppliersCreate: 'suppliers:create',
  suppliersUpdate: 'suppliers:update',
  suppliersDelete: 'suppliers:delete',
  supplierLedgerList: 'supplierLedger:listBySupplier',
  supplierLedgerAdd: 'supplierLedger:addEntry',
  purchasesList: 'purchases:list',
  purchasesGet: 'purchases:get',
  purchasesCreate: 'purchases:create',
  purchasesUpdate: 'purchases:update',
  purchasesDelete: 'purchases:delete',
  expensesList: 'expenses:list',
  expensesCreate: 'expenses:create',
  expensesUpdate: 'expenses:update',
  expensesDelete: 'expenses:delete',
  bankAccountsList: 'bankAccounts:list',
  bankAccountsCreate: 'bankAccounts:create',
  bankAccountsUpdate: 'bankAccounts:update',
  bankAccountsDelete: 'bankAccounts:delete',
  paymentTerminalsList: 'paymentTerminals:list',
  paymentTerminalsCreate: 'paymentTerminals:create',
  paymentTerminalsUpdate: 'paymentTerminals:update',
  paymentTerminalsDelete: 'paymentTerminals:delete',
  salesList: 'sales:list',
  salesGet: 'sales:get',
  salesCreate: 'sales:create',
  salesUpdate: 'sales:update',
  salesDelete: 'sales:delete',
  usersList: 'users:list',
  usersGet: 'users:get',
  usersCreate: 'users:create',
  usersUpdate: 'users:update',
  usersDelete: 'users:delete',
  usersLogin: 'users:login',
  usersCurrent: 'users:current',
  usersLogout: 'users:logout',
  auditLogsList: 'auditLogs:list',
  storeSettingsGet: 'storeSettings:get',
  storeSettingsUpdate: 'storeSettings:update',
  printerPrintRaw: 'printer:print-raw',
  printerPrintHtml: 'printer:print-html',
  filesSaveText: 'files:save-text',
  filesSaveBinary: 'files:save-binary',
  backupManualSave: 'backup:manual-save',
  backupRestore: 'backup:restore',
  cloudBackupUpload: 'cloud-backup:upload',
  cloudBackupDownload: 'cloud-backup:download',
  cloudBackupStatus: 'cloud-backup:status',
  reportsGet: 'reports:get'
} as const
