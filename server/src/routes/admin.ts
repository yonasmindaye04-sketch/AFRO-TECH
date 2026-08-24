import { Router } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../config/db.js'
import { asyncHandler, AppError, parsePagination } from '../utils/helpers.js'
import { authenticate, requireAfrotechAdmin } from '../middleware/auth.js'

import { validateBody } from '../middleware/validate.js'

const router = Router()
router.use(authenticate, requireAfrotechAdmin)

/** GET /api/v1/admin/tenants — all companies with owner info + usage counts */
router.get(
  '/tenants',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePagination(req.query as Record<string, string>)
    const search = String(req.query.search || '').trim()
    const params: unknown[] = []
    let where = ''
    if (search) {
      params.push(`%${search}%`)
      where = `WHERE t.name ILIKE $${params.length} OR t.slug ILIKE $${params.length}`
    }
    params.push(limit, offset)
    const rows = await query(
      `SELECT t.*, u.id AS owner_id, u.email AS owner_email, u.full_name AS owner_name,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (t.trial_ends_at - now())) / 86400))::int AS trial_days_left
       FROM tenants t LEFT JOIN users u ON u.tenant_id = t.id AND u.role = 'owner'
       ${where}
       ORDER BY t.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    const countParams = params.slice(0, Math.max(0, params.length - 2))
    const total = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM tenants t ${where}`, countParams)
    res.json({ tenants: rows, page, limit, total: Number(total?.n ?? 0) })
  })
)

/** POST /api/v1/admin/tenants/:id/extend — extend trial / subscription manually */
router.post(
  '/tenants/:id/extend',
  validateBody(z.object({ days: z.number().int().min(1).max(3650) })),
  asyncHandler(async (req, res) => {
    const { days } = req.body as { days: number }
    const row = await queryOne(
      `UPDATE tenants SET trial_ends_at = GREATEST(trial_ends_at, now()) + ($2 || ' days')::interval,
              status = CASE WHEN status IN ('expired') THEN 'trial' ELSE status END,
              updated_at = now()
       WHERE id = $1 RETURNING *`,
      [req.params.id, days]
    )
    if (!row) throw new AppError(404, 'Tenant not found', 'NOT_FOUND')
    res.json({ tenant: row })
  })
)

/** PATCH /api/v1/admin/tenants/:id — activate (grant free access), suspend, reactivate */
router.patch(
  '/tenants/:id',
  asyncHandler(async (req, res) => {
    const schema = z.object({ status: z.enum(['trial', 'active', 'suspended', 'expired']) })
    const parsed = schema.safeParse(req.body)
    if (!parsed.success) throw new AppError(400, 'Invalid status', 'VALIDATION')
    const row = await queryOne(`UPDATE tenants SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`, [
      req.params.id,
      parsed.data.status,
    ])
    if (!row) throw new AppError(404, 'Tenant not found', 'NOT_FOUND')
    // Suspending a company also disables its users' sessions at next request.
    res.json({ tenant: row })
  })
)

/** GET /api/v1/admin/stats — overview for the AFRO-TECH dashboard */
router.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const byType = await query<{ business_type: string; n: string }>(
      `SELECT business_type, count(*) AS n FROM tenants GROUP BY business_type`
    )
    const totals = await queryOne<{ tenants: string; active: string; expiring_soon: string }>(
      `SELECT count(*) AS tenants,
              count(*) FILTER (WHERE status IN ('trial','active')) AS active,
              count(*) FILTER (WHERE status = 'trial' AND trial_ends_at < now() + interval '7 days') AS expiring_soon
       FROM tenants`
    )
    res.json({
      by_type: Object.fromEntries(byType.map((r) => [r.business_type, Number(r.n)])),
      total_tenants: Number(totals?.tenants ?? 0),
      active_tenants: Number(totals?.active ?? 0),
      expiring_soon: Number(totals?.expiring_soon ?? 0),
    })
  })
)

/** GET /api/v1/admin/audit — recent activity across all workspaces */
router.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePagination(req.query as Record<string, string>)
    const params: unknown[] = []
    let where = ''
    if (req.query.tenant_id) {
      params.push(String(req.query.tenant_id))
      where = `WHERE a.tenant_id = $${params.length}`
    }
    params.push(limit, offset)
    const rows = await query(
      `SELECT a.*, t.name AS tenant_name FROM audit_logs a LEFT JOIN tenants t ON t.id = a.tenant_id
       ${where} ORDER BY a.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    res.json({ logs: rows, page, limit })
  })
)

/** POST /api/v1/admin/users/:id/reset-password — AFRO-TECH sets a temporary password for any user */
router.post(
  '/users/:id/reset-password',
  validateBody(z.object({ new_password: z.string().min(8).max(100) })),
  asyncHandler(async (req, res) => {
    const bcrypt = (await import('bcryptjs')).default
    const hash = await bcrypt.hash((req.body as { new_password: string }).new_password, 12)
    const row = await queryOne(`UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING email, full_name`, [
      hash,
      req.params.id,
    ])
    if (!row) throw new AppError(404, 'User not found', 'NOT_FOUND')
    await query(
      `INSERT INTO audit_logs (user_id, user_name, action, entity, entity_id, details)
       VALUES ($1,'AFRO-TECH admin','password.reset','user',$2,$3)`,
      [req.user!.id, req.params.id, JSON.stringify({ email: row.email })]
    )
    res.json({ ok: true, email: row.email })
  })
)

export default router
