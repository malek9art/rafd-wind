/**
 * مستودعات CRUD البسيطة: المصروفات والحسابات البنكية والطرفيات —
 * بلا منطق أعمال إضافي (نص التكليف §6-8).
 */
import type { Db } from '../db'
import type {
  BankAccount,
  BankAccountPatch,
  Expense,
  ExpensePatch,
  NewBankAccount,
  NewExpense,
  NewPaymentTerminal,
  PaymentTerminal,
  PaymentTerminalPatch
} from '../../shared/types'
import { buildSetClause, nowIso, requireFound, roundMoney } from './helpers'

/* ------------------------------ مصروفات ------------------------------ */

const EXPENSE_COLS = 'id, category, amount, description, payment_method, expense_date, created_at'

export function listExpenses(db: Db): Expense[] {
  return db.prepare(`SELECT ${EXPENSE_COLS} FROM expenses ORDER BY id`).all() as Expense[]
}

export function getExpense(db: Db, id: number): Expense {
  return requireFound(
    db.prepare(`SELECT ${EXPENSE_COLS} FROM expenses WHERE id = ?`).get(id) as Expense | undefined,
    `مصروف غير موجود: ${id}`
  )
}

export function createExpense(db: Db, input: NewExpense): Expense {
  if (!input.category?.trim()) throw new Error('تصنيف المصروف مطلوب')
  if (!(input.amount > 0)) throw new Error('مبلغ المصروف يجب أن يكون أكبر من صفر')
  const result = db
    .prepare(
      `INSERT INTO expenses (category, amount, description, payment_method, expense_date, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.category.trim(),
      roundMoney(input.amount),
      input.description ?? null,
      input.payment_method ?? 'cash',
      input.expense_date ?? nowIso().slice(0, 10),
      nowIso()
    )
  return getExpense(db, Number(result.lastInsertRowid))
}

const EXPENSE_ALLOWED = ['category', 'amount', 'description', 'payment_method', 'expense_date'] as const

export function updateExpense(db: Db, id: number, patch: ExpensePatch): Expense {
  getExpense(db, id)
  const { clause, values } = buildSetClause(patch as Record<string, unknown>, EXPENSE_ALLOWED)
  db.prepare(`UPDATE expenses SET ${clause} WHERE id = ?`).run(...values, id)
  return getExpense(db, id)
}

export function deleteExpense(db: Db, id: number): void {
  getExpense(db, id)
  db.prepare('DELETE FROM expenses WHERE id = ?').run(id)
}

/* ------------------------------ حسابات بنكية ------------------------------ */

const BANK_COLS =
  'id, bank_name, account_name, account_number, iban, currency, is_active, notes, created_at'

export function listBankAccounts(db: Db): BankAccount[] {
  return db.prepare(`SELECT ${BANK_COLS} FROM bank_accounts ORDER BY id`).all() as BankAccount[]
}

export function getBankAccount(db: Db, id: number): BankAccount {
  return requireFound(
    db.prepare(`SELECT ${BANK_COLS} FROM bank_accounts WHERE id = ?`).get(id) as
      | BankAccount
      | undefined,
    `حساب بنكي غير موجود: ${id}`
  )
}

export function createBankAccount(db: Db, input: NewBankAccount): BankAccount {
  if (!input.bank_name?.trim()) throw new Error('اسم البنك مطلوب')
  if (!input.account_name?.trim()) throw new Error('اسم الحساب مطلوب')
  const result = db
    .prepare(
      `INSERT INTO bank_accounts (bank_name, account_name, account_number, iban, currency, is_active, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.bank_name.trim(),
      input.account_name.trim(),
      input.account_number ?? null,
      input.iban ?? null,
      input.currency ?? 'YER',
      input.is_active === undefined ? 1 : input.is_active ? 1 : 0,
      input.notes ?? null,
      nowIso()
    )
  return getBankAccount(db, Number(result.lastInsertRowid))
}

const BANK_ALLOWED = [
  'bank_name',
  'account_name',
  'account_number',
  'iban',
  'currency',
  'is_active',
  'notes'
] as const

export function updateBankAccount(db: Db, id: number, patch: BankAccountPatch): BankAccount {
  getBankAccount(db, id)
  const normalized: Record<string, unknown> = { ...patch }
  if (patch.is_active !== undefined) normalized.is_active = patch.is_active ? 1 : 0
  const { clause, values } = buildSetClause(normalized, BANK_ALLOWED)
  db.prepare(`UPDATE bank_accounts SET ${clause} WHERE id = ?`).run(...values, id)
  return getBankAccount(db, id)
}

/** حذف حساب له فواتير محوّلة يُفرِغ مرجعها تلقائيًا (SET NULL من المرحلة 1) */
export function deleteBankAccount(db: Db, id: number): void {
  getBankAccount(db, id)
  db.prepare('DELETE FROM bank_accounts WHERE id = ?').run(id)
}

/* ------------------------------ طرفيات دفع ------------------------------ */

const TERMINAL_COLS =
  'id, name, provider, terminal_id, connection_type, is_active, supports_contactless, notes, created_at'

export function listPaymentTerminals(db: Db): PaymentTerminal[] {
  return db.prepare(`SELECT ${TERMINAL_COLS} FROM payment_terminals ORDER BY id`).all() as PaymentTerminal[]
}

export function getPaymentTerminal(db: Db, id: number): PaymentTerminal {
  return requireFound(
    db.prepare(`SELECT ${TERMINAL_COLS} FROM payment_terminals WHERE id = ?`).get(id) as
      | PaymentTerminal
      | undefined,
    `طرفية غير موجودة: ${id}`
  )
}

export function createPaymentTerminal(db: Db, input: NewPaymentTerminal): PaymentTerminal {
  if (!input.name?.trim()) throw new Error('اسم الطرفية مطلوب')
  const result = db
    .prepare(
      `INSERT INTO payment_terminals (name, provider, terminal_id, connection_type, is_active, supports_contactless, notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.name.trim(),
      input.provider ?? 'generic',
      input.terminal_id ?? null,
      input.connection_type ?? 'network',
      input.is_active === undefined ? 1 : input.is_active ? 1 : 0,
      input.supports_contactless ? 1 : 0,
      input.notes ?? null,
      nowIso()
    )
  return getPaymentTerminal(db, Number(result.lastInsertRowid))
}

const TERMINAL_ALLOWED = [
  'name',
  'provider',
  'terminal_id',
  'connection_type',
  'is_active',
  'supports_contactless',
  'notes'
] as const

export function updatePaymentTerminal(
  db: Db,
  id: number,
  patch: PaymentTerminalPatch
): PaymentTerminal {
  getPaymentTerminal(db, id)
  const normalized: Record<string, unknown> = { ...patch }
  if (patch.is_active !== undefined) normalized.is_active = patch.is_active ? 1 : 0
  if (patch.supports_contactless !== undefined)
    normalized.supports_contactless = patch.supports_contactless ? 1 : 0
  const { clause, values } = buildSetClause(normalized, TERMINAL_ALLOWED)
  db.prepare(`UPDATE payment_terminals SET ${clause} WHERE id = ?`).run(...values, id)
  return getPaymentTerminal(db, id)
}

export function deletePaymentTerminal(db: Db, id: number): void {
  getPaymentTerminal(db, id)
  db.prepare('DELETE FROM payment_terminals WHERE id = ?').run(id)
}
