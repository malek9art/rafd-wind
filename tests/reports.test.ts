import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { createProduct } from '../src/main/repos/products'
import { createSale, voidSale } from '../src/main/repos/sales'
import { createExpense } from '../src/main/repos/crudSimple'
import { createPurchase } from '../src/main/repos/purchases'
import { getPnlReport } from '../src/main/repos/reports'

let dir: string
let db: Db

beforeEach(() => {
  // تثبيت الساعة يجعل بيانات nowIso تقع داخل نطاق التقرير في كل بيئة/تاريخ تشغيل.
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-07-15T12:00:00.000Z'))
  dir = mkdtempSync(join(tmpdir(), 'rafd-rep-'))
  db = openDb(join(dir, 't.db'))
})

afterEach(() => {
  try {
    db.close()
  } catch {}
  rmSync(dir, { recursive: true, force: true })
  vi.useRealTimers()
})

describe('منطق التقارير والربح والخسارة', () => {
  it('يعطي نتيجة صفرية متماسكة ودون أخطاء لفترة بلا بيانات', () => {
    const report = getPnlReport(db, '2026-07-01', '2026-07-31')
    expect(report.totalRevenue).toBe(0)
    expect(report.totalCogs).toBe(0)
    expect(report.totalExpenses).toBe(0)
    expect(report.totalPurchases).toBe(0)
    expect(report.grossProfit).toBe(0)
    expect(report.netProfit).toBe(0)
    expect(report.dailyRevenue).toHaveLength(0)
    expect(report.expensesByCategory).toHaveLength(0)
  })

  it('يحسب إيراد مالي ومصروفات ومشتريات وربح وخسارة بشكل صحيح لسيناريوهات مختلطة', () => {
    // 1. إضافة سلع (واحدة بالقطعة وواحدة بالوزن)
    const p1 = createProduct(db, { name: 'عصير تفاح', price: 150, cost: 80, stock: 100 })
    const p2 = createProduct(db, { name: 'جبن موزون', price: 200, cost: 120, stock: 50, sell_by_weight: 1 })

    // 2. تسجيل مبيعات
    // عملية بيع عادية: قطعتين عصير (سعر 150*2 = 300)، تكلفة قطعتين عصير (80*2 = 160)
    createSale(db, {
      items: [{ product_id: p1.id, quantity: 2 }],
      paid: 300
    })

    // عملية بيع بالوزن: 500 جرام جبن (0.5 كجم) (سعر 200*0.5 = 100)، تكلفة (120*0.5 = 60)
    createSale(db, {
      items: [{ product_id: p2.id, quantity: 1, weight_g: 500, sold_by_weight: 1 }],
      paid: 100
    })

    // 3. تسجيل مصروفات على فئات متعددة
    createExpense(db, { category: 'إيجار', amount: 50, expense_date: '2026-07-28' })
    createExpense(db, { category: 'كهرباء', amount: 20, expense_date: '2026-07-28' })

    // 4. تسجيل أمر شراء
    createPurchase(db, {
      status: 'received',
      items: [{ product_name: 'سلعة تجريبية مشتراة', quantity: 10, unit_cost: 30 }],
      paid: 300
    })

    // 5. توليد التقرير
    const report = getPnlReport(db, '2026-07-01', '2026-07-31')

    // الإيراد الكلي: 300 + 100 = 400 YER
    expect(report.totalRevenue).toBe(400)

    // COGS الكلي: (80*2) + (120 * 0.5) = 160 + 60 = 220 YER
    expect(report.totalCogs).toBe(220)

    // المصروفات الكلية: 50 + 20 = 70 YER
    expect(report.totalExpenses).toBe(70)

    // المشتريات الكلية: 10 * 30 = 300 YER
    expect(report.totalPurchases).toBe(300)

    // مجمل الربح: 400 - 220 = 180 YER
    expect(report.grossProfit).toBe(180)

    // صافي الربح: 180 - 70 = 110 YER
    expect(report.netProfit).toBe(110)

    // فئات المصروفات
    expect(report.expensesByCategory).toHaveLength(2)
    expect(report.expensesByCategory[0]).toEqual({ category: 'إيجار', amount: 50 })
    expect(report.expensesByCategory[1]).toEqual({ category: 'كهرباء', amount: 20 })

    // الإيراد اليومي
    expect(report.dailyRevenue).toHaveLength(1)
    expect(report.dailyRevenue[0].amount).toBe(400)
  })

  it('يستبعد الفاتورة الملغاة من الإيراد والتكلفة والإيراد اليومي', () => {
    const product = createProduct(db, { name: 'صنف ملغى', price: 100, cost: 60, stock: 5 })
    const { sale } = createSale(db, { items: [{ product_id: product.id, quantity: 1 }], paid: 100 })
    voidSale(db, sale.id, 'اختبار الإلغاء')

    const report = getPnlReport(db, '2026-07-01', '2026-07-31')
    expect(report.totalRevenue).toBe(0)
    expect(report.totalCogs).toBe(0)
    expect(report.dailyRevenue).toHaveLength(0)
  })

  it('يستخدم تكلفة الصنف وقت البيع لا التكلفة الحالية عند إعداد COGS التاريخي', () => {
    const product = createProduct(db, { name: 'صنف بتكلفة متغيرة', price: 100, cost: 60, stock: 5 })
    createSale(db, { items: [{ product_id: product.id, quantity: 1 }], paid: 100 })
    db.prepare('UPDATE products SET cost = 90 WHERE id = ?').run(product.id)

    const report = getPnlReport(db, '2026-07-01', '2026-07-31')
    expect(report.totalCogs).toBe(60)
  })
})
