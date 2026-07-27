/**
 * اختبارات تكامل لبوابة قفل الكتابة (§8.3) — معيار القبول المنصوص حرفيًا:
 * «منتهٍ: الكتابة تُرفَض، القراءة تنجح (اختبر كلا الاتجاهين صراحة)».
 * قاعدة SQLite حقيقية + تراخيص موقَّعة فعليًا بزوج عابر — بلا أي محاكاة.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createPrivateKey, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { saveActivatedLicense, loadLicenseStatus, verifyLicenseKey } from '../src/main/license'
import { assertLicenseWritable, EXPIRED_WRITE_MESSAGE, UNLICENSED_WRITE_MESSAGE } from '../src/main/license-gate'
import { createProduct, getProduct, listProducts } from '../src/main/repos/products'

let privateKeyPem: string
let publicKeyBase64: string

let dir: string
let dbDir: string
let db: Db

const FIXED_NOW = new Date('2026-07-27T12:00:00.000Z')
const PAYLOAD = {
  v: 1 as const,
  license_id: 'LIC-GATE-1',
  plan: 'pro' as const,
  customer: 'متجر البوابة',
  issued_at: '2026-01-01T00:00:00.000Z',
  device_binding: null
}

function activateWith(payload: Record<string, unknown>): void {
  const full = { ...PAYLOAD, ...payload, expires_at: payload.expires_at as string }
  const payloadBytes = Buffer.from(JSON.stringify(full), 'utf8')
  const key = createPrivateKey({ key: privateKeyPem, format: 'pem', type: 'pkcs8' })
  const license = `RAFD1.${payloadBytes.toString('base64url')}.${sign(null, payloadBytes, key).toString('base64url')}`
  const verified = verifyLicenseKey(license, { publicKeyBase64, now: FIXED_NOW })
  if (!verified.ok) throw new Error(`test setup: ${verified.error}`)
  saveActivatedLicense(dir, license, verified.info)
}

/** ترخيص صالح حتى 2099 */
const VALID_EXPIRES = '2099-12-31T23:59:59.999Z'
/** ترخيص منتهٍ منذ يومين عند FIXED_NOW */
const EXPIRED_EXPIRES = '2026-07-25T23:59:59.999Z'

beforeEach(() => {
  const pair = generateKeyPairSync('ed25519')
  privateKeyPem = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  publicKeyBase64 = Buffer.from(pair.publicKey.export({ type: 'spki', format: 'der' })).toString('base64')
  dir = mkdtempSync(join(tmpdir(), 'rafd-gate-'))
  dbDir = mkdtempSync(join(tmpdir(), 'rafd-gatedb-'))
  db = openDb(join(dbDir, 't.db'))
})
afterEach(() => {
  try {
    db.close()
  } catch {
    /* closed */
  }
  rmSync(dir, { recursive: true, force: true })
  rmSync(dbDir, { recursive: true, force: true })
})

describe('البوابة المركزية — assertLicenseWritable', () => {
  it('بلا ترخيص مُفعَّل: الكتابة مرفوضة برسالة تفعيل صريحة (دفاع عميق)', () => {
    expect(() => assertLicenseWritable(dir, { publicKeyBase64, now: FIXED_NOW })).toThrow(UNLICENSED_WRITE_MESSAGE)
  })

  it('ترخيص صالح: الكتابة تمر وتُنفَّذ فعليًا على SQLite', () => {
    activateWith({ expires_at: VALID_EXPIRES })
    expect(() => assertLicenseWritable(dir, { publicKeyBase64, now: FIXED_NOW })).not.toThrow()
    const p = createProduct(db, { name: 'صنف', price: 5, stock: 10 })
    expect(getProduct(db, p.id).name).toBe('صنف')
  })

  it('ترخيص قارب على الانتهاء (3 أيام): تنبيه في الحالة لكن الكتابة تمر (غير مانع)', () => {
    activateWith({ expires_at: new Date(FIXED_NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString() })
    const status = loadLicenseStatus(dir, { publicKeyBase64, now: FIXED_NOW })
    expect(status.activated && status.expiring_soon).toBe(true)
    expect(() => assertLicenseWritable(dir, { publicKeyBase64, now: FIXED_NOW })).not.toThrow()
  })

  it('منتهٍ: الكتابة تُرفَض صراحةً، والقراءة تنجح (كلا الاتجاهين على قاعدة حقيقية)', () => {
    // بيانات مكتوبة قبلاً بترخيص صالح
    activateWith({ expires_at: VALID_EXPIRES })
    assertLicenseWritable(dir, { publicKeyBase64, now: FIXED_NOW })
    const p = createProduct(db, { name: 'بيانات قديمة', price: 9, stock: 4 })

    // انتهى الترخيص الآن
    activateWith({ expires_at: EXPIRED_EXPIRES })

    // اتجاه الكتابة: مرفوض برسالة §8.3 الصريحة
    expect(() => assertLicenseWritable(dir, { publicKeyBase64, now: FIXED_NOW })).toThrow(EXPIRED_WRITE_MESSAGE)
    expect(() => assertLicenseWritable(dir, { publicKeyBase64, now: FIXED_NOW })).toThrow('تواصل مع الإدارة')

    // اتجاه القراءة: حرّ دائمًا — الحالة مفعَّلة بأعلام الانتهاء والبيانات مقروءة
    const status = loadLicenseStatus(dir, { publicKeyBase64, now: FIXED_NOW })
    expect(status.activated).toBe(true)
    if (status.activated) {
      expect(status.expired).toBe(true)
      expect(status.days_left).toBe(-1)
      expect(status.info.customer).toBe('متجر البوابة')
    }
    expect(listProducts(db).map((x) => x.name)).toEqual(['بيانات قديمة'])
    expect(getProduct(db, p.id).stock).toBe(4)
  })

  it('تجديد منتهٍ بمفتاح جديد صالح يعيد فتح الكتابة (طريق التجديد لا يُحظر)', () => {
    activateWith({ expires_at: EXPIRED_EXPIRES })
    expect(() => assertLicenseWritable(dir, { publicKeyBase64, now: FIXED_NOW })).toThrow(EXPIRED_WRITE_MESSAGE)

    // التفعيل مفتوح دائمًا (ليس قناة كتابة مصنَّفة) — التجديد يحل المشكلة مباشرة
    activateWith({ expires_at: VALID_EXPIRES })
    expect(() => assertLicenseWritable(dir, { publicKeyBase64, now: FIXED_NOW })).not.toThrow()
    const p = createProduct(db, { name: 'بعد التجديد', price: 1 })
    expect(listProducts(db).map((x) => x.name)).toEqual(['بعد التجديد'])
  })
})
