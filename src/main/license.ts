/**
 * نظام الترخيص — المرحلة 0 (الوثيقة §8 + خارطة الطريق):
 * - مفتاح موقَّع بـEd25519: RAFD1.<base64url(payload)>.<base64url(signature)>
 * - التحقق محلي بالكامل بمفتاح عام مضمَّن في الكود (license-public-key.ts).
 * - حالة الترخيص لا تُقرأ كقيمة خام مخزَّنة؛ يُعاد التحقق من التوقيع عند كل تشغيل (§11).
 * - المفتاح الخاص في tools/keygen (خارج التطبيق الموزَّع) وأداة CLI الحقيقية في المرحلة 3.
 *
 * تبسيطات المرحلة 0 (تُستكمل في المرحلة 3):
 * - بصمة الجهاز (§8.2) غير مطبَّقة بعد (الحقل device_binding يُقبل لكن لا يُفحص).
 * - المفتاح المنتهي يُعامَل كغير صالح (منع دخول كامل)؛ نمط «قفل الكتابة مع قراءة حرة» (§8.3) لاحقًا.
 */
import { createPublicKey, verify } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { EMBEDDED_PUBLIC_KEY_SPKI_BASE64 } from './license-public-key'
import type { LicenseInfo, LicensePlan, LicenseStatus } from '../shared/types'

export const LICENSE_KEY_PREFIX = 'RAFD1'

interface LicensePayload {
  v: 1
  license_id: string
  plan: LicensePlan
  customer: string
  issued_at: string
  expires_at: string
  device_binding?: string | null
}

export type VerifyResult = { ok: true; info: LicenseInfo } | { ok: false; error: string }

const VALID_PLANS: readonly string[] = ['trial', 'starter', 'pro']

export function verifyLicenseKey(key: string, now: Date = new Date()): VerifyResult {
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
    key: Buffer.from(EMBEDDED_PUBLIC_KEY_SPKI_BASE64, 'base64'),
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
  if (expiresAt <= now.getTime()) {
    // المرحلة 0: المنتهي = غير صالح. المرحلة 3 تطبّق نمط «قفل الكتابة فقط» (§8.3)
    return { ok: false, error: 'انتهت صلاحية هذا الترخيص — تواصل مع الإدارة للتجديد' }
  }

  const info: LicenseInfo = {
    license_id: payload.license_id,
    plan: payload.plan as LicensePlan,
    customer: payload.customer,
    issued_at: payload.issued_at,
    expires_at: payload.expires_at
  }
  return { ok: true, info }
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

export function loadLicenseStatus(userDataDir: string, now: Date = new Date()): LicenseStatus {
  const file = licenseFilePath(userDataDir)
  if (!existsSync(file)) return { activated: false, reason: 'لا يوجد ترخيص مُفعَّل' }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { key?: string }
    if (!raw.key) return { activated: false, reason: 'ملف الترخيص تالف' }
    const result = verifyLicenseKey(raw.key, now)
    if (!result.ok) {
      return { activated: false, reason: result.error }
    }
    return { activated: true, info: result.info }
  } catch {
    return { activated: false, reason: 'تعذّرت قراءة ملف الترخيص' }
  }
}

export function clearActivatedLicense(userDataDir: string): void {
  rmSync(licenseFilePath(userDataDir), { force: true })
}
