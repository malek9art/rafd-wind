import { describe, expect, it } from 'vitest'
import { decryptBackupBytes, encryptBackupBytes } from '../src/main/backup-crypto'

describe('تشفير النسخ الاحتياطية', () => {
  it('يفك التشفير بعبارة المرور الصحيحة ويحمي المحتوى', () => {
    const plaintext = Buffer.from('SQLite backup test: بيانات عربية')
    const encrypted = encryptBackupBytes(plaintext, 'recovery-pass-123')
    expect(encrypted.equals(plaintext)).toBe(false)
    expect(decryptBackupBytes(encrypted, 'recovery-pass-123').equals(plaintext)).toBe(true)
  })

  it('يرفض عبارة المرور القصيرة والخاطئة والبيانات المعدلة', () => {
    const plaintext = Buffer.from('backup')
    expect(() => encryptBackupBytes(plaintext, 'short')).toThrow('8 أحرف')
    const encrypted = encryptBackupBytes(plaintext, 'recovery-pass-123')
    expect(() => decryptBackupBytes(encrypted, 'wrong-pass-123')).toThrow('خاطئة')
    const tampered = Buffer.from(encrypted)
    tampered[tampered.length - 1] ^= 1
    expect(() => decryptBackupBytes(tampered, 'recovery-pass-123')).toThrow()
  })
})
