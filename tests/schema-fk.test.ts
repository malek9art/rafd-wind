/**
 * اختبارات تكامل للقيود المرجعية المنقولة (شرط المرحلة 1 الإلزامي، §13):
 * ابن بأب غير موجود يُرفض · CASCADE يحذف الأبناء · SET NULL يُبقي السجل ويفرّغ المرجع
 * · foreign_keys=ON فعّال فعليًا · قيود single-row وUNIQUE.
 * كل اختبار على قاعدة SQLite حقيقية بملف مؤقت (لا محاكاة).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-fk-'))
  db = openDb(join(dir, 'fk.db'))
})
afterEach(() => {
  try {
    db.close()
  } catch {
    /* closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

const now = () => new Date().toISOString()

function insertSupplier(name = 'مورد ١'): number {
  return Number(
    db.prepare("INSERT INTO suppliers (name, created_at) VALUES (?, ?)").run(name, now()).lastInsertRowid
  )
}
function insertCustomer(name = 'عميل ١'): number {
  return Number(
    db.prepare("INSERT INTO customers (name, created_at) VALUES (?, ?)").run(name, now()).lastInsertRowid
  )
}
function insertProduct(opts: { supplier_id?: number | null; sku?: string | null } = {}): number {
  return Number(
    db.prepare(
      "INSERT INTO products (name, price, supplier_id, sku, created_at) VALUES ('منتج', 1, ?, ?, ?)"
    ).run(opts.supplier_id ?? null, opts.sku ?? null, now()).lastInsertRowid
  )
}
function insertSale(bank_account_id: number | null = null): number {
  return Number(
    db.prepare(
      "INSERT INTO sales (invoice_number, total, paid, bank_account_id, created_at) VALUES (?, 10, 10, ?, ?)"
    ).run(`INV-${Math.random()}`, bank_account_id, now()).lastInsertRowid
  )
}
function insertPurchase(supplier_id: number | null): number {
  return Number(
    db.prepare(
      "INSERT INTO purchases (supplier_id, purchase_date, created_at) VALUES (?, ?, ?)"
    ).run(supplier_id, now(), now()).lastInsertRowid
  )
}
function insertUser(): number {
  return Number(
    db.prepare("INSERT INTO app_users (full_name, created_at, updated_at) VALUES ('مستخدم', ?, ?)")
      .run(now(), now()).lastInsertRowid
  )
}
function insertBankAccount(): number {
  return Number(
    db.prepare("INSERT INTO bank_accounts (bank_name, account_name, created_at) VALUES ('بنك', 'حساب', ?)")
      .run(now()).lastInsertRowid
  )
}

describe('foreign_keys=ON فعّال فعليًا', () => {
  it('PRAGMA foreign_keys = 1', () => {
    const row = db.pragma('foreign_keys', { simple: true }) as number
    expect(row).toBe(1)
  })
})

describe('ابن بأب غير موجود يُرفض (كل قيد مرجعي)', () => {
  it.each([
    ['product_packaging.product_id', "INSERT INTO product_packaging (product_id, created_at) VALUES (999, '2026-01-01')"],
    ['customer_ledger.customer_id', "INSERT INTO customer_ledger (customer_id, type, amount, created_at) VALUES (999, 'sale', 1, '2026-01-01')"],
    ['customer_ledger.sale_id', null], // يُحتاج عميل حقيقي — يُعالج أدناه
    ['supplier_ledger.supplier_id', "INSERT INTO supplier_ledger (supplier_id, type, amount, created_at) VALUES (999, 'purchase', 1, '2026-01-01')"],
    ['purchases.supplier_id', "INSERT INTO purchases (supplier_id, created_at) VALUES (999, '2026-01-01')"],
    ['purchase_items.purchase_id', "INSERT INTO purchase_items (purchase_id, product_name, created_at) VALUES (999, 'صنف', '2026-01-01')"],
    ['purchase_items.product_id', null], // يُحتاج شراء حقيقي — أدناه
    ['sales.bank_account_id', "INSERT INTO sales (invoice_number, total, paid, bank_account_id, created_at) VALUES ('INV-X1', 1, 1, 999, '2026-01-01')"],
    ['audit_logs.user_id', "INSERT INTO audit_logs (user_id, action, created_at) VALUES (999, 'login', '2026-01-01')"],
    ['products.supplier_id', "INSERT INTO products (name, price, supplier_id, created_at) VALUES ('P', 1, 999, '2026-01-01')"]
  ])('%s', (_label, sql) => {
    if (sql) expect(() => db.exec(sql)).toThrow(/FOREIGN KEY/)
  })

  it('customer_ledger.sale_id يشير لفاتورة غير موجودة يُرفض', () => {
    const customer = insertCustomer()
    expect(() =>
      db.prepare("INSERT INTO customer_ledger (customer_id, type, amount, sale_id, created_at) VALUES (?, 'sale', 1, 999, ?)")
        .run(customer, now())
    ).toThrow(/FOREIGN KEY/)
  })

  it('purchase_items.product_id يشير لمنتج غير موجود يُرفض', () => {
    const supplier = insertSupplier()
    const purchase = insertPurchase(supplier)
    expect(() =>
      db.prepare("INSERT INTO purchase_items (purchase_id, product_id, product_name, created_at) VALUES (?, 999, 'صنف', ?)")
        .run(purchase, now())
    ).toThrow(/FOREIGN KEY/)
  })
})

describe('ON DELETE CASCADE — حذف الأب يحذف الأبناء', () => {
  it('حذف عميل يحذف قيود دفتره', () => {
    const customer = insertCustomer()
    db.prepare("INSERT INTO customer_ledger (customer_id, type, amount, created_at) VALUES (?, 'sale', 50, ?)")
      .run(customer, now())
    db.prepare('DELETE FROM customers WHERE id = ?').run(customer)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM customer_ledger').get() as { c: number }).c
    expect(count).toBe(0)
  })

  it('حذف مورد يحذف قيود دفتره', () => {
    const supplier = insertSupplier()
    db.prepare("INSERT INTO supplier_ledger (supplier_id, type, amount, created_at) VALUES (?, 'purchase', 100, ?)")
      .run(supplier, now())
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(supplier)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM supplier_ledger').get() as { c: number }).c
    expect(count).toBe(0)
  })

  it('حذف منتج يحذف تغليفه', () => {
    const product = insertProduct()
    db.prepare('INSERT INTO product_packaging (product_id, units_per_carton, created_at) VALUES (?, 12, ?)')
      .run(product, now())
    db.prepare('DELETE FROM products WHERE id = ?').run(product)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM product_packaging').get() as { c: number }).c
    expect(count).toBe(0)
  })

  it('حذف شراء يحذف أصنافه', () => {
    const purchase = insertPurchase(insertSupplier())
    db.prepare("INSERT INTO purchase_items (purchase_id, product_name, created_at) VALUES (?, 'صنف', ?)")
      .run(purchase, now())
    db.prepare('DELETE FROM purchases WHERE id = ?').run(purchase)
    const count = (db.prepare('SELECT COUNT(*) AS c FROM purchase_items').get() as { c: number }).c
    expect(count).toBe(0)
  })
})

describe('ON DELETE SET NULL — السجل يبقى والمرجع يُفرَّغ', () => {
  it('حذف مورد: المنتج وأمر الشراء يبقيان بلا مرجع', () => {
    const supplier = insertSupplier()
    const product = insertProduct({ supplier_id: supplier })
    const purchase = insertPurchase(supplier)
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(supplier)
    const p = db.prepare('SELECT supplier_id FROM products WHERE id = ?').get(product) as { supplier_id: number | null }
    const pur = db.prepare('SELECT supplier_id FROM purchases WHERE id = ?').get(purchase) as { supplier_id: number | null }
    expect(p.supplier_id).toBeNull()
    expect(pur.supplier_id).toBeNull()
    // أمر الشراء نفسه بقي موجودًا
    expect(db.prepare('SELECT COUNT(*) AS c FROM purchases WHERE id = ?').get(purchase)).toMatchObject({ c: 1 })
  })

  it('حذف فاتورة: قيد العميل المرتبط بها يبقى مع sale_id مفرَّغ (قرار التحسين الموثَّق)', () => {
    const customer = insertCustomer()
    const sale = insertSale()
    db.prepare("INSERT INTO customer_ledger (customer_id, type, amount, sale_id, created_at) VALUES (?, 'sale', 50, ?, ?)")
      .run(customer, sale, now())
    db.prepare('DELETE FROM sales WHERE id = ?').run(sale)
    const ledger = db.prepare('SELECT sale_id FROM customer_ledger WHERE customer_id = ?').get(customer) as {
      sale_id: number | null
    }
    expect(ledger.sale_id).toBeNull()
  })

  it('حذف شراء: قيد المورد المرتبط به يبقى مع purchase_id مفرَّغ', () => {
    const supplier = insertSupplier()
    const purchase = insertPurchase(supplier)
    db.prepare("INSERT INTO supplier_ledger (supplier_id, type, amount, purchase_id, created_at) VALUES (?, 'purchase', 100, ?, ?)")
      .run(supplier, purchase, now())
    db.prepare('DELETE FROM purchases WHERE id = ?').run(purchase)
    const ledger = db.prepare('SELECT purchase_id FROM supplier_ledger WHERE supplier_id = ?').get(supplier) as {
      purchase_id: number | null
    }
    expect(ledger.purchase_id).toBeNull()
  })

  it('حذف منتج: صنف الشراء التاريخي يبقى مع product_id مفرَّغ', () => {
    const product = insertProduct()
    const purchase = insertPurchase(insertSupplier())
    db.prepare("INSERT INTO purchase_items (purchase_id, product_id, product_name, created_at) VALUES (?, ?, 'صنف تاريخي', ?)")
      .run(purchase, product, now())
    db.prepare('DELETE FROM products WHERE id = ?').run(product)
    const item = db.prepare('SELECT product_id FROM purchase_items WHERE purchase_id = ?').get(purchase) as {
      product_id: number | null
    }
    expect(item.product_id).toBeNull()
  })

  it('حذف مستخدم: سجل التدقيق يبقى مع user_id مفرَّغ', () => {
    const user = insertUser()
    db.prepare("INSERT INTO audit_logs (user_id, action, entity_type, created_at) VALUES (?, 'login', 'app_users', ?)")
      .run(user, now())
    db.prepare('DELETE FROM app_users WHERE id = ?').run(user)
    const log = db.prepare('SELECT user_id FROM audit_logs').get() as { user_id: number | null }
    expect(log.user_id).toBeNull()
  })

  it('حذف حساب بنكي: الفاتورة تبقى مع bank_account_id مفرَّغ', () => {
    const account = insertBankAccount()
    const sale = insertSale(account)
    db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(account)
    const s = db.prepare('SELECT bank_account_id FROM sales WHERE id = ?').get(sale) as {
      bank_account_id: number | null
    }
    expect(s.bank_account_id).toBeNull()
  })
})

describe('قيود UNIQUE وصفّ واحد', () => {
  it('sku فريد: تكرار يُرفض، وNULL متعدد مسموح', () => {
    insertProduct({ sku: 'SKU-1' })
    expect(() => insertProduct({ sku: 'SKU-1' })).toThrow(/UNIQUE/)
    insertProduct()
    insertProduct()
    const c = (db.prepare('SELECT COUNT(*) AS c FROM products').get() as { c: number }).c
    expect(c).toBe(3)
  })

  it('تغليف واحد فقط لكل منتج (unique على product_id)', () => {
    const product = insertProduct()
    db.prepare('INSERT INTO product_packaging (product_id, created_at) VALUES (?, ?)').run(product, now())
    expect(() =>
      db.prepare('INSERT INTO product_packaging (product_id, created_at) VALUES (?, ?)').run(product, now())
    ).toThrow(/UNIQUE/)
  })

  it('store_settings صف واحد فقط (CHECK id = 1)', () => {
    db.prepare("INSERT INTO store_settings (id, name, created_at, updated_at) VALUES (1, 'متجري', ?, ?)").run(now(), now())
    expect(() =>
      db.prepare("INSERT INTO store_settings (id, name, created_at, updated_at) VALUES (2, 'آخر', ?, ?)").run(now(), now())
    ).toThrow(/CHECK/)
  })
})

describe('اكتمال أعمدة §6 حرفيًا (حراسة ضد أخطاء النقل)', () => {
  const EXPECTED_COLUMNS: Record<string, string[]> = {
    store_settings: ['id','name','name_ar','logo_url','primary_color','secondary_color','currency','phone','email','address','tax_number','invoice_footer','business_type','tax_enabled','tax_rate','tax_mode','enabled_categories','custom_categories','created_at','updated_at','printer_port','printer_baud_rate','receipt_width'],
    app_users: ['id','full_name','role','phone','status','avatar_url','pin_hash','created_at','updated_at'],
    products: ['id','name','name_ar','price','cost','stock','unit','sku','barcode','category','min_stock','image_url','is_active','supplier_id','supplier_name','sell_by_weight','created_at'],
    product_packaging: ['id','product_id','units_per_carton','carton_cost','unit_cost','created_at'],
    sales: ['id','invoice_number','total','paid','bank_account_id','created_at','customer_id','payment_method','status','voided_at','voided_by','void_reason'],
    sale_items: ['id','sale_id','product_id','product_name','quantity','unit_price','total','weight_g','sold_by_weight','unit_cost'],
    customers: ['id','name','phone','email','balance','total_purchases','notes','created_at'],
    customer_ledger: ['id','customer_id','type','amount','balance_after','reference','notes','sale_id','created_at'],
    suppliers: ['id','name','phone','email','balance','notes','created_at'],
    supplier_ledger: ['id','supplier_id','type','amount','balance_after','reference','notes','purchase_id','created_at'],
    purchases: ['id','supplier_id','supplier_name','reference','total','paid','status','purchase_date','notes','created_at'],
    purchase_items: ['id','purchase_id','product_id','product_name','quantity','unit','unit_cost','total','units_per_carton','cartons','received_quantity','created_at'],
    expenses: ['id','category','amount','description','payment_method','expense_date','created_at'],
    bank_accounts: ['id','bank_name','account_name','account_number','iban','currency','is_active','notes','created_at'],
    payment_terminals: ['id','name','provider','terminal_id','connection_type','is_active','supports_contactless','notes','created_at'],
    audit_logs: ['id','user_id','action','entity_type','entity_id','meta','actor_email','entity','created_at']
  }

  for (const [table, columns] of Object.entries(EXPECTED_COLUMNS)) {
    it(`${table}: كل الأعمدة المطلوبة موجودة وبنفس الترتيب`, () => {
      const actual = (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map((c) => c.name)
      expect(actual).toEqual(columns)
    })
  }
})
