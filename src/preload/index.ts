/**
 * Preload — الجسر الوحيد بين الواجهة وطبقة Node (الوثيقة §7 + §11):
 * تعريف عبر contextBridge فقط، بدون nodeIntegration، مسارات محدودة محكومة.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/types'
import type { NewProduct, RafdLocalApi, SaleItemInput } from '../shared/types'

const api: RafdLocalApi = {
  license: {
    status: () => ipcRenderer.invoke(IPC.licenseStatus),
    activate: (key: string) => ipcRenderer.invoke(IPC.licenseActivate, key)
  },
  products: {
    list: () => ipcRenderer.invoke(IPC.productsList),
    create: (payload: NewProduct) => ipcRenderer.invoke(IPC.productsCreate, payload)
  },
  sales: {
    create: (payload: { items: SaleItemInput[]; paid: number }) =>
      ipcRenderer.invoke(IPC.salesCreate, payload),
    get: (sale_id: number) => ipcRenderer.invoke(IPC.salesGet, sale_id)
  }
}

contextBridge.exposeInMainWorld('rafdLocal', api)
