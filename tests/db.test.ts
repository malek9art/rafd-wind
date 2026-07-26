/**
 * اختبارات تكامل لطبقة SQLite — ملف مؤقت حقيقي عبر better-sqlite3 فعلي
 * (الوثيقة §13: بدون محاكاة لقاعدة البيانات).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createProduct,
  createSale,
  getSaleWithItems,
  listProducts,
  openDb,
  type Db
} from '../src/main/db'

let dir: string
let dbPath: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-db-'))
  dbPath = join(dir, 'test.db')
  db = openDb(dbPath)
})

afterEach(() => {
  try {
    db.close()
  } catch {
    /* already closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('products', () => {
  it('ينشئ جداول المخطط ويبدأ فارغًا', () => {
    expect(listProducts(db)).toEqual([])
  })

  it('ينشئ منتجًا ويعيده بكل الحقول', () => {
    const p = createProduct(db, {
      name: 'Cola 330ml',
      name_ar: 'كولا ٣٣٠مل',
      price: 5.5,
      cost: 4,
      stock: 24,
      unit: 'pcs'
    })
    expect(p.id).toBe(1)
    expect(p.name).toBe('Cola 330ml')
    expect(p.name_ar).toBe('كولا ٣٣٠مل')
    expect(p.price).toBe(5.5)
    expect(p.stock).toBe(24)
    expect(p.created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(listProducts(db)).toHaveLength(1)
  })

  it('يرفض منتجًا بلا اسم أو بسعر سالب', () => {
    expect(() => createProduct(db, { name: ' ', price: 1 })).toThrow('اسم المنتج مطلوب')
    expect(() => createProduct(db, { name: 'x', price: -1 })).toThrow()
  })
})

describe('sales', () => {
  it('ينشئ بيعًا كاملًا: أسعار من القاعدة، ترقيم فاتورة، تنقيص مخزون', () => {
    const cola = createProduct(db, { name: 'Cola', price: 5.5, cost: 4, stock: 24 })
    const water = createProduct(db, { name: 'Water', name_ar: 'ماء', price: 2, cost: 1, stock: 100 })

    const sale = createSale(db, {
      items: [
        { product_id: cola.id, quantity: 2 },
        { product_id: water.id, quantity: 3 }
      ],
      paid: 20
    })

    expect(sale.sale.invoice_number).toBe('INV-000001')
    expect(sale.sale.total).toBe(17) // 2×5.5 + 3×2
    expect(sale.sale.paid).toBe(20)
    expect(sale.items).toHaveLength(2)
    expect(sale.items[0]).toMatchObject({ product_id: cola.id, quantity: 2, unit_price: 5.5, total: 11 })
    expect(sale.items[1]).toMatchObject({ product_id: water.id, product_name: 'ماء', quantity: 3, total: 6 })

    const products = listProducts(db)
    expect(products.find((p) => p.id === cola.id)?.stock).toBe(22)
    expect(products.find((p) => p.id === water.id)?.stock).toBe(97)
  })

  it('يرقم الفواتير تسلسليًا', () => {
    const p = createProduct(db, { name: 'x', price: 1, stock: 10 })
    const s1 = createSale(db, { items: [{ product_id: p.id, quantity: 1 }], paid: 1 })
    const s2 = createSale(db, { items: [{ product_id: p.id, quantity: 1 }], paid: 1 })
    expect(s1.sale.invoice_number).toBe('INV-000001')
    expect(s2.sale.invoice_number).toBe('INV-000002')
  })

  it('يرفض بيعًا فارغًا أو مدفوعًا ناقصًا أو مخزونًا غير كافٍ أو منتجًا مفقودًا', () => {
    const p = createProduct(db, { name: 'Cola', price: 5, stock: 2 })
    expect(() => createSale(db, { items: [], paid: 0 })).toThrow('بدون أصناف')
    expect(() => createSale(db, { items: [{ product_id: p.id, quantity: 1 }], paid: 4 })).toThrow('أقل من إجمالي')
    expect(() => createSale(db, { items: [{ product_id: p.id, quantity: 5 }], paid: 25 })).toThrow('مخزون غير كافٍ')
    expect(() => createSale(db, { items: [{ product_id: 999, quantity: 1 }], paid: 5 })).toThrow('غير موجود')
    expect(() => createSale(db, { items: [{ product_id: p.id, quantity: 0 }], paid: 0 })).toThrow('الكمية')
  })

  it('فشل صنف وسط البيع يُرجع كل شيء (معاملة ذرّية): لا فاتورة ولا تنقيص مخزون', () => {
    const a = createProduct(db, { name: 'A', price: 1, stock: 10 })
    const b = createProduct(db, { name: 'B', price: 1, stock: 1 })
    expect(() =>
      createSale(db, {
        items: [
          { product_id: a.id, quantity: 7 },
          { product_id: b.id, quantity: 5 } // سيفشل هنا
        ],
        paid: 20
      })
    ).toThrow('مخزون غير كافٍ')

    expect(listProducts(db).find((p) => p.id === a.id)?.stock).toBe(10)
    const salesCount = db.prepare('SELECT COUNT(*) AS c FROM sales').get() as { c: number }
    const itemsCount = db.prepare('SELECT COUNT(*) AS c FROM sale_items').get() as { c: number }
    expect(salesCount.c).toBe(0)
    expect(itemsCount.c).toBe(0)
  })

  it('البيانات تبقى بعد إغلاق القاعدة وإعادة فتحها (معيار نجاح المرحلة 0)', () => {
    const p = createProduct(db, { name: 'Cola', price: 5.5, stock: 24 })
    const sale = createSale(db, { items: [{ product_id: p.id, quantity: 2 }], paid: 11 })
    const saleId = sale.sale.id
    db.close()

    const reopened = openDb(dbPath)
    const persisted = getSaleWithItems(reopened, saleId)
    expect(persisted.sale.invoice_number).toBe('INV-000001')
    expect(persisted.sale.total).toBe(11)
    expect(persisted.items).toHaveLength(1)
    expect(listProducts(reopened).find((x) => x.id === p.id)?.stock).toBe(22)
    reopened.close()
  })
})
