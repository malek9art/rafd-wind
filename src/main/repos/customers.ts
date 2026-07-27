/** مستودع العملاء — CRUD بسيط، المنطق المالي في customerLedger (عقد §7) */
import type { Db } from '../db'
import type { Customer, CustomerPatch, NewCustomer } from '../../shared/types'
import { buildSetClause, nowIso, requireFound, roundMoney } from './helpers'

const COLS = 'id, name, phone, email, balance, total_purchases, notes, created_at'

export function listCustomers(db: Db): Customer[] {
  return db.prepare(`SELECT ${COLS} FROM customers ORDER BY id`).all() as Customer[]
}

export function getCustomer(db: Db, id: number): Customer {
  return requireFound(
    db.prepare(`SELECT ${COLS} FROM customers WHERE id = ?`).get(id) as Customer | undefined,
    `عميل غير موجود: ${id}`
  )
}

export function createCustomer(db: Db, input: NewCustomer): Customer {
  if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('اسم العميل مطلوب')
  }
  const result = db
    .prepare(
      `INSERT INTO customers (name, phone, email, balance, total_purchases, notes, created_at)
       VALUES (@name, @phone, @email, @balance, @total_purchases, @notes, @created_at)`
    )
    .run({
      name: input.name.trim(),
      phone: input.phone ?? null,
      email: input.email ?? null,
      balance: roundMoney(input.balance ?? 0),
      total_purchases: roundMoney(input.total_purchases ?? 0),
      notes: input.notes ?? null,
      created_at: nowIso()
    })
  return getCustomer(db, Number(result.lastInsertRowid))
}

const UPDATE_ALLOWED = ['name', 'phone', 'email', 'balance', 'total_purchases', 'notes'] as const

export function updateCustomer(db: Db, id: number, patch: CustomerPatch): Customer {
  getCustomer(db, id)
  const { clause, values } = buildSetClause(patch as Record<string, unknown>, UPDATE_ALLOWED)
  db.prepare(`UPDATE customers SET ${clause} WHERE id = ?`).run(...values, id)
  return getCustomer(db, id)
}

/** حذف صلب — قيود الدفتر تتبعه CASCADE بقرار مخطط المرحلة 1 */
export function deleteCustomer(db: Db, id: number): void {
  getCustomer(db, id)
  const run = db.transaction(() => {
    db.prepare('DELETE FROM customers WHERE id = ?').run(id)
  })
  run()
}
