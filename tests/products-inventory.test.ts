import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '../src/main/db'
import { calculateRestock, createProduct, getProduct, restockProduct } from '../src/main/repos/products'
import { isWeightCategory, isWeightProduct } from '../src/shared/catalog'

describe('منطق المخزون والمنتجات الصرف', () => {
  describe('حساب إعادة التخزين بالكرتون', () => {
    it('يحسب الكمية المضافة والمخزون الجديد ومتوسط التكلفة المرجح بشكل صحيح', () => {
      // الحالي: 10 حبات، تكلفة 100 ريال للحبة
      // مضاف: كرتونين، في كل كرتون 12 حبة، سعر الكرتون 1800 ريال (يعني 150 ريال للحبة)
      const currentStock = 10
      const currentCost = 100
      const cartons = 2
      const cartonCost = 1800
      const unitsPerCarton = 12

      const result = calculateRestock(currentStock, currentCost, cartons, cartonCost, unitsPerCarton)

      expect(result.addedQty).toBe(24)
      expect(result.newStock).toBe(34)
      // التكلفة المرجحة: ((10 * 100) + (24 * 150)) / 34 = (1000 + 3600) / 34 = 4600 / 34 = 135.294...
      expect(result.newCost).toBe(135.29)
    })

    it('يتعامل مع مخزون صفري أو سالب للبداية', () => {
      const result = calculateRestock(0, 0, 1, 1000, 10)
      expect(result.addedQty).toBe(10)
      expect(result.newStock).toBe(10)
      expect(result.newCost).toBe(100)
    })
  })

  describe('كشف فئات الوزن والمنتجات', () => {
    it('يكشف فئات الوزن بشكل صحيح', () => {
      expect(isWeightCategory('خضروات وفواكه')).toBe(true)
      expect(isWeightCategory('أجبان وألبان')).toBe(true)
      expect(isWeightCategory('بقالة')).toBe(false)
    })

    it('يكشف ما إذا كان المنتج يباع بالوزن بناء على علمه أو فئته', () => {
      expect(isWeightProduct({ sell_by_weight: 1 })).toBe(true)
      expect(isWeightProduct({ category: 'لحوم وأسماك' })).toBe(true)
      expect(isWeightProduct({ category: 'بقالة' })).toBe(false)
    })
  })

  describe('التحقق من صحة مدخلات إعادة التخزين والرفض الفعلي (Database-Level Validation)', () => {
    let dir: string
    let db: any

    const beforeEachFunc = () => {
      dir = mkdtempSync(join(tmpdir(), 'rafd-restock-val-'))
      db = openDb(join(dir, 't.db'))
    }
    const afterEachFunc = () => {
      try {
        db.close()
      } catch {}
      rmSync(dir, { recursive: true, force: true })
    }

    it('يرفض كراتين سالبة أو صفرية ولا يغيّر المخزون أو التكلفة', () => {
      beforeEachFunc()
      try {
        const product = createProduct(db, { name: 'عصير تفاح', price: 200, cost: 100, stock: 5 })
        
        // كراتين = 0
        expect(() => restockProduct(db, product.id, 0, 1000, 10)).toThrow('عدد الكراتين الموردة يجب أن يكون عددًا صحيحًا أكبر من صفر')
        
        // كراتين سالبة
        expect(() => restockProduct(db, product.id, -2, 1000, 10)).toThrow('عدد الكراتين الموردة يجب أن يكون عددًا صحيحًا أكبر من صفر')
        
        // كراتين كسرية
        expect(() => restockProduct(db, product.id, 1.5, 1000, 10)).toThrow('عدد الكراتين الموردة يجب أن يكون عددًا صحيحًا أكبر من صفر')

        // التأكد من عدم حدوث أي تغيير
        const after = getProduct(db, product.id)
        expect(after.stock).toBe(5)
        expect(after.cost).toBe(100)
      } finally {
        afterEachFunc()
      }
    })

    it('يرفض تكلفة سالبة ولا يغيّر المخزون أو التكلفة', () => {
      beforeEachFunc()
      try {
        const product = createProduct(db, { name: 'بسكويت', price: 50, cost: 30, stock: 10 })

        // تكلفة سالبة
        expect(() => restockProduct(db, product.id, 2, -500, 12)).toThrow('تكلفة الكرتون المورد يجب أن تكون صفرًا أو أكثر')

        const after = getProduct(db, product.id)
        expect(after.stock).toBe(10)
        expect(after.cost).toBe(30)
      } finally {
        afterEachFunc()
      }
    })

    it('يرفض عدد وحدات بالكرتون صفر أو سالب ولا يغيّر المخزون أو التكلفة', () => {
      beforeEachFunc()
      try {
        const product = createProduct(db, { name: 'شيبس', price: 100, cost: 60, stock: 2 })

        // وحدات = 0
        expect(() => restockProduct(db, product.id, 1, 1000, 0)).toThrow('عدد الوحدات في الكرتون يجب أن يكون أكبر من صفر')
        
        // وحدات سالبة
        expect(() => restockProduct(db, product.id, 1, 1000, -12)).toThrow('عدد الوحدات في الكرتون يجب أن يكون أكبر من صفر')

        const after = getProduct(db, product.id)
        expect(after.stock).toBe(2)
        expect(after.cost).toBe(60)
      } finally {
        afterEachFunc()
      }
    })
  })
})
