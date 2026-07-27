/**
 * نظام الترخيص — المرحلة 3 (الوثيقة §8 كاملًا):
 *
 * - مفتاح موقَّع بـEd25519: RAFD1.<base64url(payload)>.<base64url(signature)>
 *   التحقق محلي بالكامل بالمفتاح العام الإنتاجي المضمَّن (license-public-key.ts) (§8.1).
 * - بصمة الجهاز فعلية (§8.2): حقل device_binding في الحمولة، إن وُجد، يُطابَق مع
 *   بصمة الجهاز الحالية؛ عدم التطابق = رفض صريح. غياب الحقل = ترخيص غير مربوط.
 * - دورة الحياة (§8.3): التحقق لم يعد «صالح/غير صالح» فقط —
 *     • صالح: عمل طبيعي (flags كلها false).
 *     • قارب على الانتهاء (نافذة 7 أيام): expiring_soon=true — تنبيه غير مانع.
 *     • منتهٍ: التحقق ينجح مع expired=true — **قفل الكتابة فقط** عبر
 *       license-gate.ts (القراءة حرة دائمًا).
 *     • توقيع/بنية/ربط فاسد: ok=false — منع الدخول الكامل من البداية (كما كان).
 * - حالة الترخيص لا تُقرأ كقيمة خام مخزَّنة؛ يُعاد التحقق توقيعيًا عند كل تشغيل (§11).
 *
 * خيار publicKeyBase64 ثغرة حقن ضيقة مقصودة للاختبارات فقط (زوج مفاتيح عابر)،
 * ولا تستعمله أي شفرة إنتاج — الإنتاج يختزل دائمًا للمفتاح المضمَّن.
 */
import { createPublicKey, verify } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { EMBEDDED_PUBLIC_KEY_SPKI_BASE64 } from './license-public-key'
import { getDeviceFingerprint } from './device-fingerprint'
import type { LicenseInfo, LicensePlan, LicenseStatus } from '../shared/types'

export const LICENSE_KEY_PREFIX = 'RAFD1'

/** نافذة «قارب على الانتهاء» بالأيام قبل expires_at (§8.3) */
export const EXPIRING_SOON_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

interface LicensePayload {
  v: 1
  license_id: string
  plan: LicensePlan
  customer: string
  issued_at: string
  expires_at: string
  device_binding?: string | null
}

export interface VerifyOptions {
  /** لحظة التقييم (حقن زمن صريح للاختبارات) */
  now?: Date
  /** تجاوز المفتاح العام المضمَّن — للاختبارات فقط، لا يُمرَّر من شفرة إنتاج */
  publicKeyBase64?: string
  /** حلّال بصمة الجهاز — يُستدعى كسولًا فقط لو كانت الحمولة مربوطة بجهاز */
  resolveFingerprint?: () => string
}

export type VerifySuccess = {
  ok: true
  info: LicenseInfo
  /** انتهى — يبقى نجاح تحقق ليفتح التطبيق للقراءة؛ قفل الكتابة عبر البوابة */
  expired: boolean
  /** ضمن نافذة EXPIRING_SOON_DAYS قبل الانتهاء — تنبيه غير مانع */
  expiring_soon: boolean
  /** أيام صحيحة موجبة متبقية، أو سالبة بعدد أيام الانتهاء المنقضية */
  days_left: number
}

export type VerifyResult = VerifySuccess | { ok: false; error: string }

const VALID_PLANS: readonly string[] = ['trial', 'starter', 'pro']

