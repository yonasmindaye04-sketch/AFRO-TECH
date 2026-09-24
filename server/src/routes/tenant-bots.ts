import { Router } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../config/db.js'
import { asyncHandler, AppError } from '../utils/helpers.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import {
  validateBotToken,
  getTenantBotByTenant,
  getTenantBotByBotId,
  listSubscribers,
  listBroadcasts,
  sendBroadcast,
  startTenantBot,
  stopTenantBot,
  handleTenantBotUpdate,
  useWebhooks,
  registerBotWebhook,
  clearBotWebhook,
} from '../services/tenantBot.js'

const router = Router()

/* ── Public webhook (no auth) — Telegram calls this for each bot.
      Path carries the bot id + per-bot secret, making the URL itself unguessable. */
router.post(
  '/webhook/:botId/:secret',
  asyncHandler(async (req, res) => {
    const { botId, secret } = req.params
    const bot = await getTargetBot(botId, secret)
    if (!bot) return res.status(404).json({ error: 'Unknown bot' }) // don't leak which part was wrong
    if (!bot.is_active) return res.json({ ok: true, ignored: 'inactive' })
    // Always answer 200 once the update is accepted — a 500 makes Telegram
    // redeliver the same update and re-run side effects (subscribers, links).
    try {
      await handleTenantBotUpdate(bot, req.body ?? {})
    } catch (err) {
      console.error(`[bot:${botId}] webhook handler error:`, err instanceof Error ? err.message : err)
    }
    res.json({ ok: true })
  })
)

async function getTargetBot(botId: string, secret: string) {
  try {
    return await queryOne<import('../services/tenantBot.js').TenantBotRow>(
      `SELECT * FROM tenant_bots WHERE id = $1::uuid AND webhook_secret = $2`,
      [botId, secret]
    )
  } catch {
    return null
  }
}

/* ── Authenticated tenant management ── */
router.use(authenticate)

/** GET /api/v1/tenant-bot — bot config + minimal status (owner) */
router.get(
  '/',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) return res.json({ bot: null })
    const subs = await queryOne<{ total: string; active: string }>(
      `SELECT count(*)::text AS total, count(*) FILTER (WHERE is_active)::text AS active
       FROM bot_subscribers WHERE bot_id = $1`,
      [bot.id]
    )
    const broadcastsCount = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM bot_broadcasts WHERE bot_id = $1`, [bot.id])
    res.json({
      bot: {
        id: bot.id,
        bot_username: bot.bot_username,
        bot_id: bot.bot_id,
        display_name: bot.display_name,
        description: bot.description,
        welcome_message: bot.welcome_message,
        commands: bot.commands,
        auto_reply: bot.auto_reply,
        is_active: bot.is_active,
        broadcast_limit_per_day: bot.broadcast_limit_per_day,
        total_subscribers: Number(subs?.active ?? 0),
        total_subscribers_ever: Number(subs?.total ?? 0),
        last_broadcast_at: bot.last_broadcast_at,
        share_url: `https://t.me/${bot.bot_username}?start=subscribe`,
        total_broadcasts: Number(broadcastsCount?.n ?? 0),
      },
    })
  })
)

/** POST /api/v1/tenant-bot/register — validate token and create a bot (owner) */
router.post(
  '/register',
  requireRole('owner'),
  validateBody(z.object({ token: z.string().regex(/^\d+:[A-Za-z0-9_-]+$/, 'Looks like an invalid BotFather token') })),
  asyncHandler(async (req, res) => {
    const token = (req.body as { token: string }).token.trim()
    const me = await validateBotToken(token)
    const tid = req.user!.tenant_id!

    const existing = await getTenantBotByTenant(tid)
    const row = await queryOne<{ id: string; bot_username: string; is_active: boolean; webhook_secret: string }>(
      existing
        ? `UPDATE tenant_bots SET bot_token=$2, bot_id=$3, bot_username=$4, is_active=true, updated_at=now()
           WHERE tenant_id=$1 RETURNING id, bot_username, is_active, webhook_secret`
        : `INSERT INTO tenant_bots (tenant_id, bot_token, bot_id, bot_username) VALUES ($1, $2, $3, $4)
           RETURNING id, bot_username, is_active, webhook_secret`,
      [tid, token, me.id, me.username]
    )
    if (!row) throw new AppError(500, 'Could not save the bot', 'INTERNAL')
    const bot = await queryOne<import('../services/tenantBot.js').TenantBotRow>(`SELECT * FROM tenant_bots WHERE id = $1`, [row.id])
    if (!bot) throw new AppError(500, 'Could not load the bot', 'INTERNAL')

    // Prefer webhook (production, works on free-tier apps) — fallback to local polling loop.
    if (useWebhooks()) await registerBotWebhook(bot)
    else await startTenantBot(row.id)

    res.json({ id: row.id, bot_username: row.bot_username, is_active: row.is_active, share_url: `https://t.me/${row.bot_username}` })
  })
)

