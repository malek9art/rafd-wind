/**
 * اختبار اكتمال تصنيف قنوات IPC لبوابة قفل الكتابة (§8.3):
 * كل قناة إما كتابة (تُفحص) أو حرة صراحة — لا قناة خارج التصنيف أبدًا،
 * وخطورة الفئتين متعاكستان (نسيان إضافة قناة كتابة جديدة = كسر صريح هنا).
 */
import { describe, expect, it } from 'vitest'
import { IPC } from '../src/shared/types'
import { FREE_CHANNELS, WRITE_CHANNELS } from '../src/main/ipc-write-channels'

const ALL = Object.values(IPC)

describe('تصنيف القنوات', () => {
  it('كل قناة في خريطة IPC إما كتابة أو حرة، ولا تقاطع بين الفئتين', () => {
    expect(ALL.length).toBeGreaterThan(0)
    for (const channel of ALL) {
      const isWrite = WRITE_CHANNELS.has(channel)
      const isFree = FREE_CHANNELS.has(channel)
      expect(isWrite !== isFree, `channel out of classification: ${channel}`).toBe(true)
    }
    // حرّ = المتممة الحقيقية للكتابة (مشتقة لا مكررة)
    expect(WRITE_CHANNELS.size + FREE_CHANNELS.size).toBe(ALL.length)
  })

  it('قنوات الكتابة هي بالضبط عمليات الإدراج/التعديل/الإلغاء/الحذف (32 قناة)', () => {
    expect(WRITE_CHANNELS.size).toBe(32)
    const expected = [
      'products:create', 'products:update', 'products:delete', 'products:restock',
      'customers:create', 'customers:update', 'customers:delete',
      'customerLedger:addEntry',
      'suppliers:create', 'suppliers:update', 'suppliers:delete',
      'supplierLedger:addEntry',
      'purchases:create', 'purchases:update', 'purchases:delete',
      'expenses:create', 'expenses:update', 'expenses:delete',
      'bankAccounts:create', 'bankAccounts:update', 'bankAccounts:delete',
      'paymentTerminals:create', 'paymentTerminals:update', 'paymentTerminals:delete',
      'sales:create', 'sales:update', 'sales:void', 'sales:delete',
      'users:create', 'users:update', 'users:delete',
      'storeSettings:update'
    ]
    expect([...WRITE_CHANNELS].sort()).toEqual(expected.sort())
  })

  it('القنوات الحرجة تبقى حرة: التفعيل (طريق التجديد)، الحالة، البصمة، الدخول، القراءات', () => {
    const mustBeFree = [
      IPC.licenseActivate, // حظره مع ترخيص منتهٍ يمنع التجديد ذاته
      IPC.licenseStatus,
      IPC.licenseFingerprint,
      IPC.usersLogin, // الدخول شرط لقراءة البيانات تحت ترخيص منتهٍ
      IPC.usersLogout,
      IPC.usersCurrent,
      IPC.auditLogsList,
      IPC.productsList,
      IPC.customersList,
      IPC.purchasesList,
      IPC.purchasesGet,
      IPC.salesList,
      IPC.salesGet,
      IPC.storeSettingsGet
    ]
    for (const channel of mustBeFree) {
      expect(WRITE_CHANNELS.has(channel), `${channel} must stay free`).toBe(false)
      expect(FREE_CHANNELS.has(channel), `${channel} must be classified free`).toBe(true)
    }
  })
})
