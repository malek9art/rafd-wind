/**
 * Preload — الجسر الوحيد بين الواجهة وطبقة Node (الوثيقة §7 + §11):
 * تعريف عبر contextBridge فقط، بدون nodeIntegration، مسارات محدودة محكومة.
 */
import { contextBridge, ipcRenderer } from 'electron'
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
  RafdLocalApi,
  SalePatch,
  StoreSettingsPatch,
  SupplierPatch,
  UserPatch
} from '../shared/types'

const api: RafdLocalApi = {
  license: {
    status: () => ipcRenderer.invoke(IPC.licenseStatus),
    activate: (key: string) => ipcRenderer.invoke(IPC.licenseActivate, key)
  },
  products: {
    list: (filters) => ipcRenderer.invoke(IPC.productsList, filters),
    create: (payload: NewProduct) => ipcRenderer.invoke(IPC.productsCreate, payload),
    update: (id: number, patch: ProductPatch) => ipcRenderer.invoke(IPC.productsUpdate, id, patch),
    delete: (id: number) => ipcRenderer.invoke(IPC.productsDelete, id)
  },
  customers: {
    list: () => ipcRenderer.invoke(IPC.customersList),
    create: (payload: NewCustomer) => ipcRenderer.invoke(IPC.customersCreate, payload),
    update: (id: number, patch: CustomerPatch) => ipcRenderer.invoke(IPC.customersUpdate, id, patch),
    delete: (id: number) => ipcRenderer.invoke(IPC.customersDelete, id)
  },
  customerLedger: {
    listByCustomer: (customer_id: number) => ipcRenderer.invoke(IPC.customerLedgerList, customer_id),
    addEntry: (payload: NewLedgerEntry) => ipcRenderer.invoke(IPC.customerLedgerAdd, payload)
  },
  suppliers: {
    list: () => ipcRenderer.invoke(IPC.suppliersList),
    create: (payload: NewSupplier) => ipcRenderer.invoke(IPC.suppliersCreate, payload),
    update: (id: number, patch: SupplierPatch) => ipcRenderer.invoke(IPC.suppliersUpdate, id, patch),
    delete: (id: number) => ipcRenderer.invoke(IPC.suppliersDelete, id)
  },
  supplierLedger: {
    listBySupplier: (supplier_id: number) => ipcRenderer.invoke(IPC.supplierLedgerList, supplier_id),
    addEntry: (payload: NewSupplierLedgerEntry) => ipcRenderer.invoke(IPC.supplierLedgerAdd, payload)
  },
  purchases: {
    list: (filters) => ipcRenderer.invoke(IPC.purchasesList, filters),
    get: (id: number) => ipcRenderer.invoke(IPC.purchasesGet, id),
    create: (payload: NewPurchase) => ipcRenderer.invoke(IPC.purchasesCreate, payload),
    update: (id: number, patch: PurchasePatch) => ipcRenderer.invoke(IPC.purchasesUpdate, id, patch),
    delete: (id: number) => ipcRenderer.invoke(IPC.purchasesDelete, id)
  },
  expenses: {
    list: () => ipcRenderer.invoke(IPC.expensesList),
    create: (payload: NewExpense) => ipcRenderer.invoke(IPC.expensesCreate, payload),
    update: (id: number, patch: ExpensePatch) => ipcRenderer.invoke(IPC.expensesUpdate, id, patch),
    delete: (id: number) => ipcRenderer.invoke(IPC.expensesDelete, id)
  },
  bankAccounts: {
    list: () => ipcRenderer.invoke(IPC.bankAccountsList),
    create: (payload: NewBankAccount) => ipcRenderer.invoke(IPC.bankAccountsCreate, payload),
    update: (id: number, patch: BankAccountPatch) => ipcRenderer.invoke(IPC.bankAccountsUpdate, id, patch),
    delete: (id: number) => ipcRenderer.invoke(IPC.bankAccountsDelete, id)
  },
  paymentTerminals: {
    list: () => ipcRenderer.invoke(IPC.paymentTerminalsList),
    create: (payload: NewPaymentTerminal) => ipcRenderer.invoke(IPC.paymentTerminalsCreate, payload),
    update: (id: number, patch: PaymentTerminalPatch) =>
      ipcRenderer.invoke(IPC.paymentTerminalsUpdate, id, patch),
    delete: (id: number) => ipcRenderer.invoke(IPC.paymentTerminalsDelete, id)
  },
  sales: {
    list: (filters) => ipcRenderer.invoke(IPC.salesList, filters),
    get: (sale_id: number) => ipcRenderer.invoke(IPC.salesGet, sale_id),
    create: (payload: NewSale) => ipcRenderer.invoke(IPC.salesCreate, payload),
    update: (id: number, patch: SalePatch) => ipcRenderer.invoke(IPC.salesUpdate, id, patch),
    delete: (id: number) => ipcRenderer.invoke(IPC.salesDelete, id)
  },
  users: {
    list: () => ipcRenderer.invoke(IPC.usersList),
    get: (id: number) => ipcRenderer.invoke(IPC.usersGet, id),
    create: (payload: NewUser) => ipcRenderer.invoke(IPC.usersCreate, payload),
    update: (id: number, patch: UserPatch) => ipcRenderer.invoke(IPC.usersUpdate, id, patch),
    delete: (id: number) => ipcRenderer.invoke(IPC.usersDelete, id),
    login: (identifier: string, pin: string) => ipcRenderer.invoke(IPC.usersLogin, identifier, pin),
    current: () => ipcRenderer.invoke(IPC.usersCurrent),
    logout: () => ipcRenderer.invoke(IPC.usersLogout)
  },
  auditLogs: {
    list: (filters?: AuditFilters) => ipcRenderer.invoke(IPC.auditLogsList, filters)
  },
  storeSettings: {
    get: () => ipcRenderer.invoke(IPC.storeSettingsGet),
    update: (patch: StoreSettingsPatch) => ipcRenderer.invoke(IPC.storeSettingsUpdate, patch)
  }
}

contextBridge.exposeInMainWorld('rafdLocal', api)
