/**
 * اختبارات نظام الترقيات §9 — إصدار مخطط، نسخة احتياطية إلزامية قبل ترقية،
 * idempotency، رفض قاعدة أحدث من التطبيق.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import {
  SCHEMA_VERSION_CODE,
  hasColumn,
  hasTable,
  readSchemaVersion
} from '../src/main/migrations'

let dir: string
let dbPath: string
let dbs: Db[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-mig-'))
  dbPath = join(dir, 'app.db')
  dbs = []
})
afterEach(() => {
  for (const db of dbs) {
    try {
      db.close()
    } catch {
      /* closed */
    }
  }
  rmSync(dir, { recursive: true, force: true })
})

function trackedOpen(path: string): Db {
  const db = openDb(path)
  dbs.push(db)
  return db
}

/** DDL المرحلة 0 الحرفي — لمحاكاة قاعدة عميل قديمة بلا schema_version */
const PHASE0_DDL = `
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, name_ar TEXT,
  price REAL NOT NULL CHECK (price >= 0), cost REAL NOT NULL DEFAULT 0,
  stock REAL NOT NULL DEFAULT 0, unit TEXT NOT NULL DEFAULT 'pcs', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT NOT NULL UNIQUE,
  total REAL NOT NULL, paid REAL NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sale_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id INTEGER REFERENCES products(id), product_name TEXT NOT NULL,
  quantity REAL NOT NULL CHECK (quantity > 0), unit_price REAL NOT NULL, total REAL NOT NULL);
`

const EXPECTED_TABLES = [
  'schema_version',
  'store_settings',
  'app_users',
  'products',
  'product_packaging',
  'sales',
  'sale_items',
  'customers',
  'customer_ledger',
  'suppliers',
  'supplier_ledger',
  'purchases',
  'purchase_items',
  'expenses',
  'bank_accounts',
  'payment_terminals',
  'audit_logs',
  'invoice_sequences'
]

describe('ترقية قاعدة جديدة كليًا', () => {
  it('تنشئ كل جداول §6 وتسجل الإصدار 1 ولا تأخذ نسخة (لا بيانات لحمايتها)', () => {
    const db = trackedOpen(dbPath)
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION_CODE)
    for (const table of EXPECTED_TABLES) {
      expect(hasTable(db, table), `table ${table}`).toBe(true)
    }
    const backups = readdirSync(dir).filter((f) => f.includes('.backup-'))
    expect(backups).toHaveLength(0)
  })
})

describe('ترقية قاعدة عميل من المرحلة 0 (v0 → الإصدار الحالي)', () => {
  beforeEach(() => {
    const legacy = new Database(dbPath)
    legacy.exec(PHASE0_DDL)
    legacy
      .prepare(
        "INSERT INTO products (name, name_ar, price, cost, stock, unit, created_at) VALUES ('Cola', 'كولا', 5.5, 4, 24, 'pcs', '2026-07-26T00:00:00.000Z')"
      )
      .run()
    legacy
      .prepare("INSERT INTO sales (invoice_number, total, paid, created_at) VALUES ('INV-000001', 11, 11, '2026-07-26T01:00:00.000Z')")
      .run()
    legacy
      .prepare(
        "INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, total) VALUES (1, 1, 'كولا', 2, 5.5, 11)"
      )
      .run()
    legacy.close()
  })

  it('تأخذ نسخة احتياطية حقيقية قبل الترقية وتحفظ البيانات وتضيف الأعمدة', () => {
    const db = trackedOpen(dbPath)
    // النسخة النهائية بعد كامل سلسلة الترقيات (v0→v1→v2 حاليًا) هي SCHEMA_VERSION_CODE
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION_CODE)

    // ملف النسخة موجود بحجم > 0 ويحمل حالة ما قبل الترقية (عدم وجود عمود sku فيه إثبات)
    // اسم الملف يتبع نمط backup-v0-to-v<CURRENT>- → يصمد أمام ترقيات مستقبلية
    const backups = readdirSync(dir).filter((f) => f.includes('.backup-v0-to-v'))
    expect(backups).toHaveLength(1)
    const backupPath = join(dir, backups[0])
    expect(statSync(backupPath).size).toBeGreaterThan(0)

    const backupDb = new Database(backupPath, { readonly: true })
    const backupCols = (backupDb.pragma('table_info(products)') as Array<{ name: string }>).map(
      (c) => c.name
    )
    expect(backupCols).not.toContain('sku')
    const legacyRow = backupDb.prepare('SELECT name FROM products WHERE id = 1').get()
    expect(legacyRow).toMatchObject({ name: 'Cola' })
    backupDb.close()
    dbs.push(backupDb)

    // البيانات الحية سالمة + الأعمدة الجديدة أُضيفت عبر سلسلة migrations
    expect(hasColumn(db, 'products', 'sku')).toBe(true)
    expect(hasColumn(db, 'products', 'supplier_id')).toBe(true)
    expect(hasColumn(db, 'sales', 'bank_account_id')).toBe(true)
    expect(hasColumn(db, 'sales', 'customer_id')).toBe(true)
    expect(hasColumn(db, 'sales', 'payment_method')).toBe(true)
    expect(hasColumn(db, 'sales', 'status')).toBe(true)
    expect(hasTable(db, 'invoice_sequences')).toBe(true)
    expect(
      (
        db.prepare(
          "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_sales_customer'"
        ).get() as { name: string } | undefined
      )?.name
    ).toBe('idx_sales_customer')
    const live = db.prepare('SELECT name, sku, category, sell_by_weight FROM products WHERE id = 1').get() as Record<
      string,
      unknown
    >
    expect(live.name).toBe('Cola')
    expect(live.sku).toBeNull()
    expect(live.category).toBe('عام')
    expect(live.sell_by_weight).toBe(0)
    const sale = db.prepare('SELECT invoice_number, bank_account_id FROM sales WHERE id = 1').get() as Record<
      string,
      unknown
    >
    expect(sale.invoice_number).toBe('INV-000001')
    expect(sale.bank_account_id).toBeNull()
    expect(
      (db.prepare('SELECT next_number FROM invoice_sequences WHERE id = 1').get() as { next_number: number })
        .next_number
    ).toBe(2)
    expect(
      (db.prepare('SELECT unit_cost FROM sale_items WHERE sale_id = 1').get() as { unit_cost: number })
        .unit_cost
    ).toBe(4)
  })

  it('إعادة فتح القاعدة المُرقّاة idempotent: لا خطأ ولا نسخة جديدة', () => {
    trackedOpen(dbPath).close()
    const backupsBefore = readdirSync(dir).filter((f) => f.includes('.backup-')).length
    const db = trackedOpen(dbPath)
    expect(readSchemaVersion(db)).toBe(SCHEMA_VERSION_CODE)
    db.close()
    const backupsAfter = readdirSync(dir).filter((f) => f.includes('.backup-')).length
    expect(backupsAfter).toBe(backupsBefore)
  })
})

describe('حماية من قاعدة بإصدار أحدث', () => {
  it('يرفض الفتح برسالة صريحة', () => {
    const db = new Database(dbPath)
    db.exec(`CREATE TABLE schema_version (id INTEGER PRIMARY KEY CHECK (id = 1), version INTEGER NOT NULL, updated_at TEXT NOT NULL)`)
    db.prepare("INSERT INTO schema_version (id, version, updated_at) VALUES (1, 999, '2026-01-01T00:00:00Z')").run()
    db.close()
    expect(() => trackedOpen(dbPath)).toThrow(/أحدث/)
  })
})
