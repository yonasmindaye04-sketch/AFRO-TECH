import { pool, query, queryOne } from '../config/db.js'
import { logAudit } from '../utils/audit.js'
import { AppError } from '../utils/helpers.js'
import { escapeHtml } from './telegram.js'
import { bt, isBotLang, type BotLang } from './botI18n.js'

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
  language: string
  subscribed_at: Date
  last_seen_at: Date | null
}

export async function listSubscribers(botId: string): Promise<SubscriberRow[]> {
  return query<SubscriberRow>(
    `SELECT id, chat_id, username, first_name, last_name, is_active, language, subscribed_at, last_seen_at
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
      // Blocked/deactivated chats burn the daily budget — deactivate them (ported from yekis)
      if (isBlockedError(err)) await deactivateSubscriber(botId, chat_id).catch(() => undefined)
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

/** The Mini App URL with company context (used by the menu button + in-line buttons). */
export function tenantBotAppUrl(bot: Pick<TenantBotRow, 'id' | 'tenant_id'>): string {
  const baseAppUrl = (process.env.TELEGRAM_WEBAPP_URL || `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/app`)
  return `${baseAppUrl}${baseAppUrl.includes('?') ? '&' : '?'}tenant_id=${bot.tenant_id}&bot_id=${bot.id}`
}

/** Publish the bot's command list so Telegram shows the "/" autocomplete (ported from yekis bot startBot). */
async function registerBotCommands(bot: TenantBotRow, lang: BotLang): Promise<void> {
  const commands: Array<{ command: string; description: string }> = [
    { command: 'start', description: lang === 'am' ? 'ጀምር' : 'Get started' },
    { command: 'menu', description: lang === 'am' ? 'ዋና ሜኑ' : 'Main menu' },
    { command: 'help', description: lang === 'am' ? 'እርዳታ' : 'Help' },
    { command: 'language', description: lang === 'am' ? 'ቋንቋ ቀይር' : 'Change language' },
    { command: 'receipt', description: lang === 'am' ? 'የክፍያ ደረሰኝ ላክ' : 'Submit payment receipt' },
    { command: 'today', description: 'Daily summary (staff)' },
    { command: 'lowstock', description: 'Low stock (staff)' },
    { command: 'expiring', description: 'Expiring items (staff)' },
    { command: 'shift', description: 'My shift (staff)' },
    { command: 'parent', description: lang === 'am' ? 'ልጅዎን ያገናኙ' : 'Link your child (parents)' },
    { command: 'child', description: lang === 'am' ? 'ልጆቼ' : 'Linked students (parents)' },
    { command: 'myfees', description: lang === 'am' ? 'የክፍያ ሁኔታ' : 'Fee status (parents)' },
  ]
  await tgApi(bot.bot_token, 'setMyCommands', { commands }).catch(() => undefined)
  const desc = (bot.description || `${bot.display_name ?? 'Assistant'} — announcements, receipts & info`).slice(0, 255)
  await tgApi(bot.bot_token, 'setMyDescription', { description: desc }).catch(() => undefined)
}

/** Register the bot's webhook with Telegram + set its menu button to the Mini App. */
export async function registerBotWebhook(bot: TenantBotRow): Promise<void> {
  const url = tenantBotWebhookUrl(bot)
  await tgApi(bot.bot_token, 'setWebhook', {
    url,
    secret_token: bot.webhook_secret,
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  })
  // Menu button opens the tenant's workspace inside Telegram with company context
  const appUrl = tenantBotAppUrl(bot)
  const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [bot.tenant_id])
  const buttonText = bot.display_name || (tenant?.name ? `Open ${tenant.name}` : 'Open Workspace')

  await tgApi(bot.bot_token, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: buttonText, web_app: { url: appUrl } },
  }).catch(() => undefined) // not fatal — web_apps need HTTPS endpoints
  await registerBotCommands(bot, 'en')
  await pool.query(`UPDATE tenant_bots SET transport = 'webhook', updated_at = now() WHERE id = $1`, [bot.id])
}

/** Remove the webhook (used when switching back to polling or on delete). */
export async function clearBotWebhook(bot: TenantBotRow): Promise<void> {
  await tgApi(bot.bot_token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => undefined)
  await pool.query(`UPDATE tenant_bots SET transport = 'polling', updated_at = now() WHERE id = $1`, [bot.id])
}

/* ── Inbound update shape (message or callback_query / photos) ── */

export interface TgFrom { id: number; first_name?: string; username?: string; language_code?: string }
export interface TgPhotoSize { file_id: string; width: number; height: number; file_size?: number }
export interface TgIncomingMessage {
  chat: { id: number }
  text?: string
  caption?: string
  photo?: TgPhotoSize[]
  from?: TgFrom
}
export interface TgCallbackQuery {
  id: string
  data?: string
  from: TgFrom
  message?: { message_id: number; chat: { id: number } }
}
export interface TenantBotUpdate {
  update_id: number
  message?: TgIncomingMessage
  callback_query?: TgCallbackQuery
}

/* ── Lightweight per-chat rate limiting (ported from yekis rateLimit middleware,
      adapted to a plain in-memory window — bounded because it's keyed by chat) ── */
const RATE_LIMIT_MESSAGE = 20 // messages per window per chat
const RATE_LIMIT_CALLBACK = 40
const RATE_WINDOW_MS = 60_000
const rateBuckets = new Map<string, { count: number; resetAt: number }>()
function rateLimitHit(chatId: number, kind: 'message' | 'callback'): boolean {
  const key = `${kind}:${chatId}`
  const now = Date.now()
  let b = rateBuckets.get(key)
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + RATE_WINDOW_MS }
    rateBuckets.set(key, b)
    // Occasional sweep so the map can't grow unbounded
    if (rateBuckets.size > 5000) {
      for (const [k, v] of rateBuckets) if (v.resetAt < now) rateBuckets.delete(k)
    }
  }
  const limit = kind === 'message' ? RATE_LIMIT_MESSAGE : RATE_LIMIT_CALLBACK
  b.count += 1
  return b.count > limit
}

/** 403 "bot was blocked" / "user is deactivated" — subscriber must be deactivated (ported from yekis). */
function isBlockedError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /Forbidden|bot was blocked|user is deactivated|chat not found/i.test(msg)
}

/** Handle one Telegram update for a tenant bot (called from webhook route or polling loop). */
export async function handleTenantBotUpdate(botRow: TenantBotRow, update: TenantBotUpdate): Promise<void> {
  if (update.callback_query) {
    await handleCallbackQuery(botRow, update.callback_query).catch((err) =>
      console.warn(`[bot:${botRow.id}] callback handler error:`, err instanceof Error ? err.message : err)
    )
    return
  }
  if (update.message) {
    return handleUpdate(botRow, update)
  }
}
interface Runtime {
  tenantBotId: string
  token: string
  stopped: boolean
  offset: number
}
const running = new Map<string, Runtime>() // tenant_bots.id -> runtime

export function botIsRunning(botId: string): boolean { return running.has(botId) }

/** Resolve the subscriber's stored language preference (defaults from Telegram locale). */
async function subscriberLang(botId: string, chatId: number, fromLangCode?: string): Promise<BotLang> {
  const row = await queryOne<{ language: string | null }>(
    `SELECT language FROM bot_subscribers WHERE bot_id = $1 AND chat_id = $2`,
    [botId, chatId]
  )
  if (row && isBotLang(row.language)) return row.language
  return fromLangCode === 'am' ? 'am' : 'en'
}

async function setSubscriberLang(botId: string, chatId: number, lang: BotLang): Promise<void> {
  await query(`UPDATE bot_subscribers SET language = $3 WHERE bot_id = $1 AND chat_id = $2`, [botId, chatId, lang])
}

/** Build the bottom-keyboard (main menu) for a chat — staff vs parents vs customers (ported from yekis mainMenu keyboard). */
function mainMenuKeyboard(bot: TenantBotRow, opts: { linked: boolean; hasStudents: boolean; lang: BotLang }): { inline_keyboard: Array<Array<Record<string, unknown>>> } {
  const rows: Array<Array<Record<string, unknown>>> = []
  if (opts.linked) {
    rows.push([{ text: bt(opts.lang, 'btn_today'), callback_data: 'menu:today' }])
    rows.push([
      { text: bt(opts.lang, 'btn_lowstock'), callback_data: 'menu:lowstock' },
      { text: bt(opts.lang, 'btn_shift'), callback_data: 'menu:shift' },
    ])
    rows.push([{ text: bt(opts.lang, 'btn_receipt'), callback_data: 'menu:receipt' }])
  } else if (opts.hasStudents) {
    rows.push([
      { text: bt(opts.lang, 'btn_child'), callback_data: 'menu:child' },
      { text: bt(opts.lang, 'btn_fees'), callback_data: 'menu:myfees' },
    ])
    rows.push([{ text: bt(opts.lang, 'btn_receipt'), callback_data: 'menu:receipt' }])
  } else {
    rows.push([{ text: bt(opts.lang, 'btn_receipt'), callback_data: 'menu:receipt' }])
  }
  const bottomRow: Array<Record<string, unknown>> = [{ text: bt(opts.lang, 'btn_language'), callback_data: 'menu:language' }]
  // web_app buttons require an HTTPS URL — in local dev (http://localhost) Telegram
  // rejects the whole message with BUTTON_TYPE_INVALID, so skip the app button there.
  const appUrl = tenantBotAppUrl(bot)
  if (appUrl.startsWith('https://')) {
    bottomRow.push({ text: bt(opts.lang, 'btn_open_app'), web_app: { url: appUrl } })
  }
  rows.push(bottomRow)
  return { inline_keyboard: rows }
}

/* ── Callback-query handling (inline keyboard taps) — ported from yekis callbacks.ts ── */
async function handleCallbackQuery(botRow: TenantBotRow, cq: TgCallbackQuery): Promise<void> {
  const chatId = cq.message?.chat.id ?? cq.from.id
  if (rateLimitHit(chatId, 'callback')) {
    await tgApi(botRow.bot_token, 'answerCallbackQuery', { callback_query_id: cq.id })
    return
  }
  const data = cq.data ?? ''

  const answer = (text?: string): Promise<unknown> => tgApi(botRow.bot_token, 'answerCallbackQuery', { callback_query_id: cq.id, text })

  if (data === 'menu:language') {
    await answer()
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: bt(await subscriberLang(botRow.id, chatId, cq.from?.language_code), 'lang_prompt'),
      reply_markup: {
        inline_keyboard: [
          [{ text: 'English', callback_data: 'lang:en' }],
          [{ text: 'አማርኛ (Amharic)', callback_data: 'lang:am' }],
        ],
      },
    })
    return
  }

  if (data === 'lang:en' || data === 'lang:am') {
    const lang: BotLang = data === 'lang:am' ? 'am' : 'en'
    await upsertSubscriber(botRow.id, botRow.tenant_id, chatId, cq.from?.first_name ?? 'there', cq.from?.username)
    await setSubscriberLang(botRow.id, chatId, lang)
    await answer(bt(lang, lang === 'am' ? 'lang_saved_am' : 'lang_saved_en'))
    await tgApi(botRow.bot_token, 'sendMessage', { chat_id: chatId, text: bt(lang, lang === 'am' ? 'lang_saved_am' : 'lang_saved_en') })
    return
  }

  if (data === 'menu:receipt') {
    await answer()
    await upsertSubscriber(botRow.id, botRow.tenant_id, chatId, cq.from?.first_name ?? 'there', cq.from?.username)
    await query(`UPDATE bot_subscribers SET pending_action = 'awaiting_receipt' WHERE bot_id = $1 AND chat_id = $2`, [botRow.id, chatId])
    const lang = await subscriberLang(botRow.id, chatId, cq.from?.language_code)
    await tgApi(botRow.bot_token, 'sendMessage', { chat_id: chatId, text: bt(lang, 'receipt_ask'), parse_mode: 'HTML' })
    return
  }

  // Command buttons — re-dispatch through the regular text pipeline
  if (data.startsWith('menu:')) {
    await answer()
    const cmd = data.slice(5)
    const from = cq.from
    await handleUpdate(botRow, {
      update_id: 0,
      message: { chat: { id: chatId }, text: `/${cmd}`, from },
    })
    return
  }

  await answer()
}

/**
 * Handle a photo photo-receipt submission (ported from the yekis topup/kyc scenes,
 * adapted to a single-step flow keyed on bot_subscribers.pending_action).
 */
async function handleReceiptPhoto(botRow: TenantBotRow, msg: TgIncomingMessage, pending: string | null): Promise<void> {
  // Photos arrive all the time; we only act when the receipt scene is armed.
  if (pending !== 'awaiting_receipt' || !msg.photo?.length) return
  const chatId = msg.chat.id
  const lang = await subscriberLang(botRow.id, chatId, msg.from?.language_code)
  const largest = msg.photo[msg.photo.length - 1]!
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO bot_receipt_submissions (bot_id, tenant_id, chat_id, sender_name, file_id, caption)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [botRow.id, botRow.tenant_id, chatId, msg.from?.first_name ?? null, largest.file_id, msg.caption ?? null]
  )
  await query(`UPDATE bot_subscribers SET pending_action = NULL WHERE bot_id = $1 AND chat_id = $2`, [botRow.id, chatId])
  logAudit({ tenantId: botRow.tenant_id, userName: 'telegram-bot', action: 'bot.receipt.submitted', entity: 'bot_receipt', entityId: inserted?.id ?? null, details: { chat_id: chatId } })
  await tgApi(botRow.bot_token, 'sendMessage', { chat_id: chatId, text: bt(lang, 'receipt_received'), parse_mode: 'HTML' })
}

async function handleUpdate(botRow: TenantBotRow, update: TenantBotUpdate): Promise<void> {
  const msg = update.message
  if (!msg?.from || !msg.chat) return
  const chatId = msg.chat.id

  if (rateLimitHit(chatId, 'message')) return // drop — silent throttle

  const firstName = msg.from.first_name || 'there'
  const username = msg.from.username || undefined

  // Upsert the subscriber on every contact (handles re-subscribe too)
  await upsertSubscriber(botRow.id, botRow.tenant_id, chatId, firstName, username)
  const sub = await queryOne<{ language: string | null; pending_action: string | null }>(
    `SELECT language, pending_action FROM bot_subscribers WHERE bot_id = $1 AND chat_id = $2`,
    [botRow.id, chatId]
  )
  const lang: BotLang = isBotLang(sub?.language) ? sub.language : msg.from.language_code === 'am' ? 'am' : 'en'

  // Photo? → receipt intake if in the receipt scene
  if (msg.photo?.length) {
    await handleReceiptPhoto(botRow, msg, sub?.pending_action ?? null)
    return
  }
  const fullText = msg.text?.trim()
  if (!fullText) return
  const [rawCmd, ...args] = fullText.split(/\s+/)
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, '')

  // Fetch company info
  const tenant = await queryOne<{ name: string; business_type: string }>(
    `SELECT name, business_type FROM tenants WHERE id = $1`,
    [botRow.tenant_id]
  )
  const tenantName = escapeHtml(tenant?.name ?? 'Workspace')
  const businessType = tenant?.business_type ?? 'store'

  // Check if sender is a linked staff member / owner of THIS specific company
  const linkedUser = await queryOne<{
    id: string
    full_name: string
    role: string
    tenant_id: string
  }>(
    `SELECT id, full_name, role, tenant_id FROM users
     WHERE telegram_chat_id = $1 AND tenant_id = $2 AND is_active = true
     LIMIT 1`,
    [chatId, botRow.tenant_id]
  )

  /* ── 1. Account linking (/link CODE) ── */
  if (cmd === '/link') {
    const code = (args[0] || '').toUpperCase()
    if (!code) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: escapeHtml(bt(lang, 'link_prompt')).replace('/link CODE', '<code>/link CODE</code>'),
        parse_mode: 'HTML',
      })
      return
    }

    const row = await queryOne<{ user_id: string; expires_at: Date }>(
      `SELECT user_id, expires_at FROM telegram_link_codes WHERE code = $1`,
      [code]
    )
    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: bt(lang, 'link_invalid'),
      })
      return
    }

    const user = await queryOne<{ id: string; full_name: string; role: string; tenant_id: string }>(
      `SELECT id, full_name, role, tenant_id FROM users WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
      [row.user_id, botRow.tenant_id]
    )
    if (!user) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `${bt(lang, 'link_wrong_workspace')} <b>${tenantName}</b>.`,
        parse_mode: 'HTML',
      })
      return
    }

    await query(`UPDATE users SET telegram_chat_id = $1, telegram_linked_at = now() WHERE id = $2`, [chatId, user.id])
    await query(`DELETE FROM telegram_link_codes WHERE code = $1`, [code])
    logAudit({
      userId: user.id,
      userName: user.full_name,
      action: 'telegram.link',
      entity: 'tenant_bot',
      entityId: botRow.id,
      details: { telegram: msg.from.id, company: tenantName },
    })

    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `✅ <b>Linked!</b>\n\n${bt(lang, 'linked_welcome')} <b>${escapeHtml(user.full_name)}</b> (${user.role}) — <b>${tenantName}</b>.\n\n${bt(lang, 'try_commands')}`,
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(botRow, { linked: true, hasStudents: false, lang }),
    })
    return
  }

  /* ── 2. Account unlinking (/unlink) ── */
  if (cmd === '/unlink') {
    if (linkedUser) {
      await query(`UPDATE users SET telegram_chat_id = NULL, telegram_linked_at = NULL WHERE id = $1`, [linkedUser.id])
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `${bt(lang, 'unlinked_done')} <b>${tenantName}</b>.`,
        parse_mode: 'HTML',
      })
      return
    }
  }

  /* ── 2b. Parent & Guardian Linking (/parent CODE) ── */
  if (cmd === '/parent') {
    const rawCode = (args[0] || '').trim().toUpperCase()
    if (!rawCode) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: escapeHtml(bt(lang, 'parent_prompt')).replace('/parent STU-00001', '<code>/parent STU-00001</code>'),
        parse_mode: 'HTML',
      })
      return
    }

    const student = await queryOne<{
      id: string
      code: string
      first_name: string
      last_name: string
      class_name: string | null
    }>(
      `SELECT s.id, s.code, s.first_name, s.last_name, c.name AS class_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE UPPER(s.code) = $1 AND s.tenant_id = $2 AND s.status = 'active' LIMIT 1`,
      [rawCode, botRow.tenant_id]
    )

    if (!student) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `❌ ${bt(lang, 'parent_not_found')} (<b>${escapeHtml(rawCode)}</b> — ${tenantName})`,
        parse_mode: 'HTML',
      })
      return
    }

    await query(
      `UPDATE students
       SET guardian_telegram_chat_id = $1, guardian_telegram_username = $2
       WHERE id = $3`,
      [String(chatId), firstName || null, student.id]
    )

    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `✅ <b>${bt(lang, 'parent_linked')}</b>\n\n` +
        `👤 <b>Student:</b> ${escapeHtml(student.first_name)} ${escapeHtml(student.last_name)}\n` +
        `🆔 <b>Code:</b> <code>${escapeHtml(student.code)}</code>\n` +
        `🏫 <b>School:</b> ${tenantName}\n\n` +
        `${bt(lang, 'try_commands')}`,
      parse_mode: 'HTML',
      reply_markup: mainMenuKeyboard(botRow, { linked: false, hasStudents: true, lang }),
    })
    return
  }

  /* ── 2c. Guardian Inquiries (/child, /student, /myfees) ── */
  if (cmd === '/child' || cmd === '/student') {
    const students = await query<{
      id: string
      code: string
      first_name: string
      last_name: string
      class_name: string | null
    }>(
      `SELECT s.id, s.code, s.first_name, s.last_name, c.name AS class_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.guardian_telegram_chat_id = $1::text AND s.tenant_id = $2 AND s.status = 'active'`,
      [String(chatId), botRow.tenant_id]
    )

    if (!students.length) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: bt(lang, 'no_students_linked'),
        parse_mode: 'HTML',
      })
      return
    }

    const list = students
      .map((s) => `• <b>${escapeHtml(`${s.first_name} ${s.last_name}`)}</b> (Code: <code>${escapeHtml(s.code)}</code>)\n  ${bt(lang, 'class')}: ${escapeHtml(s.class_name || 'N/A')}`)
      .join('\n\n')

    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `👨‍👩‍👧 <b>${tenantName}</b>:\n\n${list}`,
      parse_mode: 'HTML',
    })
    return
  }

  if (cmd === '/myfees') {
    const fees = await query<{
      title: string
      amount: string
      paid_amount: string
      status: string
      due_date: string | null
      student_name: string
    }>(
      `SELECT f.title, f.amount::text, f.paid_amount::text, f.status, f.due_date,
              s.first_name || ' ' || s.last_name AS student_name
       FROM fees f
       JOIN students s ON s.id = f.student_id
       WHERE s.guardian_telegram_chat_id = $1::text AND f.tenant_id = $2
       ORDER BY f.created_at DESC LIMIT 6`,
      [String(chatId), botRow.tenant_id]
    )

    if (!fees.length) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: bt(lang, 'no_fees'),
        parse_mode: 'HTML',
      })
      return
    }

    const textList = fees
      .map((f) => {
        const remaining = Math.max(0, Number(f.amount) - Number(f.paid_amount))
        const statusEmoji = f.status === 'paid' ? `✅ ${bt(lang, 'paid')}` : remaining > 0 ? `⚠️ ${bt(lang, 'due')}: ${remaining.toFixed(2)} ETB` : bt(lang, 'status')
        return `• <b>${escapeHtml(f.title)}</b> (${escapeHtml(f.student_name)})\n  ${bt(lang, 'total')}: ${Number(f.amount).toFixed(2)} ETB | ${bt(lang, 'paid')}: ${Number(f.paid_amount).toFixed(2)} ETB\n  ${bt(lang, 'status')}: ${statusEmoji}${f.due_date ? ` (${bt(lang, 'due')}: ${f.due_date.toString().slice(0, 10)})` : ''}`
      })
      .join('\n\n')

    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `📋 <b>${bt(lang, 'btn_fees')}:</b>\n\n${textList}`,
      parse_mode: 'HTML',
    })
    return
  }

  /* ── 3. Start & Help (/start, /help, /menu) ── */
  if (cmd === '/start' || cmd === '/help' || cmd === '/menu') {
    // If the user sent a deeplink like /start D09806 (Telegram start parameter)
    if (args[0] && args[0].length >= 6 && args[0].toLowerCase() !== 'subscribe') {
      const linkCodeArg = args[0].trim().toUpperCase()
      const row = await queryOne<{ user_id: string; expires_at: Date }>(
        `SELECT user_id, expires_at FROM telegram_link_codes WHERE code = $1`,
        [linkCodeArg]
      )
      if (row && new Date(row.expires_at).getTime() >= Date.now()) {
        const user = await queryOne<{ id: string; full_name: string; role: string; tenant_id: string }>(
          `SELECT id, full_name, role, tenant_id FROM users WHERE id = $1 AND tenant_id = $2 AND is_active = true`,
          [row.user_id, botRow.tenant_id]
        )
        if (user) {
          await query(`UPDATE users SET telegram_chat_id = $1, telegram_linked_at = now() WHERE id = $2`, [chatId, user.id])
          await query(`DELETE FROM telegram_link_codes WHERE code = $1`, [linkCodeArg])
          await tgApi(botRow.bot_token, 'sendMessage', {
            chat_id: chatId,
            text: `✅ <b>Linked!</b>\n\nWelcome, <b>${escapeHtml(user.full_name)}</b> (${user.role}) to <b>${tenantName}</b>.\n\nTry /today, /lowstock, or tap the menu button below to open your workspace.`,
            parse_mode: 'HTML',
          })
          return
        }
      }
    }

    // Do they have linked students? (parent menu)
    const hasStudents = Boolean(
      await queryOne(`SELECT 1 FROM students WHERE guardian_telegram_chat_id = $1::text AND tenant_id = $2 AND status = 'active' LIMIT 1`, [String(chatId), botRow.tenant_id])
    )
    const menuKeyboard = mainMenuKeyboard(botRow, { linked: Boolean(linkedUser), hasStudents, lang })

    if (linkedUser) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `<b>${escapeHtml(linkedUser.full_name)}</b> — <b>${tenantName}</b> Assistant\n\n` +
          `Staff Commands:\n` +
          `/today — daily summary\n` +
          `/lowstock — items to reorder\n` +
          `/expiring — batches expiring in 60 days\n` +
          `/shift — active cash drawer shift\n` +
          `/receipt — submit a payment receipt photo\n` +
          `/unlink — disconnect account\n\n` +
          `Or tap the menu button to open <b>${tenantName}</b> Mini App.`,
        parse_mode: 'HTML',
        reply_markup: menuKeyboard,
      })
      return
    }

    // Customer or unlinked visitor: send welcome message + action menu
    const welcome = botRow.welcome_message
      .replace(/\\n/g, '\n')
      .replace('{name}', firstName)
      .replace('{company}', tenantName)

    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `${welcome}\n\n<i>Are you a staff member of ${tenantName}? Open Settings → Telegram to generate a code, then send /link CODE here.</i>`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
      reply_markup: menuKeyboard,
    })
    return
  }

  /* ── 3b. Language switcher (/language) — yekis /language + language picker keyboard ── */
  if (cmd === '/language' || cmd === '/lang') {
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: bt(lang, 'lang_prompt'),
      reply_markup: {
        inline_keyboard: [
          [{ text: 'English', callback_data: 'lang:en' }],
          [{ text: 'አማርኛ (Amharic)', callback_data: 'lang:am' }],
        ],
      },
    })
    return
  }

  /* ── 3c. Payment receipt intake (/receipt) — yekis topup scene, simplified ── */
  if (cmd === '/receipt') {
    await query(`UPDATE bot_subscribers SET pending_action = 'awaiting_receipt' WHERE bot_id = $1 AND chat_id = $2`, [botRow.id, chatId])
    await tgApi(botRow.bot_token, 'sendMessage', { chat_id: chatId, text: bt(lang, 'receipt_ask'), parse_mode: 'HTML' })
    return
  }
  if (cmd === '/cancel') {
    await query(`UPDATE bot_subscribers SET pending_action = NULL WHERE bot_id = $1 AND chat_id = $2`, [botRow.id, chatId])
    await tgApi(botRow.bot_token, 'sendMessage', { chat_id: chatId, text: bt(lang, 'action_cancelled'), parse_mode: 'HTML' })
    return
  }

  /* ── 4. Staff operational commands (/today, /lowstock, /expiring, /shift) ── */
  if (cmd === '/today') {
    if (!linkedUser) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `${bt(lang, 'staff_only_prefix')} <b>${tenantName}</b>. ${bt(lang, 'staff_only_suffix')}`,
        parse_mode: 'HTML',
      })
      return
    }

    if (businessType === 'hospital' || businessType === 'school') {
      const stats =
        businessType === 'hospital'
          ? await queryOne<{ today: string }>(
              `SELECT count(*)::text AS today FROM appointments WHERE tenant_id = $1 AND scheduled_at >= CURRENT_DATE AND scheduled_at < CURRENT_DATE + interval '1 day'`,
              [botRow.tenant_id]
            )
          : await queryOne<{ today: string }>(
              `SELECT count(*)::text AS today FROM attendance WHERE tenant_id = $1 AND att_date = CURRENT_DATE`,
              [botRow.tenant_id]
            )
      const label = businessType === 'hospital' ? bt(lang, 'today_appointments') : bt(lang, 'today_attendance')
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `<b>${tenantName} — ${bt(lang, 'btn_today')}</b>\n\n📅 ${stats?.today ?? 0} ${label}.`,
        parse_mode: 'HTML',
      })
      return
    }

    // Retail / Pharmacy / Store
    const s = await queryOne<{ total: string; count: string }>(
      `SELECT COALESCE(SUM(total),0)::text AS total, count(*)::text AS count FROM sales
       WHERE tenant_id = $1 AND status = 'completed' AND created_at >= CURRENT_DATE`,
      [botRow.tenant_id]
    )
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `<b>${tenantName} — ${bt(lang, 'todays_sales')}</b>\n\n💰 ${bt(lang, 'total')}: <b>${Number(s?.total ?? 0).toFixed(2)} ETB</b>\n🧾 ${bt(lang, 'receipts_count')}: <b>${s?.count ?? 0}</b>`,
      parse_mode: 'HTML',
    })
    return
  }

  if (cmd === '/lowstock') {
    if (!linkedUser) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `${bt(lang, 'staff_only_prefix')} <b>${tenantName}</b>. ${bt(lang, 'staff_only_suffix')}`,
        parse_mode: 'HTML',
      })
      return
    }

    const { rows } = await pool.query<{ name: string; sellable: string; threshold: number }>(
      `SELECT p.name, COALESCE(SUM(b.quantity) FILTER (WHERE b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE), 0)::text AS sellable,
              p.low_stock_threshold AS threshold
       FROM products p LEFT JOIN product_batches b ON b.product_id = p.id
       WHERE p.tenant_id = $1 AND p.is_active = true
       GROUP BY p.id, p.name, p.low_stock_threshold
       HAVING COALESCE(SUM(b.quantity) FILTER (WHERE b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE), 0) <= p.low_stock_threshold
       ORDER BY sellable ASC LIMIT 10`,
      [botRow.tenant_id]
    )
    if (!rows.length) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `✅ <b>${tenantName}:</b>\n\n${bt(lang, 'all_stock_ok')}`,
        parse_mode: 'HTML',
      })
      return
    }
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `⚠️ <b>${bt(lang, 'low_stock_title')} — ${tenantName}:</b>\n\n${rows.map((r) => `• <b>${escapeHtml(r.name)}</b> — ${r.sellable} ${bt(lang, 'items_left')} (${bt(lang, 'min')}: ${r.threshold})`).join('\n')}`,
      parse_mode: 'HTML',
    })
    return
  }

  if (cmd === '/expiring') {
    if (!linkedUser) return
    const { rows } = await pool.query<{ name: string; expiry_date: string; quantity: number }>(
      `SELECT p.name, b.expiry_date, b.quantity FROM product_batches b JOIN products p ON p.id = b.product_id
       WHERE b.tenant_id = $1 AND b.quantity > 0 AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60
       ORDER BY b.expiry_date ASC LIMIT 10`,
      [botRow.tenant_id]
    )
    if (!rows.length) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `✅ <b>${tenantName}:</b> ${bt(lang, 'nothing_expiring')}`,
        parse_mode: 'HTML',
      })
      return
    }
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `⏳ <b>${bt(lang, 'expiring_title')} (${tenantName}):</b>\n\n${rows.map((r) => `• <b>${escapeHtml(r.name)}</b> — ${r.quantity} ${bt(lang, 'units')} (${bt(lang, 'expires')} ${new Date(r.expiry_date).toLocaleDateString('en-GB')})`).join('\n')}`,
      parse_mode: 'HTML',
    })
    return
  }

  if (cmd === '/shift') {
    if (!linkedUser) return
    const shift = await queryOne<{ opening_balance: string; cash_sales: string; expenses: string }>(
      `SELECT opening_balance, cash_sales, expenses FROM cash_drawer_shifts WHERE tenant_id = $1 AND user_id = $2 AND status = 'open'`,
      [botRow.tenant_id, linkedUser.id]
    )
    if (!shift) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `${bt(lang, 'no_open_shift')} — <b>${tenantName}</b>.`,
        parse_mode: 'HTML',
      })
      return
    }
    const expected = Number(shift.opening_balance) + Number(shift.cash_sales) - Number(shift.expenses)
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `💼 <b>${bt(lang, 'open_shift')} — ${tenantName}</b>\n\n${bt(lang, 'cash_sales')}: <b>${Number(shift.cash_sales).toFixed(2)} ETB</b>\n${bt(lang, 'expenses')}: <b>${Number(shift.expenses).toFixed(2)} ETB</b>\n${bt(lang, 'expected_in_drawer')}: <b>${expected.toFixed(2)} ETB</b>`,
      parse_mode: 'HTML',
    })
    return
  }

  /* ── 5. Custom tenant commands (/offers, /hours, /services, etc.) ── */
  const custom = (botRow.commands ?? []).find((c) => cmd === c.trigger.trim().toLowerCase())
  if (custom) {
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      // Owner-authored responses may contain stray < or & that Telegram
      // rejects with a 400 under parse_mode HTML — escape to guarantee delivery.
      text: escapeHtml(custom.response.replace(/\\n/g, '\n')),
      disable_web_page_preview: true,
      parse_mode: 'HTML',
    })
    return
  }

  /* ── 6. Unsubscribe ── */
  if (cmd === '/stop' || cmd === '/unsubscribe') {
    await deactivateSubscriber(botRow.id, chatId)
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `${bt(lang, 'unsubscribed')} — ${tenantName}.`,
    })
    await query(`UPDATE tenant_bots SET total_subscribers = (SELECT count(*) FROM bot_subscribers WHERE bot_id = $1 AND is_active = true) WHERE id = $1`, [botRow.id])
    return
  }

  /* ── 7. Default fallback: welcome / help message ──
     Honour auto_reply=false: unknown non-command messages are ignored
     (the customer might just be saying hi). Commands always get an answer. */
  const isUnknownCommand = cmd.startsWith('/')
  if (!botRow.auto_reply && !isUnknownCommand) return

  const fallback = botRow.welcome_message
    .replace(/\\n/g, '\n')
    .replace('{name}', firstName)
    .replace('{company}', tenantName)

  const hasStudents2 = Boolean(
    await queryOne(`SELECT 1 FROM students WHERE guardian_telegram_chat_id = $1::text AND tenant_id = $2 AND status = 'active' LIMIT 1`, [String(chatId), botRow.tenant_id])
  )

  await tgApi(botRow.bot_token, 'sendMessage', {
    chat_id: chatId,
    text: isUnknownCommand ? `${bt(lang, 'unknown_command')}\n\n${fallback}` : fallback,
    disable_web_page_preview: true,
    reply_markup: mainMenuKeyboard(botRow, { linked: Boolean(linkedUser), hasStudents: hasStudents2, lang }),
  })
  await query(`UPDATE tenant_bots SET total_subscribers = (SELECT count(*) FROM bot_subscribers WHERE bot_id = $1 AND is_active = true) WHERE id = $1`, [botRow.id])
}

