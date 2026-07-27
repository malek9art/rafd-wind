/**
 * آلية تخزين PIN للمستخدمين المحليين (app_users، خريطة §6) — قرار موثَّق:
 *
 * - الخوارزمية: **scrypt** (node:crypto المدمج). مبررات الاختيار:
 *   1. صفر اعتماديات جديدة — مبدأ «أوفلاين أول» يفضّل المدمج على مكتبة أصلية ثالثة (argon2 مثلًا).
 *   2. خوارزمية memory-hard موصى بها معياريًا لتخزين أسرار قصيرة (OWASP Password Storage Cheat Sheet).
 * - المعاملات: N=16384, r=8, p=1, keylen=64 — حد OWASP الأدنى لـscrypt؛
 *   كلفة ذاكرة ~16MB وزمن ~50-100ms على جهاز كاشير عادي (مقبول لحدث دخول، مرهق لهجوم تخمين).
 * - salt: عشوائي 128-بت مستقل لكل مستخدم (randomBytes(16)) — لا إعادة استخدام.
 * - صيغة التخزين الذاتية الوصف: scrypt$N$r$p$salt_b64$hash_b64
 *   (تسمح برفع المعاملات مستقبلًا بترقية schema هادئة دون كسر المخزَّن القديم).
 * - التحقق: اشتقاق بنفس المعاملات + مقارنة بتوقيت ثابت (timingSafeEqual) — لا إرجاع مبكر.
 * - شكل PIN المقبول: أرقام فقط، 4 إلى 12 خانة (كاشير + شاشة لمس).
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const KEYLEN = 64
const SALT_BYTES = 16

export const PIN_PATTERN = /^\d{4,12}$/

export function hashPin(pin: string): string {
  if (!PIN_PATTERN.test(pin)) {
    throw new Error('PIN يجب أن يكون أرقامًا فقط، من 4 إلى 12 خانة')
  }
  const salt = randomBytes(SALT_BYTES)
  const hash = scryptSync(pin, salt, KEYLEN, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('base64')}$${hash.toString('base64')}`
}

export function verifyPin(pin: string, stored: string): boolean {
  if (typeof pin !== 'string' || typeof stored !== 'string') return false
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!N || !r || !p) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(parts[4], 'base64')
    expected = Buffer.from(parts[5], 'base64')
  } catch {
    return false
  }
  if (salt.length === 0 || expected.length === 0) return false
  const derived = scryptSync(pin, salt, expected.length, { N, r, p })
  return timingSafeEqual(derived, expected)
}
