/**
 * طبقة قاعدة البيانات (Main process) — better-sqlite3 متزامن (الوثيقة §5.2).
 * هذه الوحدة تحمل فتح الاتصال + برامجاته + الترقيات فقط؛
 * منطق الكيانات في src/main/repos/* (المرحلة 2) وكلها تأخذ المقبض صراحةً
 * لتبقى قابلة للاختبار بـVitest بدون Electron (§13).
 */
import Database from 'better-sqlite3'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { ensureMigrated } from './migrations'

export type Db = Database.Database

/** تقريب مبالغ مبسّط (قرار التمثيل المالي النهائي REAL vs وحدات صغرى — المرحلة 1، §تقارير) */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

export function openDb(dbPath: string): Db {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  // §9: الترقيات (مع النسخة الاحتياطية) تُشغَّل قبل إتاحة الاتصال لأي شاشة.
  // أي استثناء من الترقية (رفض إصدار أحدث، فشل ترقية مستقبلي) يجب ألا يُبقي
  // مقبض SQLite مفتوحًا — على ويندوز يمنع المقبض المُسرَّب حذف/استبدال الملف (EPERM).
  try {
    ensureMigrated(db, dbPath)
  } catch (err) {
    db.close()
    throw err
  }
  return db
}