/** PATCH /api/v1/tenant-bot — update bot config (owner) */
router.patch(
  '/',
  requireRole('owner'),
  validateBody(
    z.object({
      welcome_message: z.string().min(1).max(4000).optional(),
      display_name: z.string().max(100).nullable().optional(),
      description: z.string().max(500).nullable().optional(),
      auto_reply: z.boolean().optional(),
      broadcast_limit_per_day: z.number().int().min(0).max(50).optional(),
      commands: z
        .array(
          z.object({
            trigger: z.string().regex(/^\/[a-z0-9_/-]+$/i, 'Command must start with /').max(32),
            response: z.string().min(1).max(4000),
          })
        )
        .max(40)
        .optional(),
    })
  ),
  asyncHandler(async (req, res) => {
    const tid = req.user!.tenant_id!
    const bot = await getTenantBotByTenant(tid)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    const fields = req.body as Record<string, unknown>
    const keys = Object.keys(fields)
    if (!keys.length) return res.json({ ok: true })
    const sets = keys.map((k, i) => `${k} = $${i + 2}`).join(', ')
    const row = await queryOne(
      `UPDATE tenant_bots SET ${sets}, updated_at = now() WHERE id = $1 RETURNING *`,
      [bot.id, ...Object.values(fields)]
    )
    res.json({ bot: row })
  })
)

/** POST /api/v1/tenant-bot/pause — stop receiving messages (owner) */
router.post(
  '/pause',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    if (useWebhooks()) await clearBotWebhook(bot)
    else await stopTenantBot(bot.id)
    await query(`UPDATE tenant_bots SET is_active = false, updated_at = now() WHERE id = $1`, [bot.id])
    res.json({ ok: true })
  })
)

/** POST /api/v1/tenant-bot/resume — resume receiving messages (owner) */
router.post(
  '/resume',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    if (!bot.bot_token) throw new AppError(400, 'Bot has no token; re-register', 'NO_TOKEN')
    if (useWebhooks()) await registerBotWebhook(bot)
    else await startTenantBot(bot.id)
    await query(`UPDATE tenant_bots SET is_active = true, updated_at = now() WHERE id = $1`, [bot.id])
    res.json({ ok: true })
  })
)

/** GET /api/v1/tenant-bot/subscribers — list of subscribers (owner) */
router.get(
  '/subscribers',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    const rows = await listSubscribers(bot.id)
    res.json({ subscribers: rows })
  })
)

/** GET /api/v1/tenant-bot/subscribers now includes language preference for the dashboard */

/** GET /api/v1/tenant-bot/receipts — payment receipts customers sent to the bot (owner) */
router.get(
  '/receipts',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    const status = String(req.query.status || '').toLowerCase()
    const allowed = ['pending', 'confirmed', 'rejected']
    const rows = await query<{
      id: string
      chat_id: string
      sender_name: string | null
      caption: string | null
      file_id: string
      status: string
      review_note: string | null
      created_at: Date
    }>(
      `SELECT id, chat_id::text, sender_name, caption, file_id, status, review_note, created_at
       FROM bot_receipt_submissions
       WHERE bot_id = $1 ${allowed.includes(status) ? 'AND status = $2' : ''}
       ORDER BY created_at DESC LIMIT 200`,
      allowed.includes(status) ? [bot.id, status] : [bot.id]
    )
    res.json({ receipts: rows })
  })
)

