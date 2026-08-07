/**
 * اختبارات تكامل: منتجات (update/delete/فلاتر)، مصروفات، حسابات بنكية،
 * طرفيات دفع، إعدادات المتجر (upsert الصف الوحيد)، وسجل التدقيق
 * (فلاتر/ترتيب/حد + صمت writeAudit الذي لا يُفشل العملية الأم أبدًا).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import { createProduct, deleteProduct, getProduct, listProducts, updateProduct } from '../src/main/repos/products'
import {
  createBankAccount,
  createExpense,
  createPaymentTerminal,
  deleteBankAccount,
  deleteExpense,
  deletePaymentTerminal,
  getExpense,
  listBankAccounts,
  listExpenses,
  listPaymentTerminals,
  updateBankAccount,
  updateExpense,
  updatePaymentTerminal
} from '../src/main/repos/crudSimple'
import { getStoreSettings, updateStoreSettings } from '../src/main/repos/storeSettings'
import { listAuditLogs, writeAudit } from '../src/main/repos/auditLogs'
import { createSale, getSaleWithItems } from '../src/main/repos/sales'
import { createUser } from '../src/main/repos/users'

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-misc-'))
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

describe('منتجات — تحديث/حذف/فلاتر (تكملة تغطية db.test)', () => {
  it('update بقائمة بيضاء + SKU مكرر برسالة عربية', () => {
    const a = createProduct(db, { name: 'أ', price: 1, sku: 'S-1' })
    const b = createProduct(db, { name: 'ب', price: 2, sku: 'S-2' })

    const updated = updateProduct(db, a.id, { price: 7.5, stock: 4 })
    expect(updated.price).toBe(7.5)
    expect(updated.stock).toBe(4)
    expect(updated.sku).toBe('S-1')

    expect(() => updateProduct(db, b.id, { sku: 'S-1' })).toThrow('رمز SKU مستخدم من قبل')
    expect(() => updateProduct(db, a.id, {})).toThrow('لا توجد حقول صالحة للتحديث')
    expect(() => updateProduct(db, 999, { price: 1 })).toThrow('منتج غير موجود: 999')
    expect(() => createProduct(db, { name: 'ج', price: 3, sku: 'S-1' })).toThrow('رمز SKU مستخدم من قبل')
    expect(() => createProduct(db, { name: 'ج', price: 3, supplier_id: 999 })).toThrow('مورّد غير موجود: 999')
  })

  it('حذف ناعم دائمًا: is_active=0 ويبقى قابلًا للجلب، والفلاتر تعمل', () => {
    const keep = createProduct(db, { name: 'مشروبات', price: 1, category: 'مشروبات' })
    const gone = createProduct(db, { name: 'محذوف', price: 1, category: 'أخرى' })

    deleteProduct(db, gone.id)
    expect(getProduct(db, gone.id).is_active).toBe(0) // ليس محوًا

    expect(listProducts(db)).toHaveLength(2)
    expect(listProducts(db, { active_only: true }).map((p) => p.id)).toEqual([keep.id])
    expect(listProducts(db, { category: 'مشروبات' }).map((p) => p.id)).toEqual([keep.id])
    expect(listProducts(db, { active_only: true, category: 'أخرى' })).toHaveLength(0)
    expect(() => deleteProduct(db, 999)).toThrow('منتج غير موجود: 999')
  })
})

describe('مصروفات', () => {
  it('CRUD بسيط مع التحققات', () => {
    expect(() => createExpense(db, { category: ' ', amount: 5 })).toThrow('تصنيف المصروف مطلوب')
    expect(() => createExpense(db, { category: 'إيجار', amount: 0 })).toThrow('أكبر من صفر')

    const e = createExpense(db, { category: 'إيجار', amount: 300.125, description: 'شهري' })
    expect(e.amount).toBe(300.13) // roundMoney
    expect(e.payment_method).toBe('cash')
    expect(e.expense_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)

    const updated = updateExpense(db, e.id, { amount: 250, payment_method: 'transfer' })
    expect(updated.amount).toBe(250)
    expect(updated.category).toBe('إيجار')
    expect(updated.payment_method).toBe('transfer')

    expect(() => updateExpense(db, e.id, {})).toThrow('لا توجد حقول صالحة للتحديث')
    expect(() => updateExpense(db, 999, { amount: 1 })).toThrow('مصروف غير موجود: 999')

    expect(listExpenses(db)).toHaveLength(1)
    deleteExpense(db, e.id)
    expect(listExpenses(db)).toHaveLength(0)
    expect(() => getExpense(db, e.id)).toThrow('مصروف غير موجود')
  })
})

describe('حسابات بنكية', () => {
  it('CRUD + تطبيع is_active إلى 0/1', () => {
    expect(() => createBankAccount(db, { bank_name: '', account_name: 'ح' })).toThrow('اسم البنك مطلوب')
    expect(() => createBankAccount(db, { bank_name: 'ب', account_name: ' ' })).toThrow('اسم الحساب مطلوب')

    const b = createBankAccount(db, { bank_name: 'بنك التضامن', account_name: 'المتجر' })
    expect(b.currency).toBe('YER')
    expect(b.is_active).toBe(1)

    const dormant = createBankAccount(db, { bank_name: 'بنك', account_name: 'احتياطي', is_active: false })
    expect(dormant.is_active).toBe(0)

    const updated = updateBankAccount(db, b.id, { is_active: false, iban: 'YE00ABC' })
    expect(updated.is_active).toBe(0)
    expect(updated.iban).toBe('YE00ABC')
    const reactivated = updateBankAccount(db, b.id, { is_active: true })
    expect(reactivated.is_active).toBe(1)

    expect(listBankAccounts(db)).toHaveLength(2)
    deleteBankAccount(db, dormant.id)
    expect(listBankAccounts(db)).toHaveLength(1)
  })

  it('حذف حساب له فواتير محوّلة يُفرِغ مرجعها (ON DELETE SET NULL من المرحلة 1)', () => {
    const bank = createBankAccount(db, { bank_name: 'ب', account_name: 'ح' })
    const pid = createProduct(db, { name: 'صنف', price: 10, stock: 2 }).id
    const { sale } = createSale(db, {
      items: [{ product_id: pid, quantity: 1 }],
      paid: 10,
      payment_method: 'transfer',
      bank_account_id: bank.id
    })
    expect(sale.bank_account_id).toBe(bank.id)

    deleteBankAccount(db, bank.id)
    expect(getSaleWithItems(db, sale.id).sale.bank_account_id).toBeNull()
  })
})

describe('طرفيات دفع', () => {
  it('CRUD + تطبيع الأعلام الثنائية', () => {
    expect(() => createPaymentTerminal(db, { name: '' })).toThrow('اسم الطرفية مطلوب')

    const t = createPaymentTerminal(db, { name: 'جهاز الكاشير', supports_contactless: true })
    expect(t.provider).toBe('generic')
    expect(t.connection_type).toBe('network')
    expect(t.is_active).toBe(1)
    expect(t.supports_contactless).toBe(1)

    const updated = updatePaymentTerminal(db, t.id, {
      is_active: false,
      supports_contactless: false,
      terminal_id: 'T-9'
    })
    expect(updated.is_active).toBe(0)
    expect(updated.supports_contactless).toBe(0)
    expect(updated.terminal_id).toBe('T-9')

    expect(() => updatePaymentTerminal(db, t.id, {})).toThrow('لا توجد حقول صالحة للتحديث')
    expect(listPaymentTerminals(db)).toHaveLength(1)
    deletePaymentTerminal(db, t.id)
    expect(listPaymentTerminals(db)).toHaveLength(0)
    expect(() => deletePaymentTerminal(db, 999)).toThrow('طرفية غير موجودة: 999')
  })
})

describe('إعدادات المتجر (صف وحيد id=1)', () => {
  it('get() قبل أي ضبط → null، وأول update ينشئ الصف بافتراضيات المخطط', () => {
    expect(getStoreSettings(db)).toBeNull()

    const created = updateStoreSettings(db, { name_ar: 'متجر النور' })
    expect(created.id).toBe(1)
    expect(created.name_ar).toBe('متجر النور')
    expect(created.primary_color).toBe('#0d9488') // افتراضي المخطط (مطابق لون rafd)
    expect(created.secondary_color).toBe('#d97706')
    expect(created.currency).toBe('YER')
    expect(created.tax_enabled).toBe(0)

    // دمج: تحديث لاحق لا يمسّ الحقول غير المذكورة + تطبيع tax_enabled
    const merged = updateStoreSettings(db, {
      currency: 'SAR',
      tax_enabled: true,
      printer_port: 'COM3',
      printer_baud_rate: 115200,
      receipt_width: 58
    })
    expect(merged.name_ar).toBe('متجر النور')
    expect(merged.currency).toBe('SAR')
    expect(merged.tax_enabled).toBe(1)
    expect(merged.printer_port).toBe('COM3')
    expect(merged.printer_baud_rate).toBe(115200)
    expect(merged.receipt_width).toBe(58)
    expect(() => updateStoreSettings(db, { receipt_width: 72 })).toThrow('58 أو 80')

    // patch فارغ: يبقي الصف ويحدّث updated_at فقط
    const still = updateStoreSettings(db, {})
    expect(still.currency).toBe('SAR')

    // صف واحد دائمًا مهما تعددت التحديثات
    const count = db.prepare('SELECT COUNT(*) AS c FROM store_settings').get() as { c: number }
    expect(count.c).toBe(1)
  })
})

describe('سجل التدقيق — قراءة فقط', () => {
  it('فلاتر + ترتيب تنازلي بالإدراج + LIMIT مُطاع', () => {
    // user_id له FK إلى app_users: مستخدمان حقيقيان حتى لا تبتلع الكتابة
    // الصامتة الصفوف (سلوك مقصود في writeAudit)
    const u1 = createUser(db, { full_name: 'أول' })
    const u2 = createUser(db, { full_name: 'ثانٍ' })
    writeAudit(db, { userId: u1.id, action: 'a', entityType: 'x', entityId: 1 })
    writeAudit(db, { userId: u2.id, action: 'b', entityType: 'x', entityId: 2 })
    writeAudit(db, { userId: u1.id, action: 'b', entityType: 'y', entityId: 3, meta: { k: 1 } })

    const all = listAuditLogs(db)
    expect(all.map((l) => l.id)).toEqual([3, 2, 1]) // الأحدث أولًا
    expect(all[0].meta).toBe('{"k":1}')
    expect(all[1].meta).toBeNull()

    expect(listAuditLogs(db, { user_id: u1.id })).toHaveLength(2)
    expect(listAuditLogs(db, { entity_type: 'x' })).toHaveLength(2)
    expect(listAuditLogs(db, { action: 'b' })).toHaveLength(2)
    expect(listAuditLogs(db, { user_id: u1.id, action: 'b', entity_type: 'y' })).toHaveLength(1)
    expect(listAuditLogs(db, { limit: 1 })).toHaveLength(1)
  })

  it('writeAudit صامت: لا يرمي حتى على قاعدة مغلقة ولا يُفشل العملية الأم', () => {
    db.close()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(() => writeAudit(db, { userId: null, action: 'boom', entityType: 'x' })).not.toThrow()
      expect(warn).toHaveBeenCalledOnce()
    } finally {
      warn.mockRestore()
    }
  })
})
