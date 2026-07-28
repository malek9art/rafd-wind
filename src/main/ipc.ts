/**
 * تسجيل عقود IPC (§7) — غلاف رقيق: كل handler يفوّض لطبقة repos مباشرة،
 * ويمرّر «المستدعي» من جلسة المستخدم النشط للعمليات التي تحتاجه
 * (سقف الخصم + التدقيق). الأخطاء تُرمى Error عادي (§7) وتُفكّ في الواجهة.
 */
import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync } from 'node:fs'
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
import { assertLicenseWritable } from './license-gate'
import { WRITE_CHANNELS } from './ipc-write-channels'
import { getDeviceFingerprint } from './device-fingerprint'

function actor(): ActorRef {
  const user = getCurrentUser()
  return { userId: user?.id ?? null, role: user?.role ?? null }
}

export function registerIpc(db: Db, userDataDir: string): void {
  /**
   * بوابة قفل الكتابة المركزية (§8.3): كل تسجيل يمرّ من هنا؛ القناة المصنَّفة
   * كتابةً في ipc-write-channels.ts تُفحص حالة ترخيصها قبل أي تنفيذ.
   * لا فحص يدوي مكرر داخل المعالجات أو المستودعات (قرار تصميم التكليف).
   */
  const on: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      if (WRITE_CHANNELS.has(channel)) assertLicenseWritable(userDataDir)
      return listener(event, ...args)
    })
  }

  /* ترخيص */
  on(IPC.licenseStatus, (): LicenseStatus => loadLicenseStatus(userDataDir))
  on(IPC.licenseActivate, (_e, key: string): ActivateResult => {
    if (typeof key !== 'string') return { ok: false, error: 'مفتاح التفعيل مطلوب' }
    const result = verifyLicenseKey(key)
    if (!result.ok) return { ok: false, error: result.error }
    saveActivatedLicense(userDataDir, key, result.info)
    // حتى المفتاح المنتهي الموقَّع يُفعَّل: يفتح التطبيق للقراءة ويبقى قفل الكتابة
    // عليه — التفعيل هو طريق التجديد ذاته فلا يجوز حظره (§8.3)
    const { info, expired, expiring_soon } = result
    return { ok: true, info, expired, expiring_soon }
  })
  on(IPC.licenseFingerprint, (): string => getDeviceFingerprint())

  /* منتجات */
  on(IPC.productsList, (_e, filters?: { active_only?: boolean; category?: string }) =>
    products.listProducts(db, filters)
  )
  on(IPC.productsCreate, (_e, payload: NewProduct) =>
    products.createProduct(db, payload)
  )
  on(IPC.productsUpdate, (_e, id: number, patch: ProductPatch) =>
    products.updateProduct(db, id, patch)
  )
  on(IPC.productsDelete, (_e, id: number) => products.deleteProduct(db, id))
  on(IPC.productsRestock, (_e, productId: number, cartons: number, cartonCost: number, unitsPerCarton: number) =>
    products.restockProduct(db, productId, cartons, cartonCost, unitsPerCarton)
  )

  /* عملاء + دفتر */
  on(IPC.customersList, () => customers.listCustomers(db))
  on(IPC.customersCreate, (_e, payload: NewCustomer) =>
    customers.createCustomer(db, payload)
  )
  on(IPC.customersUpdate, (_e, id: number, patch: CustomerPatch) =>
    customers.updateCustomer(db, id, patch)
  )
  on(IPC.customersDelete, (_e, id: number) => customers.deleteCustomer(db, id))
  on(IPC.customerLedgerList, (_e, customer_id: number) =>
    customerLedger.listLedgerByCustomer(db, customer_id)
  )
  on(IPC.customerLedgerAdd, (_e, payload: NewLedgerEntry) =>
    customerLedger.addLedgerEntry(db, { ...payload, amount: Number(payload.amount) })
  )

  /* موردون + دفتر */
  on(IPC.suppliersList, () => suppliers.listSuppliers(db))
  on(IPC.suppliersCreate, (_e, payload: NewSupplier) =>
    suppliers.createSupplier(db, payload)
  )
  on(IPC.suppliersUpdate, (_e, id: number, patch: SupplierPatch) =>
    suppliers.updateSupplier(db, id, patch)
  )
  on(IPC.suppliersDelete, (_e, id: number) => suppliers.deleteSupplier(db, id))
  on(IPC.supplierLedgerList, (_e, supplier_id: number) =>
    supplierLedger.listLedgerBySupplier(db, supplier_id)
  )
  on(IPC.supplierLedgerAdd, (_e, payload: NewSupplierLedgerEntry) =>
    supplierLedger.addSupplierLedgerEntry(db, { ...payload, amount: Number(payload.amount) })
  )

  /* مشتريات */
  on(IPC.purchasesList, (_e, filters?: { supplier_id?: number; status?: string }) =>
    purchases.listPurchases(db, filters)
  )
  on(IPC.purchasesGet, (_e, id: number) => purchases.getPurchaseWithItems(db, id))
  on(IPC.purchasesCreate, (_e, payload: NewPurchase) =>
    purchases.createPurchase(db, payload, actor())
  )
  on(IPC.purchasesUpdate, (_e, id: number, patch: PurchasePatch) =>
    purchases.updatePurchase(db, id, patch, actor())
  )
  on(IPC.purchasesDelete, (_e, id: number) => purchases.deletePurchase(db, id, actor()))

  /* مصروفات */
  on(IPC.expensesList, () => listExpenses(db))
  on(IPC.expensesCreate, (_e, payload: NewExpense) => createExpense(db, payload))
  on(IPC.expensesUpdate, (_e, id: number, patch: ExpensePatch) =>
    updateExpense(db, id, patch)
  )
  on(IPC.expensesDelete, (_e, id: number) => deleteExpense(db, id))

  /* حسابات بنكية */
  on(IPC.bankAccountsList, () => listBankAccounts(db))
  on(IPC.bankAccountsCreate, (_e, payload: NewBankAccount) =>
    createBankAccount(db, payload)
  )
  on(IPC.bankAccountsUpdate, (_e, id: number, patch: BankAccountPatch) =>
    updateBankAccount(db, id, patch)
  )
  on(IPC.bankAccountsDelete, (_e, id: number) => deleteBankAccount(db, id))

  /* طرفيات */
  on(IPC.paymentTerminalsList, () => listPaymentTerminals(db))
  on(IPC.paymentTerminalsCreate, (_e, payload: NewPaymentTerminal) =>
    createPaymentTerminal(db, payload)
  )
  on(IPC.paymentTerminalsUpdate, (_e, id: number, patch: PaymentTerminalPatch) =>
    updatePaymentTerminal(db, id, patch)
  )
  on(IPC.paymentTerminalsDelete, (_e, id: number) => deletePaymentTerminal(db, id))

  /* مبيعات */
  on(IPC.salesList, (_e, filters?: { customer_id?: number }) =>
    sales.listSales(db, filters)
  )
  on(IPC.salesGet, (_e, sale_id: number) => sales.getSaleWithItems(db, sale_id))
  on(IPC.salesCreate, (_e, payload: NewSale) => sales.createSale(db, payload, actor()))
  on(IPC.salesUpdate, (_e, id: number, patch: SalePatch) =>
    sales.updateSale(db, id, patch, actor())
  )
  on(IPC.salesDelete, (_e, id: number) => sales.deleteSale(db, id, actor()))

  /* مستخدمون */
  on(IPC.usersList, () => users.listUsers(db))
  on(IPC.usersGet, (_e, id: number) => users.getUser(db, id))
  on(IPC.usersCreate, (_e, payload: NewUser) => users.createUser(db, payload))
  on(IPC.usersUpdate, (_e, id: number, patch: UserPatch) =>
    users.updateUser(db, id, patch)
  )
  on(IPC.usersDelete, (_e, id: number) => users.deleteUser(db, id))
  on(IPC.usersLogin, (_e, identifier: string, pin: string) =>
    users.loginUser(db, identifier, pin)
  )
  on(IPC.usersCurrent, () => getCurrentUser())
  on(IPC.usersLogout, () => {
    users._logout()
  })

  /* تدقيق */
  on(IPC.auditLogsList, (_e, filters?: AuditFilters) =>
    auditLogs.listAuditLogs(db, filters)
  )

  /* إعدادات المتجر */
  on(IPC.storeSettingsGet, () => storeSettings.getStoreSettings(db))
  on(IPC.storeSettingsUpdate, (_e, patch: StoreSettingsPatch) =>
    storeSettings.updateStoreSettings(db, patch)
  )

  /* الطباعة */
  on(IPC.printerPrintRaw, async (_e, bytes: Uint8Array): Promise<boolean> => {
    console.log(`printerPrintRaw: ${bytes.length} bytes`)
    let SerialPortMod: any = null
    try {
      SerialPortMod = require('serialport').SerialPort
    } catch (err) {
      console.warn('serialport is not compiled or available. Fallback to mock printing.', err)
      return true
    }
    if (!SerialPortMod) {
      console.warn('SerialPortMod is null, fallback to mock printing.')
      return true
    }
    try {
      const list = await SerialPortMod.list()
      const portInfo = list.find((p: any) => p.vendorId || p.productId) || list[0]
      if (!portInfo) {
        console.warn('No serial ports found. Mock printing success.')
        return true
      }
      const port = new SerialPortMod({
        path: portInfo.path,
        baudRate: 9600
      })
      return new Promise<boolean>((resolve) => {
        port.write(Buffer.from(bytes), (err: any) => {
          port.close()
          if (err) {
            console.error('Serial port write error:', err)
            resolve(false)
          } else {
            resolve(true)
          }
        })
      })
    } catch (err) {
      console.error('Failed to print to serial port:', err)
      return false
    }
  })

  on(IPC.printerPrintHtml, (_e, html: string): Promise<boolean> => {
    console.log(`printerPrintHtml: ${html.length} chars`)
    const win = BrowserWindow.getFocusedWindow()
    if (!win) {
      console.warn('No focused window found for html printing')
      return Promise.resolve(false)
    }
    return new Promise<boolean>((resolve) => {
      win.webContents.print({ silent: false, printBackground: true }, (success, failureReason) => {
        if (!success) {
          console.error(`Print failed: ${failureReason}`)
        }
        resolve(success)
      })
    })
  })

  on(IPC.filesSaveText, async (_e, filename: string, content: string): Promise<boolean> => {
    console.log(`filesSaveText requested: ${filename}`)
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return false
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'حفظ كشف الحساب',
      defaultPath: filename,
      filters: [{ name: 'Text Files', extensions: ['txt'] }]
    })
    if (canceled || !filePath) return false
    try {
      writeFileSync(filePath, content, 'utf8')
      return true
    } catch (err) {
      console.error('Failed to save file via native dialog:', err)
      return false
    }
  })
}
