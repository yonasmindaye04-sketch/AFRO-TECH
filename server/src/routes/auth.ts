import { Router } from 'express'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { pool, query, queryOne, TRIAL_DAYS } from '../config/db.js'
import { asyncHandler, AppError, slugify, withTransaction } from '../utils/helpers.js'
import type { PoolClient } from 'pg'
import { authenticate, signToken, type AuthUser, type TenantRow } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()

/** Seed default departments for a new tenant based on business_type */
async function seedDefaultDepartments(client: PoolClient, tenantId: string, businessType: string): Promise<void> {
  const defaultDepts: Record<string, { name: string; type: string; sort_order: number }[]> = {
    pharmacy: [
      { name: 'Reception', type: 'reception', sort_order: 1 },
      { name: 'Dispensing', type: 'dispensing', sort_order: 2 },
      { name: 'Counseling', type: 'counseling', sort_order: 3 },
      { name: 'Compounding', type: 'compounding', sort_order: 4 },
      { name: 'Verification', type: 'verification', sort_order: 4 },
      { name: 'Billing', type: 'billing', sort_order: 5 },
    ],
    store: [
      { name: 'Reception', type: 'reception', sort_order: 1 },
      { name: 'Sales Floor', type: 'sales', sort_order: 2 },
      { name: 'Returns/Repair', type: 'returns', sort_order: 3 },
      { name: 'Special Orders', type: 'special_orders', sort_order: 4 },
      { name: 'Billing', type: 'billing', sort_order: 5 },
    ],
    hospital: [
      { name: 'Reception', type: 'reception', sort_order: 1 },
      { name: 'Consultation', type: 'consultation', sort_order: 2 },
      { name: 'Laboratory', type: 'laboratory', sort_order: 3 },
      { name: 'Injection Room', type: 'injection', sort_order: 4 },
      { name: 'Procedure', type: 'procedure', sort_order: 5 },
      { name: 'Billing', type: 'billing', sort_order: 6 },
      { name: 'Records', type: 'records', sort_order: 7 },
    ],
    school: [
      { name: 'Reception', type: 'reception', sort_order: 1 },
      { name: 'Nurse/Clinic', type: 'nurse', sort_order: 2 },
      { name: 'Administration', type: 'admin', sort_order: 3 },
      { name: 'Billing', type: 'billing', sort_order: 4 },
      { name: 'Records', type: 'records', sort_order: 5 },
    ],
  }

  const depts = defaultDepts[businessType]
  if (!depts) return

  for (const dept of depts) {
    await client.query(
      `INSERT INTO departments (tenant_id, name, type, sort_order, is_active)
       VALUES ($1,$2,$3,$4,true)
       ON CONFLICT (tenant_id, name) DO NOTHING`,
      [tenantId, dept.name, dept.type, dept.sort_order]
    )
  }
}

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
  permissions?: string[]
  job_roles?: string[]
}

function daysLeft(trialEndsAt: Date): number {
  return Math.max(0, Math.ceil((new Date(trialEndsAt).getTime() - Date.now()) / 86_400_000))
}

async function loadMe(user: AuthUser): Promise<MeResponse> {
  let tenant: MeResponse['tenant'] = null
  let permissions: string[] = []
  let job_roles: string[] = []
  
  if (user.tenant_id) {
    const t = await queryOne<TenantRow>(`SELECT id, name, slug, business_type, status, trial_ends_at FROM tenants WHERE id = $1`, [
      user.tenant_id,
    ])
    if (t) tenant = { ...t, trial_days_left: t.status === 'trial' ? daysLeft(t.trial_ends_at) : 0 }

    if (user.role === 'owner') {
       const allPerms = await query<{ name: string }>(`SELECT name FROM permissions`)
       permissions = allPerms.map(p => p.name)
       job_roles = ['Owner']
    } else {
       const perms = await query<{ name: string }>(
         `SELECT p.name FROM permissions p
          JOIN role_permissions rp ON rp.permission_id = p.id
          JOIN user_roles ur ON ur.role_id = rp.role_id
          WHERE ur.user_id = $1 AND ur.tenant_id = $2`,
         [user.id, user.tenant_id]
       )
       permissions = perms.map(p => p.name)
       
       const roles = await query<{ name: string }>(
         `SELECT r.name FROM roles r
          JOIN user_roles ur ON ur.role_id = r.id
          WHERE ur.user_id = $1 AND ur.tenant_id = $2`,
         [user.id, user.tenant_id]
       )
       job_roles = roles.map(r => r.name)
    }
  } else if (user.role === 'afrotech_admin') {
    permissions = ['*']
    job_roles = ['AFRO-TECH Admin']
  }

  return { ...user, tenant, permissions, job_roles }
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

      // Seed default departments for the new tenant
      await seedDefaultDepartments(client, tenantRow.rows[0].id, business_type)

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

/* ══════════════ SOCIAL LOGIN (Google + Telegram) ══════════════ */

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo'
const TELEGRAM_FRESH_MS = 86_400_000

function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET)
}

