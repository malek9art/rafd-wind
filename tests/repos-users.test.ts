/**
 * اختبارات تكامل: المستخدمون — تخزين PIN مجزّأ (scrypt)، منع خروج pin_hash
 * من أي مسار قراءة، تسجيل دخول موحَّد الرسالة، والجلسة النشطة المغذّية
 * لسقف الكاشير وaudit_logs.user_id (القرار المعتمد في التكليف).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, type Db } from '../src/main/db'
import {
  _logout,
  createUser,
  deleteUser,
  getUser,
  listUsers,
  loginUser,
  updateUser
} from '../src/main/repos/users'
import { getCurrentUser } from '../src/main/session'
import { createProduct } from '../src/main/repos/products'
import { createSale } from '../src/main/repos/sales'
import { listAuditLogs } from '../src/main/repos/auditLogs'

let dir: string
let db: Db

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'rafd-users-'))
  db = openDb(join(dir, 't.db'))
})
afterEach(() => {
  _logout() // الجلسة متغيّر عام في الوحدة — تنظيف إلزامي بين الاختبارات
  try {
    db.close()
  } catch {
    /* closed */
  }
  rmSync(dir, { recursive: true, force: true })
})

/** قراءة pin_hash مباشرة من القاعدة — القناة الوحيدة التي يجوز له الظهور فيها */
function pinHashOf(id: number): string | null {
  const row = db.prepare('SELECT pin_hash FROM app_users WHERE id = ?').get(id) as {
    pin_hash: string | null
  }
  return row.pin_hash
}

describe('إنشاء وقراءة', () => {
  it('إنشاء بـPIN: يُخزَّن مجزّأ بصيغة scrypt ولا يظهر في أي استجابة', () => {
    const u = createUser(db, { full_name: 'مالك', role: 'manager', phone: '777111222', pin: '1234' })
    expect(u.id).toBe(1)
    expect(u.role).toBe('manager')
    expect(u.phone).toBe('777111222')
    expect(u).not.toHaveProperty('pin_hash')

    const hash = pinHashOf(u.id)
    expect(hash).toMatch(/^scrypt\$16384\$8\$1\$/)
    expect(hash).not.toContain('1234')

    for (const row of listUsers(db)) expect(row).not.toHaveProperty('pin_hash')
    expect(getUser(db, u.id)).not.toHaveProperty('pin_hash')
    expect(listUsers(db)).toHaveLength(1)
  })

  it('إنشاء بدون PIN → pin_hash فارغ + افتراضيات الدور والحالة', () => {
    const u = createUser(db, { full_name: 'بلا رمز' })
    expect(pinHashOf(u.id)).toBeNull()
    expect(u.role).toBe('cashier')
    expect(u.status).toBe('active')

    expect(() => createUser(db, { full_name: '  ' })).toThrow('اسم المستخدم مطلوب')
    expect(() => createUser(db, { full_name: 'س', pin: '12ab' })).toThrow('PIN')
    expect(() => createUser(db, { full_name: 'س', pin: '123' })).toThrow('PIN')
    expect(listUsers(db)).toHaveLength(1) // الفاشلان لم يُدرجا
  })

  it('update: الحقول الآمنة + PIN جديد يحل محل القديم والفارغ لا يمسّه', () => {
    const u = createUser(db, { full_name: 'مالك', pin: '1111' })
    const oldHash = pinHashOf(u.id)

    const updated = updateUser(db, u.id, { role: 'admin', pin: '2222' })
    expect(updated.role).toBe('admin')
    expect(pinHashOf(u.id)).not.toBe(oldHash)

    // الجديد ينجح والقديم يفشل
    expect(loginUser(db, 'مالك', '2222').id).toBe(u.id)
    _logout()
    expect(() => loginUser(db, 'مالك', '1111')).toThrow('بيانات الدخول غير صحيحة')

    // تحديث بلا pin لا يغيّر التجزئة
    const before = pinHashOf(u.id)
    updateUser(db, u.id, { phone: '700000000' })
    expect(pinHashOf(u.id)).toBe(before)
    expect(getUser(db, u.id).phone).toBe('700000000')

    expect(() => updateUser(db, u.id, {})).toThrow('لا توجد حقول صالحة للتحديث')
    expect(() => updateUser(db, 999, { role: 'x' })).toThrow('مستخدم غير موجود: 999')
  })
})

describe('تسجيل الدخول', () => {
  it('بالاسم أو الهاتف ينجح ويُحدِّث الجلسة، ورسالة الفشل موحّدة لكل الأسباب', () => {
    const target = createUser(db, { full_name: 'كاشير', phone: '777333444', pin: '4321' })
    createUser(db, { full_name: 'موقوف', status: 'inactive', pin: '4321' })
    createUser(db, { full_name: 'بلارمز' })

    const byName = loginUser(db, 'كاشير', '4321')
    expect(byName.id).toBe(target.id)
    expect(byName).not.toHaveProperty('pin_hash')
    expect(getCurrentUser()?.id).toBe(byName.id)

    _logout()
    expect(getCurrentUser()).toBeNull()
    const byPhone = loginUser(db, '777333444', '4321')
    expect(byPhone.id).toBe(byName.id)
    expect(getCurrentUser()?.id).toBe(byName.id)

    _logout()
    const attempts = [
      () => loginUser(db, 'كاشير', '9999'), // PIN خاطئ
      () => loginUser(db, 'مجهول', '4321'), // مستخدم غير موجود
      () => loginUser(db, 'موقوف', '4321'), // غير نشط
      () => loginUser(db, 'بلارمز', '4321') // بلا PIN أصلًا
    ]
    for (const attempt of attempts) {
      expect(attempt).toThrow('بيانات الدخول غير صحيحة')
      expect(getCurrentUser()).toBeNull() // فشل الدخول لا يترك جلسة
    }
  })
})

describe('الجلسة تغذّي سقف الكاشير والتدقيق', () => {
  it('بعد login: سقف 10% ينطبق على دور الجلسة وsale.create يُقيَّد بـuser_id', () => {
    const cashier = createUser(db, { full_name: 'كاشير', role: 'cashier', pin: '1234' })
    loginUser(db, 'كاشير', '1234')
    const session = getCurrentUser()
    expect(session?.role).toBe('cashier')
    // هذا هو تمامًا ما تبنيه طبقة IPC من getCurrentUser() (ipc.ts: actor())
    const actor = { userId: session!.id, role: session!.role }

    const pid = createProduct(db, { name: 'صنف', price: 100, stock: 5 }).id
    expect(() =>
      createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 50, discount: 50, customer_id: null }, actor)
    ).toThrow('خصم الكاشير يتجاوز السقف')

    const { sale } = createSale(db, { items: [{ product_id: pid, quantity: 1 }], paid: 100 }, actor)
    const logs = listAuditLogs(db, { action: 'sale.create' })
    expect(logs).toHaveLength(1)
    expect(logs[0].user_id).toBe(cashier.id)
    expect(logs[0].entity_id).toBe(sale.id)
  })
})

describe('حذف', () => {
  it('deleteUser يزيل الصف ويمنع الدخول لاحقًا', () => {
    const u = createUser(db, { full_name: 'مالك', pin: '1234' })
    deleteUser(db, u.id)
    expect(listUsers(db)).toHaveLength(0)
    expect(() => getUser(db, u.id)).toThrow('مستخدم غير موجود')
    expect(() => loginUser(db, 'مالك', '1234')).toThrow('بيانات الدخول غير صحيحة')
    expect(() => deleteUser(db, 999)).toThrow('مستخدم غير موجود: 999')
  })
})
