/**
 * اختبارات تكامل: المبيعات — التركيز الإلزامي من التكليف:
 * سقف خصم الكاشير (10% من subtotal)، قيد العميل الآجل، ترميز التحويل
 * البنكي، ذرّية الفشل، إعادة المخزون عند الحذف، وسجل التدقيق لكل بيع.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { createProduct, getProduct } from '../src/main/repos/products'
import { createCustomer, getCustomer } from '../src/main/repos/customers'
import { addLedgerEntry, listLedgerByCustomer } from '../src/main/repos/customerLedger'
import { createBankAccount } from '../src/main/repos/crudSimple'
import { listAuditLogs } from '../src/main/repos/auditLogs'
import { createUser } from '../src/main/repos/users'
import {
  CASHIER_DISCOUNT_CAP,
  createSale,
  deleteSale,
  getSaleWithItems,
  voidSale,
  listSales,
  updateSale,
  type ActorRef
} from '../src/main/repos/sales'

let dir: string
let db: Db
let MANAGER: ActorRef
let CASHIER: ActorRef

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-sales-'))
  db = openDb(join(dir, 't.db'))
  // ممثّلون بمعرّفات مستخدمين حقيقية — audit_logs.user_id له FK إلى app_users
  // (أي معرّف مُختلَق تعني كتابة تدقيق تُبتلع صامتًا، فيخفى شذوذ محتمل)
  MANAGER = { userId: createUser(db, { full_name: 'مدير', role: 'manager' }).id, role: 'manager' }
  CASHIER = { userId: createUser(db, { full_name: 'كاشير', role: 'cashier' }).id, role: 'cashier' }
})
afterEach(() => {
  try {
    db.close()
  } catch {
    /* closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

/** منتج اختباري بسعر/مخزون معطيين */
function seedProduct(price = 100, stock = 10): number {
  return createProduct(db, { name: 'صنف', price, stock }).id
}

describe('إتمام بيع', () => {
  it('فاتورة مرقّمة تلقائيًا + أسعار من القاعدة لا من الواجهة + تنقيص مخزون', () => {
    const pid = seedProduct(45, 5)
    const { sale, items } = createSale(db, { items: [{ product_id: pid, quantity: 2 }], paid: 90 }, MANAGER)
    expect(sale.invoice_number).toBe('INV-000001')
    expect(sale.total).toBe(90)
    expect(sale.paid).toBe(90)
    expect(sale.customer_id).toBeNull()
    expect(items).toHaveLength(1)
    expect(items[0].unit_price).toBe(45)
    expect(items[0].total).toBe(90)
    expect(getProduct(db, pid).stock).toBe(3)

    const second = createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 45 }, MANAGER)
    expect(second.sale.invoice_number).toBe('INV-000002')
  })

  it('يرفض: بلا بنود، كمية صفر، منتج مجهول، مخزون ناقص — ولا يترك أثرًا', () => {
    const pid = seedProduct(10, 2)
    expect(() => createSale(db, { items: [], paid: 0 }, MANAGER)).toThrow('بدون أصناف')
    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 0 }], paid: 0 }, MANAGER)
    ).toThrow('الكمية يجب أن تكون أكبر من صفر')
    expect(() =>
      createSale(db, { items: [{ product_id: 999, quantity: 1 }], paid: 10 }, MANAGER)
    ).toThrow('منتج غير موجود: 999')
    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 3 }], paid: 30 }, MANAGER)
    ).toThrow('مخزون غير كافٍ')

    expect(listSales(db)).toHaveLength(0)
    expect(getProduct(db, pid).stock).toBe(2)
  })

  it('يرفض تكرار المنتج داخل الفاتورة دون أي أثر على المخزون أو الأرقام', () => {
    const pid = seedProduct(10, 5)
    expect(() =>
      createSale(
        db,
        {
          items: [
            { product_id: pid, quantity: 3 },
            { product_id: pid, quantity: 3 }
          ],
          paid: 60
        },
        MANAGER
      )
    ).toThrow('لا يمكن تكرار المنتج')
    expect(listSales(db)).toHaveLength(0)
    expect(getProduct(db, pid).stock).toBe(5)
  })

  it('يمنع بيع المنتج المعطّل', () => {
    const pid = seedProduct(10, 5)
    db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(pid)
    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 10 }, MANAGER)
    ).toThrow('معطّل')
    expect(listSales(db)).toHaveLength(0)
    expect(getProduct(db, pid).stock).toBe(5)
  })
})