function frontendUrl(): string {
  return String(process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '')
}

function callbackUrl(): string {
  return `${frontendUrl()}/api/v1/auth/google/callback`
}

/** Find a user by social id, link by email, or create a fresh owner (no workspace yet). */
async function findOrCreateSocialUser(input: {
  googleId?: string
  telegramId?: string
  telegramUsername?: string
  email?: string
  fullName: string
}): Promise<{ token: string; needsWorkspace: boolean }> {
  let user: AuthUser | null = null

  if (input.googleId) {
    user = await queryOne<AuthUser>(`SELECT id, email, full_name, role, tenant_id FROM users WHERE google_id = $1 AND is_active = true`, [input.googleId])
  }
  if (!user && input.telegramId) {
    user = await queryOne<AuthUser>(`SELECT id, email, full_name, role, tenant_id FROM users WHERE telegram_id = $1 AND is_active = true`, [input.telegramId])
  }
  // Already registered with email + password → link the social identity
  if (!user && input.email) {
    user = await queryOne<AuthUser>(`SELECT id, email, full_name, role, tenant_id FROM users WHERE email = $1 AND is_active = true`, [input.email])
  }

  if (!user) {
    const email = input.email || `tg${input.telegramId}@telegram.users`
    const dup = await queryOne<{ id: string }>(`SELECT id FROM users WHERE email = $1`, [email])
    if (dup) {
      user = (await queryOne<AuthUser>(`SELECT id, email, full_name, role, tenant_id FROM users WHERE id = $1`, [dup.id]))!
    } else {
      // Random password — social users sign in with their provider, never with it
      const hash = await bcrypt.hash(crypto.randomUUID(), 12)
      user = (await queryOne<AuthUser>(
        `INSERT INTO users (email, password_hash, full_name, role, google_id, telegram_id)
         VALUES ($1,$2,$3,'owner',$4,$5) RETURNING id, email, full_name, role, tenant_id`,
        [email, hash, input.fullName, input.googleId ?? null, input.telegramId ?? null]
      ))!
    }
  } else {
    // Link the social id to the existing account if not linked yet
    if (input.googleId) await pool.query(`UPDATE users SET google_id = $1 WHERE id = $2 AND google_id IS NULL`, [input.googleId, user.id])
    if (input.telegramId) await pool.query(`UPDATE users SET telegram_id = $1 WHERE id = $2 AND telegram_id IS NULL`, [input.telegramId, user.id])
  }

  const needsWorkspace = !user.tenant_id && user.role !== 'afrotech_admin'
  return { token: signToken(user), needsWorkspace }
}

/** GET /auth/providers — which social providers are configured (public). */
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.json({
      google: googleConfigured(),
      telegram_bot: process.env.TELEGRAM_BOT_USERNAME ? process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '') : null,
    })
  })
)

/** GET /auth/google — start the Google OAuth consent flow. */
router.get(
  '/google',
  asyncHandler(async (req, res) => {
    const fe = frontendUrl()
    if (!googleConfigured()) return res.redirect(`${fe}/app/social?error=${encodeURIComponent('Google sign-in is not configured on this server yet')}`)
    const state = jwt.sign({ p: 'google-oauth' }, process.env.JWT_SECRET || 'dev_secret_change_me', { expiresIn: '10m' })
    const url = new URL(GOOGLE_AUTH_URL)
    url.searchParams.set('client_id', process.env.GOOGLE_CLIENT_ID!)
    url.searchParams.set('redirect_uri', callbackUrl())
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('scope', 'openid email profile')
    url.searchParams.set('state', state)
    url.searchParams.set('prompt', 'select_account')
    res.redirect(url.toString())
  })
)

