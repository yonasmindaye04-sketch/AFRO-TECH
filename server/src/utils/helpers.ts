import type { NextFunction, Request, Response } from 'express'
import type { PoolClient } from 'pg'

export class AppError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = 'ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

type AsyncHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>
export const asyncHandler =
  (fn: AsyncHandler) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next)
  }

/** Wrap multiple queries in a transaction; rolls back if the handler throws. */
export async function withTransaction<T>(pool: { connect: () => Promise<PoolClient> }, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9\u1200-\u137F]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'company'
  )
}

/** Human friendly sequential codes like PAT-000123 / STU-000045 (per-tenant via count). */
export async function nextCode(client: PoolClient, table: string, prefix: string, tenantId: string): Promise<string> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT count(*) + 1 AS n FROM ${table} WHERE tenant_id = $1`,
    [tenantId]
  )
  return `${prefix}-${String(rows[0].n).padStart(5, '0')}`
}

export function parsePagination(query: { page?: string; limit?: string }): { limit: number; offset: number; page: number } {
  const page = Math.max(1, Number(query.page) || 1)
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50))
  return { page, limit, offset: (page - 1) * limit }
}
