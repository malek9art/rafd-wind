/**
 * مدير النسخ الاحتياطية المحلية — المرحلة 6.
 * النسخة تُنشأ عبر better-sqlite3 backup API لضمان اتساق قاعدة WAL،
 * ثم تُرفق ببيانات checksum وإصدار المخطط قبل إتاحتها للاستعادة.
 */
import Database from 'better-sqlite3'
import { createHash, randomBytes } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join } from 'node:path'
import type { BackupInfo } from '../shared/types'
import type { Db } from './db'
import { readSchemaVersion, SCHEMA_VERSION_CODE } from './migrations'

const BACKUP_DIR_NAME = 'backups'
const ID_PATTERN = /^rafd-backup-[A-Za-z0-9_-]+$/

export function getBackupsDir(userDataDir: string): string {
  return join(userDataDir, BACKUP_DIR_NAME)
}

function ensureBackupsDir(userDataDir: string): string {
  const dir = getBackupsDir(userDataDir)
  mkdirSync(dir, { recursive: true })
  return dir
}

function fileSha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function metadataPath(dir: string, id: string): string {
  return join(dir, `${id}.json`)
}

function databasePath(dir: string, id: string): string {
  return join(dir, `${id}.db`)
}

function assertBackupId(id: string): void {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error('معرّف النسخة الاحتياطية غير صالح')
  }
}

function readMetadata(dir: string, id: string): BackupInfo {
  assertBackupId(id)
  const metadata = JSON.parse(readFileSync(metadataPath(dir, id), 'utf8')) as BackupInfo
  if (metadata.id !== id || metadata.file_name !== `${id}.db`) {
    throw new Error('بيانات النسخة الاحتياطية غير متطابقة')
  }
  return metadata
}

export function listBackups(userDataDir: string): BackupInfo[] {
  const dir = getBackupsDir(userDataDir)
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter((name) => name.startsWith('rafd-backup-') && name.endsWith('.json'))
    .map((name) => name.slice(0, -'.json'.length))
    .flatMap((id) => {
      try {
        const info = readMetadata(dir, id)
        return existsSync(databasePath(dir, id)) ? [info] : []
      } catch {
        return []
      }
    })
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
}

export async function createBackup(
  db: Db,
  userDataDir: string,
  appVersion: string
): Promise<BackupInfo> {
  const dir = ensureBackupsDir(userDataDir)
  const id = `rafd-backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`
  const target = databasePath(dir, id)
  const tempTarget = `${target}.tmp`

  try {
    await db.backup(tempTarget)
    renameSync(tempTarget, target)
    const stat = statSync(target)
    const info: BackupInfo = {
      id,
      file_name: `${id}.db`,
      created_at: new Date().toISOString(),
      schema_version: readSchemaVersion(db),
      app_version: appVersion,
      size_bytes: stat.size,
      sha256: fileSha256(target)
    }
    const tempMetadata = `${metadataPath(dir, id)}.tmp`
    writeFileSync(tempMetadata, JSON.stringify(info, null, 2), 'utf8')
    renameSync(tempMetadata, metadataPath(dir, id))
    return info
  } catch (error) {
    rmSync(tempTarget, { force: true })
    rmSync(target, { force: true })
    throw new Error(`تعذر إنشاء النسخة الاحتياطية: ${(error as Error).message}`)
  }
}

export function validateBackup(userDataDir: string, id: string): BackupInfo {
  const dir = getBackupsDir(userDataDir)
  const info = readMetadata(dir, id)
  const path = databasePath(dir, id)
  if (!existsSync(path)) throw new Error('ملف النسخة الاحتياطية غير موجود')
  if (fileSha256(path) !== info.sha256) throw new Error('فشل التحقق من سلامة النسخة الاحتياطية')

  const backupDb = new Database(path, { readonly: true })
  try {
    const result = backupDb.pragma('integrity_check') as Array<{ integrity_check: string }>
    if (result[0]?.integrity_check !== 'ok') {
      throw new Error('قاعدة النسخة الاحتياطية لا تجتاز integrity_check')
    }
    const schemaRow = backupDb
      .prepare('SELECT version FROM schema_version WHERE id = 1')
      .get() as { version: number } | undefined
    if (!schemaRow || schemaRow.version > SCHEMA_VERSION_CODE) {
      throw new Error('إصدار مخطط النسخة الاحتياطية أحدث من التطبيق الحالي')
    }
    return info
  } finally {
    backupDb.close()
  }
}

/**
 * يستعيد النسخة إلى ملف قاعدة البيانات بعد إغلاق المقبض الحالي.
 * يعيد نسخة أمان من الحالة الحالية، ويُعاد تشغيل التطبيق من IPC بعد النجاح.
 */
export async function restoreBackup(
  db: Db,
  userDataDir: string,
  dbPath: string,
  id: string,
  appVersion: string
): Promise<{ restored: BackupInfo; safety_backup: BackupInfo }> {
  const restored = validateBackup(userDataDir, id)
  const safetyBackup = await createBackup(db, userDataDir, appVersion)
  const source = databasePath(getBackupsDir(userDataDir), id)
  const restoreTemp = `${dbPath}.restore.tmp`
  const walPath = `${dbPath}-wal`
  const shmPath = `${dbPath}-shm`

  db.close()
  try {
    copyFileSync(source, restoreTemp)
    rmSync(walPath, { force: true })
    rmSync(shmPath, { force: true })
    rmSync(dbPath, { force: true })
    renameSync(restoreTemp, dbPath)
    return { restored, safety_backup: safetyBackup }
  } catch (error) {
    rmSync(restoreTemp, { force: true })
    throw new Error(`تعذرت استعادة النسخة الاحتياطية: ${(error as Error).message}`)
  }
}

export function deleteBackup(userDataDir: string, id: string): void {
  const dir = getBackupsDir(userDataDir)
  assertBackupId(id)
  // قراءة metadata أولًا تمنع حذف مسار غير معروف.
  readMetadata(dir, id)
  rmSync(databasePath(dir, id), { force: true })
  rmSync(metadataPath(dir, id), { force: true })
}
