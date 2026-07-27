/** مستودع الموردين — نفس نمط العملاء حرفيًا (عقد §7) */
import type { Db } from '../db'
import type { NewSupplier, Supplier, SupplierPatch } from '../../shared/types'
import { buildSetClause, nowIso, requireFound, roundMoney } from './helpers'

const COLS = 'id, name, phone, email, balance, notes, created_at'

export function listSuppliers(db: Db): Supplier[] {
  return db.prepare(`SELECT ${COLS} FROM suppliers ORDER BY id`).all() as Supplier[]
}

export function getSupplier(db: Db, id: number): Supplier {
  return requireFound(
    db.prepare(`SELECT ${COLS} FROM suppliers WHERE id = ?`).get(id) as Supplier | undefined,
    `مورّد غير موجود: ${id}`
  )
}

export function createSupplier(db: Db, input: NewSupplier): Supplier {
  if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('اسم المورّد مطلوب')
  }
  const result = db
    .prepare(
      `INSERT INTO suppliers (name, phone, email, balance, notes, created_at)
       VALUES (@name, @phone, @email, @balance, @notes, @created_at)`
    )
    .run({
      name: input.name.trim(),
      phone: input.phone ?? null,
      email: input.email ?? null,
      balance: roundMoney(input.balance ?? 0),
      notes: input.notes ?? null,
      created_at: nowIso()
    })
  return getSupplier(db, Number(result.lastInsertRowid))
}

const UPDATE_ALLOWED = ['name', 'phone', 'email', 'balance', 'notes'] as const

export function updateSupplier(db: Db, id: number, patch: SupplierPatch): Supplier {
  getSupplier(db, id)
  const { clause, values } = buildSetClause(patch as Record<string, unknown>, UPDATE_ALLOWED)
  db.prepare(`UPDATE suppliers SET ${clause} WHERE id = ?`).run(...values, id)
  return getSupplier(db, id)
}

/** حذف صلب — قيود الدفتر تتبعه CASCADE بقرار مخطط المرحلة 1 */
export function deleteSupplier(db: Db, id: number): void {
  getSupplier(db, id)
  const run = db.transaction(() => {
    db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
  })
  run()
}
