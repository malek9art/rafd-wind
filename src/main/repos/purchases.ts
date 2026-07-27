/**
 * مستودع المشتريات — العقد الأكثر حساسية للذرّية في المرحلة 2 (§7 + التكليف):
 *
 *  - كل عملية (إنشاء/استلام/دفع/استبدال بنود) داخل db.transaction واحدة —
 *    لا كتابات متتالية منفصلة كما في المصدر السحابي (تنازل شبكي لا معنى له محليًا).
 *  - الاستلام (receive): مرة واحدة فقط لكل أمر شراء (status يمنع التكرار →
 *    استحالة مضاعفة المخزون). يزيد stock بـ(received_quantity ?? quantity)،
 *    يحدّث products.cost بـunit_cost الجديد، يرفع/يحدّث product_packaging،
 *    ويكتب قيد supplierLedger نوعه purchase_credit بفارق (total - paid).
 *  - الدفع (pay_amount): يزيد purchases.paid (لا يتجاوز total)، يخفض رصيد
 *    المورّد (بحد أدنى صفر عبر منطق الدفتر نفسه) ويكتب قيد payment.
 *  - حراسات قرار موثَّقة: لا استبدال بنود بعد الاستلام (يفسد تطابق المخزون)،
 *    ولا حذف لأمر شراء مستلَم (عكس الاستلام ميزة مستقلة لاحقًا).
 */
import type { Db } from '../db'
import type {
  NewPurchase,
  NewPurchaseItem,
  Purchase,
  PurchaseWithItems,
  PurchasePatch
} from '../../shared/types'
import { getSupplier } from './suppliers'
import { addSupplierLedgerEntry } from './supplierLedger'
import { writeAudit } from './auditLogs'
import {
  buildSetClause,
  nowIso,
  requireFound,
  requirePositiveMoney,
  roundMoney
} from './helpers'
import type { ActorRef } from './sales'

const PURCHASE_COLS =
  'id, supplier_id, supplier_name, reference, total, paid, status, purchase_date, notes, created_at'
const ITEM_COLS =
  'id, purchase_id, product_id, product_name, quantity, unit, unit_cost, total, units_per_carton, cartons, received_quantity, created_at'

export function listPurchases(
  db: Db,
  filters?: { supplier_id?: number; status?: string }
): Purchase[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filters?.supplier_id != null) {
    where.push('supplier_id = ?')
    params.push(filters.supplier_id)
  }
  if (filters?.status) {
    where.push('status = ?')
    params.push(filters.status)
  }
  const sql = `SELECT ${PURCHASE_COLS} FROM purchases${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id`
  return db.prepare(sql).all(...params) as Purchase[]
}

export function getPurchaseWithItems(db: Db, id: number): PurchaseWithItems {
  const purchase = requireFound(
    db.prepare(`SELECT ${PURCHASE_COLS} FROM purchases WHERE id = ?`).get(id) as
      | Purchase
      | undefined,
    `أمر شراء غير موجود: ${id}`
  )
  const items = db
    .prepare(`SELECT ${ITEM_COLS} FROM purchase_items WHERE purchase_id = ? ORDER BY id`)
    .all(id) as PurchaseWithItems['items']
  return { purchase, items }
}

/** بند بعد التطبيع: كل الحقول محسومة (total دائمًا عدد بعد الحساب) */
interface NormalizedLine {
  product_id: number | null
  product_name: string
  quantity: number
  unit: string
  unit_cost: number
  total: number
  units_per_carton: number
  cartons: number
  received_quantity: number
}

/** تطبيع صف بند: حساب total عند غيابه + التحقق */
function normalizeLine(item: NewPurchaseItem): NormalizedLine {
  if (!item.product_name || typeof item.product_name !== 'string' || !item.product_name.trim()) {
    throw new Error('اسم الصنف مطلوب في بند الشراء')
  }
  if (!(item.quantity > 0)) throw new Error('كمية البند يجب أن تكون أكبر من صفر')
  if (!(item.unit_cost >= 0)) throw new Error('تكلفة الوحدة يجب أن تكون صفرًا أو أكثر')
  if (item.received_quantity !== undefined && item.received_quantity < 0) {
    throw new Error('الكمية المستلَمة لا يمكن أن تكون سالبة')
  }
  return {
    product_id: item.product_id ?? null,
    product_name: item.product_name.trim(),
    quantity: item.quantity,
    unit: item.unit?.trim() || 'حبة',
    unit_cost: roundMoney(item.unit_cost),
    total: roundMoney(item.total ?? item.unit_cost * item.quantity),
    units_per_carton: item.units_per_carton ?? 1,
    cartons: item.cartons ?? 0,
    received_quantity: item.received_quantity ?? 0
  }
}

function totalOf(lines: Array<{ total: number }>): number {
  return roundMoney(lines.reduce((sum, l) => sum + l.total, 0))
}

