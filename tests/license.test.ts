/**
 * اختبارات وحدة لنظام الترخيص — المرحلة 3 (§8 كاملًا).
 * التوقيع فعلي بزوج Ed25519 **عابر** يُولَّد داخل الاختبار ويُحقَن عامُّه عبر
 * publicKeyBase64 — لا اعتماد على أي مفتاح في المستودع (لم يعد له وجود أصلًا).
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  clearActivatedLicense,
  EXPIRING_SOON_DAYS,
  loadLicenseStatus,
  saveActivatedLicense,
  verifyLicenseKey,
  type VerifyOptions
} from '../src/main/license'

const DAY_MS = 24 * 60 * 60 * 1000

let privateKeyPem: string
let publicKeyBase64: string

function signWith(pem: string, payload: Record<string, unknown>): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8')
  const key = createPrivateKey({ key: pem, format: 'pem', type: 'pkcs8' })
  const signature = sign(null, payloadBytes, key)
  return `RAFD1.${payloadBytes.toString('base64url')}.${signature.toString('base64url')}`
}

/** خيارات حقن ثابتة لكل اختبارات الملف (العام العابر) */
let opts: VerifyOptions

const VALID_PAYLOAD = {
  v: 1 as const,
  license_id: 'LIC-TEST-1',
  plan: 'trial' as const,
  customer: 'متجر اختبار الوحدة',
  issued_at: '2026-01-01T00:00:00.000Z',
  expires_at: '2099-12-31T23:59:59.999Z',
  device_binding: null
}

let validKey: string

beforeAll(() => {
  const pair = generateKeyPairSync('ed25519')
  privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  publicKeyBase64 = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' })).toString('base64')
  opts = { publicKeyBase64 }
  validKey = signWith(privateKeyPem, VALID_PAYLOAD)
})

describe('verifyLicenseKey — صالح/قارب/منتهٍ (§8.3)', () => {
  it('يقبل مفتاحًا صالحًا ويعيد بياناته بلا أعلام', () => {
    const result = verifyLicenseKey(validKey, opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.info.license_id).toBe('LIC-TEST-1')
    expect(result.info.plan).toBe('trial')
    expect(result.info.customer).toBe('متجر اختبار الوحدة')
    expect(result.expired).toBe(false)
    expect(result.expiring_soon).toBe(false)
    expect(result.days_left).toBeGreaterThan(1000)
  })

  it('نافذة الاقتراب: علم صحيح ضمن 7 أيام (بيوم/بحد اليوم السابع)، غائب خارجها', () => {
    expect(EXPIRING_SOON_DAYS).toBe(7)
    const now = new Date('2026-07-27T12:00:00.000Z')

    // متبقٍّ 3 أيام → تنبيه غير مانع
    const soon = verifyLicenseKey(
      signWith(privateKeyPem, { ...VALID_PAYLOAD, expires_at: new Date(now.getTime() + 3 * DAY_MS).toISOString() }),
      { ...opts, now }
    )
    expect(soon.ok).toBe(true)
    if (!soon.ok) return
    expect(soon.expired).toBe(false)
    expect(soon.expiring_soon).toBe(true)
    expect(soon.days_left).toBe(3)

    // متبقٍّ 7 أيام بالضبط → ضمن النافذة (≤)
    const boundary = verifyLicenseKey(
      signWith(privateKeyPem, { ...VALID_PAYLOAD, expires_at: new Date(now.getTime() + 7 * DAY_MS).toISOString() }),
      { ...opts, now }
    )
    expect(boundary.ok && boundary.expiring_soon).toBe(true)

    // متبقٍّ 30 يوما → لا تنبيه
    const far = verifyLicenseKey(
      signWith(privateKeyPem, { ...VALID_PAYLOAD, expires_at: new Date(now.getTime() + 30 * DAY_MS).toISOString() }),
      { ...opts, now }
    )
    expect(far.ok).toBe(true)
    if (far.ok) expect(far.expiring_soon).toBe(false)
  })

  it('المنتهي لم يعد فشل تحقق (تغيير جذري §8.3): ok مع expired=true وdays_left سالبة', () => {
    const now = new Date('2026-07-27T12:00:00.000Z')
    const expired = verifyLicenseKey(
      signWith(privateKeyPem, { ...VALID_PAYLOAD, expires_at: '2026-07-25T23:59:59.999Z' }),
      { ...opts, now }
    )
    expect(expired.ok).toBe(true)
    if (!expired.ok) return
    expect(expired.expired).toBe(true)
    expect(expired.expiring_soon).toBe(false)
    expect(expired.days_left).toBe(-1)
    // ولا يزال يحمل بيانات الترخيص ليعرضها التاجر (قراءة تاريخية)
    expect(expired.info.customer).toBe('متجر اختبار الوحدة')
  })
})

