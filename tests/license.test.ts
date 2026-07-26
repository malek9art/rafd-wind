/**
 * اختبارات وحدة لنظام الترخيص (الوثيقة §8/§13).
 * التوقيع يتم فعليًا بالمفتاح الخاص التجريبي (tools/keygen) — لا محاكاة.
 */
import { describe, expect, it, beforeAll } from 'vitest'
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  clearActivatedLicense,
  loadLicenseStatus,
  saveActivatedLicense,
  verifyLicenseKey
} from '../src/main/license'

const privateKeyPem = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../tools/keygen/test-private-key.pem'),
  'utf8'
)

function signWith(pem: string, payload: Record<string, unknown>): string {
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8')
  const key = createPrivateKey({ key: pem, format: 'pem', type: 'pkcs8' })
  const signature = sign(null, payloadBytes, key)
  return `RAFD1.${payloadBytes.toString('base64url')}.${signature.toString('base64url')}`
}

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
  validKey = signWith(privateKeyPem, VALID_PAYLOAD)
})

describe('verifyLicenseKey', () => {
  it('يقبل مفتاحًا صالحًا ويعيد بياناته', () => {
    const result = verifyLicenseKey(validKey)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.info.license_id).toBe('LIC-TEST-1')
      expect(result.info.plan).toBe('trial')
      expect(result.info.customer).toBe('متجر اختبار الوحدة')
    }
  })

  it('يرفض مفتاحًا منتهي الصلاحية برسالة واضحة', () => {
    const expired = signWith(privateKeyPem, { ...VALID_PAYLOAD, expires_at: '2020-01-01T00:00:00.000Z' })
    const result = verifyLicenseKey(expired)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('انتهت صلاحية')
  })

  it('يرفض حمولة عُدِّلت بعد التوقيع (عبث)', () => {
    const parts = validKey.split('.')
    const tamperedPayload = Buffer.from(
      JSON.stringify({ ...VALID_PAYLOAD, plan: 'pro' }),
      'utf8'
    ).toString('base64url')
    const tampered = `${parts[0]}.${tamperedPayload}.${parts[2]}`
    const result = verifyLicenseKey(tampered)
    expect(result.ok).toBe(false)
  })

  it('يرفض مفتاحًا موقَّعًا بمفتاح خاص مختلف', () => {
    const wrong = generateKeyPairSync('ed25519')
    const wrongPem = wrong.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
    const forged = signWith(wrongPem, VALID_PAYLOAD)
    const result = verifyLicenseKey(forged)
    expect(result.ok).toBe(false)
  })

  it('يرفض نصًا عشوائيًا بصيغة خاطئة', () => {
    expect(verifyLicenseKey('hello-world').ok).toBe(false)
    expect(verifyLicenseKey('').ok).toBe(false)
    expect(verifyLicenseKey('BAD.abc.def').ok).toBe(false)
    expect(verifyLicenseKey('RAFD1...').ok).toBe(false)
  })

  it('يرفض باقة غير معروفة حتى لو التوقيع صحيح', () => {
    const badPlan = signWith(privateKeyPem, { ...VALID_PAYLOAD, plan: 'enterprise-x' })
    const result = verifyLicenseKey(badPlan)
    expect(result.ok).toBe(false)
  })
})

describe('حفظ/استرجاع التفعيل في userData', () => {
  it('يسترجع حالة مفعَّلة بعد الحفظ، ويعيد التحقق توقيعيًا', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafd-lic-'))
    const result = verifyLicenseKey(validKey)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    saveActivatedLicense(dir, validKey, result.info)
    const status = loadLicenseStatus(dir)
    expect(status.activated).toBe(true)
  })

  it('مجلد بلا ترخيص = غير مفعَّل', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafd-lic-'))
    expect(loadLicenseStatus(dir).activated).toBe(false)
  })

  it('ملف ترخيص مدسوس (معلومات بدون مفتاح صالح) لا يخدع الحالة — §11', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafd-lic-'))
    writeFileSync(
      join(dir, 'license.json'),
      JSON.stringify({ key: 'RAFD1.fake.fake', info: { plan: 'pro' } })
    )
    expect(loadLicenseStatus(dir).activated).toBe(false)
  })

  it('مسح الترخيص يعيد الحالة لغير مفعَّل', () => {
    const dir = mkdtempSync(join(tmpdir(), 'rafd-lic-'))
    const result = verifyLicenseKey(validKey)
    if (result.ok) saveActivatedLicense(dir, validKey, result.info)
    clearActivatedLicense(dir)
    expect(loadLicenseStatus(dir).activated).toBe(false)
  })
})