describe('سقف خصم الكاشير (10% من subtotal)', () => {
  it('خصم = السقف بالضبط يمر، وتجاوزه بقرش يرمي ولا يغيّر المخزون', () => {
    const pid = seedProduct(100, 10)
    expect(CASHIER_DISCOUNT_CAP).toBe(0.1)

    // subtotal = 200 → السقف 20 بالضبط
    const ok = createSale(
      db,
      { items: [{ product_id: pid, quantity: 2 }], paid: 180, discount: 20 },
      CASHIER
    )
    expect(ok.sale.total).toBe(180)

    expect(() =>
      createSale(
        db,
        { items: [{ product_id: pid, quantity: 2 }], paid: 179.99, discount: 20.01 },
        CASHIER
      )
    ).toThrow('خصم الكاشير يتجاوز السقف')
    // ذرّية رفض السقف: لا فاتورة ثانية ولا تنقيص مخزون إضافي
    expect(listSales(db)).toHaveLength(1)
    expect(getProduct(db, pid).stock).toBe(8)
  })

  it('الأدوار الأخرى بلا سقف، لكن الخصم فوق subtotal ممنوع للجميع', () => {
    const pid = seedProduct(100, 10)
    const sale = createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 50, discount: 50 }, MANAGER)
    expect(sale.sale.total).toBe(50)

    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 0, discount: 150 }, MANAGER)
    ).toThrow('الخصم يتجاوز إجمالي الفاتورة')
    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 0, discount: -5 }, MANAGER)
    ).toThrow('قيمة الخصم غير صالحة')
  })
})

describe('العميل الآجل', () => {
  it('متبقٍّ > 0 مع عميل: قيد sale_credit بمرجع الفاتورة + إجمالي مشتريات يزداد دائمًا', () => {
    const pid = seedProduct(45, 5)
    const cust = createCustomer(db, { name: 'أحمد' })

    const { sale } = createSale(
      db,
      { items: [{ product_id: pid, quantity: 2 }], paid: 40, customer_id: cust.id },
      MANAGER
    )
    // subtotal 90، مدفوع 40 → متبقٍّ 50
    expect(sale.total).toBe(90)
    expect(sale.customer_id).toBe(cust.id)

    const after = getCustomer(db, cust.id)
    expect(after.balance).toBe(50)
    expect(after.total_purchases).toBe(90)

    const ledger = listLedgerByCustomer(db, cust.id)
    expect(ledger).toHaveLength(1)
    expect(ledger[0].type).toBe('sale_credit')
    expect(ledger[0].amount).toBe(50)
    expect(ledger[0].balance_after).toBe(50)
    expect(ledger[0].reference).toBe(sale.invoice_number)
    expect(ledger[0].sale_id).toBe(sale.id)

    // بيع ثانٍ مدفوع بالكامل: لا قيد جديد، لكن total_purchases يتراكم دائمًا
    const second = createSale(
      db,
      { items: [{ product_id: pid, quantity: 1 }], paid: 45, customer_id: cust.id },
      MANAGER
    )
    expect(second.sale.total).toBe(45)
    expect(listLedgerByCustomer(db, cust.id)).toHaveLength(1)
    const after2 = getCustomer(db, cust.id)
    expect(after2.total_purchases).toBe(135)
    expect(after2.balance).toBe(50)
  })

  it('ذرّية: بيع آجل بدون عميل يرمي ولا ينقّص المخزون ولا يكتب فاتورة', () => {
    const pid = seedProduct(45, 5)
    expect(() => createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 10 }, MANAGER)).toThrow(
      'البيع الآجل يتطلب اختيار عميل'
    )
    expect(listSales(db)).toHaveLength(0)
    expect(getProduct(db, pid).stock).toBe(5)
  })

  it('overpay نقدي بدون عميل مسموح (الفرق باقٍ نقدًا، لا دين)', () => {
    const pid = seedProduct(45, 5)
    const { sale } = createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 100 }, MANAGER)
    expect(sale.total).toBe(45)
    expect(sale.paid).toBe(100)
    expect(listSales(db)).toHaveLength(1)
  })

  it('عميل مجهول يُرفض ولا يترك أثرًا', () => {
    const pid = seedProduct(45, 5)
    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 45, customer_id: 999 }, MANAGER)
    ).toThrow('عميل غير موجود: 999')
    expect(listSales(db)).toHaveLength(0)
  })
})

