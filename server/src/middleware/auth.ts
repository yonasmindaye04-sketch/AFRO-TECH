import jwt from 'jsonwebtoken'
import type { NextFunction, Request, Response } from 'express'
import { queryOne } from '../config/db.js'
import { AppError } from '../utils/helpers.js'
const JWT_SECRET = process.env.JWT_SECRET || 'dev_secret_change_me'

export interface AuthUser {
  id: string
  email: string
  full_name: string
  role: 'owner' | 'staff' | 'afrotech_admin'
  tenant_id: string | null
}

export interface TenantRow {
  id: string
  name: string
  slug: string
  business_type: 'pharmacy' | 'store' | 'hospital' | 'school'
  status: 'trial' | 'active' | 'expired' | 'suspended'
  trial_ends_at: Date
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser
      tenant?: TenantRow | null
    }
  }
}

export interface JwtPayload {
  sub: string
  tid: string | null
  role: AuthUser['role']
}

export function signToken(user: AuthUser): string {
  const expiresIn = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn']
  return jwt.sign({ sub: user.id, tid: user.tenant_id, role: user.role }, JWT_SECRET, { expiresIn })
}

/** Verify JWT then load fresh user + tenant so suspensions/expiry apply immediately. */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) throw new AppError(401, 'Authentication required', 'NO_TOKEN')

    let payload: JwtPayload
    try {
      payload = jwt.verify(token, JWT_SECRET) as JwtPayload
    } catch {
      throw new AppError(401, 'Session expired — please sign in again', 'BAD_TOKEN')
    }

    const user = await queryOne<AuthUser>(
      `SELECT id, email, full_name, role, tenant_id FROM users WHERE id = $1 AND is_active = true`,
      [payload.sub]
    )
    if (!user) throw new AppError(401, 'Account disabled or removed', 'USER_INACTIVE')

    req.user = user

    if (user.role === 'afrotech_admin') {
      req.tenant = null
    } else if (user.tenant_id) {
      const tenant = await queryOne<TenantRow>(`SELECT id, name, slug, business_type, status, trial_ends_at FROM tenants WHERE id = $1`, [
        user.tenant_id,
      ])
      if (!tenant) throw new AppError(401, 'Company workspace not found', 'TENANT_MISSING')

      // Auto-expire finished trials
      if (tenant.status === 'trial' && new Date(tenant.trial_ends_at).getTime() < Date.now()) {
        await queryOne(`UPDATE tenants SET status = 'expired', updated_at = now() WHERE id = $1 AND status = 'trial'`, [tenant.id])
        tenant.status = 'expired'
      }
      req.tenant = tenant
    }
    next()
  } catch (err) {
    next(err)
  }
}

/** Block access when the tenant's trial has expired or the account is suspended. */
export function requireActiveTenant(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role === 'afrotech_admin') return next()
  const t = req.tenant
  if (!t) return next(new AppError(403, 'No company workspace linked to this account', 'NO_TENANT'))
  if (t.status === 'expired')
    return next(new AppError(402, 'Your free trial has ended. Contact AFRO-TECH to subscribe and reactivate your account.', 'TRIAL_EXPIRED'))
  if (t.status === 'suspended')
    return next(new AppError(403, 'This workspace has been suspended by AFRO-TECH. Contact support.', 'SUSPENDED'))
  next()
}

export function requireRole(...roles: AuthUser['role'][]): (req: Request, res: Response, next: NextFunction) => void {
  return (req, _res, next) => {
    if (!req.user || !roles.includes(req.user.role)) return next(new AppError(403, 'You do not have permission for this action', 'FORBIDDEN'))
    next()
  }
}

export function requireAfrotechAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'afrotech_admin') return next(new AppError(403, 'AFRO-TECH admin access required', 'ADMIN_ONLY'))
  next()
}

/** Ensures a tenant-scoped resource belongs to the caller's tenant before mutating it. */
export async function assertOwnership(tenantId: string | null | undefined, rowTenantId: string): Promise<void> {
  if (!tenantId || rowTenantId !== tenantId) throw new AppError(404, 'Resource not found', 'NOT_FOUND')
}