describe('verifyLicenseKey — منع دخول كامل للفاسد/المعدَّل (يبقى كما هو)', () => {
  it('يرفض حمولة عُدِّلت بعد التوقيع (عبث)', () => {
    const parts = validKey.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...VALID_PAYLOAD, plan: 'pro' }),
      'utf8'
    ).toString('base64url')
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`
    expect(verifyLicenseKey(tampered, opts).ok).toBe(false)
  })

  it('يرفض مفتاحًا موقَّعًا بمفتاح خاص مختلف', () => {
    const wrong = generateKeyPairSync('ed25519')
    const wrongPem = wrong.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    expect(verifyLicenseKey(signWith(wrongPem, VALID_PAYLOAD), opts).ok).toBe(false)
  })

  it('يرفض نصًا عشوائيًا بصيغة خاطئة', () => {
    expect(verifyLicenseKey('hello-world', opts).ok).toBe(false)
    expect(verifyLicenseKey('', opts).ok).toBe(false)
    expect(verifyLicenseKey('BAD.abc.def', opts).ok).toBe(false)
    expect(verifyLicenseKey('RAFD1...', opts).ok).toBe(false)
  })

  it('يرفض باقة غير معروفة حتى لو التوقيع صحيح', () => {
    const badPlan = signWith(privateKeyPem, { ...VALID_PAYLOAD, plan: 'enterprise-x' })
    expect(verifyLicenseKey(badPlan, opts).ok).toBe(false)
  })
})

describe('verifyLicenseKey — بصمة الجهاز (§8.2)', () => {
  const boundKey = () =>
    signWith(privateKeyPem, { ...VALID_PAYLOAD, device_binding: 'fp-correct' })

  it('ترخيص مربوط ببصمة مطابقة يُقبل', () => {
    const result = verifyLicenseKey(boundKey(), { ...opts, resolveFingerprint: () => 'fp-correct' })
    expect(result.ok).toBe(true)
  })

  it('ترخيص مربوط ببصمة مختلفة يُرفض برسالة جهاز آخر', () => {
    const result = verifyLicenseKey(boundKey(), { ...opts, resolveFingerprint: () => 'fp-other' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('جهاز آخر')
  })

  it('ترخيص مربوط وبصمة الجهاز غير قابلة للقراءة يُرفض بصراحة', () => {
    const result = verifyLicenseKey(boundKey(), {
      ...opts,
      resolveFingerprint: () => {
        throw new Error('io-fail')
      }
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('بصمة')
  })

  it('غياب device_binding = لا فحص إطلاقًا (حتى بلا حلّال بصمة)', () => {
    // لا resolveFingerprint هنا — لو حاول الفحص الاستدعاء لسقط على عتاد لينكس الاختباري
    const result = verifyLicenseKey(validKey, opts)
    expect(result.ok).toBe(true)
  })

  it('device_binding فارغ النص يعامل كغير موجود', () => {
    const empty = signWith(privateKeyPem, { ...VALID_PAYLOAD, device_binding: '   ' })
    expect(verifyLicenseKey(empty, opts).ok).toBe(true)
  })
})

describe('حفظ/استرجاع التفعيل في userData', () => {
  it('يسترجع حالة مفعَّلة بعد الحفظ ويعيد التحقق توقيعيًا بالأعلام الجديدة', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafd-lic-'))
    const result = verifyLicenseKey(validKey, opts)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    saveActivatedLicense(dir, validKey, result.info)
    const status = loadLicenseStatus(dir, opts)
    expect(status.activated).toBe(true)
    if (!status.activated) return
    expect(status.expired).toBe(false)
    expect(status.expiring_soon).toBe(false)
    expect(status.days_left).toBeGreaterThan(1000)
  })

  it('مجلد بلا ترخيص = غير مفعَّل', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafd-lic-'))
    expect(loadLicenseStatus(dir, opts).activated).toBe(false)
  })

  it('ملف ترخيص مدسوس (معلومات بدون مفتاح صالح) لا يخدع الحالة — §11', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafd-lic-'))
    writeFileSync(
      join(dir, 'license.json'),
      JSON.stringify({ key: 'RAFD1.fake.fake', info: { plan: 'pro' } })
    )
    expect(loadLicenseStatus(dir, opts).activated).toBe(false)
  })

  it('مسح الترخيص يعيد الحالة لغير مفعَّل', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafd-lic-'))
    const result = verifyLicenseKey(validKey, opts)
    if (result.ok) saveActivatedLicense(dir, validKey, result.info)
    clearActivatedLicense(dir)
    expect(loadLicenseStatus(dir, opts).activated).toBe(false)
  })
})
