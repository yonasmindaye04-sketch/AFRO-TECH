import { Router } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../config/db.js'
import { asyncHandler, AppError } from '../utils/helpers.js'
import { authenticate, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import {
  validateBotToken,
  getTenantBotByTenant,
  listSubscribers,
  listBroadcasts,
  sendBroadcast,
  startTenantBot,
  stopTenantBot,
} from '../services/tenantBot.js'

const router = Router()
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
    const row = await queryOne<{ id: string; bot_username: string; is_active: boolean }>(
      existing
        ? `UPDATE tenant_bots SET bot_token=$2, bot_id=$3, bot_username=$4, is_active=true, updated_at=now()
           WHERE tenant_id=$1 RETURNING id, bot_username, is_active`
        : `INSERT INTO tenant_bots (tenant_id, bot_token, bot_id, bot_username) VALUES ($1, $2, $3, $4)
           RETURNING id, bot_username, is_active`,
      [tid, token, me.id, me.username]
    )
    if (!row) throw new AppError(500, 'Could not save the bot', 'INTERNAL')
    await startTenantBot(row.id)
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

/** POST /api/v1/tenant-bot/pause — pause polling (owner) */
router.post(
  '/pause',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    await stopTenantBot(bot.id)
    await query(`UPDATE tenant_bots SET is_active = false, updated_at = now() WHERE id = $1`, [bot.id])
    res.json({ ok: true })
  })
)

/** POST /api/v1/tenant-bot/resume — resume polling (owner) */
router.post(
  '/resume',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const bot = await getTenantBotByTenant(req.user!.tenant_id!)
    if (!bot) throw new AppError(404, 'Register a bot first', 'NO_BOT')
    if (!bot.bot_token) throw new AppError(400, 'Bot has no token; re-register', 'NO_TOKEN')
    await startTenantBot(bot.id)
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
