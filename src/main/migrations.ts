/**
 * نظام ترقيم إصدارات المخطط (الوثيقة §9) — يُبنى هنا في المرحلة 1 كما نصّت خارطة الطريق.
 * القواعد:
 *  - جدول schema_version (صف واحد برقم إصدار).
 *  - عند الفتح: يُقارَن المخزَّن بالمتوقَّع في الكود؛ لو أقدم تُشغَّل الترقيات بالترتيب
 *    قبل فتح أي شاشة (يُستدعى من openDb قبل إرجاع الاتصال).
 *  - قاعدة صارمة (§9): نسخة احتياطية تلقائية لملف SQLite قبل تنفيذ أي ترقية.
 *  - قاعدة بإصدار أحدث من التطبيق تُرفَض صراحةً (حماية من فتح بيانات مستقبلية بكود قديم).
 *
 * كل ترقية دالة JS (لا SQL خام) لأن SQLite يفتقد "ADD COLUMN IF NOT EXISTS" —
 * التحسّس عبر pragma table_info يجعل كل ترقية idempotent (آمنة على قاعدة
 * قديمة من المرحلة 0 وعلى قاعدة جديدة كليًا معًا).
 */
import type Database from 'better-sqlite3'
import { copyFileSync, existsSync, statSync } from 'node:fs'
import { basename } from 'node:path'

export type Db = Database.Database

/** إصدار المخطط المتوقَّع في هذا الإصدار من التطبيق */
export const SCHEMA_VERSION_CODE = 7

export interface Migration {
  version: number
  name: string
  up: (db: Db) => void
}

/* ------------------------------------------------------------------ */
/* أدوات تحسس المخطط                                                    */
/* ------------------------------------------------------------------ */

export function hasTable(db: Db, table: string): boolean {
  return !!db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(table)
}

export function hasColumn(db: Db, table: string, column: string): boolean {
  if (!hasTable(db, table)) return false
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
  return cols.some((c) => c.name === column)
}

export function readSchemaVersion(db: Db): number {
  if (!hasTable(db, 'schema_version')) return 0
  const row = db.prepare('SELECT version FROM schema_version WHERE id = 1').get() as
    | { version: number }
    | undefined
  return row?.version ?? 0
}

