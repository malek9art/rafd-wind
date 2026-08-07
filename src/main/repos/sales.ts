/**
 * مستودع المبيعات — المرحلة 2 (سلامة المبيعات والمخزون):
 *
 *  - الأسعار والمخزون من القاعدة، لا من الواجهة.
 *  - كل منتج يظهر مرة واحدة داخل الفاتورة، ولا يسمح بتجاوز المخزون.
 *  - المنتج المعطّل لا يُباع.
 *  - البيع بالوزن يتطلب وزنًا موجبًا صالحًا ومتسقًا مع تعريف المنتج.
 *  - أرقام الفواتير من عداد SQLite مستقل لا يعيد استخدام الأرقام التاريخية.
 *  - الفاتورة المعتمدة لا تُحذف صلبًا؛ تُلغى مع الاحتفاظ بالسجل والتدقيق.
 *  - طريقة الدفع وحالة الفاتورة محفوظتان في SQLite.
 */
import type { Db } from '../db'
import type {
  NewSale,
  Sale,
  SaleItem,
  SalePatch,
  SaleWithItems
} from '../../shared/types'
import { getCustomer } from './customers'
import { addLedgerEntry } from './customerLedger'
import { writeAudit } from './auditLogs'
import { nowIso, requireFound, roundMoney } from './helpers'

/** عون المستدعي: يمرَّر من طبقة IPC من جلسة المستخدم النشط */
export interface ActorRef {
  userId: number | null
  role: string | null
}

/** سقف خصم الكاشير (نص التكليف: 10% من subtotal) */
export const CASHIER_DISCOUNT_CAP = 0.1

const VALID_PAYMENT_METHODS = ['cash', 'transfer', 'card', 'other'] as const
const SALE_COLS =
  'id, invoice_number, total, paid, bank_account_id, customer_id, created_at, payment_method, status, voided_at, voided_by, void_reason'
const ITEM_COLS =
  'id, sale_id, product_id, product_name, quantity, unit_price, unit_cost, total, weight_g, sold_by_weight'

function requireFiniteNumber(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(message)
  return value
}

function normalizeBooleanFlag(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (value === true || value === 1) return true
  if (value === false || value === 0) return false
  throw new Error(`${label} غير صالح`)
}

function normalizePaymentMethod(value: unknown): string {
  const method = typeof value === 'string' ? value.trim() || 'cash' : 'cash'
  if (!VALID_PAYMENT_METHODS.includes(method as (typeof VALID_PAYMENT_METHODS)[number])) {
    throw new Error(`طريقة دفع غير معروفة: ${method}`)
  }
  return method
}

/**
 * يحسب مقدار النقص في المخزون. هذه الدالة لا تتولى التحقق من صحة المدخلات؛
 * createSale يتحقق منها قبل استدعائها، وتبقى الدالة قابلة للاختبار منفردة.
 */
export function saleItemStockDelta(item: {
  quantity?: number
  weight_g?: number | null
  sold_by_weight?: boolean | number
}): number {
  const isSoldByWeight = item.sold_by_weight === true || item.sold_by_weight === 1
  if (isSoldByWeight) return Number(item.weight_g) / 1000
  return Number(item.quantity)
}

function nextInvoiceNumber(db: Db): string {
  const row = db
    .prepare('SELECT next_number FROM invoice_sequences WHERE id = 1')
    .get() as { next_number: number } | undefined
  if (!row || !Number.isSafeInteger(row.next_number) || row.next_number < 1) {
    throw new Error('عداد أرقام الفواتير غير متاح أو تالف')
  }
  const number = row.next_number
  db.prepare('UPDATE invoice_sequences SET next_number = next_number + 1 WHERE id = 1').run()
  return `INV-${String(number).padStart(6, '0')}`
}

