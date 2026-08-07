/**
 * تسجيل عقود IPC (§7) — غلاف رقيق: كل handler يفوّض لطبقة repos مباشرة،
 * ويمرّر «المستدعي» من جلسة المستخدم النشط للعمليات التي تحتاجه
 * (سقف الخصم + التدقيق). الأخطاء تُرمى Error عادي (§7) وتُفكّ في الواجهة.
 */
import { app, ipcMain, BrowserWindow, dialog } from 'electron'
import type { IpcMainInvokeEvent } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
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
import * as reports from './repos/reports'
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
import type { ActivateResult, LicenseStatus, PnlReport } from '../shared/types'
import { assertLicenseWritable } from './license-gate'
import { WRITE_CHANNELS } from './ipc-write-channels'
import { getDeviceFingerprint } from './device-fingerprint'
import { assertAuthenticated, assertPermission } from './permissions'
import { createBackup, deleteBackup, listBackups, restoreBackup, validateBackup } from './backups'

function actor(): ActorRef {
  const user = getCurrentUser()
  return { userId: user?.id ?? null, role: user?.role ?? null }
}

function assertTrustedRenderer(event: IpcMainInvokeEvent): void {
  const url = event.senderFrame?.url ?? event.sender.getURL()
  if (url.startsWith('file://')) return

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    try {
      if (new URL(url).origin === new URL(devUrl).origin) return
    } catch {
      /* falls through to the explicit rejection */
    }
  }
  throw new Error('مصدر IPC غير موثوق')
}

export function registerIpc(
  db: Db,
  userDataDir: string,
  dbPath: string = join(userDataDir, 'rafd.db'),
  appVersion = '0.1.0'
): void {
  /**
   * بوابة قفل الكتابة المركزية (§8.3): كل تسجيل يمرّ من هنا؛ القناة المصنَّفة
   * كتابةً في ipc-write-channels.ts تُفحص حالة ترخيصها قبل أي تنفيذ.
   * لا فحص يدوي مكرر داخل المعالجات أو المستودعات (قرار تصميم التكليف).
   */
  const on: typeof ipcMain.handle = (channel, listener) => {
    ipcMain.handle(channel, (event, ...args) => {
      assertTrustedRenderer(event)
      const currentUser = getCurrentUser()
      assertAuthenticated(channel, currentUser)
      if (WRITE_CHANNELS.has(channel)) {
        assertLicenseWritable(userDataDir)
        // إنشاء أول مدير هو الاستثناء الوحيد قبل وجود جلسة.
        if (channel !== IPC.usersBootstrap) assertPermission(channel, currentUser)
      }
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
  on(IPC.salesList, (_e, filters?: { customer_id?: number; status?: string }) =>
    sales.listSales(db, filters)
  )
  on(IPC.salesGet, (_e, sale_id: number) => sales.getSaleWithItems(db, sale_id))
  on(IPC.salesCreate, (_e, payload: NewSale) => sales.createSale(db, payload, actor()))
  on(IPC.salesUpdate, (_e, id: number, patch: SalePatch) =>
    sales.updateSale(db, id, patch, actor())
  )
  on(IPC.salesVoid, (_e, id: number, reason: string) =>
    sales.voidSale(db, id, reason, actor())
  )
  on(IPC.salesDelete, (_e, id: number) => sales.deleteSale(db, id, actor()))

  /* مستخدمون */
  on(IPC.usersCount, () => users.countUsers(db))
  on(IPC.usersBootstrap, (_e, full_name: string, pin: string) =>
    users.bootstrapAdmin(db, full_name, pin)
  )
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
    if (!(bytes instanceof Uint8Array) || bytes.length === 0) return false
    console.log(`printerPrintRaw: ${bytes.length} bytes`)
    let SerialPortMod: any = null
    try {
      SerialPortMod = require('serialport').SerialPort
    } catch (err) {
      console.warn('serialport is not compiled or available.', err)
      return false
    }
    if (!SerialPortMod) return false

    try {
      const settings = storeSettings.getStoreSettings(db)
      const configuredPath = settings?.printer_port?.trim()
      if (!configuredPath) {
        console.warn('Thermal printer port is not configured')
        return false
      }
      const list = await SerialPortMod.list()
      const portInfo = list.find((port: any) => port.path === configuredPath)
      if (!portInfo?.path) {
        console.warn(`Configured thermal printer port is unavailable: ${configuredPath}`)
        return false
      }
      const baudRate = Number(settings?.printer_baud_rate || 9600)
      const port = new SerialPortMod({ path: portInfo.path, baudRate })
      return new Promise<boolean>((resolve) => {
        let settled = false
        const finish = (success: boolean) => {
          if (settled) return
          settled = true
          try {
            port.close()
          } catch {
            /* port may already be closed */
          }
          resolve(success)
        }
        port.on('error', (error: unknown) => {
          console.error('Serial port error:', error)
          finish(false)
        })
        port.write(Buffer.from(bytes), (error: Error | null) => {
          if (error) {
            console.error('Serial port write error:', error)
            finish(false)
          } else {
            finish(true)
          }
        })
      })
    } catch (err) {
      console.error('Failed to print to serial port:', err)
      return false
    }
  })

  on(IPC.printerPrintHtml, async (_e, html: string): Promise<boolean> => {
    if (typeof html !== 'string' || !html.trim()) return false
    console.log(`printerPrintHtml: ${html.length} chars`)
    const printWindow = new BrowserWindow({
      show: false,
      width: 800,
      height: 1000,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    try {
      await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
      return await new Promise<boolean>((resolve) => {
        printWindow.webContents.print(
          { silent: false, printBackground: true },
          (success, failureReason) => {
            if (!success) console.error(`Print failed: ${failureReason}`)
            resolve(success)
          }
        )
      })
    } catch (error) {
      console.error('Failed to prepare HTML for printing:', error)
      return false
    } finally {
      if (!printWindow.isDestroyed()) printWindow.close()
    }
  })

  on(IPC.filesSaveText, async (_e, filename: string, content: string): Promise<boolean> => {
    console.log(`filesSaveText requested: ${filename}`)
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return false
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'حفظ الملف',
      defaultPath: filename,
      filters: [
        { name: 'CSV / Text Files', extensions: ['csv', 'txt'] },
        { name: 'All Files', extensions: ['*'] }
      ]
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

  /* النسخ الاحتياطية */
  on(IPC.backupsList, () => listBackups(userDataDir))
  on(IPC.backupsValidate, (_e, id: string) => validateBackup(userDataDir, id))
  on(IPC.backupsCreate, async () => createBackup(db, userDataDir, appVersion))
  on(IPC.backupsDelete, (_e, id: string) => deleteBackup(userDataDir, id))
  on(IPC.backupsRestore, async (_e, id: string) => {
    const result = await restoreBackup(db, userDataDir, dbPath, id, appVersion)
    // الاستعادة تستبدل ملف القاعدة؛ إعادة التشغيل إلزامية لإعادة بناء جميع المقابض.
    setTimeout(() => {
      app.relaunch()
      app.exit(0)
    }, 100)
    return result
  })

  on(IPC.reportsGet, (_e, startDate: string, endDate: string): PnlReport => {
    console.log(`reportsGet requested for range: ${startDate} to ${endDate}`)
    return reports.getPnlReport(db, startDate, endDate)
  })
}
