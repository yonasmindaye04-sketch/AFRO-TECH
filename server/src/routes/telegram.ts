import { Router } from 'express'
import { z } from 'zod'
import { queryOne } from '../config/db.js'
import { asyncHandler, AppError } from '../utils/helpers.js'
import { authenticate, signToken } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { createLinkCode, getMe, handleUpdate, telegramEnabled, verifyInitData, WEBHOOK_SECRET } from '../services/telegram.js'

const router = Router()

  /** GET /config — bot username + whether this account is linked (auth) */
router.get(
    '/config',
    authenticate,
    asyncHandler(async (req, res) => {
      const me = telegramEnabled() ? await getMe() : null
      const user = await queryOne<{ telegram_chat_id: number | null }>(`SELECT telegram_chat_id FROM users WHERE id = $1`, [req.user!.id])
      res.json({
        enabled: telegramEnabled(),
        bot_username: me?.username ?? process.env.TELEGRAM_BOT_USERNAME ?? null,
        linked: Boolean(user?.telegram_chat_id),
        app_url: (process.env.PUBLIC_URL || '').replace(/\/$/, '') + '/app',
      })
    })
  )

  /** POST /link-code — generate a 6-char code valid for 15 minutes (auth) */
router.post(
    '/link-code',
    authenticate,
    asyncHandler(async (req, res) => {
      if (!telegramEnabled()) throw new AppError(503, 'Telegram is not configured on this server', 'TELEGRAM_OFF')
      const code = await createLinkCode(req.user!.id)
      const me = await getMe()
      res.json({ code, bot_username: me?.username ?? process.env.TELEGRAM_BOT_USERNAME ?? null })
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
   * Validates the signed initData server-side (HMAC + freshness), then issues a
   * platform JWT for the linked user. Telegram identity replaces the password.
   */
router.post(
    '/verify',
    validateBody(z.object({ initData: z.string().min(20) })),
    asyncHandler(async (req, res) => {
      const parsed = verifyInitData((req.body as { initData: string }).initData)
      if (!parsed) throw new AppError(401, 'Telegram signature verification failed', 'TG_BAD_SIGNATURE')
      const user = await queryOne<{ id: string; email: string; full_name: string; role: 'owner' | 'staff' | 'afrotech_admin'; tenant_id: string | null }>(
        `SELECT id, email, full_name, role, tenant_id FROM users WHERE telegram_chat_id = $1 AND is_active = true LIMIT 1`,
        [parsed.userId]
      )
      if (!user) throw new AppError(404, 'This Telegram account is not linked to a workspace yet. Open the web app and link it from Settings → Telegram.', 'TG_NOT_LINKED')
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
