import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { query, queryOne } from '../config/db.js'
import { asyncHandler, AppError } from '../utils/helpers.js'
import { authenticate, requireActiveTenant, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()
router.use(authenticate)

/** GET /api/v1/users — list workspace staff (owner only) */
router.get(
  '/',
  requireActiveTenant,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT id, email, full_name, role, is_active, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at ASC`,
      [req.user!.tenant_id]
    )
    res.json({ users: rows })
  })
)

const createStaffSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
})
router.post(
  '/',
  requireActiveTenant,
  requireRole('owner'),
  validateBody(createStaffSchema),
  asyncHandler(async (req, res) => {
    const { full_name, email, password } = req.body as z.infer<typeof createStaffSchema>
    const dup = await queryOne(`SELECT id FROM users WHERE email = $1`, [email])
    if (dup) throw new AppError(409, 'A user with this email already exists', 'EMAIL_TAKEN')
    const hash = await bcrypt.hash(password, 12)
    const row = await queryOne(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,'staff')
       RETURNING id, email, full_name, role, is_active, created_at`,
      [req.user!.tenant_id, email, hash, full_name]
    )
    res.status(201).json({ user: row })
  })
)

const updateStaffSchema = z.object({
  is_active: z.boolean().optional(),
  full_name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(8).max(100).optional(),
})
router.patch(
  '/:id',
  requireActiveTenant,
  requireRole('owner'),
  validateBody(updateStaffSchema),
  asyncHandler(async (req, res) => {
    const { id } = req.params
    const target = await queryOne(`SELECT id, role FROM users WHERE id = $1 AND tenant_id = $2`, [id, req.user!.tenant_id])
    if (!target) throw new AppError(404, 'User not found', 'NOT_FOUND')
    if (target.role === 'owner' && req.body.is_active === false)
      throw new AppError(400, 'The owner account cannot be deactivated', 'OWNER_LOCKED')

    const { is_active, full_name, password } = req.body as z.infer<typeof updateStaffSchema>
    let pwClause = ''
    const params: unknown[] = []
    if (full_name) {
      params.push(full_name)
      pwClause += `, full_name = $${params.length}`
    }
    if (password) {
      params.push(await bcrypt.hash(password, 12))
      pwClause += `, password_hash = $${params.length}`
    }
    if (typeof is_active === 'boolean') {
      params.push(is_active)
      pwClause += `, is_active = $${params.length}`
    }
    params.push(id, req.user!.tenant_id)
    const row = await queryOne(
      `UPDATE users SET ${pwClause.replace(', ', '')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
       RETURNING id, email, full_name, role, is_active, created_at`,
      params
    )
    res.json({ user: row })
  })
)

export default router