describe('التحويل البنكي', () => {
  it('transfer يتطلب حسابًا حقيقيًا ويُخزَّن مرجعًا في الفاتورة', () => {
    const pid = seedProduct(30, 3)
    const bank = createBankAccount(db, { bank_name: 'بنك التضامن', account_name: 'المتجر' })

    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 30, payment_method: 'transfer' }, MANAGER)
    ).toThrow('التحويل البنكي يتطلب اختيار حساب بنكي')
    expect(() =>
      createSale(
        db,
        { items: [{ product_id: pid, quantity: 1 }], paid: 30, payment_method: 'transfer', bank_account_id: 999 },
        MANAGER
      )
    ).toThrow('حساب بنكي غير موجود: 999')
    // ذرّية الفشلين
    expect(getProduct(db, pid).stock).toBe(3)
    expect(listSales(db)).toHaveLength(0)

    const { sale } = createSale(
      db,
      { items: [{ product_id: pid, quantity: 1 }], paid: 30, payment_method: 'transfer', bank_account_id: bank.id },
      MANAGER
    )
    expect(sale.bank_account_id).toBe(bank.id)
    expect(listSales(db)).toHaveLength(1)
  })
})

describe('قراءة وتعديل وحذف', () => {
  it('list بفلتر customer_id وget بالبنود', () => {
    const pid = seedProduct(10, 10)
    const c1 = createCustomer(db, { name: 'أ' }).id
    const c2 = createCustomer(db, { name: 'ب' }).id
    createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 10, customer_id: c1 }, MANAGER)
    createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 10, customer_id: c2 }, MANAGER)
    createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 10 }, MANAGER)

    expect(listSales(db)).toHaveLength(3)
    const mine = listSales(db, { customer_id: c1 })
    expect(mine).toHaveLength(1)
    expect(mine[0].customer_id).toBe(c1)

    const full = getSaleWithItems(db, mine[0].id)
    expect(full.items).toHaveLength(1)
    expect(full.items[0].product_name).toBe('صنف')
    expect(() => getSaleWithItems(db, 999)).toThrow('فاتورة غير موجودة: 999')
  })

  it('update محافظ: paid وbank_account_id فقط ولا يمسّ total', () => {
    const pid = seedProduct(10, 10)
    const bank = createBankAccount(db, { bank_name: 'ب', account_name: 'ح' })
    const { sale } = createSale(
      db,
      {
        items: [{ product_id: pid, quantity: 1 }],
        paid: 10,
        payment_method: 'transfer',
        bank_account_id: bank.id
      },
      MANAGER
    )

    const paidUpdated = updateSale(db, sale.id, { paid: 6 }, MANAGER)
    expect(paidUpdated.paid).toBe(6)
    expect(paidUpdated.total).toBe(10)

    const updated = updateSale(db, sale.id, { bank_account_id: bank.id }, MANAGER)
    expect(updated.paid).toBe(6)
    expect(updated.bank_account_id).toBe(bank.id)
    expect(updated.total).toBe(10)
    expect(updated.payment_method).toBe('transfer')

    expect(() => updateSale(db, sale.id, { paid: -1 }, MANAGER)).toThrow('المبلغ المدفوع غير صالح')
    expect(() => updateSale(db, sale.id, { bank_account_id: 999 }, MANAGER)).toThrow('حساب بنكي غير موجود: 999')
    expect(() => updateSale(db, 999, { paid: 1 }, MANAGER)).toThrow('فاتورة غير موجودة: 999')
    // التحديثات الفاشلة لم تُغيّر شيئًا
    const still = getSaleWithItems(db, sale.id).sale
    expect(still.paid).toBe(6)
    expect(still.bank_account_id).toBe(bank.id)
  })

  it('إلغاء فاتورة نقدية يعيد المخزون ويحافظ على السجل', () => {
    const pid = seedProduct(10, 3)
    const { sale } = createSale(db, { items: [{ product_id: pid, quantity: 2 }], paid: 20 }, MANAGER)
    expect(getProduct(db, pid).stock).toBe(1)

    const voided = voidSale(db, sale.id, 'إلغاء بناءً على طلب العميل', MANAGER)
    expect(voided.status).toBe('voided')
    expect(voided.void_reason).toBe('إلغاء بناءً على طلب العميل')
    expect(listSales(db)).toHaveLength(1)
    expect(getSaleWithItems(db, sale.id).sale.status).toBe('voided')
    expect(getProduct(db, pid).stock).toBe(3)
    expect(() => deleteSale(db, sale.id, MANAGER)).toThrow('الحذف الصلب')
  })

  it('إلغاء فاتورة آجلة بلا حركات لاحقة يعكس قيد الدين والمخزون', () => {
    const pid = seedProduct(50, 3)
    const cust = createCustomer(db, { name: 'أحمد' })
    const { sale } = createSale(
      db,
      { items: [{ product_id: pid, quantity: 1 }], paid: 20, customer_id: cust.id },
      MANAGER
    )
    expect(listLedgerByCustomer(db, cust.id)).toHaveLength(1)

    const voided = voidSale(db, sale.id, 'إلغاء اختبار', MANAGER)
    expect(voided.status).toBe('voided')
    expect(getProduct(db, pid).stock).toBe(3)
    expect(getCustomer(db, cust.id).balance).toBe(0)
    expect(listLedgerByCustomer(db, cust.id).map((entry) => entry.type)).toEqual([
      'sale_credit',
      'sale_void'
    ])
  })

  it('يمنع إلغاء فاتورة آجلة بعد وجود حركة لاحقة في دفتر العميل', () => {
    const pid = seedProduct(50, 3)
    const cust = createCustomer(db, { name: 'أحمد' })
    const { sale } = createSale(
      db,
      { items: [{ product_id: pid, quantity: 1 }], paid: 20, customer_id: cust.id },
      MANAGER
    )
    addLedgerEntry(db, { customer_id: cust.id, amount: 10, type: 'payment' })

    expect(() => voidSale(db, sale.id, 'إلغاء غير آمن', MANAGER)).toThrow(
      'سبق أن تحرك دفتر العميل'
    )
    expect(getProduct(db, pid).stock).toBe(2)
    expect(getSaleWithItems(db, sale.id).sale.status).toBe('completed')
  })

  it('إلغاء فاتورة عميل مدفوعة بالكامل يعكس إجمالي مشترياته ويحافظ على الرقم', () => {
    const pid = seedProduct(10, 3)
    const customer = createCustomer(db, { name: 'عميل نقدي' })
    const first = createSale(
      db,
      { items: [{ product_id: pid, quantity: 1 }], paid: 10, customer_id: customer.id },
      MANAGER
    )
    expect(getCustomer(db, customer.id).total_purchases).toBe(10)

    const voided = voidSale(db, first.sale.id, 'إلغاء فاتورة مدفوعة', MANAGER)
    expect(voided.status).toBe('voided')
    expect(getCustomer(db, customer.id).total_purchases).toBe(0)
    expect(getProduct(db, pid).stock).toBe(3)

    const next = createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 10 }, MANAGER)
    expect(next.sale.invoice_number).toBe('INV-000002')
    expect(next.sale.payment_method).toBe('cash')
  })
})

