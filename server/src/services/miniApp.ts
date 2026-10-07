import { query, queryOne } from '../config/db.js'
import { AppError } from '../utils/helpers.js'
import { BOT_TOKEN_SQL, decryptBotToken } from './tenantBot.js'
import { telegramEnabled, verifyInitData, verifyInitDataWithToken } from './telegram.js'

export interface ParsedInitData {
  userId: number
  firstName: string
  username?: string
  /** startapp / ?startapp= value from the deep link, if present. */
  startParam?: string
  authDate: number
}

export interface MiniAppTenant {
  id: string
  name: string
  slug: string
  business_type: 'pharmacy' | 'store' | 'hospital' | 'school'
  currency: string
  brand: TenantBrand
  bot_username: string | null
}

export interface Resolution {
  parsed: ParsedInitData | null
  tenantId: string | null
  /** Which signal identified the tenant — recorded for audit/debugging. */
  via: 'bot_token' | 'start_param' | 'fallback' | null
}

/**
 * Parse initData WITHOUT verifying the signature, purely to read the routing
 * hints (start_param, query_id). Nothing here is trusted as identity — the
 * returned values only decide which bot token to verify against.
 */
export function peekInitData(initData: string): { startParam?: string; userId?: number; authDate: number } {
  try {
    const params = new URLSearchParams(initData)
    const authDate = Number(params.get('auth_date') || 0)
    const startParam = params.get('start_param') || undefined
    const userRaw = params.get('user')
    const userId = userRaw ? ((JSON.parse(userRaw) as { id?: number }).id ?? undefined) : undefined
    return { startParam, userId, authDate }
  } catch {
    return { authDate: 0 }
  }
}

/**
 * Resolve which tenant a Mini App launch belongs to.
 *
 * Order of authority:
 *  1. `botId`/`tenantId` hint -> that bot's token verifies the HMAC. Success
 *     proves the initData was signed by this specific store's bot.
 *  2. `start_param` (deep link `?startapp=<slug>`) -> look the tenant up by
 *     slug, then verify with its bot token. The slug is only a routing hint;
 *     the HMAC still has to match.
 *  3. Platform bot fallback for single-bot setups.
 *
 * A client-supplied tenantId is never trusted on its own: it can only win if
 * the signature validates against that tenant's own bot token.
 */
export async function resolveMiniAppTenant(opts: {
  initData: string
  botId?: string
  tenantId?: string
  slug?: string
}): Promise<Resolution> {
  const { initData, botId, tenantId } = opts
  const peek = peekInitData(initData)
  const slug = (opts.slug || peek.startParam || '').trim()

  // 1. Tenant bot hinted by bot_id / tenant_id query param
  if (botId || tenantId) {
    const hinted = await queryOne<{ id: string; tenant_id: string; resolved_token: string | null }>(
      `SELECT id, tenant_id, ${BOT_TOKEN_SQL} AS resolved_token FROM tenant_bots
       WHERE (${botId ? 'id = $1' : 'tenant_id = $1'}) AND is_active = true`,
      [botId || tenantId]
    )
    if (hinted?.resolved_token) {
      const parsed = verify(initData, hinted.resolved_token)
      if (parsed) return { parsed, tenantId: hinted.tenant_id, via: 'bot_token' }
    }
  }

  // 2. Deep-link slug -> tenant -> its bot token
  if (slug) {
    const bySlug = await queryOne<{ id: string; resolved_token: string | null }>(
      `SELECT t.id, ${BOT_TOKEN_SQL} AS resolved_token
       FROM tenants t
       JOIN tenant_bots b ON b.tenant_id = t.id AND b.is_active = true
       WHERE t.bot_slug = $1 OR t.slug = $1
       LIMIT 1`,
      [slug]
    )
    if (bySlug?.resolved_token) {
      const parsed = verify(initData, bySlug.resolved_token)
      if (parsed) return { parsed, tenantId: bySlug.id, via: 'start_param' }
    }
  }

  // 3. Platform (single-bot) fallback
  if (telegramEnabled()) {
    const parsed = verify(initData, null)
    if (parsed) return { parsed, tenantId: tenantId || null, via: 'fallback' }
  }

  return { parsed: null, tenantId: null, via: null }
}

/** Verify + normalise, optionally against a specific (possibly sealed) token. */
function verify(initData: string, token: string | null): ParsedInitData | null {
  const parsed = token === null ? verifyInitData(initData) : verifyInitDataWithToken(initData, decryptBotToken(token))
  if (!parsed) return null
  const peek = peekInitData(initData)
  return { ...parsed, startParam: peek.startParam, authDate: peek.authDate }
}

export interface TenantBrand {
  primary?: string
  accent?: string
  logo_url?: string
  tagline?: string
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

/** Only allow hex colours through — brand values are injected into CSS vars. */
function sanitiseBrand(raw: unknown): TenantBrand {
  const src = (raw ?? {}) as Record<string, unknown>
  const out: TenantBrand = {}
  if (typeof src.primary === 'string' && HEX.test(src.primary)) out.primary = src.primary
  if (typeof src.accent === 'string' && HEX.test(src.accent)) out.accent = src.accent
  if (typeof src.logo_url === 'string' && /^https:\/\//i.test(src.logo_url) && src.logo_url.length <= 500) {
    out.logo_url = src.logo_url
  }
  if (typeof src.tagline === 'string') out.tagline = src.tagline.slice(0, 140)
  return out
}

/** Public, non-sensitive tenant config the Mini App renders before login. */
export async function getMiniAppTenant(tenantId: string): Promise<MiniAppTenant | null> {
  const row = await queryOne<{
    id: string
    name: string
    slug: string
    business_type: MiniAppTenant['business_type']
    currency: string
    brand: Record<string, unknown>
    bot_username: string | null
  }>(
    `SELECT t.id, t.name, t.slug, t.business_type,
            COALESCE(s.data->>'currency', 'ETB') AS currency,
            t.brand,
            b.bot_username
     FROM tenants t
     LEFT JOIN tenant_settings s ON s.tenant_id = t.id
     LEFT JOIN tenant_bots b ON b.tenant_id = t.id AND b.is_active = true
     WHERE t.id = $1`,
    [tenantId]
  )
  if (!row) return null
  return { ...row, brand: sanitiseBrand(row.brand) }
}

/** Record how a Mini App launch was resolved — feeds per-tenant usage stats. */
export async function logMiniAppSession(tenantId: string, telegramId: number | null, startParam: string | null, via: Resolution['via']): Promise<void> {
  await query(
    `INSERT INTO tenant_miniapp_sessions (tenant_id, telegram_id, start_param, resolved_via)
     VALUES ($1, $2, $3, $4)`,
    [tenantId, telegramId, startParam, via ?? 'fallback']
  ).catch((err) => console.warn('[miniapp] session log failed:', err instanceof Error ? err.message : err))
}

/** Parse the slug a `?startapp=` deep link carried, ignoring junk values. */
export function normaliseSlug(value: string | null | undefined): string | undefined {
  const slug = (value ?? '').trim().toLowerCase()
  return /^[a-z0-9][a-z0-9-]{1,48}$/.test(slug) ? slug : undefined
}

export function requireTenant(tenant: MiniAppTenant | null): MiniAppTenant {
  if (!tenant) throw new AppError(404, 'This Telegram link is not linked to a workspace.', 'TENANT_UNKNOWN')
  return tenant
}