export function verifyLicenseKey(key: string, options: VerifyOptions = {}): VerifyResult {
  const now = options.now ?? new Date()
  const trimmed = key.trim()
  const parts = trimmed.split('.')
  if (parts.length !== 3 || parts[0] !== LICENSE_KEY_PREFIX) {
    return { ok: false, error: 'صيغة المفتاح غير صحيحة' }
  }
  const payloadB64 = parts[1]
  const signatureB64 = parts[2]
  if (!payloadB64 || !signatureB64) {
    return { ok: false, error: 'صيغة المفتاح غير صحيحة' }
  }

  let payloadBytes: Buffer
  let signatureBytes: Buffer
  try {
    payloadBytes = Buffer.from(payloadB64, 'base64url')
    signatureBytes = Buffer.from(signatureB64, 'base64url')
  } catch {
    return { ok: false, error: 'ترميز المفتاح تالف' }
  }

  // التحقق التشفيري أولًا: لا نثق بمحتوى الحمولة قبل إثبات التوقيع
  const publicKey = createPublicKey({
    key: Buffer.from(options.publicKeyBase64 ?? EMBEDDED_PUBLIC_KEY_SPKI_BASE64, 'base64'),
    format: 'der',
    type: 'spki'
  })
  let signatureValid: boolean
  try {
    signatureValid = verify(null, payloadBytes, publicKey, signatureBytes)
  } catch {
    return { ok: false, error: 'تعذّر التحقق من المفتاح' }
  }
  if (!signatureValid) {
    return { ok: false, error: 'المفتاح غير موقَّع من جهة الإصدار، أو عدِّل محتواه' }
  }

  let payload: LicensePayload
  try {
    payload = JSON.parse(payloadBytes.toString('utf8')) as LicensePayload
  } catch {
    return { ok: false, error: 'محتوى المفتاح تالف' }
  }

  if (payload.v !== 1) return { ok: false, error: 'إصدار مفتاح غير مدعوم' }
  if (!payload.license_id || !payload.customer) {
    return { ok: false, error: 'بيانات الترخيص ناقصة' }
  }
  if (!VALID_PLANS.includes(payload.plan)) {
    return { ok: false, error: 'باقة الترخيص غير معروفة' }
  }

  const expiresAt = Date.parse(payload.expires_at)
  if (Number.isNaN(expiresAt)) {
    return { ok: false, error: 'تاريخ انتهاء الترخيص غير صالح' }
  }

  // بصمة الجهاز (§8.2): وجود device_binding يعني ترخيصًا مربوطًا — طابِق أو ارفض.
  // غياب الحقل = ترخيص غير مربوط بجهاز، فلا فحص إطلاقًا (ولا استدعاء بصمة).
  const binding = payload.device_binding?.trim()
  if (binding) {
    let current: string | null = null
    try {
      current = options.resolveFingerprint
        ? options.resolveFingerprint()
        : getDeviceFingerprint()
    } catch {
      current = null
    }
    if (!current) {
      return { ok: false, error: 'تعذّرت قراءة بصمة هذا الجهاز لمطابقة الترخيص المربوط' }
    }
    if (current !== binding) {
      return { ok: false, error: 'هذا الترخيص مربوط بجهاز آخر — تواصل مع الإدارة لإعادة الربط' }
    }
  }

  // دورة الحياة (§8.3): الانتهاء لم يعد فشل تحقق — يُحسب أعلامًا تُفسَّر في البوابة والواجهة
  const msLeft = expiresAt - now.getTime()
  const expired = msLeft < 0
  const daysLeft = Math.ceil(msLeft / DAY_MS)

  const info: LicenseInfo = {
    license_id: payload.license_id,
    plan: payload.plan as LicensePlan,
    customer: payload.customer,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at
  }
  return {
    ok: true,
    info,
    expired,
    expiring_soon: !expired && msLeft <= EXPIRING_SOON_DAYS * DAY_MS,
    days_left: daysLeft
  }
}

/** ملف حفظ مفتاح التفعيل داخل userData (يُعاد التحقق منه توقيعيًا عند كل تشغيل — §11) */
export function licenseFilePath(userDataDir: string): string {
  return join(userDataDir, 'license.json')
}

export function saveActivatedLicense(userDataDir: string, key: string, info: LicenseInfo): void {
  mkdirSync(userDataDir, { recursive: true })
  writeFileSync(
    licenseFilePath(userDataDir),
    JSON.stringify({ key: key.trim(), info }, null, 2),
    'utf8'
  )
}

export type LoadOptions = VerifyOptions

export function loadLicenseStatus(userDataDir: string, options: LoadOptions = {}): LicenseStatus {
  const file = licenseFilePath(userDataDir)
  if (!existsSync(file)) return { activated: false, reason: 'لا يوجد ترخيص مُفعَّل' }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { key?: string }
    if (!raw.key) return { activated: false, reason: 'ملف الترخيص تالف' }
    const result = verifyLicenseKey(raw.key, options)
    if (!result.ok) {
      // مفتاح مخزَّن غير صالح/تالف/معدَّل/مربوط بجهاز آخر = منع دخول كامل (§8.3)
      return { activated: false, reason: result.error }
    }
    const { info, expired, expiring_soon, days_left } = result
    return { activated: true, info, expired, expiring_soon, days_left }
  } catch {
    return { activated: false, reason: 'تعذّرت قراءة ملف الترخيص' }
  }
}

export function clearActivatedLicense(userDataDir: string): void {
  rmSync(licenseFilePath(userDataDir), { force: true })
}