function requireActiveBankAccount(db: Db, id: number): void {
  if (!Number.isInteger(id) || id <= 0) throw new Error(`حساب بنكي غير موجود: ${id}`)
  const row = db
    .prepare('SELECT id, is_active FROM bank_accounts WHERE id = ?')
    .get(id) as { id: number; is_active: number } | undefined
  if (!row) throw new Error(`حساب بنكي غير موجود: ${id}`)
  if (row.is_active !== 1) throw new Error(`حساب بنكي غير نشط: ${id}`)
}

export function listSales(
  db: Db,
  filters?: { customer_id?: number; status?: string }
): Sale[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filters?.customer_id != null) {
    where.push('customer_id = ?')
    params.push(filters.customer_id)
  }
  if (filters?.status) {
    where.push('status = ?')
    params.push(filters.status)
  }
  const sql = `SELECT ${SALE_COLS} FROM sales${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id`
  return db.prepare(sql).all(...params) as Sale[]
}

export function getSaleWithItems(db: Db, saleId: number): SaleWithItems {
  const sale = requireFound(
    db.prepare(`SELECT ${SALE_COLS} FROM sales WHERE id = ?`).get(saleId) as Sale | undefined,
    `فاتورة غير موجودة: ${saleId}`
  )
  const items = db
    .prepare(`SELECT ${ITEM_COLS} FROM sale_items WHERE sale_id = ? ORDER BY id`)
    .all(saleId) as SaleItem[]
  return { sale, items }
}

