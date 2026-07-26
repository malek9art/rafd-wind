/**
 * العملية الرئيسية (Main) — دورة حياة التطبيق، إنشاء النافذة، تسجيل عقود IPC (§7)،
 * ووضع فحص دخاني (--rafd-smoke / --rafd-smoke-verify) يُستخدم على GitHub Actions
 * windows-latest للتحقق الحقيقي من مسار: تفعيل → منتج → بيع → ثبات البيانات (§13).
 */
import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import type { Db } from './db'
import { createProduct, createSale, getSaleWithItems, listProducts, openDb } from './db'
import {
  loadLicenseStatus,
  saveActivatedLicense,
  verifyLicenseKey
} from './license'
import { IPC } from '../shared/types'
import type {
  ActivateResult,
  LicenseStatus,
  NewProduct,
  SaleItemInput,
  SaleWithItems
} from '../shared/types'

const SMOKE_WRITE = '--rafd-smoke'
const SMOKE_VERIFY = '--rafd-smoke-verify'
const smokeMode: 'write' | 'verify' | null = process.argv.includes(SMOKE_WRITE)
  ? 'write'
  : process.argv.includes(SMOKE_VERIFY)
    ? 'verify'
    : null

let db: Db
const userDataDir = () => app.getPath('userData')
const dbFilePath = () => join(userDataDir(), 'rafd.db')

function registerIpc(): void {
  ipcMain.handle(IPC.licenseStatus, (): LicenseStatus => loadLicenseStatus(userDataDir()))

  ipcMain.handle(IPC.licenseActivate, (_event, key: string): ActivateResult => {
    if (typeof key !== 'string') return { ok: false, error: 'مفتاح التفعيل مطلوب' }
    const result = verifyLicenseKey(key)
    if (!result.ok) return { ok: false, error: result.error }
    saveActivatedLicense(userDataDir(), key, result.info)
    return { ok: true, info: result.info }
  })

  ipcMain.handle(IPC.productsList, () => listProducts(db))

  ipcMain.handle(IPC.productsCreate, (_event, payload: NewProduct) =>
    createProduct(db, payload)
  )

  ipcMain.handle(IPC.salesCreate, (_event, payload: { items: SaleItemInput[]; paid: number }) =>
    createSale(db, payload)
  )

  ipcMain.handle(IPC.salesGet, (_event, sale_id: number): SaleWithItems =>
    getSaleWithItems(db, sale_id)
  )
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: true,
    autoHideMenuBar: true,
    title: 'رفد — نقطة بيع',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // قيود أمنية إلزامية (§11)
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  const devServerUrl = process.env['ELECTRON_RENDERER_URL']
  if (devServerUrl) {
    win.loadURL(devServerUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

/* ----------------------------------------------------------------------- */
/* وضع الفحص الدخاني للتكامل المستمر — يمر بنفس وحدات الإنتاج (db/license)   */
/* ----------------------------------------------------------------------- */

interface SmokeState {
  db_path: string
  product: { id: number; name: string; price: number }
  sale: SaleWithItems
  written_at: string
}

function smokeLog(name: string, data: unknown): void {
  writeFileSync(join(userDataDir(), name), JSON.stringify(data, null, 2), 'utf8')
}

function smokeFinish(ok: boolean, marker: string, detail: string, code: number): void {
  const line = `${marker} ${detail}`
  console.log(line)
  writeFileSync(join(userDataDir(), 'smoke-result.txt'), line, 'utf8')
  app.exit(ok ? 0 : code)
}

async function runSmokeWrite(win: BrowserWindow): Promise<void> {
  try {
    const rawKey = process.env['RAFD_TEST_LICENSE'] ?? ''
    const verified = verifyLicenseKey(rawKey)
    if (!verified.ok) throw new Error(`license verify failed: ${verified.error}`)
    saveActivatedLicense(userDataDir(), rawKey, verified.info)
    const status = loadLicenseStatus(userDataDir())
    if (!status.activated) throw new Error('license status not activated after save')

    const product = createProduct(db, {
      name: 'Smoke Cola 330ml',
      name_ar: 'كولا اختبار ٣٣٠مل',
      price: 5.5,
      cost: 4,
      stock: 24,
      unit: 'pcs'
    })
    const sale = createSale(db, { items: [{ product_id: product.id, quantity: 2 }], paid: 11 })
    const reread = getSaleWithItems(db, sale.sale.id)
    if (reread.sale.total !== 11 || reread.items.length !== 1) {
      throw new Error('sale reread mismatch')
    }
    const remaining = listProducts(db).find((p) => p.id === product.id)?.stock
    if (remaining !== 22) throw new Error(`stock decrement mismatch: ${remaining}`)

    const state: SmokeState = {
      db_path: dbFilePath(),
      product: { id: product.id, name: product.name, price: product.price },
      sale,
      written_at: new Date().toISOString()
    }
    smokeLog('smoke-state.json', state)
    smokeLog('smoke-write.log', { ok: true, renderer_loaded: true, state })
    smokeFinish(true, 'SMOKE_WRITE_OK', `db=${state.db_path} invoice=${sale.sale.invoice_number}`, 1)
  } catch (error) {
    smokeFinish(false, 'SMOKE_WRITE_FAIL', (error as Error).message, 2)
  }
}

async function runSmokeVerify(): Promise<void> {
  try {
    const status = loadLicenseStatus(userDataDir())
    if (!status.activated) throw new Error('license not persisted across restart')
    const { readFileSync } = await import('node:fs')
    const state = JSON.parse(
      readFileSync(join(userDataDir(), 'smoke-state.json'), 'utf8')
    ) as SmokeState
    const sale = getSaleWithItems(db, state.sale.sale.id)
    if (sale.sale.total !== state.sale.sale.total) throw new Error('persisted total mismatch')
    if (sale.sale.invoice_number !== state.sale.sale.invoice_number)
      throw new Error('persisted invoice mismatch')
    const product = listProducts(db).find((p) => p.id === state.product.id)
    if (!product) throw new Error('product missing after restart')
    if (product.stock !== 22) throw new Error(`persisted stock mismatch: ${product.stock}`)
    smokeLog('smoke-verify.log', { ok: true, sale, product })
    smokeFinish(true, 'SMOKE_VERIFY_OK', `invoice=${sale.sale.invoice_number} total=${sale.sale.total}`, 3)
  } catch (error) {
    smokeFinish(false, 'SMOKE_VERIFY_FAIL', (error as Error).message, 4)
  }
}

// بيئات CI بلا GPU: يجب استدعاء appendSwitch قبل جاهزية التطبيق ليكون فعّالًا
if (smokeMode) {
  app.commandLine.appendSwitch('disable-gpu')
}

app.whenReady().then(async () => {
  db = openDb(dbFilePath())
  registerIpc()
  const win = createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })

  if (smokeMode) {
    win.webContents.once('did-finish-load', () => {
      if (smokeMode === 'write') void runSmokeWrite(win)
      else void runSmokeVerify()
    })
    win.webContents.once('did-fail-load', (_e, code, desc) => {
      smokeFinish(false, 'SMOKE_LOAD_FAIL', `${code} ${desc}`, 5)
    })
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
