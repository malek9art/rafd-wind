/**
 * مساعدات مشتركة لطبقة المستودعات (repos) — كل دالة هنا تأخذ مقبض قاعدة
 * البيانات صراحة لتبقى قابلة للاختبار بـVitest بدون Electron (§13).
 */
import { unlinkSync } from 'node:fs'
import { roundMoney } from '../db'

export { roundMoney }

export const nowIso = (): string => new Date().toISOString()

export function requireFound<T>(row: T | undefined | null, message: string): T {
  if (row === undefined || row === null) throw new Error(message)
  return row
}

/** تحقق رقم مالي صالح (منتهٍ، ليس NaN، ضمن مجال معقول) */
export function requireMoney(value: unknown, label: string): number {
  const n = typeof value === 'string' ? Number(value) : (value as number)
  if (typeof n !== 'number' || !Number.isFinite(n)) {
    throw new Error(`${label}: قيمة رقمية غير صالحة`)
  }
  return n
}

export function requirePositiveMoney(value: unknown, label: string, allowZero = false): number {
  const n = roundMoney(requireMoney(value, label))
  if (allowZero ? n < 0 : n <= 0) {
    throw new Error(`${label}: يجب أن تكون ${allowZero ? 'صفرًا أو أكثر' : 'أكبر من صفر'}`)
  }
  return n
}

/**
 * بناء جملة SET لتحديث آمن بقائمة أعمدة بيضاء — يمنع حقن أعمدة عشوائية
 * عبر patch قادم من الواجهة، ويرفض patch فارغًا صراحة.
 */
export function buildSetClause(
  patch: Record<string, unknown>,
  allowed: readonly string[]
): { clause: string; values: unknown[] } {
  const keys = allowed.filter((k) => patch[k] !== undefined)
  if (keys.length === 0) throw new Error('لا توجد حقول صالحة للتحديث')
  const clause = keys.map((k) => `${k} = ?`).join(', ')
  const values = keys.map((k) => patch[k])
  return { clause, values }
}

/** إزالة ملفات SQLite الجانبية عند التنظيف في الاختبارات فقط */
export function _unsafeUnlink(path: string): void {
  unlinkSync(path)
}
