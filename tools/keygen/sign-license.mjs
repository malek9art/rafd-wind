#!/usr/bin/env node
/**
 * ⚠️ مفتاح تجريبي للمرحلة 0 فقط — TEST-ONLY ⚠️
 * يوقِّع مفاتيح تفعيل Ed25519 بصيغة RAFD1.<b64url(payload)>.<b64url(sig)>
 * بالمفتاح الخاص التجريبي الموجود بجانبه في هذا المجلد.
 *
 * هذا المجلد (tools/) لا يُشحَن مع التطبيق أبدًا (مستبعَد من إعداد electron-builder —
 * الوثيقة §8.1/§11). في المرحلة 3 تُستبدل هذه الأداة بأداة CLI رسمية لدى الإدارة
 * بزوج مفاتيح إنتاجي جديد لا يوجد خاصُّه في أي مستودع كود مُوزَّع.
 *
 * الاستخدام:
 *   node tools/keygen/sign-license.mjs [--expires 2030-01-01] [--customer "اسم"] [--plan trial]
 *   node tools/keygen/sign-license.mjs --expires 2020-01-01   # مفتاح منتهٍ (لاختبار الرفض)
 */
import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const privateKeyPem = readFileSync(join(here, 'test-private-key.pem'), 'utf8')

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

const expires = arg('expires', '2099-12-31')
const payload = {
  v: 1,
  license_id: arg('id', `LIC-${Date.now()}`),
  plan: arg('plan', 'trial'),
  customer: arg('customer', 'متجر تجريبي'),
  issued_at: new Date().toISOString(),
  expires_at: new Date(`${expires}T23:59:59.999Z`).toISOString(),
  device_binding: null
}

const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8')
const privateKey = createPrivateKey({ key: privateKeyPem, format: 'pem', type: 'pkcs8' })
const signature = sign(null, payloadBytes, privateKey)

const license = `RAFD1.${payloadBytes.toString('base64url')}.${signature.toString('base64url')}`

console.log(`# payload: ${JSON.stringify(payload)}`)
console.log(license)
