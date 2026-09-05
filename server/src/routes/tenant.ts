import { Router } from 'express'
import { z } from 'zod'
import { pool, queryOne } from '../config/db.js'
import { asyncHandler, slugify } from '../utils/helpers.js'
import { authenticate, requireActiveTenant, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()
router.use(authenticate)

/** GET /api/v1/tenant — current company profile + trial status */
router.get(
  '/',
  requireActiveTenant,
  requireRole('owner', 'staff'),
  asyncHandler(async (req, res) => {
    const t = await queryOne(
      `SELECT id, name, slug, business_type, status, trial_ends_at,
              GREATEST(0, CEIL(EXTRACT(EPOCH FROM (trial_ends_at - now())) / 86400))::int AS trial_days_left
       FROM tenants WHERE id = $1`,
      [req.user!.tenant_id]
    )
    res.json({ tenant: t })
  })
)

const updateTenantSchema = z.object({
  name: z.string().trim().min(2).max(120).optional(),
})
router.patch(
  '/',
  requireActiveTenant,
  requireRole('owner'),
  validateBody(updateTenantSchema),
  asyncHandler(async (req, res) => {
    const { name } = req.body as z.infer<typeof updateTenantSchema>
    if (!name) return res.json({ tenant: req.tenant })
    const t = await queryOne(`UPDATE tenants SET name = $1, updated_at = now() WHERE id = $2 RETURNING *`, [name, req.user!.tenant_id])
    res.json({ tenant: t })
  })
)

/** GET /api/v1/tenant/slug-available?slug=... — used live during registration */
router.get(
  '/slug-available',
  asyncHandler(async (req, res) => {
    const raw = String(req.query.slug || '')
    const slug = slugify(raw)
    if (!raw || slug.length < 3) return res.json({ slug, available: false, reason: 'Too short' })
    const taken = await queryOne(`SELECT 1 FROM tenants WHERE slug = $1`, [slug])
    res.json({ slug, available: !taken })
  })
)

/** DELETE /api/v1/tenant — owner deletes their own workspace permanently */
router.delete(
  '/',
  requireActiveTenant,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    await pool.query(`DELETE FROM tenants WHERE id = $1`, [req.user!.tenant_id])
    res.json({ ok: true })
  })
)

/* ── Workspace settings (business profile, receipts, prefs) ── */

router.get(
  '/settings',
  requireActiveTenant,
  asyncHandler(async (req, res) => {
    const row = await queryOne<{ data: Record<string, unknown> }>(`SELECT data FROM tenant_settings WHERE tenant_id = $1`, [
      req.user!.tenant_id,
    ])
    res.json({ settings: row?.data ?? {} })
  })
)

const settingsSchema = z.object({
  business_name: z.string().trim().max(160).optional(),
  tin_number: z.string().trim().max(50).optional(),
  vat_number: z.string().trim().max(50).optional(),
  business_phone: z.string().trim().max(40).optional(),
  business_address: z.string().trim().max(300).optional(),
  receipt_header: z.string().trim().max(250).optional(),
  receipt_footer: z.string().trim().max(300).optional(),
  currency: z.string().trim().max(10).optional(),
  tax_rate: z.number().min(0).max(100).optional(),
  academic_year: z.string().trim().max(20).optional(),
  margin_presets: z.string().trim().max(50).optional(),
  auto_print_receipt: z.boolean().optional(),
})
router.put(
  '/settings',
  requireActiveTenant,
  requireRole('owner'),
  validateBody(settingsSchema),
  asyncHandler(async (req, res) => {
    const patch = req.body as Record<string, unknown>
    const row = await queryOne<{ data: Record<string, unknown> }>(
      `INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (tenant_id) DO UPDATE SET data = tenant_settings.data || $2::jsonb, updated_at = now()
       RETURNING data`,
      [req.user!.tenant_id, JSON.stringify(patch)]
    )
    res.json({ settings: row?.data ?? {} })
  })
)

export default router