describe('سجل التدقيق', () => {
  it('كل عملية بيع تكتب صفًا بـuser_id المستدعي وبيانات الكيان', () => {
    // user_id في audit_logs له FK إلى app_users — المستدعي هنا يمثل جلسة
    // حقيقية (في الإنتاج يأتي دائمًا من login عبر getCurrentUser)، لذا ننشئ
    // مستخدمين فعليين وإلا ابتلع writeAudit الصف بهدوء (سلوك مقصود).
    const writer = createUser(db, { full_name: 'كاتب' })
    const updater = createUser(db, { full_name: 'معدّل' })
    const deleter = createUser(db, { full_name: 'حاذف' })

    const pid = seedProduct(10, 5)
    const { sale } = createSale(
      db,
      { items: [{ product_id: pid, quantity: 1 }], paid: 10 },
      { userId: writer.id, role: 'manager' }
    )
    const creates = listAuditLogs(db, { action: 'sale.create' })
    expect(creates).toHaveLength(1)
    expect(creates[0].user_id).toBe(writer.id)
    expect(creates[0].entity_type).toBe('sales')
    expect(creates[0].entity_id).toBe(sale.id)
    expect(JSON.parse(creates[0].meta as string).invoice_number).toBe(sale.invoice_number)

    updateSale(db, sale.id, { paid: 9 }, { userId: updater.id, role: 'manager' })
    voidSale(db, sale.id, 'تصحيح إداري', { userId: deleter.id, role: 'manager' })

    const updates = listAuditLogs(db, { action: 'sale.update' })
    expect(updates).toHaveLength(1)
    expect(updates[0].user_id).toBe(updater.id)
    const voids = listAuditLogs(db, { action: 'sale.void' })
    expect(voids).toHaveLength(1)
    expect(voids[0].user_id).toBe(deleter.id)
  })
})

