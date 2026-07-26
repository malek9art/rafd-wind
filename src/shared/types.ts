/**
 * أنواع مشتركة بين عمليات main / preload / renderer.
 * حقول قاعدة البيانات واستجابات IPC تُستخدم بصيغة snake_case
 * لمطابقة عقود rafd-app قدر الإمكان (الوثيقة §7).
 */

export interface Product {
  id: number
  name: string
  name_ar: string | null
  price: number
  cost: number
  stock: number
  unit: string
  created_at?: string
}

export interface NewProduct {
  name: string
  name_ar?: string | null
  price: number
  cost?: number
  stock?: number
  unit?: string
}

export interface Sale {
  id: number
  invoice_number: string
  total: number
  paid: number
  created_at: string
}

export interface SaleItem {
  id: number
  sale_id: number
  product_id: number | null
  product_name: string
  quantity: number
  unit_price: number
  total: number
}

/** عنصر داخل "سلة" البيع قبل الإتمام */
export interface SaleItemInput {
  product_id: number
  quantity: number
}

export interface SaleWithItems {
  sale: Sale
  items: SaleItem[]
}

export type LicensePlan = 'trial' | 'starter' | 'pro'

export interface LicenseInfo {
  license_id: string
  plan: LicensePlan
  customer: string
  issued_at: string
  expires_at: string
}

export type LicenseStatus =
  | { activated: true; info: LicenseInfo }
  | { activated: false; reason?: string }

export type ActivateResult =
  | { ok: true; info: LicenseInfo }
  | { ok: false; error: string }

/** واجهة الـAPI المعروضة للواجهة عبر contextBridge (الوثيقة §7) */
export interface RafdLocalApi {
  license: {
    status(): Promise<LicenseStatus>
    activate(key: string): Promise<ActivateResult>
  }
  products: {
    list(): Promise<Product[]>
    create(payload: NewProduct): Promise<Product>
  }
  sales: {
    create(payload: { items: SaleItemInput[]; paid: number }): Promise<SaleWithItems>
    get(sale_id: number): Promise<SaleWithItems>
  }
}

export const IPC = {
  licenseStatus: 'license:status',
  licenseActivate: 'license:activate',
  productsList: 'products:list',
  productsCreate: 'products:create',
  salesCreate: 'sales:create',
  salesGet: 'sales:get'
} as const
