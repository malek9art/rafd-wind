#!/usr/bin/env node
/**
 * أداة توقيع مفاتيح تفعيل RAFD — الأداة **الحقيقية** منذ المرحلة 3 (§8.1).
 * يوقَّع Ed25519 بصيغة RAFD1.<b64url(payload)>.<b64url(sig)>
 *
 * أمن المفتاح الخاص (حرفيًا): لا يوجد أي مفتاح خاص داخل هذا المستودع، ولا يجوز
 * أن يوجد. تصل هذه الأداة إلى المفتاح من خارج المستودع حصريًا، بإحدى طريقتين:
 *   1) متغيّر البيئة RAFD_SIGNING_KEY_PEM يحمل محتوى PEM كاملًا (طريقة CI
 *      عبر GitHub Secret محفوظ لدى الإدارة)
 *   2) --key-file <مسار خارج المستودع>  (طريقة الإدارة على جهازها محليًا)
 * مجلد tools/ لا يُشحَن مع التطبيق أبدًا (files: في electron-builder لا تشمله).
 *
 * الاستخدام:
 *   node tools/keygen/sign-license.mjs --customer "متجر النور" --plan pro --expires 2027-01-01
 *   node tools/keygen/sign-license.mjs --device <بصمة جهاز العميل>   # ترخيص مربوط (§8.2)
 *
 * ملاحظة الربط: بصمة جهاز العميل تُؤخذ من الجهاز نفسه (قناة license:fingerprint في
 * التطبيق؛ ستظهر في شاشة التفعيل في المرحلة 4). تشغيل هذه الأداة على جهاز الإدارة
 * لا يعطي بصمة جهاز العميل — لا تخلط بينهما.
 */
import { createPrivateKey, sign } from 'node:crypto'
import { readFileSync } from 'node:fs'

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`)
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback
}

function loadPrivateKeyPem() {
  const fromFile = process.argv.includes('--key-file')
    ? readFileSync(arg('--key-file', ''), 'utf8')
    : null
  const pem = (fromFile ?? process.env['RAFD_SIGNING_KEY_PEM'] ?? '').trim()
  if (!pem) {
    throw new Error(
      'لا يوجد مفتاح توقيع: مرِّر RAFD_SIGNING_KEY_PEM (محتوى PEM) أو --key-file <مسار خارج المستودع>'
    )
  }
  if (!pem.includes('BEGIN PRIVATE KEY')) {
    throw new Error('محتوى المفتاح ليس PKCS8 PEM صالحًا (يفتقد BEGIN PRIVATE KEY)')
  }
  return pem
}

const expires = arg('expires', '2099-12-31')
const payload = {
  v: 1,
  license_id: arg('id', `LIC-${Date.now()}`),
  plan: arg('plan', 'trial'),
  customer: arg('customer', 'متجر تجريبي'),
  issued_at: new Date().toISOString(),
  expires_at: new Date(`${expires}T23:59:59.999Z`).toISOString(),
  device_binding: arg('device', null) || null
}

const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8')
const privateKey = createPrivateKey({ key: loadPrivateKeyPem(), format: 'pem', type: 'pkcs8' })
const signature = sign(null, payloadBytes, privateKey)

const license = `RAFD1.${payloadBytes.toString('base64url')}.${signature.toString('base64url')}`

console.log(`# payload: ${JSON.stringify(payload)}`)
console.log(license)
