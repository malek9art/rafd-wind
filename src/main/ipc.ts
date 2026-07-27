/**
 * تسجيل عقود IPC (§7) — غلاف رقيق: كل handler يفوّض لطبقة repos مباشرة،
 * ويمرّر «المستدعي» من جلسة المستخدم النشط للعمليات التي تحتاجه
 * (سقف الخصم + التدقيق). الأخطاء تُرمى Error عادي (§7) وتُفكّ في الواجهة.
 */
import { ipcMain } from 'electron'
import type { Db } from './db'
import { IPC } from '../shared/types'
import type {
  AuditFilters,
  BankAccountPatch,
  CustomerPatch,
  ExpensePatch,
  NewBankAccount,
  NewCustomer,
  NewExpense,
  NewLedgerEntry,
  NewPaymentTerminal,
  NewProduct,
  NewPurchase,
  NewSale,
  NewSupplier,
  NewSupplierLedgerEntry,
  NewUser,
  PaymentTerminalPatch,
  ProductPatch,
  PurchasePatch,
  SalePatch,
  StoreSettingsPatch,
  SupplierPatch,
  UserPatch
} from '../shared/types'
import { getCurrentUser } from './session'
import type { ActorRef } from './repos/sales'
import * as products from './repos/products'
import * as customers from './repos/customers'
import * as customerLedger from './repos/customerLedger'
import * as suppliers from './repos/suppliers'
import * as supplierLedger from './repos/supplierLedger'
import * as purchases from './repos/purchases'
import * as sales from './repos/sales'
import * as users from './repos/users'
import * as auditLogs from './repos/auditLogs'
import * as storeSettings from './repos/storeSettings'
import {
  createExpense,
  deleteExpense,
  listExpenses,
  updateExpense,
  createBankAccount,
  deleteBankAccount,
  listBankAccounts,
  updateBankAccount,
  createPaymentTerminal,
  deletePaymentTerminal,
  listPaymentTerminals,
  updatePaymentTerminal
} from './repos/crudSimple'
import {
  loadLicenseStatus,
  saveActivatedLicense,
  verifyLicenseKey
} from './license'
import type { ActivateResult, LicenseStatus } from '../shared/types'

function actor(): ActorRef {
  const user = getCurrentUser()
  return { userId: user?.id ?? null, role: user?.role ?? null }
}

