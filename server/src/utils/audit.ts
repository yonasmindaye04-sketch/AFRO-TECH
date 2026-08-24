import type { PoolClient } from 'pg'
import { query } from '../config/db.js'

interface AuditInput {
  tenantId?: string | null
  userId?: string | null
  userName?: string | null
  action: string
  entity: string
  entityId?: string | null
  details?: unknown
}

/** Fire-and-forget audit trail writer — never blocks or breaks the request. */
export function logAudit(input: AuditInput, client?: PoolClient): void {
  const sql = `INSERT INTO audit_logs (tenant_id, user_id, user_name, action, entity, entity_id, details)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`
  const params = [
    input.tenantId ?? null,
    input.userId ?? null,
    input.userName ?? null,
    input.action,
    input.entity,
    input.entityId ?? null,
    input.details ? JSON.stringify(input.details) : null,
  ]
  if (client) {
    void client.query(sql, params).catch(() => undefined)
  } else {
    void query(sql, params).catch(() => undefined)
  }
}
