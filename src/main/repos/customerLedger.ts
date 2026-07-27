/**
 * دفتر العملاء — المنطق المنقول حرفيًا:
 *   sale_credit → balance += amount        (دين جديد على العميل)
 *   payment     → balance = max(0, -)       (سداد يخفض الدين، بحد أدنى صفر)
 *   adjustment  → balance = amount          (تعيين مطلق)
 * تحسين محلي مقصود (موافق عليه نصًا في التكليف): القيد + تحديث الرصيد في
 * معاملة SQLite واحدة ذرّية — المصدر السحابي كان يكتبهما متتاليين غير ذرّيين.
 */
import type { Db } from '../db'
import type { LedgerEntry, LedgerEntryType, NewLedgerEntry } from '../../shared/types'
import { getCustomer } from './customers'
import { nowIso, requireFound, requirePositiveMoney, roundMoney } from './helpers'

const VALID_TYPES: readonly LedgerEntryType[] = ['sale_credit', 'payment', 'adjustment']
const COLS =
  'id, customer_id, type, amount, balance_after, reference, notes, sale_id, created_at'

export function listLedgerByCustomer(db: Db, customerId: number): LedgerEntry[] {
  return db
    .prepare(`SELECT ${COLS} FROM customer_ledger WHERE customer_id = ? ORDER BY id`)
    .all(customerId) as LedgerEntry[]
}

function getEntry(db: Db, id: number): LedgerEntry {
  return requireFound(
    db.prepare(`SELECT ${COLS} FROM customer_ledger WHERE id = ?`).get(id) as
      | LedgerEntry
      | undefined,
    `قيد غير موجود: ${id}`
  )
}

export function addLedgerEntry(db: Db, input: NewLedgerEntry): LedgerEntry {
  if (!VALID_TYPES.includes(input.type)) {
    throw new Error(`نوع قيد غير معروف: ${input.type}`)
  }
  // sale_credit/payment مبلغ موجب؛ adjustment تعيين مطلق (≥ 0)
  const allowZero = input.type === 'adjustment'
  const amount = requirePositiveMoney(input.amount, 'مبلغ القيد', allowZero)

  const run = db.transaction((): LedgerEntry => {
    const customer = getCustomer(db, input.customer_id)
    let newBalance: number
    switch (input.type) {
      case 'sale_credit':
        newBalance = roundMoney(customer.balance + amount)
        break
      case 'payment':
        newBalance = roundMoney(Math.max(0, customer.balance - amount))
        break
      case 'adjustment':
        newBalance = amount
        break
    }
    db.prepare('UPDATE customers SET balance = ? WHERE id = ?').run(newBalance, customer.id)
    const result = db
      .prepare(
        `INSERT INTO customer_ledger (customer_id, type, amount, balance_after, reference, notes, sale_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        customer.id,
        input.type,
        amount,
        newBalance,
        input.reference ?? null,
        input.notes ?? null,
        input.sale_id ?? null,
        nowIso()
      )
    return getEntry(db, Number(result.lastInsertRowid))
  })
  return run()
}
