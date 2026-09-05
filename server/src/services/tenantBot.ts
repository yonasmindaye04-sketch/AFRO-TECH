import { pool, query, queryOne } from '../config/db.js'
import { logAudit } from '../utils/audit.js'
import { AppError } from '../utils/helpers.js'

/* ── Generic per-bot Telegram client ─────────────────────── */
async function tgApi<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  let res: Response
  try {
    res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
    })
  } catch (err) {
    throw new AppError(502, 'Could not reach the Telegram API. Check your connection and try again.', 'TG_REACH_ERROR')
  }
  let data: { ok: boolean; result?: T; description?: string } | null = null
  try {
    data = (await res.json()) as { ok: boolean; result?: T; description?: string } | null
  } catch {
    /* non-JSON response */
  }
  if (!res.ok || !data?.ok) {
    throw new AppError(502, data?.description || `Telegram API error (HTTP ${res.status})`, 'TG_API_ERROR')
  }
  return data.result as T
}

export async function validateBotToken(token: string): Promise<{ id: number; username: string }> {
  const me = await tgApi<{ id: number; username: string; is_bot: boolean }>(token, 'getMe')
  if (!me.is_bot) throw new AppError(400, 'That token belongs to a user, not a bot. Create one with @BotFather.', 'NOT_A_BOT')
  return { id: me.id, username: me.username }
}

/* ── Tenant bot CRUD (DB layer) ──────────────────────────── */
export interface TenantBotRow {
  id: string
  tenant_id: string
  bot_token: string
  bot_id: number
  bot_username: string
  display_name: string | null
  description: string | null
  welcome_message: string
  commands: Array<{ trigger: string; response: string }>
  auto_reply: boolean
  is_active: boolean
  broadcast_limit_per_day: number
  total_subscribers: number
  last_broadcast_at: Date | null
  webhook_secret: string
  transport: 'polling' | 'webhook'
}

export async function getTenantBotByTenant(tenantId: string): Promise<TenantBotRow | null> {
  return queryOne<TenantBotRow>(`SELECT * FROM tenant_bots WHERE tenant_id = $1`, [tenantId])
}

export async function getTenantBotByBotId(botId: string): Promise<TenantBotRow | null> {
  return queryOne<TenantBotRow>(`SELECT * FROM tenant_bots WHERE id = $1`, [botId])
}

export interface SubscriberRow {
  id: string
  chat_id: number
  username: string | null
  first_name: string | null
  last_name: string | null
  is_active: boolean
  subscribed_at: Date
  last_seen_at: Date | null
}

export async function listSubscribers(botId: string): Promise<SubscriberRow[]> {
  return query<SubscriberRow>(
    `SELECT id, chat_id, username, first_name, last_name, is_active, subscribed_at, last_seen_at
     FROM bot_subscribers WHERE bot_id = $1 ORDER BY subscribed_at DESC`,
    [botId]
  )
}

export async function listBroadcasts(botId: string): Promise<Array<{
  id: string; message: string; recipients: number; delivered: number; failed: number; status: string; error: string | null; sent_at: Date | null; created_at: Date
}>> {
  return query(
    `SELECT id, message, recipients, delivered, failed, status, error, sent_at, created_at
     FROM bot_broadcasts WHERE bot_id = $1 ORDER BY created_at DESC LIMIT 100`,
    [botId]
  )
}

/* ── Subscriber helpers ──────────────────────────────────── */
export async function upsertSubscriber(botId: string, tenantId: string, chatId: number, firstName: string, username?: string): Promise<void> {
  await query(
    `INSERT INTO bot_subscribers (bot_id, tenant_id, chat_id, first_name, username, is_active, last_seen_at)
     VALUES ($1, $2, $3, $4, $5, true, now())
     ON CONFLICT (bot_id, chat_id) DO UPDATE SET is_active = true, first_name = EXCLUDED.first_name, username = EXCLUDED.username, last_seen_at = now()`,
    [botId, tenantId, chatId, firstName, username ?? null]
  )
}

export async function deactivateSubscriber(botId: string, chatId: number): Promise<void> {
  await query(`UPDATE bot_subscribers SET is_active = false, last_seen_at = now() WHERE bot_id = $1 AND chat_id = $2`, [botId, chatId])
}

/* ── Broadcast ───────────────────────────────────────────── */
export interface BroadcastResult { delivered: number; failed: number }