function insertLines(db: Db, purchaseId: number, lines: ReturnType<typeof normalizeLine>[]): void {
  const stmt = db.prepare(
    `INSERT INTO purchase_items (purchase_id, product_id, product_name, quantity, unit, unit_cost, total, units_per_carton, cartons, received_quantity, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
  for (const line of lines) {
    stmt.run(
      purchaseId,
      line.product_id,
      line.product_name,
      line.quantity,
      line.unit,
      line.unit_cost,
      line.total,
      line.units_per_carton,
      line.cartons,
      line.received_quantity,
      nowIso()
    )
  }
}

/**
 * تنفيذ الاستلام داخل معاملة خارجية (تحفظ الذرّية عبر savepoint في better-sqlite3).
 * لا يُستدعى إلا ضمن معاملة محيطة من create/update.
 */
function receivePurchaseItems(db: Db, purchaseId: number): void {
  const purchase = requireFound(
    db.prepare(`SELECT ${PURCHASE_COLS} FROM purchases WHERE id = ?`).get(purchaseId) as
      | Purchase
      | undefined,
    `أمر شراء غير موجود: ${purchaseId}`
  )
  if (purchase.status === 'received') {
    throw new Error('أمر الشراء مستلَم مسبقًا — لا يمكن استلامه مرتين')
  }
  const items = db
    .prepare(`SELECT ${ITEM_COLS} FROM purchase_items WHERE purchase_id = ? ORDER BY id`)
    .all(purchaseId) as PurchaseWithItems['items']

  const increaseStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?')
  const updateCost = db.prepare('UPDATE products SET cost = ? WHERE id = ?')
  const setReceived = db.prepare('UPDATE purchase_items SET received_quantity = ? WHERE id = ?')
  const upsertPackaging = db.prepare(
    `INSERT INTO product_packaging (product_id, units_per_carton, carton_cost, unit_cost, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET
       units_per_carton = excluded.units_per_carton,
       carton_cost = excluded.carton_cost,
       unit_cost = excluded.unit_cost`
  )

  for (const item of items) {
    // received_quantity ?? quantity — استلام جزئي مسموح عبر received_quantity الصريحة
    const received = item.received_quantity > 0 ? item.received_quantity : item.quantity
    setReceived.run(received, item.id)
    if (item.product_id != null) {
      requireFound(
        db.prepare('SELECT id FROM products WHERE id = ?').get(item.product_id),
        `منتج غير موجود: ${item.product_id}`
      )
      increaseStock.run(received, item.product_id)
      if (item.unit_cost >= 0) {
        updateCost.run(item.unit_cost, item.product_id)
      }
      if (item.units_per_carton > 0) {
        upsertPackaging.run(
          item.product_id,
          item.units_per_carton,
          roundMoney(item.unit_cost * item.units_per_carton),
          item.unit_cost,
          nowIso()
        )
      }
    }
  }

  db.prepare("UPDATE purchases SET status = 'received' WHERE id = ?").run(purchaseId)

  // دين المورّد بفارق (total - paid) + قيد دفتر — داخل نفس المعاملة
  if (purchase.supplier_id != null) {
    const credit = roundMoney(purchase.total - purchase.paid)
    if (credit > 0) {
      addSupplierLedgerEntry(db, {
        supplier_id: purchase.supplier_id,
        amount: credit,
        type: 'purchase_credit',
        reference: purchase.reference,
        purchase_id: purchaseId
      })
    }
  }
}

export function createPurchase(
  db: Db,
  input: NewPurchase,
  actor?: ActorRef
): PurchaseWithItems {
  if (!input.items || input.items.length === 0) {
    throw new Error('لا يمكن إنشاء أمر شراء بدون بنود')
  }
  if (input.supplier_id != null) getSupplier(db, input.supplier_id)

  const run = db.transaction((): PurchaseWithItems => {
    const lines = input.items.map(normalizeLine)
    const total = totalOf(lines)
    const paid = roundMoney(input.paid ?? 0)
    if (paid < 0 || paid > total) {
      throw new Error(`المدفوع (${paid}) خارج المجال 0..${total}`)
    }
    const nextId = (
      db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM purchases').get() as { n: number }
    ).n
    const reference = input.reference?.trim() || `PO-${String(nextId).padStart(6, '0')}`
    // إنشاءٌ بحالة received: لا نُدرج 'received' قبل تنفيذ الاستلام، وإلا رأى
    // حارس «مستلَم مسبقًا» في receivePurchaseItems الصفَّ المُدرَج للتوّ ومنع
    // الاستلام الأول ذاته (كان يقتل مسار «إنشاء مستلَم» كاملًا — اكتشفته
    // الاختبارات). نُدرج بحالة ما قبل الاستلام ونترك receivePurchaseItems
    // يضبط 'received' بعد نجاح كل الآثار، ضمن المعاملة نفسها.
    const requestedStatus = input.status?.trim() || 'completed'
    const wantsReceive = requestedStatus === 'received'
    const status = wantsReceive ? 'completed' : requestedStatus

    const result = db
      .prepare(
        `INSERT INTO purchases (supplier_id, supplier_name, reference, total, paid, status, purchase_date, notes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.supplier_id ?? null,
        input.supplier_name ?? null,
        reference,
        total,
        paid,
        status,
        input.purchase_date ?? nowIso(),
        input.notes ?? null,
        nowIso()
      )
    const purchaseId = Number(result.lastInsertRowid)
    insertLines(db, purchaseId, lines)

    if (wantsReceive) {
      receivePurchaseItems(db, purchaseId)
    }
    writeAudit(db, {
      userId: actor?.userId ?? null,
      action: 'purchase.create',
      entityType: 'purchases',
      entityId: purchaseId,
      meta: { reference, total, status: requestedStatus }
    })
    return getPurchaseWithItems(db, purchaseId)
  })
  return run()
}

