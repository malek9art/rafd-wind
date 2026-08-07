/**
 * صلاحيات العمليات الحساسة — المرحلة 4.
 *
 * هذه الوحدة نقية بلا Electron حتى تُختبر مباشرة. القراءة تبقى حرة تحت
 * بوابة الترخيص، أما كل قناة كتابة فتمر عبر assertPermission في ipc.ts.
 */
import { IPC } from '../shared/types'
import type { AppUser } from '../shared/types'

export type AppRole = 'admin' | 'manager' | 'cashier' | 'viewer'

const ADMIN_CHANNELS = new Set<string>([
  IPC.productsCreate,
  IPC.productsUpdate,
  IPC.productsDelete,
  IPC.productsRestock,
  IPC.customersCreate,
  IPC.customersUpdate,
  IPC.customersDelete,
  IPC.customerLedgerAdd,
  IPC.suppliersCreate,
  IPC.suppliersUpdate,
  IPC.suppliersDelete,
  IPC.supplierLedgerAdd,
  IPC.purchasesCreate,
  IPC.purchasesUpdate,
  IPC.purchasesDelete,
  IPC.expensesCreate,
  IPC.expensesUpdate,
  IPC.expensesDelete,
  IPC.bankAccountsCreate,
  IPC.bankAccountsUpdate,
  IPC.bankAccountsDelete,
  IPC.paymentTerminalsCreate,
  IPC.paymentTerminalsUpdate,
  IPC.paymentTerminalsDelete,
  IPC.salesCreate,
  IPC.salesUpdate,
  IPC.salesVoid,
  IPC.salesDelete,
  IPC.usersCreate,
  IPC.usersUpdate,
  IPC.usersDelete,
  IPC.storeSettingsUpdate
])

const MANAGER_CHANNELS = new Set<string>([
  IPC.productsCreate,
  IPC.productsUpdate,
  IPC.productsDelete,
  IPC.productsRestock,
  IPC.customersCreate,
  IPC.customersUpdate,
  IPC.customerLedgerAdd,
  IPC.suppliersCreate,
  IPC.suppliersUpdate,
  IPC.suppliersDelete,
  IPC.supplierLedgerAdd,
  IPC.purchasesCreate,
  IPC.purchasesUpdate,
  IPC.purchasesDelete,
  IPC.expensesCreate,
  IPC.expensesUpdate,
  IPC.expensesDelete,
  IPC.bankAccountsCreate,
  IPC.bankAccountsUpdate,
  IPC.bankAccountsDelete,
  IPC.paymentTerminalsCreate,
  IPC.paymentTerminalsUpdate,
  IPC.paymentTerminalsDelete,
  IPC.salesCreate,
  IPC.salesUpdate,
  IPC.salesVoid
])

const CASHIER_CHANNELS = new Set<string>([
  IPC.customersCreate,
  IPC.customersUpdate,
  IPC.customerLedgerAdd,
  IPC.salesCreate
])

function rolePermissions(role: string): ReadonlySet<string> {
  switch (role as AppRole) {
    case 'admin':
      return ADMIN_CHANNELS
    case 'manager':
      return MANAGER_CHANNELS
    case 'cashier':
      return CASHIER_CHANNELS
    case 'viewer':
      return new Set()
    default:
      return new Set()
  }
}

export function canRole(role: string, channel: string): boolean {
  return rolePermissions(role).has(channel)
}

export function assertPermission(channel: string, user: AppUser | null): void {
  if (!user) throw new Error('يجب تسجيل الدخول لتنفيذ هذه العملية')
  if (!canRole(user.role, channel)) {
    throw new Error(`ليس لديك صلاحية لتنفيذ العملية: ${channel}`)
  }
}

export const PUBLIC_CHANNELS: ReadonlySet<string> = new Set([
  IPC.licenseStatus,
  IPC.licenseActivate,
  IPC.licenseFingerprint,
  IPC.usersCount,
  IPC.usersBootstrap,
  IPC.usersLogin,
  IPC.usersCurrent,
  IPC.usersLogout
])

export function assertAuthenticated(channel: string, user: AppUser | null): void {
  if (!PUBLIC_CHANNELS.has(channel) && !user) {
    throw new Error('يجب تسجيل الدخول لقراءة بيانات المتجر')
  }
}

export const ROLE_PERMISSIONS = Object.freeze({
  admin: ADMIN_CHANNELS,
  manager: MANAGER_CHANNELS,
  cashier: CASHIER_CHANNELS
})
