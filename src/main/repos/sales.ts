/**
 * مستودع المبيعات — المرحلة 2 (عقد §7 + المنطق المنقول):
 *
 *  - الأسعار تُقرأ من القاعدة داخل المعاملة، لا تُؤخذ من الواجهة (§11).
 *  - سقف خصم الكاشير: discount ≤ 10% من subtotal لدور cashier (منطق
 *    discount-policy المنقول نصًا في التكليف §9). الأدوار الأخرى بلا سقف حاليًا.
 *  - العميل الآجل: customer_id + (total - paid) > 0 → قيد customer_ledger نوعه
 *    sale_credit بـreference=invoice_number؛ وtotal_purchases يزداد دائمًا مع العميل.
 *  - التحويل البنكي: payment_method='transfer' يتطلب bank_account_id فعليًّا.
 *  - تدقيق صامت لكل عملية (sale.create/update/delete) بـuser_id المستدعي.
 *  - حذف الفاتورة: يعيد المخزون، ويُمنع إن وُجدت قيود دفتر مرتبطة بها
 *    (تُسوّى من شاشة العميل أولًا) — قرار موثَّق يحفظ الاتساق المالي.
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

const SALE_COLS = 'id, invoice_number, total, paid, bank_account_id, customer_id, created_at'
const ITEM_COLS = 'id, sale_id, product_id, product_name, quantity, unit_price, total, weight_g, sold_by_weight'

export function saleItemStockDelta(item: { quantity?: number; weight_g?: number | null; sold_by_weight?: boolean | number }): number {
  let dec = Number(item.quantity) || 0
  const isSoldByWeight = item.sold_by_weight === true || item.sold_by_weight === 1
  if ((isSoldByWeight || item.weight_g != null) && item.weight_g != null) {
    dec = Number(item.weight_g) / 1000
  }
  return dec > 0 ? dec : 0
}

export function listSales(db: Db, filters?: { customer_id?: number }): Sale[] {
  if (filters?.customer_id != null) {
    return db
      .prepare(`SELECT ${SALE_COLS} FROM sales WHERE customer_id = ? ORDER BY id`)
      .all(filters.customer_id) as Sale[]
  }
  return db.prepare(`SELECT ${SALE_COLS} FROM sales ORDER BY id`).all() as Sale[]
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
  if (!input.items || input.items.length === 0) {
    throw new Error('لا يمكن إتمام بيع بدون أصناف')
  }
  if (!(input.paid >= 0)) {
    throw new Error('المبلغ المدفوع غير صالح')
  }
  const customerId = input.customer_id ?? null
  const paymentMethod = input.payment_method?.trim() || 'cash'
  const discount = roundMoney(input.discount ?? 0)
  if (discount < 0) throw new Error('قيمة الخصم غير صالحة')

  const run = db.transaction((): SaleWithItems => {
    // المبالغ من القاعدة لا من الواجهة (§11)
    const getProduct = db.prepare('SELECT id, name, name_ar, price, stock, sell_by_weight FROM products WHERE id = ?')
    const decreaseStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')

    let subtotal = 0
    const lines: Array<{
      product_id: number
      product_name: string
      quantity: number
      unit_price: number
      total: number
      weight_g: number | null
      sold_by_weight: number
    }> = []
    for (const item of input.items) {
      if (!(item.quantity > 0)) throw new Error('الكمية يجب أن تكون أكبر من صفر')
      const product = getProduct.get(item.product_id) as
        | { id: number; name: string; name_ar: string | null; price: number; stock: number; sell_by_weight: number }
        | undefined
      if (!product) throw new Error(`منتج غير موجود: ${item.product_id}`)

      const isSoldByWeight = item.sold_by_weight !== undefined
        ? (item.sold_by_weight === true || item.sold_by_weight === 1 ? 1 : 0)
        : (product.sell_by_weight ? 1 : 0)

      const weightG = item.weight_g !== undefined ? item.weight_g : null

      const dec = saleItemStockDelta({
        quantity: item.quantity,
        weight_g: weightG,
        sold_by_weight: !!isSoldByWeight
      })

      if (product.stock < dec) {
        throw new Error(`مخزون غير كافٍ للمنتج «${product.name}» (المتاح: ${product.stock})`)
      }
      const lineTotal = roundMoney(product.price * (isSoldByWeight ? (weightG ?? 0) / 1000 : item.quantity))
      subtotal = roundMoney(subtotal + lineTotal)
      lines.push({
        product_id: product.id,
        product_name: product.name_ar || product.name,
        quantity: item.quantity,
        unit_price: product.price,
        total: lineTotal,
        weight_g: weightG,
        sold_by_weight: isSoldByWeight
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
      requireFound(
        db.prepare('SELECT id FROM bank_accounts WHERE id = ?').get(input.bank_account_id),
        `حساب بنكي غير موجود: ${input.bank_account_id}`
      )
      bankAccountId = input.bank_account_id
    }

    const paid = roundMoney(input.paid)
    const credit = roundMoney(total - paid)
    if (credit < 0) {
      // overpay مسموح (باقٍ للعميل) — الفرق يرجع نقدًا، لا دين
    }
    if (credit > 0 && customerId == null) {
      throw new Error(`البيع الآجل يتطلب اختيار عميل (المتبقي: ${credit})`)
    }

    const nextId = (
      db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM sales').get() as { n: number }
    ).n
    const invoiceNumber = `INV-${String(nextId).padStart(6, '0')}`
    const createdAt = nowIso()
    const result = db
      .prepare(
        `INSERT INTO sales (invoice_number, total, paid, bank_account_id, customer_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(invoiceNumber, total, paid, bankAccountId, customerId, createdAt)
    const saleId = Number(result.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, total, weight_g, sold_by_weight)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    for (const line of lines) {
      const dec = saleItemStockDelta({
        quantity: line.quantity,
        weight_g: line.weight_g,
        sold_by_weight: !!line.sold_by_weight
      })
      decreaseStock.run(dec, line.product_id)
      insertItem.run(
        saleId,
        line.product_id,
        line.product_name,
        line.quantity,
        line.unit_price,
        line.total,
        line.weight_g,
        line.sold_by_weight
      )
    }

    // عميل: إجمالي المشتريات دائمًا + قيد آجل عند وجود متبقٍّ
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
      meta: { invoice_number: invoiceNumber, total, paid, customer_id: customerId }
    })
    return getSaleWithItems(db, saleId)
  })
  return run()
}

/**
 * تعديل محافظ (قرار موثَّق): paid / bank_account_id فقط.
 * تسوية دين عميل بعد دفع لاحق تتم عبر customerLedger.addEntry نوع payment،
 * لا بتعديل الفاتورة رجعيًا — فصل نظيف للمسؤوليات.
 */