const SCALAR_ALLOWED = ['supplier_name', 'purchase_date', 'notes'] as const

export function updatePurchase(db: Db, id: number, patch: PurchasePatch, actor?: ActorRef): PurchaseWithItems {
  const run = db.transaction((): PurchaseWithItems => {
    const existing = getPurchaseWithItems(db, id)

    // حقول عددية بسيطة (supplier_id يُعامل خصوصًا للتحقق)
    const { clause, values } = (() => {
      try {
        return buildSetClause(patch as Record<string, unknown>, SCALAR_ALLOWED)
      } catch {
        return { clause: '', values: [] as unknown[] }
      }
    })()
    if (patch.supplier_id !== undefined) {
      if (patch.supplier_id != null) getSupplier(db, patch.supplier_id)
      db.prepare('UPDATE purchases SET supplier_id = ? WHERE id = ?').run(patch.supplier_id, id)
    }
    if (clause) {
      db.prepare(`UPDATE purchases SET ${clause} WHERE id = ?`).run(...values, id)
    }

    // استبدال البنود كاملًا — محظور بعد الاستلام (يفسد تطابق المخزون)
    if (patch.items !== undefined) {
      if (existing.purchase.status === 'received') {
        throw new Error('لا يمكن استبدال بنود أمر شراء مستلَم')
      }
      if (patch.items.length === 0) throw new Error('لا يمكن إفراغ بنود أمر الشراء')
      const lines = patch.items.map(normalizeLine)
      const total = totalOf(lines)
      if (existing.purchase.paid > total) {
        throw new Error(`المدفوع الحالي (${existing.purchase.paid}) يتجاوز الإجمالي الجديد (${total})`)
      }
      db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id)
      insertLines(db, id, lines)
      db.prepare('UPDATE purchases SET total = ? WHERE id = ?').run(total, id)
    }

    // الاستلام (بعلم receive أو status='received')
    const wantsReceive =
      patch.receive === true || patch.status === 'received'
    if (wantsReceive) {
      receivePurchaseItems(db, id)
    } else if (patch.status !== undefined) {
      db.prepare('UPDATE purchases SET status = ? WHERE id = ?').run(patch.status, id)
    }

    // دفعة إضافية
    if (patch.pay_amount !== undefined) {
      const amount = requirePositiveMoney(patch.pay_amount, 'مبلغ الدفعة')
      const current = getPurchaseWithItems(db, id).purchase
      const newPaid = roundMoney(current.paid + amount)
      if (newPaid > current.total) {
        throw new Error(`المدفوع الجديد (${newPaid}) يتجاوز إجمالي أمر الشراء (${current.total})`)
      }
      db.prepare('UPDATE purchases SET paid = ? WHERE id = ?').run(newPaid, id)
      if (current.supplier_id != null) {
        addSupplierLedgerEntry(db, {
          supplier_id: current.supplier_id,
          amount,
          type: 'payment',
          reference: current.reference,
          purchase_id: id
        })
      }
    }

    writeAudit(db, {
      userId: actor?.userId ?? null,
      action: 'purchase.update',
      entityType: 'purchases',
      entityId: id,
      meta: { receive: wantsReceive, pay_amount: patch.pay_amount ?? null }
    })
    return getPurchaseWithItems(db, id)
  })
  return run()
}

/** حذف محظور لأمر مستلَم (عكس الاستلام ميزة مستقلة لاحقًا — قرار موثَّق) */
export function deletePurchase(db: Db, id: number, actor?: ActorRef): void {
  const existing = getPurchaseWithItems(db, id)
  if (existing.purchase.status === 'received') {
    throw new Error('لا يمكن حذف أمر شراء مستلَم — التراجع عن الاستلام ميزة مستقلة')
  }
  const run = db.transaction(() => {
    db.prepare('DELETE FROM purchases WHERE id = ?').run(id)
    writeAudit(db, {
      userId: actor?.userId ?? null,
      action: 'purchase.delete',
      entityType: 'purchases',
      entityId: id,
      meta: { reference: existing.purchase.reference }
    })
  })
  run()
}
