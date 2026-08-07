/**
 * مستودع المشتريات — المرحلة 3 (دورة الاستلام والرصيد):
 *
 *  - الحالات: draft / pending / partially_received / received / cancelled.
 *  - الاستلام الجزئي متعدد المراحل، والكمية المستلمة هدف تراكمي لا تتجاوز المطلوب.
 *  - كل عملية استلام تزيد المخزون بالفرق الجديد فقط.
 *  - تكلفة المخزون تُحدَّث بمتوسط مرجح عند الاستلام.
 *  - دين المورد يُسجَّل حسب قيمة الكمية المستلمة فعليًا.
 *  - الدفعات قبل أول استلام غير مسموحة؛ تمنع التباس الدفعة المقدمة مع الدين.
 *  - كل عملية داخل معاملة SQLite واحدة، ولا حذف لأمر بدأ استلامه.
 */
import type { Db } from '../db'
import type {
  NewPurchase,
  NewPurchaseItem,
  Purchase,
  PurchaseReceiptItem,
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
const VALID_STATUSES = [
  'draft',
  'pending',
  'partially_received',
  'received',
  'cancelled'
] as const

type PurchaseStatus = (typeof VALID_STATUSES)[number]

function requireFinite(value: unknown, message: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(message)
  return value
}

function normalizeStatus(value: unknown, fallback: PurchaseStatus = 'pending'): PurchaseStatus {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : fallback
  // completed هو الاسم القديم للحالة الافتراضية غير المستلمة؛ يُحوّل دون كسر قواعد قديمة.
  const normalized = raw === 'completed' ? 'pending' : raw
  if (!VALID_STATUSES.includes(normalized as PurchaseStatus)) {
    throw new Error(`حالة شراء غير معروفة: ${raw}`)
  }
  return normalized as PurchaseStatus
}

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
    params.push(normalizeStatus(filters.status))
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

/** بند بعد التطبيع: total يُحسب مركزيًا ولا يُؤخذ من الواجهة. */
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

function normalizeLine(item: NewPurchaseItem): NormalizedLine {
  if (!item || !item.product_name || typeof item.product_name !== 'string' || !item.product_name.trim()) {
    throw new Error('اسم الصنف مطلوب في بند الشراء')
  }
  const quantity = requireFinite(item.quantity, 'كمية البند غير صالحة')
  if (quantity <= 0) throw new Error('كمية البند يجب أن تكون أكبر من صفر')
  const unitCost = requireFinite(item.unit_cost, 'تكلفة الوحدة غير صالحة')
  if (unitCost < 0) throw new Error('تكلفة الوحدة يجب أن تكون صفرًا أو أكثر')

  if (
    item.product_id != null &&
    (!Number.isInteger(item.product_id) || item.product_id <= 0)
  ) {
    throw new Error('معرّف المنتج في بند الشراء غير صالح')
  }

  const received = item.received_quantity ?? 0
  if (typeof received !== 'number' || !Number.isFinite(received) || received < 0) {
    throw new Error('الكمية المستلَمة يجب أن تكون رقمًا صفرًا أو أكثر وليست سالبة')
  }
  if (received > quantity) {
    throw new Error('الكمية المستلَمة لا يمكن أن تتجاوز الكمية المطلوبة')
  }

  const unitsPerCarton = item.units_per_carton ?? 1
  if (typeof unitsPerCarton !== 'number' || !Number.isFinite(unitsPerCarton) || unitsPerCarton <= 0) {
    throw new Error('عدد الوحدات في الكرتون يجب أن يكون أكبر من صفر')
  }
  const cartons = item.cartons ?? 0
  if (typeof cartons !== 'number' || !Number.isFinite(cartons) || cartons < 0) {
    throw new Error('عدد الكراتين يجب أن يكون صفرًا أو أكثر')
  }

  return {
    product_id: item.product_id ?? null,
    product_name: item.product_name.trim(),
    quantity,
    unit: item.unit?.trim() || 'حبة',
    unit_cost: roundMoney(unitCost),
    total: roundMoney(unitCost * quantity),
    units_per_carton: unitsPerCarton,
    cartons,
    received_quantity: received
  }
}

function totalOf(lines: Array<{ total: number }>): number {
  return roundMoney(lines.reduce((sum, l) => sum + l.total, 0))
}

function receivedValue(items: PurchaseWithItems['items']): number {
  return roundMoney(items.reduce((sum, item) => sum + item.received_quantity * item.unit_cost, 0))
}

function insertLines(db: Db, purchaseId: number, lines: NormalizedLine[]): void {
  const stmt = db.prepare(
    `INSERT INTO purchase_items (
      purchase_id, product_id, product_name, quantity, unit, unit_cost, total,
      units_per_carton, cartons, received_quantity, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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

function validateProductReferences(db: Db, lines: NormalizedLine[]): void {
  for (const line of lines) {
    if (line.product_id == null) continue
    requireFound(
      db.prepare('SELECT id FROM products WHERE id = ?').get(line.product_id),
      `منتج غير موجود: ${line.product_id}`
    )
  }
}

function getLedgerTotals(db: Db, purchaseId: number): { credits: number; payments: number } {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN type = 'purchase_credit' THEN amount ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN type = 'payment' THEN amount ELSE 0 END), 0) AS payments
       FROM supplier_ledger
       WHERE purchase_id = ?`
    )
    .get(purchaseId) as { credits: number; payments: number }
  return { credits: roundMoney(row.credits), payments: roundMoney(row.payments) }
}

function updateSupplierCreditForReceipt(
  db: Db,
  purchase: Purchase,
  items: PurchaseWithItems['items']
): void {
  if (purchase.supplier_id == null) return
  const totals = getLedgerTotals(db, purchase.id)
  // paid - payment ledger = الدفعة المقدمة الموجودة داخل سجل purchase نفسه.
  const initialPaid = roundMoney(Math.max(0, purchase.paid - totals.payments))
  const desiredCredits = roundMoney(Math.max(0, receivedValue(items) - initialPaid))
  const creditDelta = roundMoney(desiredCredits - totals.credits)
  if (creditDelta > 0) {
    addSupplierLedgerEntry(db, {
      supplier_id: purchase.supplier_id,
      amount: creditDelta,
      type: 'purchase_credit',
      reference: purchase.reference,
      purchase_id: purchase.id
    })
  }
}

function updateProductForReceipt(
  db: Db,
  productId: number,
  receivedDelta: number,
  unitCost: number,
  unitsPerCarton: number
): void {
  const product = db
    .prepare('SELECT id, stock, cost FROM products WHERE id = ?')
    .get(productId) as { id: number; stock: number; cost: number } | undefined
  if (!product) throw new Error(`منتج غير موجود: ${productId}`)
  if (receivedDelta <= 0) return
  if (!Number.isFinite(product.stock) || product.stock < 0) {
    throw new Error(`مخزون المنتج غير صالح: ${productId}`)
  }

  const newStock = product.stock + receivedDelta
  const newCost = roundMoney(
    (product.stock * product.cost + receivedDelta * unitCost) / newStock
  )
  const changed = db
    .prepare('UPDATE products SET stock = ?, cost = ? WHERE id = ?')
    .run(newStock, newCost, productId)
  if (changed.changes !== 1) throw new Error(`تعذّر تحديث مخزون المنتج: ${productId}`)

  db.prepare(
    `INSERT INTO product_packaging (product_id, units_per_carton, carton_cost, unit_cost, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(product_id) DO UPDATE SET
       units_per_carton = excluded.units_per_carton,
       carton_cost = excluded.carton_cost,
       unit_cost = excluded.unit_cost`
  ).run(
    productId,
    unitsPerCarton,
    roundMoney(unitCost * unitsPerCarton),
    unitCost,
    nowIso()
  )
}

type ReceiptTarget = { product_id: number | null; received_quantity: number }

/**
 * يستلم الكمية المستهدفة التراكمية لكل بند. الفرق فقط هو الذي يزيد المخزون.
 */
function receivePurchaseItems(
  db: Db,
  purchaseId: number,
  requestedTargets?: ReceiptTarget[]
): PurchaseWithItems {
  const purchase = getPurchaseWithItems(db, purchaseId)
  if (purchase.purchase.status === 'cancelled') {
    throw new Error('لا يمكن استلام أمر شراء ملغى')
  }
  if (purchase.purchase.status === 'received') {
    throw new Error('أمر الشراء مستلَم مسبقًا بالكامل — لا يمكن استلامه مرة أخرى')
  }

  const actualItems = purchase.items
  if (requestedTargets && requestedTargets.length !== actualItems.length) {
    throw new Error('قائمة كميات الاستلام لا تطابق بنود أمر الشراء')
  }

  const setReceived = db.prepare('UPDATE purchase_items SET received_quantity = ? WHERE id = ?')
  let anyDelta = false

  for (let index = 0; index < actualItems.length; index += 1) {
    const item = actualItems[index]
    const requested = requestedTargets?.[index]
    if (requested && (requested.product_id ?? null) !== (item.product_id ?? null)) {
      throw new Error(`بند الاستلام لا يطابق المنتج في أمر الشراء: ${item.product_name}`)
    }

    const target = requested
      ? requireFinite(requested.received_quantity, 'الكمية المستلَمة غير صالحة')
      : item.quantity
    if (target < item.received_quantity) {
      throw new Error(`لا يمكن إنقاص كمية مستلمة سابقًا للصنف «${item.product_name}»`)
    }
    if (target > item.quantity) {
      throw new Error(`الكمية المستلَمة تتجاوز المطلوب للصنف «${item.product_name}»`)
    }

    const delta = roundMoney(target - item.received_quantity)
    if (delta <= 0) continue
    anyDelta = true
    setReceived.run(target, item.id)

    if (item.product_id != null) {
      updateProductForReceipt(
        db,
        item.product_id,
        delta,
        item.unit_cost,
        item.units_per_carton
      )
    }
  }

  if (!anyDelta) throw new Error('لا توجد كمية جديدة للاستلام')

  const updated = getPurchaseWithItems(db, purchaseId)
  const allReceived = updated.items.every((item) => item.received_quantity >= item.quantity)
  const hasReceived = updated.items.some((item) => item.received_quantity > 0)
  const status: PurchaseStatus = allReceived
    ? 'received'
    : hasReceived
      ? 'partially_received'
      : 'pending'

  if (purchase.purchase.paid > receivedValue(updated.items)) {
    throw new Error('المدفوع يتجاوز قيمة الكمية المستلمة فعليًا')
  }

  db.prepare('UPDATE purchases SET status = ? WHERE id = ?').run(status, purchaseId)
  updateSupplierCreditForReceipt(db, purchase.purchase, updated.items)

  return getPurchaseWithItems(db, purchaseId)
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
    const requestedStatus = normalizeStatus(input.status)
    const lines = input.items.map(normalizeLine)
    validateProductReferences(db, lines)
    const total = totalOf(lines)
    const paid = roundMoney(requireFinite(input.paid ?? 0, 'المدفوع غير صالح'))
    if (paid < 0 || paid > total) {
      throw new Error(`المدفوع (${paid}) خارج المجال 0..${total}`)
    }

    const wantsReceive = requestedStatus === 'received'
    const hasInitialReceived = lines.some((line) => line.received_quantity > 0)
    if (!wantsReceive && hasInitialReceived) {
      throw new Error('لا يمكن تحديد كمية مستلمة لأمر غير مستلم')
    }
    if (!wantsReceive && paid > 0) {
      throw new Error('لا يمكن تسجيل دفعة قبل أول استلام فعلي')
    }

    const receiveTargets = wantsReceive
      ? lines.map((line, index) => ({
          product_id: line.product_id,
          received_quantity:
            input.items[index].received_quantity === undefined
              ? line.quantity
              : line.received_quantity
        }))
      : undefined
    const initialReceivedValue = receiveTargets
      ? roundMoney(
          receiveTargets.reduce((sum, target, index) => sum + target.received_quantity * lines[index].unit_cost, 0)
        )
      : 0
    if (wantsReceive && paid > initialReceivedValue) {
      throw new Error('المدفوع يتجاوز قيمة الكمية المستلمة فعليًا')
    }

    const reference = input.reference?.trim() || `PO-${String(
      (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM purchases').get() as { n: number }).n
    ).padStart(6, '0')}`
    const result = db
      .prepare(
        `INSERT INTO purchases (
          supplier_id, supplier_name, reference, total, paid, status,
          purchase_date, notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.supplier_id ?? null,
        input.supplier_name ?? null,
        reference,
        total,
        paid,
        wantsReceive ? 'pending' : requestedStatus,
        input.purchase_date ?? nowIso(),
        input.notes ?? null,
        nowIso()
      )
    const purchaseId = Number(result.lastInsertRowid)

    // تُحفظ الكمية المستلمة صفرًا ثم تُطبق عبر مسار الاستلام الذري.
    insertLines(
      db,
      purchaseId,
      lines.map((line) => ({ ...line, received_quantity: 0 }))
    )

    let finalPurchase: PurchaseWithItems
    if (wantsReceive) {
      finalPurchase = receivePurchaseItems(db, purchaseId, receiveTargets)
    } else {
      finalPurchase = getPurchaseWithItems(db, purchaseId)
    }

    writeAudit(db, {
      userId: actor?.userId ?? null,
      action: 'purchase.create',
      entityType: 'purchases',
      entityId: purchaseId,
      meta: { reference, total, status: finalPurchase.purchase.status }
    })
    return finalPurchase
  })
  return run()
}

const SCALAR_ALLOWED = ['supplier_name', 'purchase_date', 'notes'] as const

function receiptTargetsFromLines(lines: NewPurchaseItem[]): ReceiptTarget[] {
  return lines.map((line) => ({
    product_id: line.product_id ?? null,
    received_quantity: line.received_quantity ?? line.quantity
  }))
}

export function updatePurchase(
  db: Db,
  id: number,
  patch: PurchasePatch,
  actor?: ActorRef
): PurchaseWithItems {
  const run = db.transaction((): PurchaseWithItems => {
    const existing = getPurchaseWithItems(db, id)
    if (existing.purchase.status === 'cancelled') {
      throw new Error('لا يمكن تعديل أمر شراء ملغى')
    }

    const existingReceivedValue = receivedValue(existing.items)
    const statusBefore = normalizeStatus(existing.purchase.status)

    if (patch.supplier_id !== undefined && patch.supplier_id !== existing.purchase.supplier_id) {
      if (statusBefore !== 'draft' && statusBefore !== 'pending') {
        throw new Error('لا يمكن تغيير المورد بعد بدء الاستلام')
      }
      if (existing.purchase.paid > 0 || existingReceivedValue > 0) {
        throw new Error('لا يمكن تغيير المورد بعد وجود حركة مالية أو استلام')
      }
      if (patch.supplier_id != null) getSupplier(db, patch.supplier_id)
      db.prepare('UPDATE purchases SET supplier_id = ? WHERE id = ?').run(patch.supplier_id, id)
    }

    const scalarKeys = SCALAR_ALLOWED.filter((key) => patch[key] !== undefined)
    if (scalarKeys.length > 0) {
      const { clause, values } = buildSetClause(patch as Record<string, unknown>, SCALAR_ALLOWED)
      db.prepare(`UPDATE purchases SET ${clause} WHERE id = ?`).run(...values, id)
    }

    const wantsReceive = patch.receive === true || patch.status === 'received' || patch.received_items !== undefined
    let receiptTargets: ReceiptTarget[] | undefined
    if (patch.received_items !== undefined) {
      receiptTargets = patch.received_items.map((line) => ({
        product_id: line.product_id ?? null,
        received_quantity: line.received_quantity
      }))
    } else if (wantsReceive && patch.items !== undefined) {
      receiptTargets = receiptTargetsFromLines(patch.items)
    }

    // استبدال بنود الأمر مسموح قبل أول استلام فقط.
    if (patch.items !== undefined && !wantsReceive) {
      if (statusBefore !== 'draft' && statusBefore !== 'pending') {
        throw new Error('لا يمكن استبدال بنود أمر شراء مستلَم أو بدأ استلامه')
      }
      if (patch.items.length === 0) throw new Error('لا يمكن إفراغ بنود أمر الشراء')
      const lines = patch.items.map(normalizeLine)
      if (lines.some((line) => line.received_quantity > 0)) {
        throw new Error('لا يمكن إدخال كمية مستلمة عند استبدال أمر غير مستلم')
      }
      validateProductReferences(db, lines)
      const total = totalOf(lines)
      if (existing.purchase.paid > total) {
        throw new Error(`المدفوع الحالي (${existing.purchase.paid}) يتجاوز الإجمالي الجديد (${total})`)
      }
      db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id)
      insertLines(db, id, lines)
      db.prepare('UPDATE purchases SET total = ? WHERE id = ?').run(total, id)
    }

    if (wantsReceive) {
      const afterReceive = receivePurchaseItems(db, id, receiptTargets)
      // لا يمكن تنفيذ دفعة ضمن نفس الطلب قبل أن تصبح هناك كمية مستلمة.
      if (patch.pay_amount !== undefined) {
        throw new Error('نفّذ الاستلام أولًا ثم سجّل الدفعة في عملية مستقلة')
      }
      writeAudit(db, {
        userId: actor?.userId ?? null,
        action: 'purchase.receive',
        entityType: 'purchases',
        entityId: id,
        meta: { status: afterReceive.purchase.status }
      })
      return afterReceive
    }

    if (patch.status !== undefined) {
      const requestedStatus = normalizeStatus(patch.status)
      if (requestedStatus === 'cancelled') {
        if (statusBefore !== 'draft' && statusBefore !== 'pending') {
          throw new Error('لا يمكن إلغاء أمر بدأ استلامه')
        }
        if (existing.purchase.paid > 0 || existingReceivedValue > 0) {
          throw new Error('لا يمكن إلغاء أمر له حركة مالية أو استلام')
        }
        db.prepare("UPDATE purchases SET status = 'cancelled' WHERE id = ?").run(id)
      } else if (requestedStatus === 'draft' || requestedStatus === 'pending') {
        if (statusBefore !== 'draft' && statusBefore !== 'pending') {
          throw new Error('لا يمكن إعادة أمر مستلم إلى حالة غير مستلم')
        }
        db.prepare('UPDATE purchases SET status = ? WHERE id = ?').run(requestedStatus, id)
      } else if (requestedStatus === 'partially_received') {
        throw new Error('حالة الاستلام الجزئي تُحسب تلقائيًا من الكميات')
      }
    }

    if (patch.pay_amount !== undefined) {
      const amount = requirePositiveMoney(patch.pay_amount, 'مبلغ الدفعة')
      const current = getPurchaseWithItems(db, id)
      if (current.purchase.status === 'draft' || current.purchase.status === 'pending') {
        throw new Error('لا يمكن تسجيل دفعة قبل أول استلام فعلي')
      }
      const newPaid = roundMoney(current.purchase.paid + amount)
      const currentReceivedValue = receivedValue(current.items)
      if (newPaid > currentReceivedValue) {
        throw new Error(
          `المدفوع الجديد (${newPaid}) يتجاوز إجمالي القيمة المستلمة (${currentReceivedValue})`
        )
      }
      db.prepare('UPDATE purchases SET paid = ? WHERE id = ?').run(newPaid, id)
      if (current.purchase.supplier_id != null) {
        addSupplierLedgerEntry(db, {
          supplier_id: current.purchase.supplier_id,
          amount,
          type: 'payment',
          reference: current.purchase.reference,
          purchase_id: id
        })
      }
    }

    const result = getPurchaseWithItems(db, id)
    writeAudit(db, {
      userId: actor?.userId ?? null,
      action: 'purchase.update',
      entityType: 'purchases',
      entityId: id,
      meta: { pay_amount: patch.pay_amount ?? null, status: result.purchase.status }
    })
    return result
  })
  return run()
}

/** حذف أمر لم يبدأ استلامه ولم يسجل عليه دفع. */
export function deletePurchase(db: Db, id: number, actor?: ActorRef): void {
  const existing = getPurchaseWithItems(db, id)
  if (
    existing.purchase.status !== 'draft' &&
    existing.purchase.status !== 'pending'
  ) {
    throw new Error('لا يمكن حذف أمر شراء مستلَم أو بدأ استلامه أو أُلغي')
  }
  if (existing.purchase.paid > 0 || receivedValue(existing.items) > 0) {
    throw new Error('لا يمكن حذف أمر شراء له حركة مالية أو استلام')
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
