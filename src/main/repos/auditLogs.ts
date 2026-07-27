/**
 * سجل التدقيق — قراءة فقط عبر IPC + كاتب داخلي صامت:
 * writeAudit لا يُعرَّض عبر IPC، ولا يُفشل العملية الأصلية أبدًا لو فشل
 * (منقولًا بهذا السلوك من المصدر كما هو).
 */
import type { Db } from '../db'
import type { AuditFilters, AuditLog } from '../../shared/types'
import { nowIso } from './helpers'

const COLS = 'id, user_id, action, entity_type, entity_id, meta, actor_email, entity, created_at'

export function listAuditLogs(db: Db, filters?: AuditFilters): AuditLog[] {
  const where: string[] = []
  const params: unknown[] = []
  if (filters?.user_id != null) {
    where.push('user_id = ?')
    params.push(filters.user_id)
  }
  if (filters?.entity_type) {
    where.push('entity_type = ?')
    params.push(filters.entity_type)
  }
  if (filters?.action) {
    where.push('action = ?')
    params.push(filters.action)
  }
  const limit = Math.min(Math.max(filters?.limit ?? 200, 1), 500)
  const sql = `SELECT ${COLS} FROM audit_logs${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`
  return db.prepare(sql).all(...params, limit) as AuditLog[]
}

export interface AuditInput {
  userId: number | null
  action: string
  entityType?: string | null
  entityId?: number | null
  meta?: Record<string, unknown> | null
  actorEmail?: string | null
}

/** كتابة صامتة: أي فشل هنا يُسجَّل تحذيرًا فقط ولا يرمي (§6/§11) */
export function writeAudit(db: Db, input: AuditInput): void {
  try {
    db.prepare(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, meta, actor_email, entity, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.userId,
      input.action,
      input.entityType ?? null,
      input.entityId ?? null,
      input.meta ? JSON.stringify(input.meta) : null,
      input.actorEmail ?? null,
      null,
      nowIso()
    )
  } catch (error) {
    console.warn('[audit] write failed (swallowed):', (error as Error).message)
  }
}
