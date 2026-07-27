/** اختبارات تكامل: الموردون + دفتر الموردين (مرآة نمط العملاء) */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import {
  createSupplier,
  deleteSupplier,
  getSupplier,
  listSuppliers,
  updateSupplier
} from '../src/main/repos/suppliers'
import {
  addSupplierLedgerEntry,
  listLedgerBySupplier
} from '../src/main/repos/supplierLedger'

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-supp-'))
  db = openDb(join(dir, 't.db'))
})
afterEach(() => {
  try {
    db.close()
  } catch {
    /* closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('suppliers CRUD', () => {
  it('إنشاء/قراءة/تحديث/حذف مع التحققات', () => {
    const s = createSupplier(db, { name: 'شركة التوزيع', email: 's@x.co' })
    expect(s.id).toBe(1)
    expect(s.balance).toBe(0)
    expect(() => createSupplier(db, { name: '' })).toThrow('اسم المورّد مطلوب')

    const updated = updateSupplier(db, s.id, { phone: '0500000' })
    expect(updated.phone).toBe('0500000')

    expect(listSuppliers(db)).toHaveLength(1)
    deleteSupplier(db, s.id)
    expect(listSuppliers(db)).toHaveLength(0)
  })
})

describe('supplierLedger — purchase_credit بدل sale_credit', () => {
  it('سلسلة أرصدة صحيحة مع balance_after متسلسل', () => {
    const s = createSupplier(db, { name: 'مورد' })

    const e1 = addSupplierLedgerEntry(db, { supplier_id: s.id, amount: 500, type: 'purchase_credit', reference: 'PO-1' })
    expect(e1.balance_after).toBe(500)
    expect(getSupplier(db, s.id).balance).toBe(500)

    const e2 = addSupplierLedgerEntry(db, { supplier_id: s.id, amount: 200, type: 'payment' })
    expect(e2.balance_after).toBe(300)

    const e3 = addSupplierLedgerEntry(db, { supplier_id: s.id, amount: 999, type: 'payment' })
    expect(e3.balance_after).toBe(0)

    const e4 = addSupplierLedgerEntry(db, { supplier_id: s.id, amount: 42, type: 'adjustment' })
    expect(e4.balance_after).toBe(42)

    expect(listLedgerBySupplier(db, s.id)).toHaveLength(4)
  })

  it('ذرّية: قيد باطل لا يترك أثرًا', () => {
    const s = createSupplier(db, { name: 'مورد' })
    addSupplierLedgerEntry(db, { supplier_id: s.id, amount: 10, type: 'purchase_credit' })
    expect(() =>
      addSupplierLedgerEntry(db, { supplier_id: s.id, amount: 5, type: 'nope' as never })
    ).toThrow('نوع قيد غير معروف')
    expect(getSupplier(db, s.id).balance).toBe(10)
    expect(listLedgerBySupplier(db, s.id)).toHaveLength(1)
  })
})