export function createSale(db: Db, input: NewSale, actor?: ActorRef): SaleWithItems {
  if (!input || !Array.isArray(input.items) || input.items.length === 0) {
    throw new Error('لا يمكن إتمام بيع بدون أصناف')
  }

  const paidInput = requireFiniteNumber(input.paid, 'المبلغ المدفوع غير صالح')
  if (paidInput < 0) throw new Error('المبلغ المدفوع غير صالح')

  const customerId = input.customer_id ?? null
  if (customerId != null && (!Number.isInteger(customerId) || customerId <= 0)) {
    throw new Error('معرّف العميل غير صالح')
  }
  const paymentMethod = normalizePaymentMethod(input.payment_method)
  const discountInput = input.discount ?? 0
  const discount = roundMoney(requireFiniteNumber(discountInput, 'قيمة الخصم غير صالحة'))
  if (discount < 0) throw new Error('قيمة الخصم غير صالحة')

  const run = db.transaction((): SaleWithItems => {
    const getProduct = db.prepare(
      'SELECT id, name, name_ar, price, cost, stock, sell_by_weight, is_active FROM products WHERE id = ?'
    )
    const decreaseStock = db.prepare(
      'UPDATE products SET stock = stock - ? WHERE id = ? AND is_active = 1 AND stock >= ?'
    )
    const seenProductIds = new Set<number>()

    let subtotal = 0
    const lines: Array<{
      product_id: number
      product_name: string
      quantity: number
      unit_price: number
      unit_cost: number
      total: number
      weight_g: number | null
      sold_by_weight: number
    }> = []

    for (const item of input.items) {
      if (!item || !Number.isInteger(item.product_id) || item.product_id <= 0) {
        throw new Error('معرّف المنتج غير صالح')
      }
      if (seenProductIds.has(item.product_id)) {
        throw new Error(`لا يمكن تكرار المنتج داخل الفاتورة: ${item.product_id}`)
      }
      seenProductIds.add(item.product_id)

      const quantity = requireFiniteNumber(item.quantity, 'الكمية غير صالحة')
      if (quantity <= 0) throw new Error('الكمية يجب أن تكون أكبر من صفر')

      const product = getProduct.get(item.product_id) as
        | {
            id: number
            name: string
            name_ar: string | null
            price: number
            cost: number
            stock: number
            sell_by_weight: number
            is_active: number
          }
        | undefined
      if (!product) throw new Error(`منتج غير موجود: ${item.product_id}`)
      if (product.is_active !== 1) {
        throw new Error(`المنتج «${product.name}» معطّل ولا يمكن بيعه`)
      }
      if (!Number.isFinite(product.price) || product.price < 0) {
        throw new Error(`سعر المنتج «${product.name}» غير صالح`)
      }
      if (!Number.isFinite(product.cost) || product.cost < 0) {
        throw new Error(`تكلفة المنتج «${product.name}» غير صالحة`)
      }

      const productIsWeighted = product.sell_by_weight === 1
      const requestedWeightFlag = normalizeBooleanFlag(item.sold_by_weight, 'علم البيع بالوزن')
      if (requestedWeightFlag !== undefined && requestedWeightFlag !== productIsWeighted) {
        throw new Error(`بيانات الوزن لا تطابق إعداد المنتج «${product.name}»`)
      }

      const weightG = item.weight_g ?? null
      if (productIsWeighted) {
        if (weightG == null || typeof weightG !== 'number' || !Number.isFinite(weightG) || weightG <= 0) {
          throw new Error(`الوزن يجب أن يكون أكبر من صفر للمنتج «${product.name}»`)
        }
      } else if (weightG != null) {
        throw new Error(`الوزن غير مسموح للمنتج غير الموزون «${product.name}»`)
      }

      const stockDelta = productIsWeighted ? weightG! / 1000 : quantity
      if (!Number.isFinite(stockDelta) || stockDelta <= 0) {
        throw new Error('كمية الخصم من المخزون غير صالحة')
      }
      if (product.stock < stockDelta) {
        throw new Error(`مخزون غير كافٍ للمنتج «${product.name}» (المتاح: ${product.stock})`)
      }

      const lineTotal = roundMoney(product.price * stockDelta)
      if (!Number.isFinite(lineTotal) || lineTotal < 0) {
        throw new Error('إجمالي بند البيع غير صالح')
      }
      subtotal = roundMoney(subtotal + lineTotal)
      if (!Number.isFinite(subtotal)) throw new Error('إجمالي الفاتورة غير صالح')

      lines.push({
        product_id: product.id,
        product_name: product.name_ar || product.name,
        quantity,
        unit_price: product.price,
        unit_cost: product.cost,
        total: lineTotal,
        weight_g: productIsWeighted ? weightG : null,
        sold_by_weight: productIsWeighted ? 1 : 0
      })
    }

    // سقف خصم الكاشير (داخل المعاملة، قبل أي كتابة)
    if (actor?.role === 'cashier') {
      const cap = roundMoney(subtotal * CASHIER_DISCOUNT_CAP)
      if (discount > cap) {
        throw new Error(`خصم الكاشير يتجاوز السقف المسموح (${cap} = 10% من الإجمالي)`)
      }
    }
    if (discount > subtotal) throw new Error('الخصم يتجاوز إجمالي الفاتورة')
    const total = roundMoney(subtotal - discount)

    if (customerId != null) getCustomer(db, customerId)

    let bankAccountId: number | null = null
    if (paymentMethod === 'transfer') {
      if (input.bank_account_id == null) {
        throw new Error('التحويل البنكي يتطلب اختيار حساب بنكي')
      }
      requireActiveBankAccount(db, input.bank_account_id)
      bankAccountId = input.bank_account_id
    } else if (input.bank_account_id != null) {
      throw new Error('الحساب البنكي لا يستخدم إلا مع طريقة دفع التحويل')
    }

    const paid = roundMoney(paidInput)
    const credit = roundMoney(total - paid)
    // overpay مسموح — الفرق يرجع نقدًا، ولا يتحول إلى دين.
    if (credit > 0 && customerId == null) {
      throw new Error(`البيع الآجل يتطلب اختيار عميل (المتبقي: ${credit})`)
    }

    const invoiceNumber = nextInvoiceNumber(db)
    const createdAt = nowIso()
    const result = db
      .prepare(
        `INSERT INTO sales (
          invoice_number, total, paid, bank_account_id, customer_id, created_at,
          payment_method, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`
      )
      .run(invoiceNumber, total, paid, bankAccountId, customerId, createdAt, paymentMethod)
    const saleId = Number(result.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO sale_items (
        sale_id, product_id, product_name, quantity, unit_price, unit_cost, total, weight_g, sold_by_weight
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const line of lines) {
      const stockDelta = line.sold_by_weight === 1 ? line.weight_g! / 1000 : line.quantity
      const stockResult = decreaseStock.run(stockDelta, line.product_id, stockDelta)
      if (stockResult.changes !== 1) {
        throw new Error(`تعذّر خصم مخزون المنتج «${line.product_name}» بأمان`)
      }
      insertItem.run(
        saleId,
        line.product_id,
        line.product_name,
        line.quantity,
        line.unit_price,
        line.unit_cost,
        line.total,
        line.weight_g,
        line.sold_by_weight
      )
    }

    // عميل: إجمالي المشتريات دائمًا + قيد آجل عند وجود متبقٍ
    if (customerId != null) {
      db.prepare('UPDATE customers SET total_purchases = total_purchases + ? WHERE id = ?').run(
        total,
        customerId
      )
      if (credit > 0) {
        addLedgerEntry(db, {
          customer_id: customerId,
          amount: credit,
          type: 'sale_credit',
          reference: invoiceNumber,
          sale_id: saleId
        })
      }
    }

    writeAudit(db, {
      userId: actor?.userId ?? null,
      action: 'sale.create',
      entityType: 'sales',
      entityId: saleId,
      meta: {
        invoice_number: invoiceNumber,
        total,
        paid,
        customer_id: customerId,
        payment_method: paymentMethod
      }
    })
    return getSaleWithItems(db, saleId)
  })
  return run()
}

/**
 * تعديل محافظ:
 * - paid يُعدّل فقط لفاتورة بلا عميل، لأن فاتورة العميل تُسوّى عبر دفتر العميل.
 * - bank_account_id لا يُربط إلا بفواتير التحويل.
 */
export function updateSale(db: Db, id: number, patch: SalePatch, actor?: ActorRef): Sale {
  const initial = getSaleWithItems(db, id).sale
  if (initial.status === 'voided') throw new Error('لا يمكن تعديل فاتورة ملغاة')

  const run = db.transaction((): Sale => {
    const current = getSaleWithItems(db, id).sale
    if (patch.paid !== undefined) {
      const paid = roundMoney(requireFiniteNumber(patch.paid, 'المبلغ المدفوع غير صالح'))
      if (paid < 0) throw new Error('المبلغ المدفوع غير صالح')
      if (current.customer_id != null && paid !== current.paid) {
        throw new Error('لا يمكن تعديل مدفوعات فاتورة مرتبطة بعميل — استخدم دفتر العميل')
      }
      db.prepare('UPDATE sales SET paid = ? WHERE id = ?').run(paid, id)
    }
    if (patch.bank_account_id !== undefined) {
      if (current.payment_method !== 'transfer') {
        throw new Error('الحساب البنكي لا يرتبط إلا بفاتورة تحويل')
      }
      if (patch.bank_account_id == null) {
        throw new Error('فاتورة التحويل تتطلب حسابًا بنكيًا')
      }
      requireActiveBankAccount(db, patch.bank_account_id)
      db.prepare('UPDATE sales SET bank_account_id = ? WHERE id = ?').run(
        patch.bank_account_id,
        id
      )
    }
    const sale = getSaleWithItems(db, id).sale
    writeAudit(db, {
      userId: actor?.userId ?? null,
      action: 'sale.update',
      entityType: 'sales',
      entityId: id,
      meta: { paid: sale.paid, bank_account_id: sale.bank_account_id }
    })
    return sale
  })
  return run()
}

/**
 * إلغاء محاسبي للفواتير المعتمدة بدل حذفها صلبًا.
 * الفاتورة ذات قيد عميل مرتبط تُوقف وتحتاج تسوية مالية صريحة قبل الإلغاء،
 * حتى لا يتم إسقاط أثر الدين بصمت.
 */
export function voidSale(db: Db, id: number, reason: string, actor?: ActorRef): Sale {
  if (typeof reason !== 'string' || !reason.trim()) {
    throw new Error('سبب إلغاء الفاتورة مطلوب')
  }
  if (reason.trim().length > 500) throw new Error('سبب الإلغاء طويل جدًا')

  const existing = getSaleWithItems(db, id)
  if (existing.sale.status === 'voided') throw new Error('الفاتورة ملغاة مسبقًا')

  const run = db.transaction((): Sale => {
    const linkedCredit = db
      .prepare(
        `SELECT id, customer_id, amount
         FROM customer_ledger
         WHERE sale_id = ? AND type = 'sale_credit'
         ORDER BY id`
      )
      .all(id) as Array<{ id: number; customer_id: number; amount: number }>
    const linkedOther = db
      .prepare("SELECT COUNT(*) AS c FROM customer_ledger WHERE sale_id = ? AND type <> 'sale_credit'")
      .get(id) as { c: number }
    if (linkedCredit.length > 1 || linkedOther.c > 0) {
      throw new Error('لا يمكن إلغاء فاتورة لها قيود دفتر غير قابلة للعكس تلقائيًا — سوِّ الدفتر أولًا')
    }

    if (linkedCredit.length === 1) {
      const credit = linkedCredit[0]
      const laterEntries = db
        .prepare('SELECT COUNT(*) AS c FROM customer_ledger WHERE customer_id = ? AND id > ?')
        .get(credit.customer_id, credit.id) as { c: number }
      const customer = getCustomer(db, credit.customer_id)
      if (laterEntries.c > 0 || customer.balance < credit.amount) {
        throw new Error('لا يمكن إلغاء فاتورة سبق أن تحرك دفتر العميل بعدها — سوِّ الدفتر أولًا')
      }
    }

    const restore = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
    for (const item of existing.items) {
      if (item.product_id != null) {
        const delta = saleItemStockDelta({
          quantity: item.quantity,
          weight_g: item.weight_g,
          sold_by_weight: item.sold_by_weight
        })
        if (!Number.isFinite(delta) || delta <= 0) {
          throw new Error(`بيانات مخزون غير صالحة داخل الفاتورة ${id}`)
        }
        restore.run(delta, item.product_id)
      }
    }

    if (existing.sale.customer_id != null) {
      if (linkedCredit.length === 1) {
        addLedgerEntry(db, {
          customer_id: linkedCredit[0].customer_id,
          amount: linkedCredit[0].amount,
          type: 'sale_void',
          reference: `إلغاء ${existing.sale.invoice_number}`,
          sale_id: id
        })
      }
      db.prepare(
        'UPDATE customers SET total_purchases = MAX(0, total_purchases - ?) WHERE id = ?'
      ).run(existing.sale.total, existing.sale.customer_id)
    }

    db.prepare(
      `UPDATE sales
       SET status = 'voided', voided_at = ?, voided_by = ?, void_reason = ?
       WHERE id = ? AND status <> 'voided'`
    ).run(nowIso(), actor?.userId ?? null, reason.trim(), id)

    writeAudit(db, {
      userId: actor?.userId ?? null,
      action: 'sale.void',
      entityType: 'sales',
      entityId: id,
      meta: { invoice_number: existing.sale.invoice_number, reason: reason.trim() }
    })
    return getSaleWithItems(db, id).sale
  })
  return run()
}

/**
 * قناة توافق قديمة: لا تسمح بالحذف الصلب بعد اعتماد سياسة المرحلة 0.
 */
export function deleteSale(_db: Db, _id: number, _actor?: ActorRef): never {
  throw new Error('الحذف الصلب للفاتورة غير مسموح — استخدم إلغاء الفاتورة مع سبب واضح')
}
