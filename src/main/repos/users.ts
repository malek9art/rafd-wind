/**
 * مستودع المستخدمين (app_users) — المرحلة 2.
 * قواعد أمنية مقصودة:
 *  - pin_hash لا يخرج أبدًا من العملية الرئيسية (الأعمدة الآمنة فقط في list/get/login).
 *  - الأدوار (role) حقل بيانات بسيط — لا طبقة صلاحيات في هذه المرحلة (نص التكليف).
 *  - login موحَّد الرسالة للفشل (لا يكشف هل المستخدم موجود أم PIN خاطئ).
 */
import type { Db } from '../db'
import { hashPin, verifyPin } from '../pin'
import type { AppUser, NewUser, UserPatch } from '../../shared/types'
import { buildSetClause, nowIso, requireFound } from './helpers'
import { setCurrentUser } from '../session'

const SAFE_COLS = 'id, full_name, role, phone, status, avatar_url, created_at, updated_at'

export function listUsers(db: Db): AppUser[] {
  return db.prepare(`SELECT ${SAFE_COLS} FROM app_users ORDER BY id`).all() as AppUser[]
}

export function getUser(db: Db, id: number): AppUser {
  return requireFound(
    db.prepare(`SELECT ${SAFE_COLS} FROM app_users WHERE id = ?`).get(id) as AppUser | undefined,
    `مستخدم غير موجود: ${id}`
  )
}

export function createUser(db: Db, input: NewUser): AppUser {
  if (!input.full_name || typeof input.full_name !== 'string' || !input.full_name.trim()) {
    throw new Error('اسم المستخدم مطلوب')
  }
  // hashPin يرمي برسالة عربية واضحة لو الشكل غير صالح
  const pinHash = input.pin ? hashPin(input.pin) : null
  const result = db
    .prepare(
      `INSERT INTO app_users (full_name, role, phone, status, avatar_url, pin_hash, created_at, updated_at)
       VALUES (@full_name, @role, @phone, @status, @avatar_url, @pin_hash, @created_at, @updated_at)`
    )
    .run({
      full_name: input.full_name.trim(),
      role: input.role?.trim() || 'cashier',
      phone: input.phone ?? null,
      status: input.status?.trim() || 'active',
      avatar_url: input.avatar_url ?? null,
      pin_hash: pinHash,
      created_at: nowIso(),
      updated_at: nowIso()
    })
  return getUser(db, Number(result.lastInsertRowid))
}

const SCALAR_ALLOWED = ['full_name', 'role', 'phone', 'status', 'avatar_url'] as const

export function updateUser(db: Db, id: number, patch: UserPatch): AppUser {
  getUser(db, id)
  const { clause, values } = buildSetClause(patch as Record<string, unknown>, SCALAR_ALLOWED)
  const sets: string[] = clause ? [clause] : []
  const params: unknown[] = [...values]
  // PIN جديد غير فارغ يعاد تجزئته؛ الفارغ/غير الممرَّر لا يمسّ الحالي
  if (patch.pin) {
    sets.push('pin_hash = ?')
    params.push(hashPin(patch.pin))
  }
  if (sets.length === 0) throw new Error('لا توجد حقول صالحة للتحديث')
  db.prepare(`UPDATE app_users SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(
    ...params,
    nowIso(),
    id
  )
  return getUser(db, id)
}

export function deleteUser(db: Db, id: number): void {
  getUser(db, id)
  db.prepare('DELETE FROM app_users WHERE id = ?').run(id)
}

/**
 * تسجيل دخول: مطابقة بالاسم الكامل أو الهاتف + تحقق PIN (scrypt).
 * عند النجاح يُحدَّث «المستخدم النشط» في الجلسة (session.ts).
 */
export function loginUser(db: Db, identifier: string, pin: string): AppUser {
  const row = db
    .prepare(
      `SELECT ${SAFE_COLS}, pin_hash FROM app_users
       WHERE (full_name = ? OR phone = ?) AND status = 'active'
       ORDER BY id LIMIT 1`
    )
    .get(identifier, identifier) as (AppUser & { pin_hash: string | null }) | undefined

  if (!row || !row.pin_hash || !verifyPin(pin, row.pin_hash)) {
    throw new Error('بيانات الدخول غير صحيحة')
  }
  const user: AppUser = {
    id: row.id,
    full_name: row.full_name,
    role: row.role,
    phone: row.phone,
    status: row.status,
    avatar_url: row.avatar_url,
    created_at: row.created_at,
    updated_at: row.updated_at
  }
  setCurrentUser(user)
  return user
}

/** يُستخدم في اختبارات التنظيف فقط */
export function _logout(): void {
  setCurrentUser(null)
}
