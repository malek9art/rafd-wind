import { describe, expect, it } from 'vitest'
import { IPC } from '../src/shared/types'
import { assertAuthenticated, assertPermission, canRole } from '../src/main/permissions'

const user = (role: string) => ({
  id: 1,
  full_name: 'مستخدم اختبار',
  role,
  phone: null,
  status: 'active',
  avatar_url: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z'
})

describe('صلاحيات الأدوار', () => {
  it('admin يملك كل قنوات الكتابة التشغيلية', () => {
    expect(canRole('admin', IPC.productsCreate)).toBe(true)
    expect(canRole('admin', IPC.purchasesDelete)).toBe(true)
    expect(canRole('admin', IPC.usersCreate)).toBe(true)
    expect(canRole('admin', IPC.storeSettingsUpdate)).toBe(true)
    expect(canRole('admin', IPC.updaterInstall)).toBe(true)
  })

  it('manager يدير التشغيل ولا يدير المستخدمين أو إعدادات المتجر', () => {
    expect(canRole('manager', IPC.productsUpdate)).toBe(true)
    expect(canRole('manager', IPC.purchasesUpdate)).toBe(true)
    expect(canRole('manager', IPC.salesVoid)).toBe(true)
    expect(canRole('manager', IPC.backupsCreate)).toBe(true)
    expect(canRole('manager', IPC.updaterDownload)).toBe(true)
    expect(canRole('manager', IPC.backupsRestore)).toBe(false)
    expect(canRole('manager', IPC.usersCreate)).toBe(false)
    expect(canRole('manager', IPC.storeSettingsUpdate)).toBe(false)
  })

  it('cashier ينفذ البيع والعملاء ولا ينفذ المخزون والمشتريات والإلغاء', () => {
    expect(canRole('cashier', IPC.salesCreate)).toBe(true)
    expect(canRole('cashier', IPC.customersCreate)).toBe(true)
    expect(canRole('cashier', IPC.productsUpdate)).toBe(false)
    expect(canRole('cashier', IPC.purchasesCreate)).toBe(false)
    expect(canRole('cashier', IPC.salesVoid)).toBe(false)
  })

  it('viewer لا يملك أي كتابة، والمستخدم المفقود يُرفض', () => {
    expect(canRole('viewer', IPC.salesCreate)).toBe(false)
    expect(() => assertPermission(IPC.salesCreate, null)).toThrow('يجب تسجيل الدخول')
    expect(() => assertPermission(IPC.salesCreate, user('viewer'))).toThrow('ليس لديك صلاحية')
  })

  it('قنوات الدخول العامة لا تحتاج جلسة، وقراءة المتجر تتطلبها', () => {
    expect(() => assertAuthenticated(IPC.usersLogin, null)).not.toThrow()
    expect(() => assertAuthenticated(IPC.usersCount, null)).not.toThrow()
    expect(() => assertAuthenticated(IPC.productsList, null)).toThrow('يجب تسجيل الدخول')
    expect(() => assertAuthenticated(IPC.productsList, user('cashier'))).not.toThrow()
  })
})