/** GET /auth/google/callback — exchange the code, find/create the user, bounce to the app. */
router.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const fe = frontendUrl()
    const fail = (msg: string): void => res.redirect(`${fe}/app/social?error=${encodeURIComponent(msg)}`)
    try {
      if (!googleConfigured()) return fail('Google sign-in is not configured on this server yet')
      const code = String(req.query.code || '')
      const state = String(req.query.state || '')
      if (!code) return fail('Missing authorization code')
      try {
        jwt.verify(state, process.env.JWT_SECRET || 'dev_secret_change_me')
      } catch {
        return fail('Expired sign-in attempt — please try again')
      }

      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: process.env.GOOGLE_CLIENT_ID!,
          client_secret: process.env.GOOGLE_CLIENT_SECRET!,
          redirect_uri: callbackUrl(),
          grant_type: 'authorization_code',
        }),
      })
      if (!tokenRes.ok) return fail('Google rejected the sign-in — please try again')
      const tokens = (await tokenRes.json()) as { access_token?: string }
      if (!tokens.access_token) return fail('Google did not return an access token')

      const infoRes = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${tokens.access_token}` } })
      if (!infoRes.ok) return fail('Could not read your Google profile')
      const profile = (await infoRes.json()) as { sub?: string; email?: string; name?: string; given_name?: string; family_name?: string }
      if (!profile.sub || !profile.email) return fail('Your Google account did not share an email address')

      const result = await findOrCreateSocialUser({
        googleId: profile.sub,
        email: profile.email.toLowerCase(),
        fullName: profile.name || [profile.given_name, profile.family_name].filter(Boolean).join(' ') || profile.email.split('@')[0],
      })
      return res.redirect(`${fe}/app/social?token=${encodeURIComponent(result.token)}${result.needsWorkspace ? '&ws=1' : ''}`)
    } catch (err) {
      console.error('[auth/google]', err)
      return fail('Sign-in failed — please try again')
    }
  })
)

/** POST /auth/telegram-login — verify the Telegram Login Widget payload and sign in. */
const telegramLoginSchema = z.object({
  id: z.union([z.number(), z.string()]),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  photo_url: z.string().optional(),
  auth_date: z.union([z.number(), z.string()]),
  hash: z.string(),
})
router.post(
  '/telegram-login',
  validateBody(telegramLoginSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof telegramLoginSchema>
    const botToken = process.env.TELEGRAM_BOT_TOKEN
    if (!botToken) throw new AppError(503, 'Telegram sign-in is not configured on this server', 'NOT_CONFIGURED')

    const authMs = Number(d.auth_date) * 1000
    if (Number.isNaN(authMs) || Date.now() - authMs > TELEGRAM_FRESH_MS) {
      throw new AppError(401, 'Expired Telegram sign-in — please try again', 'BAD_TOKEN')
    }

    // Per Telegram spec: secret = SHA256(bot_token); HMAC-SHA256(data_check_string, secret) must equal hash
    const dataCheckString = Object.entries(d)
      .filter(([k]) => k !== 'hash')
      .map(([k, v]) => `${k}=${String(v)}`)
      .sort()
      .join('\n')
    const secret = crypto.createHash('sha256').update(botToken).digest()
    const hmac = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex')
    if (hmac !== d.hash) throw new AppError(401, 'Invalid Telegram sign-in — verification failed', 'BAD_SIGNATURE')

    const fullName = [d.first_name, d.last_name].filter(Boolean).join(' ') || (d.username ? `@${d.username}` : `Telegram ${d.id}`)
    const result = await findOrCreateSocialUser({ telegramId: String(d.id), telegramUsername: d.username, fullName })
    res.json({ token: result.token, needs_workspace: result.needsWorkspace })
  })
)

/** POST /auth/complete-social — create a workspace for a social-logged-in user with no tenant. */
const completeSocialSchema = z.object({
  company_name: z.string().trim().min(2).max(120),
  business_type: z.enum(['pharmacy', 'store', 'hospital', 'school']),
})
router.post(
  '/complete-social',
  authenticate,
  validateBody(completeSocialSchema),
  asyncHandler(async (req, res) => {
    const user = req.user!
    if (user.tenant_id) throw new AppError(409, 'Your account already has a workspace', 'HAS_TENANT')
    const { company_name, business_type } = req.body as z.infer<typeof completeSocialSchema>

    let slug = slugify(company_name)
    const slugTaken = await queryOne(`SELECT id FROM tenants WHERE slug = $1`, [slug])
    if (slugTaken) slug = `${slug}-${Math.random().toString(36).slice(2, 7)}`

    const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86_400_000)
    const tenantRow = await queryOne<TenantRow>(
      `INSERT INTO tenants (name, slug, business_type, status, trial_ends_at) VALUES ($1,$2,$3,'trial',$4) RETURNING *`,
      [company_name.trim(), slug, business_type, trialEnds.toISOString()]
    )
    await pool.query(`UPDATE users SET tenant_id = $1 WHERE id = $2`, [tenantRow!.id, user.id])
    await withTransaction(pool, async (client) => {
      await seedDefaultDepartments(client, tenantRow!.id, business_type)
    })

    const updated: AuthUser = { ...user, tenant_id: tenantRow!.id }
    res.status(201).json({ token: signToken(updated), me: await loadMe(updated) })
  })
)

export default router
