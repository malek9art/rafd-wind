/** اختبارات تكامل: العملاء + دفتر العملاء (ذرّية + صحة balance/balance_after) */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import {
  createCustomer,
  deleteCustomer,
  getCustomer,
  listCustomers,
  updateCustomer
} from '../src/main/repos/customers'
import { addLedgerEntry, listLedgerByCustomer } from '../src/main/repos/customerLedger'

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-cust-'))
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

describe('customers CRUD', () => {
  it('إنشاء/قراءة/تحديث/حذف مع التحققات', () => {
    const c = createCustomer(db, { name: 'أحمد', phone: '777123456' })
    expect(c.id).toBe(1)
    expect(c.balance).toBe(0)
    expect(() => createCustomer(db, { name: ' ' })).toThrow('اسم العميل مطلوب')

    const updated = updateCustomer(db, c.id, { notes: 'عميل دائم', balance: 100 })
    expect(updated.notes).toBe('عميل دائم')
    expect(updated.balance).toBe(100)
    expect(() => updateCustomer(db, c.id, {})).toThrow('لا توجد حقول')
    expect(() => updateCustomer(db, 999, { notes: 'x' })).toThrow('عميل غير موجود')

    expect(listCustomers(db)).toHaveLength(1)
    deleteCustomer(db, c.id)
    expect(listCustomers(db)).toHaveLength(0)
  })
})

describe('customerLedger — منطق الأرصدة', () => {
  it('sale_credit يزيد الدين، payment يخفضه بحد أدنى صفر، adjustment تعيين مطلق', () => {
    const c = createCustomer(db, { name: 'أحمد' })

    const e1 = addLedgerEntry(db, { customer_id: c.id, amount: 100, type: 'sale_credit', reference: 'INV-1' })
    expect(e1.balance_after).toBe(100)
    expect(getCustomer(db, c.id).balance).toBe(100)

    const e2 = addLedgerEntry(db, { customer_id: c.id, amount: 30, type: 'payment' })
    expect(e2.balance_after).toBe(70)

    // سداد أكبر من الدين → أرضية صفر (منطق المصدر حرفيًا)
    const e3 = addLedgerEntry(db, { customer_id: c.id, amount: 200, type: 'payment' })
    expect(e3.balance_after).toBe(0)
    expect(getCustomer(db, c.id).balance).toBe(0)

    const e4 = addLedgerEntry(db, { customer_id: c.id, amount: 55.5, type: 'adjustment' })
    expect(e4.balance_after).toBe(55.5)
    expect(getCustomer(db, c.id).balance).toBe(55.5)

    const ledger = listLedgerByCustomer(db, c.id)
    expect(ledger.map((e) => [e.type, e.amount, e.balance_after])).toEqual([
      ['sale_credit', 100, 100],
      ['payment', 30, 70],
      ['payment', 200, 0],
      ['adjustment', 55.5, 55.5]
    ])
  })

  it('ذرّية: قيد باطل لا يترك أي أثر (لا قيد ولا تغيير رصيد)', () => {
    const c = createCustomer(db, { name: 'أحمد' })
    addLedgerEntry(db, { customer_id: c.id, amount: 40, type: 'sale_credit' })

    expect(() =>
      addLedgerEntry(db, { customer_id: c.id, amount: 10, type: 'bogus' as never })
    ).toThrow('نوع قيد غير معروف')
    expect(() => addLedgerEntry(db, { customer_id: c.id, amount: -5, type: 'payment' })).toThrow()
    expect(() => addLedgerEntry(db, { customer_id: 999, amount: 10, type: 'sale_credit' })).toThrow('عميل غير موجود')

    expect(getCustomer(db, c.id).balance).toBe(40)
    expect(listLedgerByCustomer(db, c.id)).toHaveLength(1)
  })

  it('يرفض sale_credit بمبلغ صفري ويقبل adjustment صفري (تعيين مطلق للصفر)', () => {
    const c = createCustomer(db, { name: 'أحمد' })
    addLedgerEntry(db, { customer_id: c.id, amount: 25, type: 'sale_credit' })
    expect(() => addLedgerEntry(db, { customer_id: c.id, amount: 0, type: 'sale_credit' })).toThrow()
    const zero = addLedgerEntry(db, { customer_id: c.id, amount: 0, type: 'adjustment' })
    expect(zero.balance_after).toBe(0)
    expect(getCustomer(db, c.id).balance).toBe(0)
  })
})
