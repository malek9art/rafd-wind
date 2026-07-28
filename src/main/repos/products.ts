/**
 * مستودع المنتجات — المرحلة 2 (عقد §7).
 * سياسة الحذف (قرار موثَّق): حذف ناعم إلزامًا — المنتج المرتبط بمبيعات/مشتريات
 * تاريخية لا يُمحى أبدًا، بل يُعطَّل (is_active=0) حفاظًا على سلامة السجلات؛
 * حتى المنتج غير المرتبط يعامل بنفس القاعدة لتوحيد السلوك (بلا مسارَي حذف).
 */
import type { Db } from '../db'
import type { NewProduct, Product, ProductPatch } from '../../shared/types'
import { buildSetClause, nowIso, requireFound, roundMoney } from './helpers'

const COLS =
  'id, name, name_ar, price, cost, stock, unit, sku, barcode, category, min_stock, image_url, is_active, supplier_id, supplier_name, sell_by_weight, created_at'

export function listProducts(
  db: Db,
  filters?: { active_only?: boolean; category?: string }
): Product[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filters?.active_only) where.push('is_active = 1')
  if (filters?.category) {
    where.push('category = ?')
    params.push(filters.category)
  }
  const sql = `SELECT ${COLS} FROM products${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id`
  return db.prepare(sql).all(...params) as Product[]
}

export function createProduct(db: Db, input: NewProduct): Product {
  if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
    throw new Error('اسم المنتج مطلوب')
  }
  if (!(input.price >= 0)) {
    throw new Error('سعر البيع يجب أن يكون صفرًا أو أكثر')
  }
  if (input.supplier_id != null) {
    requireFound(
      db.prepare('SELECT id FROM suppliers WHERE id = ?').get(input.supplier_id),
      `مورّد غير موجود: ${input.supplier_id}`
    )
  }
  try {
    const result = db
      .prepare(
        `INSERT INTO products (name, name_ar, price, cost, stock, unit, sku, barcode, category, min_stock, image_url, is_active, supplier_id, supplier_name, sell_by_weight, created_at)
         VALUES (@name, @name_ar, @price, @cost, @stock, @unit, @sku, @barcode, @category, @min_stock, @image_url, @is_active, @supplier_id, @supplier_name, @sell_by_weight, @created_at)`
      )
      .run({
        name: input.name.trim(),
        name_ar: input.name_ar?.trim() || null,
        price: roundMoney(input.price),
        cost: roundMoney(input.cost ?? 0),
        stock: input.stock ?? 0,
        unit: input.unit?.trim() || 'pcs',
        sku: input.sku?.trim() || null,
        barcode: input.barcode?.trim() || null,
        category: input.category?.trim() || 'عام',
        min_stock: input.min_stock ?? 5,
        image_url: input.image_url ?? null,
        is_active: 1,
        supplier_id: input.supplier_id ?? null,
        supplier_name: input.supplier_name ?? null,
        sell_by_weight: input.sell_by_weight ? 1 : 0,
        created_at: nowIso()
      })
    return getProduct(db, Number(result.lastInsertRowid))
  } catch (error) {
    if (String((error as Error).message).includes('UNIQUE')) {
      throw new Error(`رمز SKU مستخدم من قبل: ${input.sku}`)
    }
    throw error
  }
}

export function getProduct(db: Db, id: number): Product {
  return requireFound(
    db.prepare(`SELECT ${COLS} FROM products WHERE id = ?`).get(id) as Product | undefined,
    `منتج غير موجود: ${id}`
  )
}

const UPDATE_ALLOWED = [
  'name',
  'name_ar',
  'price',
  'cost',
  'stock',
  'unit',
  'sku',
  'barcode',
  'category',
  'min_stock',
  'image_url',
  'is_active',
  'supplier_id',
  'supplier_name',
  'sell_by_weight'
] as const

