import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { queryOne } from '../config/db.js'
import { asyncHandler, AppError } from '../utils/helpers.js'
import { authenticate, signToken } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { createLinkCode, getMe, handleUpdate, telegramEnabled, WEBHOOK_SECRET } from '../services/telegram.js'
import {
  getMiniAppTenant,
  logMiniAppSession,
  normaliseSlug,
  requireTenant,
  resolveMiniAppTenant,
} from '../services/miniApp.js'

const router = Router()

/**
 * initData endpoints are unauthenticated by design — the HMAC check is the
 * auth. Rate limit them per IP so a leaked/hostile client can't hammer the
 * signature path (each attempt costs an HMAC plus up to 3 DB lookups).
 */
const initAppLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many requests — slow down and try again shortly.', code: 'RATE_LIMITED' },
})

/** GET /config — bot username + whether this account is linked (auth) */
router.get(
  '/config',
  authenticate,
  asyncHandler(async (req, res) => {
    // Check if tenant has their own company bot
    let tenantBot: { bot_username: string; is_active: boolean } | null = null
    if (req.user?.tenant_id) {
      tenantBot = await queryOne<{ bot_username: string; is_active: boolean }>(
        `SELECT bot_username, is_active FROM tenant_bots WHERE tenant_id = $1 AND is_active = true`,
        [req.user.tenant_id]
      )
    }

    const me = telegramEnabled() ? await getMe() : null
    const user = await queryOne<{ telegram_chat_id: number | null }>(`SELECT telegram_chat_id FROM users WHERE id = $1`, [req.user!.id])

    const botUsername = tenantBot?.bot_username ?? me?.username ?? process.env.TELEGRAM_BOT_USERNAME ?? null
    const isEnabled = Boolean(tenantBot?.is_active) || telegramEnabled()

    res.json({
      enabled: isEnabled,
      bot_username: botUsername,
      is_tenant_bot: Boolean(tenantBot),
      linked: Boolean(user?.telegram_chat_id),
      app_url: (process.env.PUBLIC_URL || '').replace(/\/$/, '') + (req.user?.tenant_id ? `/app?tenant_id=${req.user.tenant_id}` : '/app'),
    })
  })
)

/** POST /link-code — generate a 6-char code valid for 15 minutes (auth) */
router.post(
  '/link-code',
  authenticate,
  asyncHandler(async (req, res) => {
    let tenantBot: { bot_username: string } | null = null
    if (req.user?.tenant_id) {
      tenantBot = await queryOne<{ bot_username: string }>(
        `SELECT bot_username FROM tenant_bots WHERE tenant_id = $1 AND is_active = true`,
        [req.user.tenant_id]
      )
    }

    if (!tenantBot && !telegramEnabled()) {
      throw new AppError(503, 'No Telegram bot is configured for this workspace. Please set up a bot in Bot Studio or configure the platform bot.', 'TELEGRAM_OFF')
    }

    const code = await createLinkCode(req.user!.id)
    const me = telegramEnabled() ? await getMe() : null
    const botUsername = tenantBot?.bot_username ?? me?.username ?? process.env.TELEGRAM_BOT_USERNAME ?? null

    res.json({
      code,
      bot_username: botUsername,
      is_tenant_bot: Boolean(tenantBot),
    })
  })
)

/** POST /unlink — disconnect this account's chat (auth) */
router.post(
  '/unlink',
  authenticate,
  asyncHandler(async (req, res) => {
    await queryOne(`UPDATE users SET telegram_chat_id = NULL, telegram_linked_at = NULL WHERE id = $1`, [req.user!.id])
    res.json({ ok: true })
  })
)

/**
 * POST /verify — Mini App auto-login.
 * Validates the signed initData server-side (HMAC + freshness) against
 * either the company's tenant bot or the central platform bot.
 */
const initDataSchema = z.object({
  initData: z.string().min(20),
  botId: z.string().uuid().optional(),
  tenantId: z.string().uuid().optional(),
  slug: z.string().trim().min(2).max(64).optional(),
})