/** POST /api/v1/tenant-bot/receipts/:id/review — confirm/reject a customer receipt (owner) */
router.post(
  '/receipts/:id/review',
  requireRole('owner'),
  validateBody(
    z
      .object({ status: z.enum(['confirmed', 'rejected']), review_note: z.string().max(500).optional() })
      .strip()
  ),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    const { status, review_note } = req.body as { status: 'confirmed' | 'rejected'; review_note?: string }
    const receipt = await queryOne<{ id: string; chat_id: string; status: string }>(
      `SELECT id, chat_id::text, status FROM bot_receipt_submissions WHERE id = $1 AND bot_id = $2`,
      [req.params.id, bot.id]
    )
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND')
    if (receipt.status !== 'pending') throw new AppError(409, `Receipt is already ${receipt.status}`, 'BAD_STATE')

    await query(
      `UPDATE bot_receipt_submissions
       SET status = $2, review_note = $3, reviewed_by = $4, reviewed_at = now()
       WHERE id = $1`,
      [receipt.id, status, review_note ?? null, req.user!.id]
    )

    // Notify the customer via the tenant bot (fire-and-forget)
    try {
      const lang = (await queryOne<{ language: string }>(`SELECT language FROM bot_subscribers WHERE bot_id = $1 AND chat_id = $2`, [bot.id, receipt.chat_id]))?.language
      const { bt, isBotLang } = await import('../services/botI18n.js')
      const text = bt(isBotLang(lang) ? lang : 'en', status === 'confirmed' ? 'receipt_confirmed' : 'receipt_rejected')
      await fetch(`https://api.telegram.org/bot${bot.bot_token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: receipt.chat_id, text }),
      })
    } catch (e) {
      console.warn('[tenant-bot] receipt review notify failed:', e instanceof Error ? e.message : e)
    }

    res.json({ ok: true, status })
  })
)

/** GET /api/v1/tenant-bot/receipts/:id/photo — proxy the Telegram photo so the owner can view it */
router.get(
  '/receipts/:id/photo',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    const receipt = await queryOne<{ file_id: string }>(
      `SELECT file_id FROM bot_receipt_submissions WHERE id = $1 AND bot_id = $2`,
      [req.params.id, bot.id]
    )
    if (!receipt) throw new AppError(404, 'Receipt not found', 'NOT_FOUND')

    const fileRes = await fetch(`https://api.telegram.org/bot${bot.bot_token}/getFile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: receipt.file_id }),
    })
    const fileData = (await fileRes.json()) as { ok: boolean; result?: { file_path?: string } }
    if (!fileData.ok || !fileData.result?.file_path) throw new AppError(404, 'Receipt photo unavailable', 'NO_FILE')

    const fileUrl = `https://api.telegram.org/file/bot${bot.bot_token}/${encodeURI(fileData.result.file_path)}`
    const img = await fetch(fileUrl)
    if (!img.ok || !img.body) throw new AppError(502, 'Could not fetch receipt photo', 'FILE_FETCH_FAIL')
    res.setHeader('Content-Type', img.headers.get('content-type') ?? 'image/jpeg')
    res.setHeader('Cache-Control', 'private, max-age=300')
    const { Readable } = await import('node:stream')
    Readable.fromWeb(img.body as unknown as import('node:stream/web').ReadableStream).pipe(res)
  })
)

/** GET /api/v1/tenant-bot/broadcasts — broadcast history (owner) */
router.get(
  '/broadcasts',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    const rows = await listBroadcasts(bot.id)
    res.json({ broadcasts: rows })
  })
)

/** POST /api/v1/tenant-bot/broadcast — send a marketing message (owner) */
router.post(
  '/broadcast',
  requireRole('owner'),
  validateBody(z.object({ message: z.string().min(1).max(4000) })),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    const result = await sendBroadcast(req.user!.tenant_id!, bot.id, (req.body as { message: string }).message, req.user!.id)
    res.json(result)
  })
)

export default router
