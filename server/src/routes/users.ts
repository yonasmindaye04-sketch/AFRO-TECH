import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { query, queryOne } from '../config/db.js'
import { asyncHandler, AppError } from '../utils/helpers.js'
import { authenticate, requireActiveTenant, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()
router.use(authenticate)

// Mapping of business type to relevant system role names
const roleMapping: Record<string, string[]> = {
  pharmacy: ['pharmacist', 'cashier', 'manager', 'accountant'],
  store: ['cashier', 'manager', 'accountant'],
  hospital: ['doctor', 'nurse', 'lab_technician', 'pharmacist', 'accountant'],
  school: ['teacher', 'registrar', 'accountant'],
  // Default to empty array if business type not found
}

/** GET /api/v1/users/roles - list available job roles for the tenant's business type */
router.get(
  '/roles',
  requireActiveTenant,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    // Get the tenant's business type
    const tenant = await queryOne(
      `SELECT business_type FROM tenants WHERE id = $1`,
      [req.user!.tenant_id]
    )
    if (!tenant) throw new AppError(404, 'Tenant not found', 'NOT_FOUND')
    
    const businessType = tenant.business_type
    const roleNames = roleMapping[businessType] || []
    
    if (roleNames.length === 0) {
      res.json({ roles: [] })
      return
    }
    
    // Build a query to fetch roles by name
    const placeholders = roleNames.map((_, index) => `$${index + 1}`).join(',')
    const roles = await query(
      `SELECT id, name, description FROM roles WHERE name IN (${placeholders}) AND is_system = true ORDER BY name`,
      roleNames
    )
    res.json({ roles })
  })
)

/** GET /api/v1/users - list workspace staff (owner only) */
router.get(
  '/',
  requireActiveTenant,
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT u.id, u.email, u.full_name, u.role, u.is_active, u.created_at, 
          COALESCE(json_agg(json_build_object('id', r.id, 'name', r.name, 'description', r.description)) FILTER (WHERE r.id IS NOT NULL), '[]') as job_roles
       FROM users u
       LEFT JOIN user_roles ur ON ur.user_id = u.id AND ur.tenant_id = u.tenant_id
       LEFT JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = $1 
       GROUP BY u.id
       ORDER BY u.created_at ASC`,
      [req.user!.tenant_id]
    )
    res.json({ users: rows })
  })
)

const createStaffSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
  role_id: z.string().uuid().optional(),
})
router.post(
  '/',
  requireActiveTenant,
  requireRole('owner'),
  validateBody(createStaffSchema),
  asyncHandler(async (req, res) => {
    const { full_name, email, password, role_id } = req.body as z.infer<typeof createStaffSchema>
    const dup = await queryOne(`SELECT id FROM users WHERE email = $1`, [email])
    if (dup) throw new AppError(409, 'A user with this email already exists', 'EMAIL_TAKEN')
    const hash = await bcrypt.hash(password, 12)
    const row = await queryOne(
      `INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,'staff')
       RETURNING id, email, full_name, role, is_active, created_at`,
      [req.user!.tenant_id, email, hash, full_name]
    )
    if (!row) throw new AppError(500, 'Failed to create user', 'CREATE_FAILED')
    if (role_id) {
      await queryOne(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`, [row.id, role_id, req.user!.tenant_id])
      const r = await queryOne(`SELECT id, name, description FROM roles WHERE id = $1`, [role_id])
      if (!r) throw new AppError(404, 'Role not found', 'ROLE_NOT_FOUND')
      row.job_roles = [r]
    } else {
      row.job_roles = []
    }
    res.status(201).json({ user: row })
  })
)

const updateStaffSchema = z.object({
  is_active: z.boolean().optional(),
  full_name: z.string().trim().min(2).max(120).optional(),
  password: z.string().min(8).max(100).optional(),
  role_id: z.string().uuid().nullable().optional(),
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

    const { is_active, full_name, password, role_id } = req.body as z.infer<typeof updateStaffSchema>
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
    
    // We construct the SET clause safely
    let row;
    if (params.length > 0) {
      params.push(id, req.user!.tenant_id)
      row = await queryOne(
        `UPDATE users SET ${pwClause.replace(', ', '')} WHERE id = $${params.length - 1} AND tenant_id = $${params.length}
         RETURNING id, email, full_name, role, is_active, created_at`,
        params
      )
    } else {
      row = await queryOne(`SELECT id, email, full_name, role, is_active, created_at FROM users WHERE id = $1`, [id])
    }

    if (role_id !== undefined) {
      await queryOne(`DELETE FROM user_roles WHERE user_id = $1 AND tenant_id = $2`, [id, req.user!.tenant_id])
      if (role_id) {
        await queryOne(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1, $2, $3)`, [id, role_id, req.user!.tenant_id])
      }
    }

    res.json({ user: row })
  })
)

export default router
