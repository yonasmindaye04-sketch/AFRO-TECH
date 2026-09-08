import { Router } from 'express'
import { z } from 'zod'
import { queryOne } from '../config/db.js'
import { asyncHandler, AppError } from '../utils/helpers.js'
import { authenticate, signToken } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { createLinkCode, getMe, handleUpdate, telegramEnabled, verifyInitData, verifyInitDataWithToken, WEBHOOK_SECRET } from '../services/telegram.js'

const router = Router()

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
router.post(
  '/verify',
  validateBody(
    z.object({
      initData: z.string().min(20),
      botId: z.string().uuid().optional(),
      tenantId: z.string().uuid().optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const { initData, botId, tenantId } = req.body as {
      initData: string
      botId?: string
      tenantId?: string
    }

    let parsed: { userId: number; firstName: string; username?: string } | null = null
    let targetTenantId: string | null = tenantId || null

    // 1. Try verifying with tenant bot if botId or tenantId is provided
    if (botId || tenantId) {
      const tenantBot = await queryOne<{ id: string; tenant_id: string; bot_token: string }>(
        `SELECT id, tenant_id, bot_token FROM tenant_bots
         WHERE (${botId ? 'id = $1' : 'tenant_id = $1'}) AND is_active = true`,
        [botId || tenantId]
      )
      if (tenantBot) {
        targetTenantId = tenantBot.tenant_id
        parsed = verifyInitDataWithToken(initData, tenantBot.bot_token)
      }
    }

    // 2. Fallback to verifying with the platform bot token
    if (!parsed && telegramEnabled()) {
      parsed = verifyInitData(initData)
    }

    if (!parsed) {
      throw new AppError(401, 'Telegram signature verification failed', 'TG_BAD_SIGNATURE')
    }

    // 3. Find linked user — prioritize matching the specific tenant if known
    let user: { id: string; email: string; full_name: string; role: 'owner' | 'staff' | 'afrotech_admin'; tenant_id: string | null } | null = null

    if (targetTenantId) {
      user = await queryOne(
        `SELECT id, email, full_name, role, tenant_id FROM users
         WHERE telegram_chat_id = $1 AND tenant_id = $2 AND is_active = true LIMIT 1`,
        [parsed.userId, targetTenantId]
      )
    }

    if (!user) {
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

    res.json({ token: signToken(user), me: user })
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
      await handleUpdate(req.body ?? {})
      res.json({ ok: true })
    })
  )

export default router