function writeSchemaVersion(db: Db, version: number): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    )
  `)
  db.prepare(
    `INSERT INTO schema_version (id, version, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`
  ).run(version, new Date().toISOString())
}

/* ------------------------------------------------------------------ */
/* النسخة الاحتياطية قبل الترقية (قاعدة §9 الصارمة)                      */
/* ------------------------------------------------------------------ */

function compactTimestamp(): string {
  // صيغة ISO مضغوطة صالحة كاسم ملف على ويندوز (لا ":" ولا ".")
  return new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', 'Z')
}

/**
 * نسخ ملف القاعدة بجانب الأصل قبل أي ترقية.
 * نُفرغ WAL إلى الملف الرئيسي أولًا (wal_checkpoint(TRUNCATE)) فيكون الملف
 * المنسوخ كاملًا متسقًا، والنسخ نفسه يتم بينما لا يوجد كاتب آخر (عملية واحدة محلية).
 */
export function backupDatabaseFile(db: Db, dbPath: string, fromVersion: number): string | null {
  // «لا بيانات لحمايتها» تُقاس بوجود جداول مستخدم فعلية، لا بحجم الملف —
  // ضبط journal_mode=WAL يكتب ترويسة القاعدة (ملف > 0) قبل أي بيانات فعلية.
  const hasUserTables =
    (db
      .prepare(
        "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
      )
      .get() as { c: number }).c > 0
  if (!existsSync(dbPath) || statSync(dbPath).size === 0 || !hasUserTables) {
    return null
  }
  db.pragma('wal_checkpoint(TRUNCATE)')
  const backupPath = `${dbPath}.backup-v${fromVersion}-to-v${SCHEMA_VERSION_CODE}-${compactTimestamp()}.db`
  copyFileSync(dbPath, backupPath)
  return backupPath
}

/* ------------------------------------------------------------------ */
/* الترقية v1 — المخطط الكامل (خريطة §6، مستخرجة حرفيًا من migrations   */
/* الخاصة بـrafd-app كما وفّرها المشرف): بدون tenant_id في كل الجداول،  */
/* SERIAL→AUTOINCREMENT، TIMESTAMPTZ→TEXT ISO8601، NUMERIC→REAL،        */
/* BOOLEAN→INTEGER 0/1.                                                 */
/* ------------------------------------------------------------------ */

function up_v1(db: Db): void {
  db.exec(`
    -- صف واحد فقط يستبدل tenants (§6)
    CREATE TABLE IF NOT EXISTS store_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT,
      name_ar TEXT,
      logo_url TEXT,
      primary_color TEXT NOT NULL DEFAULT '#0d9488',
      secondary_color TEXT NOT NULL DEFAULT '#d97706',
      currency TEXT NOT NULL DEFAULT 'YER',
      phone TEXT,
      email TEXT,
      address TEXT,
      tax_number TEXT,
      invoice_footer TEXT,
      business_type TEXT NOT NULL DEFAULT 'grocery',
      tax_enabled INTEGER NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      tax_mode TEXT NOT NULL DEFAULT 'exclusive',
      enabled_categories TEXT,
      custom_categories TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- مستخدمون محليون بـPIN (لا Supabase auth — §6)
    CREATE TABLE IF NOT EXISTS app_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'cashier',
      phone TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      avatar_url TEXT,
      pin_hash TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS suppliers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      balance REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      phone TEXT,
      email TEXT,
      balance REAL NOT NULL DEFAULT 0,
      total_purchases REAL NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS bank_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      bank_name TEXT NOT NULL,
      account_name TEXT NOT NULL,
      account_number TEXT,
      iban TEXT,
      currency TEXT NOT NULL DEFAULT 'YER',
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    -- المنتجات بالشكل النهائي (الأعمدة الجديدة تشمل supplier_id بـFK)
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      name_ar TEXT,
      price REAL NOT NULL CHECK (price >= 0),
      cost REAL NOT NULL DEFAULT 0,
      stock REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'pcs',
      sku TEXT,
      barcode TEXT,
      category TEXT NOT NULL DEFAULT 'عام',
      min_stock REAL NOT NULL DEFAULT 5,
      image_url TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      supplier_name TEXT,
      sell_by_weight INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS product_packaging (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      units_per_carton REAL NOT NULL DEFAULT 1,
      carton_cost REAL NOT NULL DEFAULT 0,
      unit_cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT NOT NULL UNIQUE,
      total REAL NOT NULL,
      paid REAL NOT NULL,
      bank_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id),
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL CHECK (quantity > 0),
      unit_price REAL NOT NULL,
      total REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customer_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      balance_after REAL NOT NULL DEFAULT 0,
      reference TEXT,
      notes TEXT,
      -- قرار موثَّق (تقرير المرحلة 1): قيد FK حقيقي ON DELETE SET NULL —
      -- تحسين مقصود على المصدر (rafd-app بلا قيد هنا إطلاقًا)
      sale_id INTEGER REFERENCES sales(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS supplier_ledger (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      balance_after REAL NOT NULL DEFAULT 0,
      reference TEXT,
      notes TEXT,
      -- نفس القرار الموثَّق
      purchase_id INTEGER REFERENCES purchases(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      supplier_name TEXT,
      reference TEXT,
      total REAL NOT NULL DEFAULT 0,
      paid REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      purchase_date TEXT,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS purchase_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
      product_id INTEGER REFERENCES products(id) ON DELETE SET NULL,
      product_name TEXT NOT NULL,
      quantity REAL NOT NULL DEFAULT 0,
      unit TEXT NOT NULL DEFAULT 'حبة',
      unit_cost REAL NOT NULL DEFAULT 0,
      total REAL NOT NULL DEFAULT 0,
      units_per_carton REAL NOT NULL DEFAULT 1,
      cartons REAL NOT NULL DEFAULT 0,
      received_quantity REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS expenses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT NOT NULL,
      amount REAL NOT NULL,
      description TEXT,
      payment_method TEXT NOT NULL DEFAULT 'cash',
      expense_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_terminals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'generic',
      terminal_id TEXT,
      connection_type TEXT NOT NULL DEFAULT 'network',
      is_active INTEGER NOT NULL DEFAULT 1,
      supports_contactless INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER REFERENCES app_users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id INTEGER,
      meta TEXT,
      actor_email TEXT,
      entity TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
  `)

  // أعمدة مُلحقة على قواعد قديمة من المرحلة 0 (idempotent عبر pragma table_info)
  const addCol = (table: string, column: string, ddl: string): void => {
    if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }
  addCol('products', 'sku', 'sku TEXT')
  addCol('products', 'barcode', 'barcode TEXT')
  addCol('products', 'category', "category TEXT NOT NULL DEFAULT 'عام'")
  addCol('products', 'min_stock', 'min_stock REAL NOT NULL DEFAULT 5')
  addCol('products', 'image_url', 'image_url TEXT')
  addCol('products', 'is_active', 'is_active INTEGER NOT NULL DEFAULT 1')
  addCol('products', 'supplier_id', 'supplier_id INTEGER REFERENCES suppliers(id) ON DELETE SET NULL')
  addCol('products', 'supplier_name', 'supplier_name TEXT')
  addCol('products', 'sell_by_weight', 'sell_by_weight INTEGER NOT NULL DEFAULT 0')
  addCol('sales', 'bank_account_id', 'bank_account_id INTEGER REFERENCES bank_accounts(id) ON DELETE SET NULL')

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_products_sku ON products(sku);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_product_packaging_product ON product_packaging(product_id);
    CREATE INDEX IF NOT EXISTS idx_products_supplier ON products(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_customer_ledger_customer ON customer_ledger(customer_id);
    CREATE INDEX IF NOT EXISTS idx_supplier_ledger_supplier ON supplier_ledger(supplier_id);
    CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase ON purchase_items(purchase_id);
  `)
}

/**
 * الترقية v2 — ربط الفاتورة بالعميل (متطلب منطق «قيد العميل الآجل» في طبقة
 * IPC، المرحلة 2): عمود اختياري SET NULL يحفظ الفواتير التاريخية عند حذف عميل.
 */
function up_v2(db: Db): void {
  if (!hasColumn(db, 'sales', 'customer_id')) {
    db.exec(
      'ALTER TABLE sales ADD COLUMN customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL'
    )
  }
  db.exec('CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id)')
}

/**
 * الترقية v3 — إضافة أعمدة الوزن لـ sale_items
 */
function up_v3(db: Db): void {
  if (!hasColumn(db, 'sale_items', 'weight_g')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN weight_g REAL')
  }
  if (!hasColumn(db, 'sale_items', 'sold_by_weight')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN sold_by_weight INTEGER DEFAULT 0')
  }
}

/**
 * الترقية v4 — سلامة الفواتير وإلغاء الفاتورة بدل الحذف الصلب:
 * - حفظ طريقة الدفع وحالة الفاتورة وبيانات الإلغاء.
 * - عداد مستقل لأرقام الفواتير يمنع إعادة استخدام الرقم بعد حذف/إلغاء السجل
 *   أو حذف آخر فاتورة تاريخيًا.
 */
function up_v4(db: Db): void {
  const addCol = (table: string, column: string, ddl: string): void => {
    if (!hasColumn(db, table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`)
  }

  addCol('sales', 'payment_method', "payment_method TEXT NOT NULL DEFAULT 'cash'")
  addCol('sales', 'status', "status TEXT NOT NULL DEFAULT 'completed'")
  addCol('sales', 'voided_at', 'voided_at TEXT')
  addCol(
    'sales',
    'voided_by',
    'voided_by INTEGER REFERENCES app_users(id) ON DELETE SET NULL'
  )
  addCol('sales', 'void_reason', 'void_reason TEXT')

  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_sequences (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      next_number INTEGER NOT NULL CHECK (next_number > 0)
    );

    INSERT OR IGNORE INTO invoice_sequences (id, next_number)
    SELECT 1,
      COALESCE(MAX(CAST(SUBSTR(invoice_number, 5) AS INTEGER)), 0) + 1
    FROM sales
    WHERE invoice_number LIKE 'INV-%';
  `)
}

/**
 * الترقية v5 — حفظ تكلفة المنتج وقت البيع حتى لا تتغير تقارير الفترات
 * التاريخية عند تعديل تكلفة المنتج الحالية لاحقًا.
 */
function up_v5(db: Db): void {
  if (!hasColumn(db, 'sale_items', 'unit_cost')) {
    db.exec('ALTER TABLE sale_items ADD COLUMN unit_cost REAL NOT NULL DEFAULT 0')
  }
  db.exec(`
    UPDATE sale_items
    SET unit_cost = COALESCE(
      (SELECT p.cost FROM products p WHERE p.id = sale_items.product_id),
      0
    )
    WHERE unit_cost = 0;
  `)
}

/**
 * الترقية v6 — توحيد الحالة القديمة completed إلى pending.
 * في الإصدارات السابقة كانت completed تُستخدم لأمر لم يُستلم، بينما
 * الواجهة الجديدة تحتاج حالات استلام صريحة لا تسمح بإعادة الاستلام الخاطئ.
 */
function up_v6(db: Db): void {
  db.prepare("UPDATE purchases SET status = 'pending' WHERE status = 'completed'").run()
}

/** الترقية v7 — إعدادات الطابعة الحرارية بدل اختيار منفذ عشوائي. */
function up_v7(db: Db): void {
  if (!hasColumn(db, 'store_settings', 'printer_port')) {
    db.exec('ALTER TABLE store_settings ADD COLUMN printer_port TEXT')
  }
  if (!hasColumn(db, 'store_settings', 'printer_baud_rate')) {
    db.exec('ALTER TABLE store_settings ADD COLUMN printer_baud_rate INTEGER NOT NULL DEFAULT 9600')
  }
  if (!hasColumn(db, 'store_settings', 'receipt_width')) {
    db.exec('ALTER TABLE store_settings ADD COLUMN receipt_width INTEGER NOT NULL DEFAULT 80')
  }
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'phase1-full-schema', up: up_v1 },
  { version: 2, name: 'sales-customer-link', up: up_v2 },
  { version: 3, name: 'sale-items-weight', up: up_v3 },
  { version: 4, name: 'sales-integrity-and-voiding', up: up_v4 },
  { version: 5, name: 'sale-item-cost-snapshot', up: up_v5 },
  { version: 6, name: 'purchase-receiving-state-machine', up: up_v6 },
  { version: 7, name: 'thermal-printer-settings', up: up_v7 }
]

/* ------------------------------------------------------------------ */
/* منفّذ الترقيات — يُستدعى من openDb قبل إرجاع الاتصال لأي شاشة          */
/* ------------------------------------------------------------------ */

export interface MigrationResult {
  from: number
  to: number
  backupPath: string | null
  applied: string[]
}

export function ensureMigrated(db: Db, dbPath: string): MigrationResult {
  const from = readSchemaVersion(db)
  if (from > SCHEMA_VERSION_CODE) {
    throw new Error(
      `قاعدة البيانات بإصدار مخطط (${from}) أحدث من المدعوم في هذا التطبيق (${SCHEMA_VERSION_CODE}) — حدّث التطبيق قبل الفتح`
    )
  }
  const pending = MIGRATIONS.filter((m) => m.version > from && m.version <= SCHEMA_VERSION_CODE)
  if (pending.length === 0) {
    return { from, to: from, backupPath: null, applied: [] }
  }

  // قاعدة §9: نسخة احتياطية أولًا، قبل تنفيذ أي شيء
  const backupPath = backupDatabaseFile(db, dbPath, from)
  const applied: string[] = []
  for (const migration of pending) {
    const run = db.transaction(() => {
      migration.up(db)
      writeSchemaVersion(db, migration.version)
    })
    run()
    applied.push(`${migration.version}:${migration.name}`)
  }
  return { from, to: SCHEMA_VERSION_CODE, backupPath, applied }
}