export function updateProduct(db: Db, id: number, patch: ProductPatch): Product {
  getProduct(db, id)
  // أعلام boolean عابرة لـIPC تُطبَّع إلى 0/1 قبل الربط — better-sqlite3 يرفض
  // ربط boolean ويرمي TypeError إنجليزيًا (نفس تطبيع بقية المستودعات)
  const normalized: Record<string, unknown> = { ...patch }
  if (patch.is_active !== undefined) normalized.is_active = patch.is_active ? 1 : 0
  if (patch.sell_by_weight !== undefined) normalized.sell_by_weight = patch.sell_by_weight ? 1 : 0
  const { clause, values } = buildSetClause(normalized, UPDATE_ALLOWED)
  try {
    db.prepare(`UPDATE products SET ${clause} WHERE id = ?`).run(...values, id)
  } catch (error) {
    if (String((error as Error).message).includes('UNIQUE')) {
      throw new Error(`رمز SKU مستخدم من قبل: ${patch.sku}`)
    }
    throw error
  }
  return getProduct(db, id)
}

/** حذف ناعم دائمًا (انظر ترويسة الملف) */
export function deleteProduct(db: Db, id: number): void {
  getProduct(db, id)
  db.prepare('UPDATE products SET is_active = 0 WHERE id = ?').run(id)
}

/** حساب إعادة التخزين والكمية والتكلفة المرجحة */
export function calculateRestock(
  currentStock: number,
  currentCost: number,
  cartons: number,
  cartonCost: number,
  unitsPerCarton: number
): { addedQty: number; newStock: number; newCost: number } {
  const addedQty = cartons * unitsPerCarton
  const newStock = Math.max(0, currentStock + addedQty)
  const newUnitCost = unitsPerCarton > 0 ? cartonCost / unitsPerCarton : 0

  let newCost = currentCost
  if (newStock > 0) {
    const totalCurrentCost = Math.max(0, currentStock) * currentCost
    const totalNewCost = addedQty * newUnitCost
    newCost = Math.round(((totalCurrentCost + totalNewCost) / newStock) * 100) / 100
  }
  return { addedQty, newStock, newCost }
}

/** إعادة تخزين سريعة بالكرتون */
export function restockProduct(
  db: Db,
  productId: number,
  cartons: number,
  cartonCost: number,
  unitsPerCarton: number
): Product {
  const product = getProduct(db, productId)

  if (!Number.isInteger(cartons) || cartons <= 0) {
    throw new Error('عدد الكراتين الموردة يجب أن يكون عددًا صحيحًا أكبر من صفر')
  }
  if (typeof cartonCost !== 'number' || isNaN(cartonCost) || cartonCost < 0) {
    throw new Error('تكلفة الكرتون المورد يجب أن تكون صفرًا أو أكثر')
  }
  if (typeof unitsPerCarton !== 'number' || isNaN(unitsPerCarton) || unitsPerCarton <= 0) {
    throw new Error('عدد الوحدات في الكرتون يجب أن يكون أكبر من صفر')
  }

  const { newStock, newCost } = calculateRestock(
    product.stock,
    product.cost,
    cartons,
    cartonCost,
    unitsPerCarton
  )

  // تحديث أو إدراج في جدول التغليف product_packaging
  db.prepare(`
    INSERT INTO product_packaging (product_id, units_per_carton, carton_cost, unit_cost, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(product_id) DO UPDATE SET
      units_per_carton = excluded.units_per_carton,
      carton_cost = excluded.carton_cost,
      unit_cost = excluded.unit_cost
  `).run(
    productId,
    unitsPerCarton,
    cartonCost,
    unitsPerCarton > 0 ? cartonCost / unitsPerCarton : 0,
    nowIso()
  )

  // تحديث المخزون والتكلفة في جدول المنتجات
  db.prepare('UPDATE products SET stock = ?, cost = ? WHERE id = ?').run(
    newStock,
    newCost,
    productId
  )

  return getProduct(db, productId)
}
