import type { SaleWithItems, StoreSettings } from './types'

export class EscPosBuilder {
  private buffer: number[] = []

  constructor() {
    this.initialize()
  }

  initialize() {
    this.buffer.push(0x1B, 0x40) // ESC @
    return this
  }

  alignCenter() {
    this.buffer.push(0x1B, 0x61, 1) // ESC a 1
    return this
  }

  alignLeft() {
    this.buffer.push(0x1B, 0x61, 0) // ESC a 0
    return this
  }

  alignRight() {
    this.buffer.push(0x1B, 0x61, 2) // ESC a 2
    return this
  }

  bold(enable = true) {
    this.buffer.push(0x1B, 0x45, enable ? 1 : 0) // ESC E n
    return this
  }

  size(width = 1, height = 1) {
    const w = Math.max(1, Math.min(8, width)) - 1
    const h = Math.max(1, Math.min(8, height)) - 1
    const n = (w << 4) | h
    this.buffer.push(0x1D, 0x21, n)
    return this
  }

  text(text: string) {
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)
    for (let i = 0; i < bytes.length; i++) {
      this.buffer.push(bytes[i])
    }
    return this
  }

  line(text = '') {
    this.text(text + '\n')
    return this
  }

  feed(lines = 1) {
    this.buffer.push(0x1B, 0x64, lines) // ESC d n
    return this
  }

  cut() {
    this.buffer.push(0x1D, 0x56, 66, 0) // GS V m n
    return this
  }

  cashDrawer() {
    this.buffer.push(0x1B, 0x70, 0, 25, 250) // ESC p m t1 t2
    return this
  }

  getBytes(): Uint8Array {
    return new Uint8Array(this.buffer)
  }
}

export function buildEscPosInvoice(saleWithItems: SaleWithItems, settings: StoreSettings | null): Uint8Array {
  const { sale, items } = saleWithItems
  const builder = new EscPosBuilder()

  builder.alignCenter().bold().size(2, 2)
  if (settings?.name_ar || settings?.name) {
    builder.line(settings.name_ar || settings.name || '')
  } else {
    builder.line('رافد')
  }

  builder.size(1, 1).bold(false)
  if (settings?.address) builder.line(settings.address)
  if (settings?.phone) builder.line(`تلفون: ${settings.phone}`)
  if (settings?.tax_number) builder.line(`الرقم الضريبي: ${settings.tax_number}`)

  builder.line('--------------------------------')
  builder.alignLeft()
  builder.line(`رقم الفاتورة: ${sale.invoice_number}`)
  builder.line(`التاريخ: ${new Date(sale.created_at).toLocaleString('ar-YE')}`)
  builder.line('--------------------------------')

  builder.alignRight()
  // Header of items
  builder.line('الصنف             الكمية   السعر    الإجمالي')
  builder.line('--------------------------------')
  for (const item of items) {
    const qtyStr = item.sold_by_weight ? `${item.weight_g} جم` : `${item.quantity}`
    const priceStr = String(item.unit_price)
    const totalStr = String(item.total)
    builder.line(`${item.product_name.padEnd(16)} ${qtyStr.padStart(6)} ${priceStr.padStart(6)} ${totalStr.padStart(8)}`)
  }
  builder.line('--------------------------------')

  builder.alignLeft()
  const subtotal = items.reduce((sum, item) => sum + item.total, 0)
  builder.line(`الإجمالي الفرعي: ${subtotal}`)
  const discount = Math.round((subtotal - sale.total) * 100) / 100
  if (discount > 0) {
    builder.line(`الخصم: ${discount}`)
  }
  builder.line(`الإجمالي: ${sale.total}`)
  builder.line(`المدفوع: ${sale.paid}`)
  const change = Math.round((sale.paid - sale.total) * 100) / 100
  if (change > 0) {
    builder.line(`المتبقي (الباقي): ${change}`)
  }

  if (settings?.invoice_footer) {
    builder.line('--------------------------------')
    builder.alignCenter().line(settings.invoice_footer)
  }

  builder.feed(3).cut()
  return builder.getBytes()
}