describe('مبيعات الميزان والوزن', () => {
  it('يخصم المخزون بالوزن الفعلي (جرام / 1000) للسلع الموزونة ويحسب السعر الإجمالي بالوزن', () => {
    // ننشئ منتجًا موزونًا (مثلاً جبنة) بمخزون 5 كجم وسعر 120 ريال للكجم
    const pid = createProduct(db, {
      name: 'جبنة رومي',
      price: 120,
      stock: 5,
      sell_by_weight: 1
    }).id

    // نبيع 500 جرام (0.5 كجم)
    const { sale, items } = createSale(
      db,
      {
        items: [
          {
            product_id: pid,
            quantity: 1, // الكمية الأساسية ممررة كـ 1
            weight_g: 500,
            sold_by_weight: 1
          }
        ],
        paid: 60
      },
      MANAGER
    )

    expect(sale.total).toBe(60) // 120 * 0.5 = 60 ريال
    expect(items[0].weight_g).toBe(500)
    expect(items[0].sold_by_weight).toBe(1)
    expect(items[0].total).toBe(60)

    // يجب أن يكون المخزون المتبقي 4.5 كجم
    expect(getProduct(db, pid).stock).toBe(4.5)
  })

  it('يرفض البيع بالوزن لو كان المخزون المتبقي غير كافٍ', () => {
    const pid = createProduct(db, {
      name: 'تفاح',
      price: 10,
      stock: 1.5,
      sell_by_weight: 1
    }).id

    // نحاول بيع 2000 جرام (2 كجم) والمتاح 1.5 كجم
    expect(() =>
      createSale(
        db,
        {
          items: [
            {
              product_id: pid,
              quantity: 1,
              weight_g: 2000,
              sold_by_weight: 1
            }
          ],
          paid: 20
        },
        MANAGER
      )
    ).toThrow('مخزون غير كافٍ')
  })

  it('يرفض الوزن المفقود أو الصفري أو السالب ولا يترك فاتورة', () => {
    const pid = createProduct(db, {
      name: 'لحم',
      price: 100,
      stock: 5,
      sell_by_weight: 1
    }).id

    expect(() => createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 0 }, MANAGER)).toThrow(
      'الوزن يجب أن يكون أكبر من صفر'
    )
    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 1, weight_g: 0, sold_by_weight: 1 }], paid: 0 }, MANAGER)
    ).toThrow('الوزن يجب أن يكون أكبر من صفر')
    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 1, weight_g: -100, sold_by_weight: 1 }], paid: 0 }, MANAGER)
    ).toThrow('الوزن يجب أن يكون أكبر من صفر')
    expect(listSales(db)).toHaveLength(0)
    expect(getProduct(db, pid).stock).toBe(5)
  })
})