async function pollLoop(botId: string): Promise<void> {
  if (running.has(botId)) return
  const row = await getTenantBotByBotId(botId)
  if (!row || !row.is_active) return
  const offsetRow = await queryOne<{ last_update_id: number }>(`SELECT last_update_id FROM bot_polling_state WHERE bot_id = $1`, [botId])
  const runtime: Runtime = { tenantBotId: botId, token: row.bot_token, stopped: false, offset: offsetRow?.last_update_id ?? 0 }
  running.set(botId, runtime)
  logAudit({ userId: 'system', userName: 'system', action: 'bot.start', entity: 'tenant_bot', entityId: botId })
  let failures = 0

  // Sequential loop: each getUpdates long-poll (25s) completes before the
  // next one starts. Never overlap polls — Telegram answers concurrent
  // getUpdates for the same bot with 409 Conflict.
  while (!runtime.stopped) {
    try {
      const updates = await tgApi<TenantBotUpdate[]>(row.bot_token, 'getUpdates', { offset: runtime.offset, timeout: 25, allowed_updates: ['message', 'callback_query'] })
      failures = 0
      for (const upd of updates) {
        if (runtime.stopped) break
        runtime.offset = (upd.update_id ?? runtime.offset) + 1
        try { await handleTenantBotUpdate(row, upd) } catch (err) { console.warn(`[bot:${botId}] handler error:`, err instanceof Error ? err.message : err) }
        await pool.query(`INSERT INTO bot_polling_state (bot_id, last_update_id) VALUES ($1, $2) ON CONFLICT (bot_id) DO UPDATE SET last_update_id = $2, updated_at = now()`, [botId, runtime.offset])
      }
    } catch (err) {
      if (runtime.stopped) break
      failures++
      console.warn(`[bot:${botId}] poll error #${failures}:`, err instanceof Error ? err.message : err)
      if (failures >= 10) {
        console.warn(`[bot:${botId}] too many failures — stopping. Check token validity.`)
        running.delete(botId)
        await query(`UPDATE tenant_bots SET is_active = false WHERE id = $1`, [botId])
        return
      }
      await new Promise((r) => setTimeout(r, failures * 3000))
    }
  }
}

export async function startTenantBot(botId: string): Promise<void> {
  await pool.query(`INSERT INTO bot_polling_state (bot_id) VALUES ($1) ON CONFLICT (bot_id) DO NOTHING`, [botId])
  // Also publish command registry for the polling bots (yekis parity)
  const bot = await getTenantBotByBotId(botId)
  if (bot) {
    await tgApi(bot.bot_token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => undefined)
    const appUrl = tenantBotAppUrl(bot)
    const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [bot.tenant_id])
    const buttonText = bot.display_name || (tenant?.name ? `Open ${tenant.name}` : 'Open Workspace')
    await tgApi(bot.bot_token, 'setChatMenuButton', {
      menu_button: { type: 'web_app', text: buttonText, web_app: { url: appUrl } },
    }).catch(() => undefined)
    await registerBotCommands(bot, 'en')
  }
  void pollLoop(botId).catch((err) => console.error(`[bot:${botId}] poll loop crashed:`, err instanceof Error ? err.message : err))
}

export async function stopTenantBot(botId: string): Promise<void> {
  const rt = running.get(botId)
  if (rt) { rt.stopped = true; running.delete(botId) }
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
