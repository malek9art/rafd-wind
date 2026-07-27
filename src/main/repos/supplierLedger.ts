/**
 * دفتر الموردين — نفس نمط دفتر العملاء حرفيًا بـ purchase_credit بدل sale_credit:
 *   purchase_credit → balance += amount   (دين جديد لصالح المورّد)
 *   payment         → balance = max(0, -)  (سداد يخفض الدين، بحد أدنى صفر)
 *   adjustment      → balance = amount     (تعيين مطلق)
 * معاملة ذرّية واحدة (تحسين محلي مقصود).
 */
import type { Db } from '../db'
import type {
  NewSupplierLedgerEntry,
  SupplierLedgerEntry,
  SupplierLedgerEntryType
} from '../../shared/types'
import { getSupplier } from './suppliers'
import { nowIso, requireFound, requirePositiveMoney, roundMoney } from './helpers'

const VALID_TYPES: readonly SupplierLedgerEntryType[] = ['purchase_credit', 'payment', 'adjustment']
const COLS =
  'id, supplier_id, type, amount, balance_after, reference, notes, purchase_id, created_at'

export function listLedgerBySupplier(db: Db, supplierId: number): SupplierLedgerEntry[] {
  return db
    .prepare(`SELECT ${COLS} FROM supplier_ledger WHERE supplier_id = ? ORDER BY id`)
    .all(supplierId) as SupplierLedgerEntry[]
}

function getEntry(db: Db, id: number): SupplierLedgerEntry {
  return requireFound(
    db.prepare(`SELECT ${COLS} FROM supplier_ledger WHERE id = ?`).get(id) as
      | SupplierLedgerEntry
      | undefined,
    `قيد غير موجود: ${id}`
  )
}

export function addSupplierLedgerEntry(db: Db, input: NewSupplierLedgerEntry): SupplierLedgerEntry {
  if (!VALID_TYPES.includes(input.type)) {
    throw new Error(`نوع قيد غير معروف: ${input.type}`)
  }
  const allowZero = input.type === 'adjustment'
  const amount = requirePositiveMoney(input.amount, 'مبلغ القيد', allowZero)

  const run = db.transaction((): SupplierLedgerEntry => {
    const supplier = getSupplier(db, input.supplier_id)
    let newBalance: number
    switch (input.type) {
      case 'purchase_credit':
        newBalance = roundMoney(supplier.balance + amount)
        break
      case 'payment':
        newBalance = roundMoney(Math.max(0, supplier.balance - amount))
        break
      case 'adjustment':
        newBalance = amount
        break
    }
    db.prepare('UPDATE suppliers SET balance = ? WHERE id = ?').run(newBalance, supplier.id)
    const result = db
      .prepare(
        `INSERT INTO supplier_ledger (supplier_id, type, amount, balance_after, reference, notes, purchase_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        supplier.id,
        input.type,
        amount,
        newBalance,
        input.reference ?? null,
        input.notes ?? null,
        input.purchase_id ?? null,
        nowIso()
      )
    return getEntry(db, Number(result.lastInsertRowid))
  })
  return run()
}
