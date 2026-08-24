import { Router } from 'express'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { pool, queryOne, TRIAL_DAYS } from '../config/db.js'
import { asyncHandler, AppError, slugify, withTransaction } from '../utils/helpers.js'
import { authenticate, signToken, type AuthUser, type TenantRow } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()

const registerSchema = z.object({
  company_name: z.string().trim().min(2).max(120),
  business_type: z.enum(['pharmacy', 'store', 'hospital', 'school']),
  owner_name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8, 'Password must be at least 8 characters').max(100),
})

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
})

interface MeResponse extends AuthUser {
  tenant: (TenantRow & { trial_days_left: number }) | null
}

function daysLeft(trialEndsAt: Date): number {
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
}

async function loadMe(user: AuthUser): Promise<MeResponse> {
  let tenant: MeResponse['tenant'] = null
  if (user.tenant_id) {
    const t = await queryOne<TenantRow>(`SELECT id, name, slug, business_type, status, trial_ends_at FROM tenants WHERE id = $1`, [
      user.tenant_id,
    ])
    if (t) tenant = { ...t, trial_days_left: t.status === 'trial' ? daysLeft(t.trial_ends_at) : 0 }
  }
  return { ...user, tenant }
}

/**
 * POST /api/v1/auth/register
 * Self-service company registration — instantly creates an isolated workspace
 * with a 45-day free trial and its owner account.
 */
router.post(
  '/register',
  validateBody(registerSchema),
  asyncHandler(async (req, res) => {
    const { company_name, business_type, owner_name, email, password } = req.body as z.infer<typeof registerSchema>

    const existingEmail = await queryOne(`SELECT id FROM users WHERE email = $1`, [email])
    if (existingEmail) throw new AppError(409, 'An account with this email already exists', 'EMAIL_TAKEN')

    let slug = slugify(company_name)
    const slugTaken = await queryOne(`SELECT id FROM tenants WHERE slug = $1`, [slug])
    if (slugTaken) slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`

    const hash = await bcrypt.hash(password, 12)
    const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86_400_000)

    const result = await withTransaction(pool, async (client) => {
      const tenantRow = await client.query<TenantRow>(
        `INSERT INTO tenants (name, slug, business_type, status, trial_ends_at) VALUES ($1,$2,$3,'trial',$4) RETURNING *`,
        [company_name.trim(), slug, business_type, trialEnds.toISOString()]
      )
      const userRow = await client.query<AuthUser>(
        `INSERT INTO users (tenant_id, email, password_hash, full_name, role) VALUES ($1,$2,$3,$4,'owner') RETURNING id, email, full_name, role, tenant_id`,
        [tenantRow.rows[0].id, email, hash, owner_name.trim()]
      )
      return { tenant: tenantRow.rows[0], user: userRow.rows[0] }
    })

    const user: AuthUser = result.user
    res.status(201).json({ token: signToken(user), me: await loadMe(user) })
  })
)

/** POST /api/v1/auth/login */
router.post(
  '/login',
  validateBody(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>
    const row = await queryOne<AuthUser & { password_hash: string }>(
      `SELECT id, email, full_name, role, tenant_id, password_hash FROM users WHERE email = $1 AND is_active = true`,
      [email]
    )
    if (!row || !(await bcrypt.compare(password, row.password_hash))) throw new AppError(401, 'Incorrect email or password', 'BAD_CREDENTIALS')
    const user: AuthUser = { id: row.id, email: row.email, full_name: row.full_name, role: row.role, tenant_id: row.tenant_id }
    res.json({ token: signToken(user), me: await loadMe(user) })
  })
)

/** GET /api/v1/auth/me — also refreshes the token so active sessions stay alive. */
router.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ me: await loadMe(req.user!), token: signToken(req.user!) })
  })
)

/** POST /api/v1/auth/change-password */
const changePwSchema = z.object({ current_password: z.string().min(1), new_password: z.string().min(8).max(100) })
router.post(
  '/change-password',
  authenticate,
  validateBody(changePwSchema),
  asyncHandler(async (req, res) => {
    const { current_password, new_password } = req.body as z.infer<typeof changePwSchema>
    const row = await queryOne<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [req.user!.id])
    if (!row || !(await bcrypt.compare(current_password, row.password_hash))) throw new AppError(400, 'Current password is incorrect', 'BAD_PASSWORD')
    const hash = await bcrypt.hash(new_password, 12)
    await queryOne(`UPDATE users SET password_hash = $1 WHERE id = $2`, [hash, req.user!.id])
    res.json({ ok: true })
  })
)

export default router
