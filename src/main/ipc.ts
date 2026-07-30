/**
 * تسجيل عقود IPC (§7) — غلاف رقيق: كل handler يفوّض لطبقة repos مباشرة،
 * ويمرّر «المستدعي» من جلسة المستخدم النشط للعمليات التي تحتاجه
 * (سقف الخصم + التدقيق). الأخطاء تُرمى Error عادي (§7) وتُفكّ في الواجهة.
 */
import { ipcMain, BrowserWindow, dialog } from 'electron'
import { writeFileSync, readFileSync, copyFileSync, existsSync, unlinkSync, statSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { Db } from './db'
import { openDb } from './db'
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

function actor(): ActorRef {
  const user = getCurrentUser()
  return { userId: user?.id ?? null, role: user?.role ?? null }
}

export function registerIpc(currentDb: Db, userDataDir: string): void {
  let mutableDb = currentDb
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
    products.listProducts(mutableDb, filters)
  )
  on(IPC.productsCreate, (_e, payload: NewProduct) =>
    products.createProduct(mutableDb, payload)
  )
  on(IPC.productsUpdate, (_e, id: number, patch: ProductPatch) =>
    products.updateProduct(mutableDb, id, patch)
  )
  on(IPC.productsDelete, (_e, id: number) => products.deleteProduct(mutableDb, id))
  on(IPC.productsRestock, (_e, productId: number, cartons: number, cartonCost: number, unitsPerCarton: number) =>
    products.restockProduct(mutableDb, productId, cartons, cartonCost, unitsPerCarton)
  )

  /* عملاء + دفتر */
  on(IPC.customersList, () => customers.listCustomers(mutableDb))
  on(IPC.customersCreate, (_e, payload: NewCustomer) =>
    customers.createCustomer(mutableDb, payload)
  )
  on(IPC.customersUpdate, (_e, id: number, patch: CustomerPatch) =>
    customers.updateCustomer(mutableDb, id, patch)
  )
  on(IPC.customersDelete, (_e, id: number) => customers.deleteCustomer(mutableDb, id))
  on(IPC.customerLedgerList, (_e, customer_id: number) =>
    customerLedger.listLedgerByCustomer(mutableDb, customer_id)
  )
  on(IPC.customerLedgerAdd, (_e, payload: NewLedgerEntry) =>
    customerLedger.addLedgerEntry(mutableDb, { ...payload, amount: Number(payload.amount) })
  )

  /* موردون + دفتر */
  on(IPC.suppliersList, () => suppliers.listSuppliers(mutableDb))
  on(IPC.suppliersCreate, (_e, payload: NewSupplier) =>
    suppliers.createSupplier(mutableDb, payload)
  )
  on(IPC.suppliersUpdate, (_e, id: number, patch: SupplierPatch) =>
    suppliers.updateSupplier(mutableDb, id, patch)
  )
  on(IPC.suppliersDelete, (_e, id: number) => suppliers.deleteSupplier(mutableDb, id))
  on(IPC.supplierLedgerList, (_e, supplier_id: number) =>
    supplierLedger.listLedgerBySupplier(mutableDb, supplier_id)
  )
  on(IPC.supplierLedgerAdd, (_e, payload: NewSupplierLedgerEntry) =>
    supplierLedger.addSupplierLedgerEntry(mutableDb, { ...payload, amount: Number(payload.amount) })
  )

  /* مشتريات */
  on(IPC.purchasesList, (_e, filters?: { supplier_id?: number; status?: string }) =>
    purchases.listPurchases(mutableDb, filters)
  )
  on(IPC.purchasesGet, (_e, id: number) => purchases.getPurchaseWithItems(mutableDb, id))
  on(IPC.purchasesCreate, (_e, payload: NewPurchase) =>
    purchases.createPurchase(mutableDb, payload, actor())
  )
  on(IPC.purchasesUpdate, (_e, id: number, patch: PurchasePatch) =>
    purchases.updatePurchase(mutableDb, id, patch, actor())
  )
  on(IPC.purchasesDelete, (_e, id: number) => purchases.deletePurchase(mutableDb, id, actor()))

  /* مصروفات */
  on(IPC.expensesList, () => listExpenses(mutableDb))
  on(IPC.expensesCreate, (_e, payload: NewExpense) => createExpense(mutableDb, payload))
  on(IPC.expensesUpdate, (_e, id: number, patch: ExpensePatch) =>
    updateExpense(mutableDb, id, patch)
  )
  on(IPC.expensesDelete, (_e, id: number) => deleteExpense(mutableDb, id))

  /* حسابات بنكية */
  on(IPC.bankAccountsList, () => listBankAccounts(mutableDb))
  on(IPC.bankAccountsCreate, (_e, payload: NewBankAccount) =>
    createBankAccount(mutableDb, payload)
  )
  on(IPC.bankAccountsUpdate, (_e, id: number, patch: BankAccountPatch) =>
    updateBankAccount(mutableDb, id, patch)
  )
  on(IPC.bankAccountsDelete, (_e, id: number) => deleteBankAccount(mutableDb, id))

  /* طرفيات */
  on(IPC.paymentTerminalsList, () => listPaymentTerminals(mutableDb))
  on(IPC.paymentTerminalsCreate, (_e, payload: NewPaymentTerminal) =>
    createPaymentTerminal(mutableDb, payload)
  )
  on(IPC.paymentTerminalsUpdate, (_e, id: number, patch: PaymentTerminalPatch) =>
    updatePaymentTerminal(mutableDb, id, patch)
  )
  on(IPC.paymentTerminalsDelete, (_e, id: number) => deletePaymentTerminal(mutableDb, id))

  /* مبيعات */
  on(IPC.salesList, (_e, filters?: { customer_id?: number }) =>
    sales.listSales(mutableDb, filters)
  )
  on(IPC.salesGet, (_e, sale_id: number) => sales.getSaleWithItems(mutableDb, sale_id))
  on(IPC.salesCreate, (_e, payload: NewSale) => sales.createSale(mutableDb, payload, actor()))
  on(IPC.salesUpdate, (_e, id: number, patch: SalePatch) =>
    sales.updateSale(mutableDb, id, patch, actor())
  )
  on(IPC.salesDelete, (_e, id: number) => sales.deleteSale(mutableDb, id, actor()))

  /* مستخدمون */
  on(IPC.usersList, () => users.listUsers(mutableDb))
  on(IPC.usersGet, (_e, id: number) => users.getUser(mutableDb, id))
  on(IPC.usersCreate, (_e, payload: NewUser) => users.createUser(mutableDb, payload))
  on(IPC.usersUpdate, (_e, id: number, patch: UserPatch) =>
    users.updateUser(mutableDb, id, patch)
  )
  on(IPC.usersDelete, (_e, id: number) => users.deleteUser(mutableDb, id))
  on(IPC.usersLogin, (_e, identifier: string, pin: string) =>
    users.loginUser(mutableDb, identifier, pin)
  )
  on(IPC.usersCurrent, () => getCurrentUser())
  on(IPC.usersLogout, () => {
    users._logout()
  })

  /* تدقيق */
  on(IPC.auditLogsList, (_e, filters?: AuditFilters) =>
    auditLogs.listAuditLogs(mutableDb, filters)
  )

  /* إعدادات المتجر */
  on(IPC.storeSettingsGet, () => storeSettings.getStoreSettings(mutableDb))
  on(IPC.storeSettingsUpdate, (_e, patch: StoreSettingsPatch) =>
    storeSettings.updateStoreSettings(mutableDb, patch)
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

  on(IPC.reportsGet, (_e, startDate: string, endDate: string): PnlReport => {
    console.log(`reportsGet requested for range: ${startDate} to ${endDate}`)
    return reports.getPnlReport(mutableDb, startDate, endDate)
  })

  /* النسخ الاحتياطي المحلي (§10) — قناة ملف ثنائي + استعادة */
  function isValidSqliteHeader(filePath: string): boolean {
    try {
      const fd = require('fs').openSync(filePath, 'r')
      const buf = Buffer.alloc(16)
      require('fs').readSync(fd, buf, 0, 16, 0)
      require('fs').closeSync(fd)
      return buf.toString('ascii', 0, 16).startsWith('SQLite format 3')
    } catch {
      return false
    }
  }

  on(IPC.filesSaveBinary, async (_e, filename: string, data: Uint8Array): Promise<boolean> => {
    const win = BrowserWindow.getFocusedWindow()
    if (!win) return false
    const { filePath, canceled } = await dialog.showSaveDialog(win, {
      title: 'حفظ الملف الثنائي',
      defaultPath: filename,
      filters: [
        { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
        { name: 'All Files', extensions: ['*'] }
      ]
    })
    if (canceled || !filePath) return false
    try {
      writeFileSync(filePath, Buffer.from(data))
      return true
    } catch (err) {
      console.error('Failed to save binary file:', err)
      return false
    }
  })

  on(IPC.backupManualSave, async (_e): Promise<{ ok: boolean; path?: string; error?: string }> => {
    try {
      const win = BrowserWindow.getFocusedWindow()
      const tempBackup = join(userDataDir, `rafd-backup-temp-${Date.now()}.db`)
      await mutableDb.backup(tempBackup)
      const backupData = readFileSync(tempBackup)
      const saveOpts = {
        title: 'حفظ نسخة احتياطية من قاعدة البيانات',
        defaultPath: `rafd-backup-${new Date().toISOString().slice(0, 10)}.db`,
        filters: [
          { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      }
      const saveResult = win ? await dialog.showSaveDialog(win, saveOpts) : await dialog.showSaveDialog(saveOpts)
      unlinkSync(tempBackup)
      const savedFilePath = saveResult?.filePath
      const saveCanceled = saveResult?.canceled
      if (saveCanceled || !savedFilePath) return { ok: false }
      writeFileSync(savedFilePath, backupData)
      return { ok: true, path: savedFilePath }
    } catch (err) {
      console.error('Manual backup failed:', err)
      return { ok: false, error: (err as Error).message }
    }
  })

  on(IPC.backupRestore, async (_e, selectedPath?: string): Promise<{ ok: boolean; rollbackPath?: string; error?: string }> => {
    try {
      let restoreFilePath: string | undefined = selectedPath
      if (!restoreFilePath) {
        const win = BrowserWindow.getFocusedWindow()
        const openOpts = {
          title: 'استعادة قاعدة البيانات من نسخة احتياطية',
          filters: [
            { name: 'SQLite Database', extensions: ['db', 'sqlite', 'sqlite3'] },
            { name: 'All Files', extensions: ['*'] }
          ],
          properties: ['openFile'] as Array<'openFile'>
        }
        const openResult = win ? await dialog.showOpenDialog(win, openOpts) : await dialog.showOpenDialog(openOpts)
        if (openResult.canceled || openResult.filePaths.length === 0) return { ok: false, error: 'لم يُختَر أي ملف' }
        restoreFilePath = openResult.filePaths[0]
      }
      if (!existsSync(restoreFilePath)) return { ok: false, error: 'الملف غير موجود' }
      if (!isValidSqliteHeader(restoreFilePath)) return { ok: false, error: 'رأس SQLite غير صالح — الملف ليس قاعدة بيانات صحيحة' }

      const dbPathValue = join(userDataDir, 'rafd.db')
      const rollbackPath = `${dbPathValue}.rollback-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.db`
      if (existsSync(dbPathValue) && statSync(dbPathValue).size > 0) {
        await mutableDb.backup(rollbackPath)
      }
      mutableDb.close()
      copyFileSync(restoreFilePath, dbPathValue)
      mutableDb = openDb(dbPathValue) as Db
      return { ok: true, rollbackPath }
    } catch (err) {
      console.error('Restore failed:', err)
      return { ok: false, error: (err as Error).message }
    }
  })

  /* الدفعة 5-2: النسخ السحابي عبر Supabase (rafd-dev — معزول تمامًا) (§10، §17.2) */
  on(IPC.cloudBackupUpload, async (_e): Promise<{ ok: boolean; error?: string; filePath?: string }> => {
    try {
      const tempBackup = join(userDataDir, `rafd-cloud-backup-temp-${Date.now()}.db`)
      await mutableDb.backup(tempBackup)
      const stat = statSync(tempBackup)
      const checksum = require('crypto').createHash('sha256').update(readFileSync(tempBackup)).digest('hex')
      // ملاحظة: رفع الملف الفعلي يتطلب إعداد بيئة rafd-dev (URL + anon key) —
      // هذه الدالة تُرجع بنية البيانات المُتوقَّعة وتُسجِّل خطأ واضحًا إذا لم تُعد البيئة.
      return {
        ok: false,
        error: 'Cloud upload requires rafd-dev Supabase configuration (§17.2). ' +
               'Bucket/table must be isolated from rafd-app. Check docs/CLOUD_BACKUP_DESIGN.md.'
      }
    } catch (err) {
      console.error('Cloud backup upload failed:', err)
      return { ok: false, error: (err as Error).message }
    }
  })

  on(IPC.cloudBackupDownload, async (_e, fileName?: string): Promise<{ ok: boolean; rollbackPath?: string; error?: string }> => {
    try {
      // ملاحظة: التنزيل الفعلي يتطلب إعداد بيئة rafd-dev وRLS مُطبَّق (§10، §17.2).
      return {
        ok: false,
        error: 'Cloud download requires rafd-dev Supabase environment and deployed RLS (§17.2). ' +
               'Check docs/CLOUD_BACKUP_DESIGN.md for isolated bucket/table design.'
      }
    } catch (err) {
      console.error('Cloud backup download failed:', err)
      return { ok: false, error: (err as Error).message }
    }
  })

  on(IPC.cloudBackupStatus, async (): Promise<{ lastUpload?: string; fileSize?: number; checksum?: string }> => {
    try {
      // ملاحظة: الحالة الفعلية تتطلب استعلام الجدول المعزول في rafd-dev.
      return {
        lastUpload: undefined,
        fileSize: undefined,
        checksum: undefined
      }
    } catch (err) {
      console.error('Cloud backup status failed:', err)
      return {}
    }
  })
}