router.post(
  '/verify',
  initAppLimiter,
  validateBody(initDataSchema),
  asyncHandler(async (req, res) => {
    const { initData, botId, tenantId, slug } = req.body as z.infer<typeof initDataSchema>

    // Resolve the tenant server-side. The bot that signed initData IS the
    // authority on which store this is: the hinted bot first, then the
    // startapp slug, then the platform bot. A client-supplied tenant_id only
    // ever selects which token to check — it is never trusted as identity.
    const resolution = await resolveMiniAppTenant({ initData, botId, tenantId, slug })
    const parsed = resolution.parsed
    const targetTenantId = resolution.tenantId ?? tenantId ?? null

    if (!parsed) {
      throw new AppError(401, 'Telegram signature verification failed', 'TG_BAD_SIGNATURE')
    }

    // A tenant identified by bot signature or deep-link slug is authoritative:
    // only accept an account linked to THAT tenant. Falling back to "any tenant
    // with this chat id" would let store A's bot mint a session for store B.
    const tenantIsAuthoritative = resolution.via === 'bot_token' || resolution.via === 'start_param'

    let user: { id: string; email: string; full_name: string; role: 'owner' | 'staff' | 'afrotech_admin'; tenant_id: string | null } | null = null

    if (targetTenantId) {
      user = await queryOne(
        `SELECT id, email, full_name, role, tenant_id FROM users
         WHERE telegram_chat_id = $1 AND tenant_id = $2 AND is_active = true LIMIT 1`,
        [parsed.userId, targetTenantId]
      )
    }

    if (!user && !tenantIsAuthoritative) {
      // Platform-bot launch with no reliable tenant signal — match on chat id.
      user = await queryOne(
        `SELECT id, email, full_name, role, tenant_id FROM users
         WHERE telegram_chat_id = $1 AND is_active = true LIMIT 1`,
        [parsed.userId]
      )
    }

    if (!user) {
      throw new AppError(
        404,
        'This Telegram account is not linked to a workspace yet. Open your workspace and link it from Settings → Telegram.',
        'TG_NOT_LINKED'
      )
    }

    const tenant = user.tenant_id ? await getMiniAppTenant(user.tenant_id) : null
    res.json({ token: signToken(user), me: user, tenant })
  })
)

/**
 * POST /resolve — tenant branding for the Mini App shell.
 *
 * Called before (and independently of) login so the UI can paint the right
 * colours/logo while the user is still on the sign-in screen. Returns only
 * public config, and only after initData has been signature-verified.
 */
router.post(
  '/resolve',
  initAppLimiter,
  validateBody(initDataSchema),
  asyncHandler(async (req, res) => {
    const { initData, botId, tenantId, slug } = req.body as z.infer<typeof initDataSchema>
    const resolution = await resolveMiniAppTenant({ initData, botId, tenantId, slug })
    if (!resolution.parsed) {
      throw new AppError(401, 'Telegram signature verification failed', 'TG_BAD_SIGNATURE')
    }

    const tenant = resolution.tenantId ? await getMiniAppTenant(resolution.tenantId) : null
    if (!tenant) throw new AppError(404, 'This Telegram link is not linked to a workspace.', 'TENANT_UNKNOWN')

    await logMiniAppSession(tenant.id, resolution.parsed.userId, normaliseSlug(resolution.parsed.startParam) ?? null, resolution.via)

    res.json({
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        business_type: tenant.business_type,
        currency: tenant.currency,
        brand: tenant.brand,
        bot_username: tenant.bot_username,
      },
      telegram: {
        user_id: resolution.parsed.userId,
        first_name: resolution.parsed.firstName,
        username: resolution.parsed.username ?? null,
      },
      resolved_via: resolution.via,
    })
  })
)

  /** POST /webhook — Telegram updates (production). Validated by the secret header. */
  router.post(
    '/webhook',
    asyncHandler(async (req, res) => {
      if (WEBHOOK_SECRET) {
        const header = req.headers['x-telegram-bot-api-secret-token']
        if (header !== WEBHOOK_SECRET) throw new AppError(401, 'Bad webhook secret', 'BAD_SECRET')
      }
      // Always answer 200 once the update is accepted — a 500 makes Telegram
      // redeliver the same update and re-run side effects (link codes, etc.).
      try {
        await handleUpdate(req.body ?? {})
      } catch (err) {
        console.error('[telegram] webhook handler error:', err instanceof Error ? err.message : err)
      }
      res.json({ ok: true })
    })
  )

export default router
