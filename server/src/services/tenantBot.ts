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
  // Menu button opens the tenant's workspace inside Telegram with company context
  const baseAppUrl = (process.env.TELEGRAM_WEBAPP_URL || `${(process.env.PUBLIC_URL || '').replace(/\/$/, '')}/app`)
  const appUrl = `${baseAppUrl}${baseAppUrl.includes('?') ? '&' : '?'}tenant_id=${bot.tenant_id}&bot_id=${bot.id}`
  const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [bot.tenant_id])
  const buttonText = bot.display_name || (tenant?.name ? `Open ${tenant.name}` : 'Open Workspace')

  await tgApi(bot.bot_token, 'setChatMenuButton', {
    menu_button: { type: 'web_app', text: buttonText, web_app: { url: appUrl } },
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
  const fullText = msg.text.trim()
  const [rawCmd, ...args] = fullText.split(/\s+/)
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, '')
  const firstName = msg.from.first_name || 'there'
  const username = msg.from.username || undefined

  // Upsert the subscriber on every contact (handles re-subscribe too)
  await upsertSubscriber(botRow.id, botRow.tenant_id, chatId, firstName, username)

  // Fetch company info
  const tenant = await queryOne<{ name: string; business_type: string }>(
    `SELECT name, business_type FROM tenants WHERE id = $1`,
    [botRow.tenant_id]
  )
  const tenantName = tenant?.name ?? 'Workspace'
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
        text: `To link your account, send: <code>/link CODE</code>\n\nGenerate your 6-character code in your <b>${tenantName}</b> web app under Settings → Telegram.`,
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
        text: 'That code is invalid or expired. Please generate a fresh one in Settings → Telegram.',
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
        text: `This link code belongs to another workspace. This bot is exclusively for <b>${tenantName}</b>.`,
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
      text: `✅ <b>Linked!</b>\n\nWelcome, <b>${user.full_name}</b> (${user.role}). You are now connected to <b>${tenantName}</b>.\n\n` +
        `Available staff commands:\n` +
        `/today — Daily sales & activity summary\n` +
        `/lowstock — Items needing reorder\n` +
        `/expiring — Inventory expiring soon\n` +
        `/shift — Current cash drawer shift\n` +
        `/unlink — Disconnect this account\n\n` +
        `Tap the menu button at the bottom to launch your company Mini App!`,
      parse_mode: 'HTML',
    })
    return
  }

  /* ── 2. Account unlinking (/unlink) ── */
  if (cmd === '/unlink') {
    if (linkedUser) {
      await query(`UPDATE users SET telegram_chat_id = NULL, telegram_linked_at = NULL WHERE id = $1`, [linkedUser.id])
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `Unlinked. You will no longer receive staff alerts or summaries for <b>${tenantName}</b>.`,
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
        text: `Please provide your child's student code:\nExample: <code>/parent STU-00001</code>\n\n(Ask the school administration for the student code if you don't have it.)`,
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
        text: `❌ No active student found with code "<b>${rawCode}</b>" at <b>${tenantName}</b>.\nPlease check the student code and try again.`,
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
      text: `✅ <b>Successfully Linked as Guardian!</b>\n\n` +
        `👤 <b>Student:</b> ${student.first_name} ${student.last_name}\n` +
        `🆔 <b>Code:</b> <code>${student.code}</code>\n` +
        `🏫 <b>School:</b> ${tenantName}\n` +
        `📚 <b>Class:</b> ${student.class_name || 'Not assigned'}\n\n` +
        `You will now receive important school announcements, notices, and fee receipts directly in this chat.\n\n` +
        `Commands for parents:\n` +
        `/child — View linked student info\n` +
        `/myfees — View outstanding fee records`,
      parse_mode: 'HTML',
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
        text: `You have not linked any students to this bot yet.\nSend <code>/parent STUDENT_CODE</code> to link your child.`,
        parse_mode: 'HTML',
      })
      return
    }

    const list = students
      .map((s) => `• <b>${s.first_name} ${s.last_name}</b> (Code: <code>${s.code}</code>)\n  Class: ${s.class_name || 'N/A'}`)
      .join('\n\n')

    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `👨‍👩‍👧 <b>Linked Students at ${tenantName}:</b>\n\n${list}\n\nType /myfees to check fee status.`,
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
        text: `No fee records found for your linked student(s).`,
        parse_mode: 'HTML',
      })
      return
    }

    const textList = fees
      .map((f) => {
        const remaining = Math.max(0, Number(f.amount) - Number(f.paid_amount))
        const statusEmoji = f.status === 'paid' ? '✅ Paid' : remaining > 0 ? `⚠️ Due: ${remaining.toFixed(2)} ETB` : 'Pending'
        return `• <b>${f.title}</b> (${f.student_name})\n  Total: ${Number(f.amount).toFixed(2)} ETB | Paid: ${Number(f.paid_amount).toFixed(2)} ETB\n  Status: ${statusEmoji}${f.due_date ? ` (Due: ${f.due_date.toString().slice(0, 10)})` : ''}`
      })
      .join('\n\n')

    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `📋 <b>Fee Statements:</b>\n\n${textList}`,
      parse_mode: 'HTML',
    })
    return
  }

  /* ── 3. Start & Help (/start, /help) ── */
  if (cmd === '/start' || cmd === '/help') {
    // If the user sent a deeplink like /start D09806 (Telegram start parameter)
    if (args[0] && args[0].length >= 6) {
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
            text: `✅ <b>Linked!</b>\n\nWelcome, <b>${user.full_name}</b> (${user.role}) to <b>${tenantName}</b>.\n\nTry /today, /lowstock, or tap the menu button below to open your workspace.`,
            parse_mode: 'HTML',
          })
          return
        }
      }
    }

    if (linkedUser) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `<b>${linkedUser.full_name}</b> — <b>${tenantName}</b> Assistant\n\n` +
          `Staff Commands:\n` +
          `/today — daily summary\n` +
          `/lowstock — items to reorder\n` +
          `/expiring — batches expiring in 60 days\n` +
          `/shift — active cash drawer shift\n` +
          `/unlink — disconnect account\n\n` +
          `Or tap the menu button to open <b>${tenantName}</b> Mini App.`,
        parse_mode: 'HTML',
      })
      return
    }

    // Customer or unlinked visitor: send welcome message + custom commands hint
    const welcome = botRow.welcome_message
      .replace(/\\n/g, '\n')
      .replace('{name}', firstName)
      .replace('{company}', tenantName)

    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `${welcome}\n\n<i>Are you a staff member of ${tenantName}? Open Settings → Telegram to generate a code, then send /link CODE here.</i>`,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    })
    return
  }

  /* ── 4. Staff operational commands (/today, /lowstock, /expiring, /shift) ── */
  if (cmd === '/today') {
    if (!linkedUser) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `This command is for <b>${tenantName}</b> staff. Send <code>/link CODE</code> to link your work account.`,
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
      const label = businessType === 'hospital' ? 'appointments scheduled today' : 'attendance entries recorded today'
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `<b>${tenantName} — Today</b>\n\n📅 ${stats?.today ?? 0} ${label}.`,
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
      text: `<b>${tenantName} — Today's Sales</b>\n\n💰 Total: <b>${Number(s?.total ?? 0).toFixed(2)} ETB</b>\n🧾 Receipts: <b>${s?.count ?? 0}</b>`,
      parse_mode: 'HTML',
    })
    return
  }

  if (cmd === '/lowstock') {
    if (!linkedUser) {
      await tgApi(botRow.bot_token, 'sendMessage', {
        chat_id: chatId,
        text: `This command is for <b>${tenantName}</b> staff. Send <code>/link CODE</code> to link your account.`,
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
        text: `✅ <b>${tenantName} Stock:</b>\n\nAll inventory levels look healthy! Nothing currently below threshold.`,
        parse_mode: 'HTML',
      })
      return
    }
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `⚠️ <b>Low Stock Items for ${tenantName}:</b>\n\n${rows.map((r) => `• <b>${r.name}</b> — ${r.sellable} left (min: ${r.threshold})`).join('\n')}`,
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
        text: `✅ <b>${tenantName}:</b> No products expiring within the next 60 days.`,
        parse_mode: 'HTML',
      })
      return
    }
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `⏳ <b>Expiring within 60 days (${tenantName}):</b>\n\n${rows.map((r) => `• <b>${r.name}</b> — ${r.quantity} units (expires ${new Date(r.expiry_date).toLocaleDateString('en-GB')})`).join('\n')}`,
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
        text: `No open drawer shift found for you at <b>${tenantName}</b>. Start a shift from the Cash Drawer page.`,
        parse_mode: 'HTML',
      })
      return
    }
    const expected = Number(shift.opening_balance) + Number(shift.cash_sales) - Number(shift.expenses)
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: `💼 <b>Open Shift — ${tenantName}</b>\n\nCash sales: <b>${Number(shift.cash_sales).toFixed(2)} ETB</b>\nExpenses: <b>${Number(shift.expenses).toFixed(2)} ETB</b>\nExpected in drawer: <b>${expected.toFixed(2)} ETB</b>`,
      parse_mode: 'HTML',
    })
    return
  }

  /* ── 5. Custom tenant commands (/offers, /hours, /services, etc.) ── */
  const custom = (botRow.commands ?? []).find((c) => cmd === c.trigger.trim().toLowerCase())
  if (custom) {
    await tgApi(botRow.bot_token, 'sendMessage', {
      chat_id: chatId,
      text: custom.response,
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
      text: `You have unsubscribed from ${tenantName}. Send /start at any time to rejoin.`,
    })
    await query(`UPDATE tenant_bots SET total_subscribers = (SELECT count(*) FROM bot_subscribers WHERE bot_id = $1 AND is_active = true) WHERE id = $1`, [botRow.id])
    return
  }

  /* ── 7. Default fallback: welcome / help message ── */
  const fallback = botRow.welcome_message
    .replace(/\\n/g, '\n')
    .replace('{name}', firstName)
    .replace('{company}', tenantName)

  await tgApi(botRow.bot_token, 'sendMessage', {
    chat_id: chatId,
    text: fallback,
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
