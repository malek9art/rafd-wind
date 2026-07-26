/**
 * طبقة قاعدة البيانات (Main process) — better-sqlite3 متزامن (الوثيقة §5.2).
 * لا تعتمد على كائن Electron إطلاقًا حتى تكون قابلة للاختبار بـVitest مباشرة
 * مع ملف SQLite مؤقت حقيقي (§13 — لا محاكاة لقاعدة البيانات).
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { SCHEMA_DDL } from './schema'
import type {
  NewProduct,
  Product,
  Sale,
  SaleItem,
  SaleItemInput,
  SaleWithItems
} from '../shared/types'

export type Db = Database.Database

/** تقريب مبالغ مبسّط للمرحلة 0 (قرار التمثيل المالي النهائي يُحسم في المرحلة 1) */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function openDb(dbPath: string): Db {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(SCHEMA_DDL)
  return db
}

export function listProducts(db: Db): Product[] {
  return db
    .prepare('SELECT id, name, name_ar, price, cost, stock, unit, created_at FROM products ORDER BY id')
    .all() as Product[]
}

export function createProduct(db: Db, input: NewProduct): Product {
  if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('اسم المنتج مطلوب')
  }
  if (!(input.price >= 0)) {
    throw new Error('سعر البيع يجب أن يكون صفرًا أو أكثر')
  }
  const stmt = db.prepare(
    `INSERT INTO products (name, name_ar, price, cost, stock, unit, created_at)
     VALUES (@name, @name_ar, @price, @cost, @stock, @unit, @created_at)`
  )
  const result = stmt.run({
    name: input.name.trim(),
    name_ar: input.name_ar?.trim() || null,
    price: roundMoney(input.price),
    cost: roundMoney(input.cost ?? 0),
    stock: input.stock ?? 0,
    unit: input.unit?.trim() || 'pcs',
    created_at: new Date().toISOString()
  })
  return db
    .prepare('SELECT id, name, name_ar, price, cost, stock, unit, created_at FROM products WHERE id = ?')
    .get(result.lastInsertRowid) as Product
}

/**
 * إنشاء عملية بيع داخل معاملة واحدة (الكل أو لا شيء):
 * - الأسعار تُقرأ من قاعدة البيانات في Main، لا تُؤخذ من الواجهة (§11).
 * - يتحقق من توفر المخزون وينقّصه ذرّيًا.
 * - رقم الفاتورة يُولَّد داخل المعاملة من آخر معرّف (بيئة مستخدم واحد محلية).
 */
export function createSale(
  db: Db,
  input: { items: SaleItemInput[]; paid: number }
): SaleWithItems {
  if (!input.items || input.items.length === 0) {
    throw new Error('لا يمكن إتمام بيع بدون أصناف')
  }
  if (!(input.paid >= 0)) {
    throw new Error('المبلغ المدفوع غير صالح')
  }

  const run = db.transaction((): SaleWithItems => {
    const getProduct = db.prepare(
      'SELECT id, name, name_ar, price, cost, stock, unit FROM products WHERE id = ?'
    )
    const decreaseStock = db.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')

    let total = 0
    const lines: Array<{
      product_id: number
      product_name: string
      quantity: number
      unit_price: number
      total: number
    }> = []

    for (const item of input.items) {
      if (!(item.quantity > 0)) throw new Error('الكمية يجب أن تكون أكبر من صفر')
      const product = getProduct.get(item.product_id) as Product | undefined
      if (!product) throw new Error(`منتج غير موجود: ${item.product_id}`)
      if (product.stock < item.quantity) {
        throw new Error(`مخزون غير كافٍ للمنتج «${product.name}» (المتاح: ${product.stock})`)
      }
      const lineTotal = roundMoney(product.price * item.quantity)
      total = roundMoney(total + lineTotal)
      lines.push({
        product_id: product.id,
        product_name: product.name_ar || product.name,
        quantity: item.quantity,
        unit_price: product.price,
        total: lineTotal
      })
    }

    if (roundMoney(input.paid) < total) {
      throw new Error(`المبلغ المدفوع (${input.paid}) أقل من إجمالي الفاتورة (${total})`)
    }

    const nextId =
      (db.prepare('SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM sales').get() as {
        next_id: number
      }).next_id
    const invoice_number = `INV-${String(nextId).padStart(6, '0')}`
    const created_at = new Date().toISOString()

    const insertSale = db.prepare(
      'INSERT INTO sales (invoice_number, total, paid, created_at) VALUES (?, ?, ?, ?)'
    )
    const saleResult = insertSale.run(invoice_number, total, roundMoney(input.paid), created_at)
    const saleId = Number(saleResult.lastInsertRowid)

    const insertItem = db.prepare(
      `INSERT INTO sale_items (sale_id, product_id, product_name, quantity, unit_price, total)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    for (const line of lines) {
      decreaseStock.run(line.quantity, line.product_id)
      insertItem.run(
        saleId,
        line.product_id,
        line.product_name,
        line.quantity,
        line.unit_price,
        line.total
      )
    }

    const sale = db
      .prepare('SELECT id, invoice_number, total, paid, created_at FROM sales WHERE id = ?')
      .get(saleId) as Sale
    const items = db
      .prepare(
        'SELECT id, sale_id, product_id, product_name, quantity, unit_price, total FROM sale_items WHERE sale_id = ? ORDER BY id'
      )
      .all(saleId) as SaleItem[]
    return { sale, items }
  })

  return run()
}

export function getSaleWithItems(db: Db, saleId: number): SaleWithItems {
  const sale = db
    .prepare('SELECT id, invoice_number, total, paid, created_at FROM sales WHERE id = ?')
    .get(saleId) as Sale | undefined
  if (!sale) throw new Error(`فاتورة غير موجودة: ${saleId}`)
  const items = db
    .prepare(
      'SELECT id, sale_id, product_id, product_name, quantity, unit_price, total FROM sale_items WHERE sale_id = ? ORDER BY id'
    )
    .all(saleId) as SaleItem[]
  return { sale, items }
}
