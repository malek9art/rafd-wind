/**
 * تشفير النسخ الاحتياطية قبل مغادرة الجهاز.
 * المفتاح مشتق من عبارة مرور الاسترداد، ولا يتم حفظ العبارة أو المفتاح هنا.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'

const MAGIC = Buffer.from('RAFDENC1', 'ascii')
const KEY_LENGTH = 32
const SALT_LENGTH = 16
const IV_LENGTH = 12
const MIN_PASSPHRASE_LENGTH = 8

interface EncryptedHeader {
  version: 1
  algorithm: 'aes-256-gcm'
  kdf: 'scrypt'
  salt: string
  iv: string
  auth_tag: string
  plaintext_sha256: string
}

function deriveKey(passphrase: string, salt: Buffer): Buffer {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`عبارة مرور الاسترداد يجب أن تكون ${MIN_PASSPHRASE_LENGTH} أحرف على الأقل`)
  }
  return scryptSync(passphrase, salt, KEY_LENGTH, { N: 16384, r: 8, p: 1 })
}

export function encryptBackupBytes(plaintext: Buffer, passphrase: string): Buffer {
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = deriveKey(passphrase, salt)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const header: EncryptedHeader = {
    version: 1,
    algorithm: 'aes-256-gcm',
    kdf: 'scrypt',
    salt: salt.toString('base64url'),
    iv: iv.toString('base64url'),
    auth_tag: cipher.getAuthTag().toString('base64url'),
    plaintext_sha256: createHash('sha256').update(plaintext).digest('hex')
  }
  const headerBytes = Buffer.from(JSON.stringify(header), 'utf8')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(headerBytes.length, 0)
  return Buffer.concat([MAGIC, length, headerBytes, ciphertext])
}

export function decryptBackupBytes(encrypted: Buffer, passphrase: string): Buffer {
  if (encrypted.length < MAGIC.length + 4 || !encrypted.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('صيغة النسخة المشفرة غير معروفة')
  }
  const headerLength = encrypted.readUInt32BE(MAGIC.length)
  const headerStart = MAGIC.length + 4
  const headerEnd = headerStart + headerLength
  if (headerLength <= 0 || headerEnd >= encrypted.length) throw new Error('رأس النسخة المشفرة تالف')

  let header: EncryptedHeader
  try {
    header = JSON.parse(encrypted.subarray(headerStart, headerEnd).toString('utf8')) as EncryptedHeader
  } catch {
    throw new Error('تعذر قراءة رأس النسخة المشفرة')
  }
  if (header.version !== 1 || header.algorithm !== 'aes-256-gcm' || header.kdf !== 'scrypt') {
    throw new Error('إصدار تشفير غير مدعوم')
  }

  const salt = Buffer.from(header.salt, 'base64url')
  const iv = Buffer.from(header.iv, 'base64url')
  const authTag = Buffer.from(header.auth_tag, 'base64url')
  if (salt.length !== SALT_LENGTH || iv.length !== IV_LENGTH || authTag.length !== 16) {
    throw new Error('بيانات تشفير النسخة غير صالحة')
  }

  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(passphrase, salt), iv)
    decipher.setAuthTag(authTag)
    const plaintext = Buffer.concat([
      decipher.update(encrypted.subarray(headerEnd)),
      decipher.final()
    ])
    const hash = createHash('sha256').update(plaintext).digest('hex')
    if (hash !== header.plaintext_sha256) throw new Error('فشل checksum للنسخة بعد فك التشفير')
    return plaintext
  } catch (error) {
    if ((error as Error).message.includes('checksum')) throw error
    throw new Error('عبارة المرور خاطئة أو النسخة المشفرة تالفة')
  }
}

export function encryptBackupFile(sourcePath: string, destinationPath: string, passphrase: string): void {
  writeFileSync(destinationPath, encryptBackupBytes(readFileSync(sourcePath), passphrase))
}

export function decryptBackupFile(sourcePath: string, destinationPath: string, passphrase: string): void {
  writeFileSync(destinationPath, decryptBackupBytes(readFileSync(sourcePath), passphrase))
}
