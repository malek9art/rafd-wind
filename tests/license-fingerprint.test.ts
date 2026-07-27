/**
 * اختبارات بصمة الجهاز (§8.2) — التجميع الحتمي يُختبر نقيًّا، والجمع يُختبر
 * بحقن exec (Dependency Injection) لا بمحاكاة تشغيل كاملة.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  _resetFingerprintCache,
  collectFingerprintComponents,
  componentsToFingerprint,
  FINGERPRINT_SALT,
  getDeviceFingerprint,
  type ShellExec
} from '../src/main/device-fingerprint'
import { createHash } from 'node:crypto'

beforeEach(() => {
  _resetFingerprintCache()
})

describe('componentsToFingerprint — حتمية التجميع', () => {
  it('نفس المكوّنات تعطي نفس البصمة دائمًا (sha256 64hex)', () => {
    const c = { board: 'board-1', disk: 'disk-1' }
    const a = componentsToFingerprint(c, 'h1')
    const b = componentsToFingerprint({ ...c }, 'h-other') // hostname لا يدخل مع وجود عتاد
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('تغيير اللوحة أو القرص يغيّر البصمة، ويساوي sha256 المتوقع حرفيًا', () => {
    const expected = createHash('sha256')
      .update(`${FINGERPRINT_SALT}|board-9|disk-9|`)
      .digest('hex')
    expect(componentsToFingerprint({ board: 'board-9', disk: 'disk-9' })).toBe(expected)
    expect(componentsToFingerprint({ board: 'board-X', disk: 'disk-9' })).not.toBe(expected)
    expect(componentsToFingerprint({ board: 'board-9', disk: 'disk-X' })).not.toBe(expected)
  })

  it('بلا أي مصدر عتادي: يدخل hostname البديل (وموثَّق ظهوره)', () => {
    const withHost = componentsToFingerprint({}, 'my-pc')
    const expected = createHash('sha256').update(`${FINGERPRINT_SALT}|||my-pc`).digest('hex')
    expect(withHost).toBe(expected)
    // hostname مختلف = بصمة مختلفة عند انعدام العتاد
    expect(componentsToFingerprint({}, 'other-pc')).not.toBe(withHost)
  })
})

describe('collectFingerprintComponents — استخراج منصة ويندوز بحقن exec', () => {
  it('يلتقط UUID اللوحة وتسلسل القرص ويُطبّعهما', () => {
    const calls: string[] = []
    const fakeExec: ShellExec = (cmd) => {
      calls.push(cmd)
      if (cmd.includes('ComputerSystemProduct')) return '  1234ABCD-5678-90EF-GHIJ-KLMNOPQRSTUV  \r\n'
      if (cmd.includes('Win32_DiskDrive')) return 'WD-WSerial999\r\n'
      throw new Error('unexpected')
    }
    const c = collectFingerprintComponents(fakeExec, 'win32')
    expect(c).toEqual({ board: '1234abcd-5678-90ef-ghij-klmnopqrstuv', disk: 'wd-wserial999' })
    expect(calls).toHaveLength(2)
  })

  it('UUID أصفار بالكامل يُهمَل كمصدر ناقص، وفشل مصدر لا يسقط الآخر', () => {
    const fakeExec: ShellExec = (cmd) => {
      if (cmd.includes('ComputerSystemProduct')) return '00000000-0000-0000-0000-000000000000'
      if (cmd.includes('Win32_DiskDrive')) throw new Error('cim fail')
      return ''
    }
    expect(collectFingerprintComponents(fakeExec, 'win32')).toEqual({})
  })

  it('منصة لينكس: قراءة dmi وlsblk', () => {
    const fakeExec: ShellExec = (cmd) => {
      if (cmd.startsWith('cat /sys/')) return 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee\n'
      if (cmd.startsWith('lsblk')) return 'S3Z1NX0M123456\n'
      return ''
    }
    expect(collectFingerprintComponents(fakeExec, 'linux')).toEqual({
      board: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      disk: 's3z1nx0m123456'
    })
  })
})

describe('getDeviceFingerprint — تخزين مؤقت وثبات', () => {
  it('يحسب مرة واحدة فقط ثم يخدم من الذاكرة، وإعادة الضبط تعيد الحساب', () => {
    const spy = vi.fn<ShellExec>((cmd) =>
      cmd.includes('ComputerSystemProduct') ? 'uuid-from-spy' : 'disk-from-spy'
    )
    const first = getDeviceFingerprint(spy)
    const second = getDeviceFingerprint(spy)
    expect(first).toBe(second)
    // استدعاء الصدفة حدث مرتين (لوحة+قرص) عند الحساب الأول فقط
    expect(spy).toHaveBeenCalledTimes(2)

    _resetFingerprintCache()
    getDeviceFingerprint(spy)
    expect(spy).toHaveBeenCalledTimes(4)
  })

  it('نفس مخرجات exec تعطي بصمة componentsToFingerprint ذاتها (اتساق الطبقات)', () => {
    // getDeviceFingerprint يعمل على منصة العدّاء نفسها (linux محليًا، win32 في CI)
    // — الحقن يغطي أنماط أوامر الفرعين معًا ليبقى الاختبار حتميًا على المنصتين
    const fakeExec: ShellExec = (cmd) => {
      if (cmd.startsWith('cat /sys/') || cmd.includes('ComputerSystemProduct')) return 'uuid-consistent'
      if (cmd.startsWith('lsblk') || cmd.includes('Win32_DiskDrive')) return 'disk-consistent'
      return ''
    }
    const viaGetter = getDeviceFingerprint(fakeExec)
    const viaPure = componentsToFingerprint({ board: 'uuid-consistent', disk: 'disk-consistent' })
    expect(viaGetter).toBe(viaPure)
  })
})
