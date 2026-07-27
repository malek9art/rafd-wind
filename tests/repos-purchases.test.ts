/**
 * اختبارات تكامل: المشتريات — التركيز الإلزامي:
 * ذرّية الاستلام (فشل منتصف العملية لا يترك أثرًا)، توليد المرجع/الإجمالي،
 * تحديث التكلفة/التغليف، قيد المورّد، الدفع الجزئي، الحراسات.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { createProduct, getProduct, listProducts } from '../src/main/repos/products'
import { createSupplier, getSupplier } from '../src/main/repos/suppliers'
import { listLedgerBySupplier } from '../src/main/repos/supplierLedger'
import {
  createPurchase,
  deletePurchase,
  getPurchaseWithItems,
  listPurchases,
  updatePurchase
} from '../src/main/repos/purchases'

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-pur-'))
  db = openDb(join(dir, 't.db'))
})
afterEach(() => {
  try {
    db.close()
  } catch {
    /* closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

function seedProduct(stock = 10, cost = 1): number {
  return createProduct(db, { name: 'صنف', price: 2, cost, stock }).id
}

describe('إنشاء أمر شراء', () => {
  it('مرجع تلقائي PO-000001 وإجمالي محسوب من البنود وpaid افتراضي 0', () => {
    const { purchase, items } = createPurchase(db, {
      items: [
        { product_name: 'سكر', quantity: 10, unit_cost: 3 },
        { product_name: 'شاي', quantity: 5, unit_cost: 2.5 }
      ]
    })
    expect(purchase.reference).toBe('PO-000001')
    expect(purchase.total).toBe(42.5) // 30 + 12.5
    expect(purchase.paid).toBe(0)
    expect(purchase.status).toBe('completed')
    expect(items).toHaveLength(2)
    expect(items[1].total).toBe(12.5)
  })

  it('يرفض: بلا بنود، paid>total، total سالب، received_quantity سالبة', () => {
    expect(() => createPurchase(db, { items: [] })).toThrow('بدون بنود')
    expect(() =>
      createPurchase(db, { items: [{ product_name: 'x', quantity: 1, unit_cost: 5 }], paid: 6 })
    ).toThrow('خارج المجال')
    expect(() =>
      createPurchase(db, {
        items: [{ product_name: 'x', quantity: 1, unit_cost: 5, received_quantity: -1 }]
      })
    ).toThrow('سالبة')
  })
})

describe('الاستلام (receive)', () => {
  it('إنشاء بـstatus=received: مخزون + تكلفة + تغليف + دين مورّد + قيد purchase_credit', () => {
    const productId = seedProduct(10, 1)
    const supplier = createSupplier(db, { name: 'مورد' })

    const { purchase, items } = createPurchase(db, {
      supplier_id: supplier.id,
      status: 'received',
      paid: 50,
      items: [
        {
          product_id: productId,
          product_name: 'أرز',
          quantity: 20,
          unit_cost: 4,
          units_per_carton: 10
        }
      ]
    })

    expect(purchase.total).toBe(80)
    expect(purchase.status).toBe('received')
    expect(items[0].received_quantity).toBe(20)

    const product = getProduct(db, productId)
    expect(product.stock).toBe(30) // 10 + 20
    expect(product.cost).toBe(4) // unit_cost الجديد

    const packaging = db
      .prepare('SELECT units_per_carton, carton_cost, unit_cost FROM product_packaging WHERE product_id = ?')
      .get(productId) as { units_per_carton: number; carton_cost: number; unit_cost: number }
    expect(packaging).toEqual({ units_per_carton: 10, carton_cost: 40, unit_cost: 4 })

    // دين = 80 - 50 = 30
    expect(getSupplier(db, supplier.id).balance).toBe(30)
    const ledger = listLedgerBySupplier(db, supplier.id)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ type: 'purchase_credit', amount: 30, balance_after: 30, purchase_id: purchase.id })

    expect(listPurchases(db, { status: 'received' })).toHaveLength(1)
  })

  it('received_quantity الجزئية تحكم الزيادة فعليًا وليس quantity', () => {
    const productId = seedProduct(0, 1)
    const { items } = createPurchase(db, {
      status: 'received',
      items: [{ product_id: productId, product_name: 'أرز', quantity: 50, received_quantity: 12, unit_cost: 4 }]
    })
    expect(items[0].received_quantity).toBe(12)
    expect(getProduct(db, productId).stock).toBe(12)
  })

  it('استلام لاحق عبر update(receive) وأمر بدون دين لا يكتب قيدًا', () => {
    const productId = seedProduct(0, 1)
    const supplier = createSupplier(db, { name: 'مورد' })
    const { purchase } = createPurchase(db, {
      supplier_id: supplier.id,
      paid: 100,
      items: [{ product_id: productId, product_name: 'أرز', quantity: 10, unit_cost: 10 }]
    })
    const updated = updatePurchase(db, purchase.id, { receive: true })
    expect(updated.purchase.status).toBe('received')
    expect(getProduct(db, productId).stock).toBe(10)
    // paid == total ⇒ لا قيد
    expect(listLedgerBySupplier(db, supplier.id)).toHaveLength(0)
  })

  it('ذرّية: فشل منتصف العملية لا يترك أي أثر (بند ثانٍ بمنتج وهمي)', () => {
    const productId = seedProduct(5, 1)
    const supplier = createSupplier(db, { name: 'مورد' })

    expect(() =>
      createPurchase(db, {
        supplier_id: supplier.id,
        status: 'received',
        items: [
          { product_id: productId, product_name: 'أرز', quantity: 10, unit_cost: 4 },
          { product_id: 999, product_name: 'وهمي', quantity: 2, unit_cost: 1 }
        ]
      })
    ).toThrow(/FOREIGN KEY|غير موجود/)

    // لا أثر إطلاقًا: لا شراء، لا بنود، لا مخزون زائد، لا تغليف، لا دين، لا قيد
    expect(listPurchases(db)).toHaveLength(0)
    expect((db.prepare('SELECT COUNT(*) AS c FROM purchase_items').get() as { c: number }).c).toBe(0)
    expect(getProduct(db, productId).stock).toBe(5)
    expect(
      (db.prepare('SELECT COUNT(*) AS c FROM product_packaging').get() as { c: number }).c
    ).toBe(0)
    expect(getSupplier(db, supplier.id).balance).toBe(0)
    expect(listLedgerBySupplier(db, supplier.id)).toHaveLength(0)
  })

  it('منع الاستلام المزدوج: المحاولة الثانية تُرفض والمخزون لا يتضاعف', () => {
    const productId = seedProduct(0, 1)
    const { purchase } = createPurchase(db, {
      status: 'received',
      items: [{ product_id: productId, product_name: 'أرز', quantity: 10, unit_cost: 4 }]
    })
    expect(getProduct(db, productId).stock).toBe(10)

    expect(() => updatePurchase(db, purchase.id, { receive: true })).toThrow('مسبقًا')
    expect(() => updatePurchase(db, purchase.id, { status: 'received' })).toThrow('مسبقًا')
    expect(getProduct(db, productId).stock).toBe(10)

    // ولا أثر ذرّي جزئي: المحاولتان الفاشلتان لم تكتبا أي قيد في أي دفتر
    expect((db.prepare('SELECT COUNT(*) AS c FROM supplier_ledger').get() as { c: number }).c).toBe(0)
  })
})

describe('الدفع الجزئي (pay_amount)', () => {
  it('يزيد paid ويخفض رصيد المورّد بأرضية صفر ويكتب قيد payment', () => {
    const supplier = createSupplier(db, { name: 'مورد' })
    const { purchase } = createPurchase(db, {
      supplier_id: supplier.id,
      status: 'received',
      paid: 0,
      items: [{ product_name: 'أرز', quantity: 10, unit_cost: 10 }]
    }) // دين 100

    const after1 = updatePurchase(db, purchase.id, { pay_amount: 40 })
    expect(after1.purchase.paid).toBe(40)
    expect(getSupplier(db, supplier.id).balance).toBe(60)

    // دفعة أكبر من الدين المتبقي → أرضية صفر في الرصيد، بغض النظر (منطق الدفتر)
    const after2 = updatePurchase(db, purchase.id, { pay_amount: 60 })
    expect(after2.purchase.paid).toBe(100)
    expect(getSupplier(db, supplier.id).balance).toBe(0)

    const ledger = listLedgerBySupplier(db, supplier.id)
    expect(ledger.map((e) => e.type)).toEqual(['purchase_credit', 'payment', 'payment'])
    expect(ledger[2].balance_after).toBe(0)

    expect(() => updatePurchase(db, purchase.id, { pay_amount: 1 })).toThrow('يتجاوز إجمالي')
    expect(() => updatePurchase(db, purchase.id, { pay_amount: 0 })).toThrow()
  })
})

describe('استبدال البنود والحذف', () => {
  it('استبدال كامل: حذف+إدراج وإعادة حساب total؛ محظور بعد الاستلام', () => {
    const { purchase } = createPurchase(db, {
      items: [{ product_name: 'قديم', quantity: 1, unit_cost: 5 }]
    })
    const updated = updatePurchase(db, purchase.id, {
      items: [
        { product_name: 'جديد ١', quantity: 2, unit_cost: 3 },
        { product_name: 'جديد ٢', quantity: 1, unit_cost: 4 }
      ]
    })
    expect(updated.purchase.total).toBe(10)
    expect(updated.items.map((i) => i.product_name)).toEqual(['جديد ١', 'جديد ٢'])

    updatePurchase(db, purchase.id, { receive: true })
    expect(() =>
      updatePurchase(db, purchase.id, { items: [{ product_name: 'x', quantity: 1, unit_cost: 1 }] })
    ).toThrow('مستلَم')
  })

  it('حذف أمر غير مستلَم مسموح، ومستلَم محظور', () => {
    const p1 = createPurchase(db, { items: [{ product_name: 'x', quantity: 1, unit_cost: 1 }] })
    deletePurchase(db, p1.purchase.id)
    expect(listPurchases(db)).toHaveLength(0)

    const p2 = createPurchase(db, {
      status: 'received',
      items: [{ product_name: 'y', quantity: 1, unit_cost: 1 }]
    })
    expect(() => deletePurchase(db, p2.purchase.id)).toThrow('مستلَم')
    expect(listPurchases(db)).toHaveLength(1)
  })
})

describe('التدقيق وترشيح القوائم', () => {
  it('يكتب audit_logs عند الإنشاء ويرشّح بالمورّد/الحالة', () => {
    const supplier = createSupplier(db, { name: 'مورد' })
    createPurchase(db, {
      supplier_id: supplier.id,
      items: [{ product_name: 'x', quantity: 1, unit_cost: 1 }]
    }, { userId: null, role: null })
    createPurchase(db, {
      status: 'received',
      items: [{ product_name: 'y', quantity: 1, unit_cost: 1 }]
    })
    expect(listPurchases(db, { supplier_id: supplier.id })).toHaveLength(1)
    expect(listPurchases(db, { status: 'received' })).toHaveLength(1)
    const audits = db
      .prepare("SELECT action, entity_type FROM audit_logs WHERE action = 'purchase.create'")
      .all() as Array<{ action: string; entity_type: string }>
    expect(audits.length).toBeGreaterThanOrEqual(2)
    expect(audits[0].entity_type).toBe('purchases')
    expect(getPurchaseWithItems(db, 1).purchase.reference).toBe('PO-000001')
  })
})