export function updateSale(db: Db, id: number, patch: SalePatch, actor?: ActorRef): Sale {
  getSaleWithItems(db, id)
  const run = db.transaction((): Sale => {
    if (patch.paid !== undefined) {
      if (!(patch.paid >= 0)) throw new Error('المبلغ المدفوع غير صالح')
      db.prepare('UPDATE sales SET paid = ? WHERE id = ?').run(roundMoney(patch.paid), id)
    }
    if (patch.bank_account_id !== undefined) {
      if (patch.bank_account_id != null) {
        requireFound(
          db.prepare('SELECT id FROM bank_accounts WHERE id = ?').get(patch.bank_account_id),
          `حساب بنكي غير موجود: ${patch.bank_account_id}`
        )
      }
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

/** حذف فاتورة: إعادة مخزون + منع مع وجود قيود مرتبطة (قرار ترويسة الملف) */
export function deleteSale(db: Db, id: number, actor?: ActorRef): void {
  const existing = getSaleWithItems(db, id)
  const run = db.transaction(() => {
    const linked = db
      .prepare('SELECT COUNT(*) AS c FROM customer_ledger WHERE sale_id = ?')
      .get(id) as { c: number }
    if (linked.c > 0) {
      throw new Error('لا يمكن حذف فاتورة لها قيود دفتر عميل — سوِّ الدفتر أولًا')
    }
    const restore = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
    for (const item of existing.items) {
      if (item.product_id != null) {
        const dec = saleItemStockDelta({
          quantity: item.quantity,
          weight_g: item.weight_g,
          sold_by_weight: !!item.sold_by_weight
        })
        restore.run(dec, item.product_id)
      }
    }
    db.prepare('DELETE FROM sales WHERE id = ?').run(id)
    writeAudit(db, {
      userId: actor?.userId ?? null,
      action: 'sale.delete',
      entityType: 'sales',
      entityId: id,
      meta: { invoice_number: existing.sale.invoice_number }
    })
  })
  run()
}