export async function sendBroadcast(tenantId: string, botId: string, message: string, sentBy: string): Promise<BroadcastResult> {
  const bot = await queryOne<{ bot_token: string; last_broadcast_at: Date | null; broadcast_limit_per_day: number }>(
    `SELECT bot_token, last_broadcast_at, broadcast_limit_per_day FROM tenant_bots WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
    [botId, tenantId]
  )
  if (!bot) throw new AppError(404, 'Bot not found or not active', 'INACTIVE')

  // Daily rate limit
  const sinceMidnight = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM bot_broadcasts WHERE bot_id = $1 AND status = 'sent' AND created_at >= date_trunc('day', now())`,
    [botId]
  )
  if (Number(sinceMidnight?.n ?? 0) >= bot.broadcast_limit_per_day) {
    throw new AppError(429, `Daily broadcast limit reached (${bot.broadcast_limit_per_day} per day). Try again tomorrow.`, 'RATE_LIMITED')
  }

  const subs = await query<{ chat_id: number }>(`SELECT chat_id FROM bot_subscribers WHERE bot_id = $1 AND is_active = true`, [botId])
  if (!subs.length) throw new AppError(400, 'No subscribers to broadcast to yet. Share t.me/@bot_username to grow your audience.', 'NO_SUBSCRIBERS')

  // Register pending broadcast
  const insert = await queryOne<{ id: string }>(
    `INSERT INTO bot_broadcasts (bot_id, tenant_id, sent_by, message, recipients, status) VALUES ($1,$2,$3,$4,$5,'sending') RETURNING id`,
    [botId, tenantId, sentBy, message, subs.length]
  )
  const broadcastId = insert!.id

  let delivered = 0, failed = 0
  const fails: string[] = []
  for (const { chat_id } of subs) {
    try {
      await tgApi(bot.bot_token, 'sendMessage', { chat_id, text: message, disable_web_page_preview: true })
      delivered++
    } catch (err) {
      failed++
      fails.push(err instanceof Error ? err.message : String(err))
    }
    await new Promise((r) => setTimeout(r, 50))
  }

  await pool.query(
    `UPDATE bot_broadcasts SET delivered=$1, failed=$2, status=$3, error=$4, sent_at=now() WHERE id=$5`,
    [delivered, failed, failed === subs.length ? 'failed' : 'sent', fails.slice(0, 3).join(' | ') || null, broadcastId]
  )
  await pool.query(`UPDATE tenant_bots SET last_broadcast_at = now(), updated_at = now() WHERE id = $1`, [botId])
  return { delivered, failed }
}

/* ── Runtime: webhook (prod, free-tier friendly) OR polling (dev) ── */

/** Public origin of this API (no trailing slash). Set RENDER_EXTERNAL_URL on Render. */
function publicApiUrl(): string {
  return (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
}

/** Use webhooks when a public URL is available (production). Falls back to polling locally. */
export function useWebhooks(): boolean {
  return publicApiUrl().startsWith('http') && !publicApiUrl().includes('localhost')
}

/** Webhook path for a specific tenant bot (mounted under /api/v1/tenant-bot). */
export function tenantBotWebhookPath(bot: Pick<TenantBotRow, 'id' | 'webhook_secret'>): string {
  return `/api/v1/tenant-bot/webhook/${bot.id}/${bot.webhook_secret}`
}
export function tenantBotWebhookUrl(bot: Pick<TenantBotRow, 'id' | 'webhook_secret'>): string {
  return `${publicApiUrl()}${tenantBotWebhookPath(bot)}`
}

/** Register the bot's webhook with Telegram + set its menu button to the Mini App. */
export async function registerBotWebhook(bot: TenantBotRow): Promise<void> {
  const url = tenantBotWebhookUrl(bot)
  await tgApi(bot.bot_token, 'setWebhook', {
    url,
    secret_token: bot.webhook_secret,
    allowed_updates: ['message'],
    drop_pending_updates: true,
  })
  // Menu button opens the tenant's workspace inside Telegram
  const appUrl = (process.env.TELEGRAM_WEBAPP_URL || `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/app`)
  await tgApi(bot.bot_token, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: bot.display_name || 'Open Workspace', web_app: { url: appUrl } },
  }).catch(() => undefined) // not fatal — web_apps need HTTPS endpoints
  await pool.query(`UPDATE tenant_bots SET transport = 'webhook', updated_at = now() WHERE id = $1`, [bot.id])
}

/** Remove the webhook (used when switching back to polling or on delete). */
export async function clearBotWebhook(bot: TenantBotRow): Promise<void> {
  await tgApi(bot.bot_token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => undefined)
  await pool.query(`UPDATE tenant_bots SET transport = 'polling', updated_at = now() WHERE id = $1`, [bot.id])
}

/** Handle one Telegram update for a tenant bot (called from webhook route or polling loop). */
export async function handleTenantBotUpdate(botRow: TenantBotRow, update: { update_id: number; message?: { chat: { id: number }; text?: string; from?: { id: number; first_name?: string; username?: string } } }): Promise<void> {
  return handleUpdate(botRow, update)
}
interface Runtime {
  tenantBotId: string
  token: string
  interval: ReturnType<typeof setInterval>
  offset: number
}
const running = new Map<string, Runtime>() // tenant_bots.id -> runtime

export function botIsRunning(botId: string): boolean { return running.has(botId) }

