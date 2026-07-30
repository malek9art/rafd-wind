#!/usr/bin/env node
import { mkdtempSync, rmSync, copyFileSync, existsSync, statSync, unlinkSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const DatabaseMod = await import('better-sqlite3').catch(() => { console.error('better-sqlite3 not installed'); process.exit(2) })
const Database = DatabaseMod.default || DatabaseMod

function compactTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

const dir = mkdtempSync(join(tmpdir(), 'rafd-backup-smoke-'))
const dbPath = join(dir, 'smoke-backup.db')

try {
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.exec(`CREATE TABLE IF NOT EXISTS test_data (id INTEGER PRIMARY KEY AUTOINCREMENT, value TEXT NOT NULL)`)
  db.prepare('INSERT INTO test_data (value) VALUES (?)').run('بيانات أصلية للنسخ الاحتياطي')
  const rowBefore = db.prepare('SELECT * FROM test_data WHERE id = 1').get()
  if (!rowBefore) throw new Error('لم تُنشأ البيانات الأولية')

  const backupPath = join(dir, `smoke-backup-${compactTimestamp()}.db`)
  await db.backup(backupPath)
  if (!existsSync(backupPath) || statSync(backupPath).size === 0) throw new Error('فشل إنشاء ملف النسخة الاحتياطية')

  db.exec('DELETE FROM test_data')
  db.close()
  unlinkSync(dbPath)
  if (existsSync(dbPath)) throw new Error('لم يُحذف ملف القاعدة الأصلية بعد الإفساد المتعمد')

  copyFileSync(backupPath, dbPath)
  const restoredDb = new Database(dbPath)
  restoredDb.pragma('journal_mode = WAL')
  restoredDb.pragma('foreign_keys = ON')
  const rowAfter = restoredDb.prepare('SELECT * FROM test_data WHERE id = 1').get()
  if (!rowAfter) throw new Error('لم تُستعد البيانات: الصف مفقود')
  if (rowAfter.value !== 'بيانات أصلية للنسخ الاحتياطي') throw new Error('لم تُستعد البيانات: قيمة غير مطابقة: ' + rowAfter.value)

  console.log('BACKUP_SMOKE_OK')
  console.log('db_path=', dbPath)
  console.log('backup_path=', backupPath)
  console.log('data=', JSON.stringify(rowAfter))
  restoredDb.close()
} catch (err) {
  console.error('BACKUP_SMOKE_FAIL:', err.message || err)
  process.exit(1)
} finally {
  rmSync(dir, { recursive: true, force: true })
}
