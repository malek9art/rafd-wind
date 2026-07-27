/**
 * اختبارات آلية PIN (scrypt المدمج — القرار الموثَّق في src/main/pin.ts)
 */
import { describe, expect, it } from 'vitest'
import { hashPin, verifyPin } from '../src/main/pin'

describe('hashPin / verifyPin', () => {
  it('round-trip: PIN صحيح يتحقق، وخاطئ يُرفض', () => {
    const stored = hashPin('2580')
    expect(verifyPin('2580', stored)).toBe(true)
    expect(verifyPin('2581', stored)).toBe(false)
  })

  it('salt مختلف لكل تشغيلة: نفس PIN يعطي مخزَّنًا مختلفًا', () => {
    const a = hashPin('1111')
    const b = hashPin('1111')
    expect(a).not.toBe(b)
    expect(verifyPin('1111', a)).toBe(true)
    expect(verifyPin('1111', b)).toBe(true)
  })

  it('الصيغة الذاتية الوصف scrypt$N$r$p$salt$hash', () => {
    const parts = hashPin('4321').split('$')
    expect(parts).toHaveLength(6)
    expect(parts[0]).toBe('scrypt')
    expect(parts[1]).toBe('16384') // N — حد OWASP الأدنى الموثَّق
    expect(Number(parts[2])).toBe(8) // r
    expect(Number(parts[3])).toBe(1) // p
  })

  it('يرفض PIN بشكل غير صالح عند التخزين (تحقق مدخلات)', () => {
    expect(() => hashPin('123')).toThrow('أرقامًا فقط')
    expect(() => hashPin('abcdefghij')).toThrow('أرقامًا فقط')
    expect(() => hashPin('1234567890123')).toThrow('أرقامًا فقط')
    expect(() => hashPin('')).toThrow('أرقامًا فقط')
  })

  it('مخزَّن تالف/مزوَّر لا يكسر التحقق — يرجع false', () => {
    expect(verifyPin('1234', 'garbage')).toBe(false)
    expect(verifyPin('1234', '')).toBe(false)
    expect(verifyPin('1234', 'scrypt$16384$8$1$not-valid!!!$###')).toBe(false)
    const stored = hashPin('1234')
    const tampered = stored.slice(0, -4) + 'AAAA'
    expect(verifyPin('1234', tampered)).toBe(false)
  })
})