async function handleUpdate(botRow: TenantBotRow, update: { update_id: number; message?: { chat: { id: number }; text?: string; from?: { id: number; first_name?: string; username?: string } } }): Promise<void> {
  const msg = update.message
  if (!msg?.text || !msg.from || !msg.chat) return
  const chatId = msg.chat.id
  const text = msg.text.trim().toLowerCase()
  const firstName = msg.from.first_name || 'there'
  const username = msg.from.username || undefined

  // Upsert the subscriber on every contact (handles re-subscribe too)
  await upsertSubscriber(botRow.id, botRow.tenant_id, chatId, firstName, username)

  const custom = (botRow.commands ?? []).find((c) => text === c.trigger.trim().toLowerCase())
  if (custom) {
    await tgApi(botRow.bot_token, 'sendMessage', { chat_id: chatId, text: custom.response, disable_web_page_preview: true })
    return
  }

  if (text === '/stop' || text === '/unsubscribe') {
    await deactivateSubscriber(botRow.id, chatId)
    await tgApi(botRow.bot_token, 'sendMessage', { chat_id: chatId, text: 'You have been unsubscribed. Send /start any time to re-join.' })
    await query(`UPDATE tenant_bots SET total_subscribers = (SELECT count(*) FROM bot_subscribers WHERE bot_id = $1 AND is_active = true) WHERE id = $1`, [botRow.id])
    return
  }

  // Default: send the welcome message
  await tgApi(botRow.bot_token, 'sendMessage', {
    chat_id: chatId,
    text: botRow.welcome_message.replace(/\\n/g, '\n').replace('{name}', firstName),
    disable_web_page_preview: true,
  })
  await query(`UPDATE tenant_bots SET total_subscribers = (SELECT count(*) FROM bot_subscribers WHERE bot_id = $1 AND is_active = true) WHERE id = $1`, [botRow.id])
}

async function pollLoop(botId: string): Promise<void> {
  if (running.has(botId)) return
  const row = await getTenantBotByBotId(botId)
  if (!row || !row.is_active) return
  const offsetRow = await queryOne<{ last_update_id: number }>(`SELECT last_update_id FROM bot_polling_state WHERE bot_id = $1`, [botId])
  const runtime: Runtime = { tenantBotId: botId, token: row.bot_token, offset: offsetRow?.last_update_id ?? 0, interval: 0 as unknown as ReturnType<typeof setInterval> }
  running.set(botId, runtime)
  logAudit({ userId: 'system', userName: 'system', action: 'bot.start', entity: 'tenant_bot', entityId: botId })
  let failures = 0
  const tick = async (): Promise<void> => {
    if (!running.has(botId)) return
    try {
      const updates = await tgApi<Array<{ update_id: number }>>(row.bot_token, 'getUpdates', { offset: runtime.offset, timeout: 25 })
      failures = 0
      for (const upd of updates) {
        runtime.offset = (upd.update_id ?? runtime.offset) + 1
        try { await handleUpdate(row, upd as { update_id: number; message?: { chat: { id: number }; text?: string; from?: { id: number; first_name?: string; username?: string } } }) } catch (err) { console.warn(`[bot:${botId}] handler error:`, err instanceof Error ? err.message : err) }
        await pool.query(`INSERT INTO bot_polling_state (bot_id, last_update_id) VALUES ($1, $2) ON CONFLICT (bot_id) DO UPDATE SET last_update_id = $2, updated_at = now()`, [botId, runtime.offset])
      }
    } catch (err) {
      failures++
      console.warn(`[bot:${botId}] poll error #${failures}:`, err instanceof Error ? err.message : err)
      if (failures >= 10) {
        console.warn(`[bot:${botId}] too many failures — stopping. Check token validity.`)
        await stopTenantBot(botId)
        await query(`UPDATE tenant_bots SET is_active = false WHERE id = $1`, [botId])
        return
      }
      await new Promise((r) => setTimeout(r, failures * 3000))
    }
  }
  runtime.interval = setInterval(tick, 500)
  void tick()
}

export async function startTenantBot(botId: string): Promise<void> {
  await pool.query(`INSERT INTO bot_polling_state (bot_id) VALUES ($1) ON CONFLICT (bot_id) DO NOTHING`, [botId])
  void pollLoop(botId)
}

export async function stopTenantBot(botId: string): Promise<void> {
  const rt = running.get(botId)
  if (rt) { clearInterval(rt.interval); running.delete(botId) }
}

export async function startAllTenantBots(): Promise<void> {
  const rows = await query<{ id: string; transport: 'polling' | 'webhook' }>(`SELECT id, transport FROM tenant_bots WHERE is_active = true`)
  for (const row of rows) {
    if (useWebhooks()) {
      // Ensure webhook mode (idempotent — same-bot re-registration is a no-op)
      if (row.transport !== 'webhook') {
        const full = await getTenantBotByBotId(row.id)
        if (full) await registerBotWebhook(full).catch((err) => console.warn(`[bot:${row.id}] webhook reg failed:`, err instanceof Error ? err.message : err))
      }
    } else {
      void startTenantBot(row.id)
    }
  }
}