export function registerIpc(db: Db, userDataDir: string): void {
  /* ترخيص */
  ipcMain.handle(IPC.licenseStatus, (): LicenseStatus => loadLicenseStatus(userDataDir))
  ipcMain.handle(IPC.licenseActivate, (_e, key: string): ActivateResult => {
    if (typeof key !== 'string') return { ok: false, error: 'مفتاح التفعيل مطلوب' }
    const result = verifyLicenseKey(key)
    if (!result.ok) return { ok: false, error: result.error }
    saveActivatedLicense(userDataDir, key, result.info)
    return { ok: true, info: result.info }
  })

  /* منتجات */
  ipcMain.handle(IPC.productsList, (_e, filters?: { active_only?: boolean; category?: string }) =>
    products.listProducts(db, filters)
  )
  ipcMain.handle(IPC.productsCreate, (_e, payload: NewProduct) =>
    products.createProduct(db, payload)
  )
  ipcMain.handle(IPC.productsUpdate, (_e, id: number, patch: ProductPatch) =>
    products.updateProduct(db, id, patch)
  )
  ipcMain.handle(IPC.productsDelete, (_e, id: number) => products.deleteProduct(db, id))

  /* عملاء + دفتر */
  ipcMain.handle(IPC.customersList, () => customers.listCustomers(db))
  ipcMain.handle(IPC.customersCreate, (_e, payload: NewCustomer) =>
    customers.createCustomer(db, payload)
  )
  ipcMain.handle(IPC.customersUpdate, (_e, id: number, patch: CustomerPatch) =>
    customers.updateCustomer(db, id, patch)
  )
  ipcMain.handle(IPC.customersDelete, (_e, id: number) => customers.deleteCustomer(db, id))
  ipcMain.handle(IPC.customerLedgerList, (_e, customer_id: number) =>
    customerLedger.listLedgerByCustomer(db, customer_id)
  )
  ipcMain.handle(IPC.customerLedgerAdd, (_e, payload: NewLedgerEntry) =>
    customerLedger.addLedgerEntry(db, { ...payload, amount: Number(payload.amount) })
  )

  /* موردون + دفتر */
  ipcMain.handle(IPC.suppliersList, () => suppliers.listSuppliers(db))
  ipcMain.handle(IPC.suppliersCreate, (_e, payload: NewSupplier) =>
    suppliers.createSupplier(db, payload)
  )
  ipcMain.handle(IPC.suppliersUpdate, (_e, id: number, patch: SupplierPatch) =>
    suppliers.updateSupplier(db, id, patch)
  )
  ipcMain.handle(IPC.suppliersDelete, (_e, id: number) => suppliers.deleteSupplier(db, id))
  ipcMain.handle(IPC.supplierLedgerList, (_e, supplier_id: number) =>
    supplierLedger.listLedgerBySupplier(db, supplier_id)
  )
  ipcMain.handle(IPC.supplierLedgerAdd, (_e, payload: NewSupplierLedgerEntry) =>
    supplierLedger.addSupplierLedgerEntry(db, { ...payload, amount: Number(payload.amount) })
  )

  /* مشتريات */
  ipcMain.handle(IPC.purchasesList, (_e, filters?: { supplier_id?: number; status?: string }) =>
    purchases.listPurchases(db, filters)
  )
  ipcMain.handle(IPC.purchasesGet, (_e, id: number) => purchases.getPurchaseWithItems(db, id))
  ipcMain.handle(IPC.purchasesCreate, (_e, payload: NewPurchase) =>
    purchases.createPurchase(db, payload, actor())
  )
  ipcMain.handle(IPC.purchasesUpdate, (_e, id: number, patch: PurchasePatch) =>
    purchases.updatePurchase(db, id, patch, actor())
  )
  ipcMain.handle(IPC.purchasesDelete, (_e, id: number) => purchases.deletePurchase(db, id, actor()))

  /* مصروفات */
  ipcMain.handle(IPC.expensesList, () => listExpenses(db))
  ipcMain.handle(IPC.expensesCreate, (_e, payload: NewExpense) => createExpense(db, payload))
  ipcMain.handle(IPC.expensesUpdate, (_e, id: number, patch: ExpensePatch) =>
    updateExpense(db, id, patch)
  )
  ipcMain.handle(IPC.expensesDelete, (_e, id: number) => deleteExpense(db, id))

  /* حسابات بنكية */
  ipcMain.handle(IPC.bankAccountsList, () => listBankAccounts(db))
  ipcMain.handle(IPC.bankAccountsCreate, (_e, payload: NewBankAccount) =>
    createBankAccount(db, payload)
  )
  ipcMain.handle(IPC.bankAccountsUpdate, (_e, id: number, patch: BankAccountPatch) =>
    updateBankAccount(db, id, patch)
  )
  ipcMain.handle(IPC.bankAccountsDelete, (_e, id: number) => deleteBankAccount(db, id))

  /* طرفيات */
  ipcMain.handle(IPC.paymentTerminalsList, () => listPaymentTerminals(db))
  ipcMain.handle(IPC.paymentTerminalsCreate, (_e, payload: NewPaymentTerminal) =>
    createPaymentTerminal(db, payload)
  )
  ipcMain.handle(IPC.paymentTerminalsUpdate, (_e, id: number, patch: PaymentTerminalPatch) =>
    updatePaymentTerminal(db, id, patch)
  )
  ipcMain.handle(IPC.paymentTerminalsDelete, (_e, id: number) => deletePaymentTerminal(db, id))

  /* مبيعات */
  ipcMain.handle(IPC.salesList, (_e, filters?: { customer_id?: number }) =>
    sales.listSales(db, filters)
  )
  ipcMain.handle(IPC.salesGet, (_e, sale_id: number) => sales.getSaleWithItems(db, sale_id))
  ipcMain.handle(IPC.salesCreate, (_e, payload: NewSale) => sales.createSale(db, payload, actor()))
  ipcMain.handle(IPC.salesUpdate, (_e, id: number, patch: SalePatch) =>
    sales.updateSale(db, id, patch, actor())
  )
  ipcMain.handle(IPC.salesDelete, (_e, id: number) => sales.deleteSale(db, id, actor()))

  /* مستخدمون */
  ipcMain.handle(IPC.usersList, () => users.listUsers(db))
  ipcMain.handle(IPC.usersGet, (_e, id: number) => users.getUser(db, id))
  ipcMain.handle(IPC.usersCreate, (_e, payload: NewUser) => users.createUser(db, payload))
  ipcMain.handle(IPC.usersUpdate, (_e, id: number, patch: UserPatch) =>
    users.updateUser(db, id, patch)
  )
  ipcMain.handle(IPC.usersDelete, (_e, id: number) => users.deleteUser(db, id))
  ipcMain.handle(IPC.usersLogin, (_e, identifier: string, pin: string) =>
    users.loginUser(db, identifier, pin)
  )
  ipcMain.handle(IPC.usersCurrent, () => getCurrentUser())
  ipcMain.handle(IPC.usersLogout, () => {
    users._logout()
  })

  /* تدقيق */
  ipcMain.handle(IPC.auditLogsList, (_e, filters?: AuditFilters) =>
    auditLogs.listAuditLogs(db, filters)
  )

  /* إعدادات المتجر */
  ipcMain.handle(IPC.storeSettingsGet, () => storeSettings.getStoreSettings(db))
  ipcMain.handle(IPC.storeSettingsUpdate, (_e, patch: StoreSettingsPatch) =>
    storeSettings.updateStoreSettings(db, patch)
  )
}
