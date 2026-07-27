#!/usr/bin/env node
/**
 * تحقق مستقل من ملف SQLite الناتج عن تشغيل التطبيق المُثبَّت على ويندوز حقيقي.
 * يعمل بـnode:sqlite المدمج في Node (عملية منفصلة تمامًا عن Electron) لإثبات
 * أن الكتابة/القراءة المحلية تعمل فعليًا من خارج التطبيق نفسه.
 *
 * الاستخدام: node scripts/verify-db.mjs --dir "C:\Users\runneradmin\AppData\Roaming\RAFD"
 */
import { argv, exit } from 'node:process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function arg(name) {
  const idx = argv.indexOf(`--${name}`)
  return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : null
}

const dir = arg('dir')
if (!dir) {
  console.error('usage: verify-db.mjs --dir <userDataDir>')
  exit(2)
}

const state = JSON.parse(readFileSync(join(dir, 'smoke-state.json'), 'utf8'))
const dbPath = state.db_path
console.log(`[verify-db] smoke-state.json: db_path=${dbPath}`)
console.log(`[verify-db] expected invoice=${state.sale.sale.invoice_number} total=${state.sale.sale.total}`)

const { DatabaseSync } = await import('node:sqlite')
const db = new DatabaseSync(dbPath, { readOnly: true })

const sale = db
  .prepare('SELECT id, invoice_number, total, paid, created_at FROM sales WHERE id = ?')
  .get(state.sale.sale.id)
if (!sale) throw new Error('sales row not found')
if (sale.invoice_number !== state.sale.sale.invoice_number)
  throw new Error(`invoice mismatch: ${sale.invoice_number}`)
if (Math.abs(sale.total - state.sale.sale.total) > 1e-9) throw new Error(`total mismatch: ${sale.total}`)

const items = db
  .prepare(
    'SELECT id, sale_id, product_id, product_name, quantity, unit_price, total FROM sale_items WHERE sale_id = ?'
  )
  .all(state.sale.sale.id)
if (items.length !== state.sale.items.length) throw new Error(`items count mismatch: ${items.length}`)

const product = db
  .prepare('SELECT id, name, name_ar, price, stock FROM products WHERE id = ?')
  .get(state.product.id)
if (!product) throw new Error('product row not found')
if (product.stock !== 22) throw new Error(`persisted stock mismatch: ${product.stock}`)

db.close()
console.log(`[verify-db] sale row: ${JSON.stringify(sale)}`)
console.log(`[verify-db] items: ${items.length}, product stock persisted=${product.stock}`)
console.log('CROSS_VERIFY_OK')
