/** مستودع إعدادات المتجر — صف واحد (id=1)، upsert مع قائمة أعمدة بيضاء */
import type { Db } from '../db'
import type { StoreSettings, StoreSettingsPatch } from '../../shared/types'
import { buildSetClause, nowIso } from './helpers'

const COLS =
  'id, name, name_ar, logo_url, primary_color, secondary_color, currency, phone, email, address, tax_number, invoice_footer, business_type, tax_enabled, tax_rate, tax_mode, enabled_categories, custom_categories, created_at, updated_at, printer_port, printer_baud_rate, receipt_width'

const ALLOWED = [
  'name',
  'name_ar',
  'logo_url',
  'primary_color',
  'secondary_color',
  'currency',
  'phone',
  'email',
  'address',
  'tax_number',
  'invoice_footer',
  'business_type',
  'tax_enabled',
  'tax_rate',
  'tax_mode',
  'enabled_categories',
  'custom_categories',
  'printer_port',
  'printer_baud_rate',
  'receipt_width'
] as const

export function getStoreSettings(db: Db): StoreSettings | null {
  const row = db.prepare(`SELECT ${COLS} FROM store_settings WHERE id = 1`).get() as
    | StoreSettings
    | undefined
  return row ?? null
}

/** upsert: get() قبل أي update قد يرجع null (لم تُضبط الإعدادات بعد) */
export function updateStoreSettings(db: Db, patch: StoreSettingsPatch): StoreSettings {
  const withDefaults = { ...patch }
  if (patch.tax_enabled !== undefined) {
    ;(withDefaults as Record<string, unknown>).tax_enabled = patch.tax_enabled ? 1 : 0
  }
  if (patch.printer_baud_rate !== undefined) {
    if (!Number.isInteger(patch.printer_baud_rate) || patch.printer_baud_rate < 1200 || patch.printer_baud_rate > 115200) {
      throw new Error('سرعة الطابعة غير صالحة')
    }
  }
  if (patch.receipt_width !== undefined && patch.receipt_width !== 58 && patch.receipt_width !== 80) {
    throw new Error('عرض الإيصال يجب أن يكون 58 أو 80 ملم')
  }
  db.prepare(
    `INSERT INTO store_settings (id, created_at, updated_at) VALUES (1, ?, ?)
     ON CONFLICT(id) DO NOTHING`
  ).run(nowIso(), nowIso())

  let hasFields = true
  try {
    const { clause, values } = buildSetClause(withDefaults as Record<string, unknown>, ALLOWED)
    db.prepare(`UPDATE store_settings SET ${clause}, updated_at = ? WHERE id = 1`).run(
      ...values,
      nowIso()
    )
  } catch (error) {
    if (String((error as Error).message).includes('لا توجد حقول')) hasFields = false
    else throw error
  }
  if (!hasFields) {
    db.prepare('UPDATE store_settings SET updated_at = ? WHERE id = 1').run(nowIso())
  }
  const row = getStoreSettings(db)
  if (!row) throw new Error('تعذّر إنشاء صف الإعدادات')
  return row
}
