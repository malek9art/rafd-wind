import { describe, expect, it } from 'vitest'
import { EscPosBuilder, buildEscPosInvoice } from '../src/shared/escpos'
import type { SaleWithItems, StoreSettings } from '../src/shared/types'

describe('بناء أوامر ESC/POS', () => {
  it('يُنشئ بايتات البداية والخط العريض والقص بشكل صحيح', () => {
    const builder = new EscPosBuilder()
    builder.bold(true).line('تجربة').cut()
    const bytes = builder.getBytes()

    // 0x1B, 0x40 is initialize
    expect(bytes[0]).toBe(0x1B)
    expect(bytes[1]).toBe(0x40)

    // Bold sequence ESC E 1
    let boldIndex = -1
    for (let i = 0; i < bytes.length - 2; i++) {
      if (bytes[i] === 0x1B && bytes[i + 1] === 0x45 && bytes[i + 2] === 1) {
        boldIndex = i
        break
      }
    }
    expect(boldIndex).toBeGreaterThan(-1)

    // 0x1D, 0x56, 66, 0 is cut
    expect(bytes[bytes.length - 2]).toBe(66)
    expect(bytes[bytes.length - 1]).toBe(0)
  })

  it('يبني الفاتورة بشكل بايتات متسقة بناءً على المبيعات والإعدادات', () => {
    const saleWithItems: SaleWithItems = {
      sale: {
        id: 1,
        invoice_number: 'INV-000001',
        total: 100,
        paid: 100,
        bank_account_id: null,
        customer_id: null,
        created_at: '2026-07-27T12:00:00.000Z',
        payment_method: 'cash',
        status: 'completed',
        voided_at: null,
        voided_by: null,
        void_reason: null
      },
      items: [
        {
          id: 1,
          sale_id: 1,
          product_id: 1,
          product_name: 'منتج تجريبي',
          quantity: 2,
          unit_price: 50,
          unit_cost: 30,
          total: 100,
          weight_g: null,
          sold_by_weight: 0
        }
      ]
    }

    const settings: StoreSettings = {
      id: 1,
      name: 'متجر الوفاء',
      name_ar: 'متجر الوفاء',
      logo_url: null,
      primary_color: '#000000',
      secondary_color: '#ffffff',
      currency: 'YER',
      phone: '777777777',
      email: null,
      address: 'صنعاء',
      tax_number: '123456',
      invoice_footer: 'شكراً لزيارتكم',
      business_type: 'grocery',
      tax_enabled: 0,
      tax_rate: 0,
      tax_mode: 'exclusive',
      enabled_categories: null,
      custom_categories: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01'
    }

    const bytes = buildEscPosInvoice(saleWithItems, settings)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(0)
  })
})
