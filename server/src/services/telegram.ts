import crypto from 'crypto'
import { pool, query, queryOne } from '../config/db.js'
import { logAudit } from '../utils/audit.js'

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || ''
export const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || ''
const APP_URL = (process.env.PUBLIC_URL || 'http://localhost:5173').replace(/\/$/, '')
const MINI_APP_URL = process.env.TELEGRAM_WEBAPP_URL || `${APP_URL}/app`

export const telegramEnabled = (): boolean => BOT_TOKEN.length > 0

async function api<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T | null> {
  if (!BOT_TOKEN) return null
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })
    const json = (await res.json()) as { ok: boolean; result?: T; description?: string }
    if (!json.ok) {
      console.warn(`[telegram] ${method} failed: ${json.description}`)
      return null
    }
    return json.result ?? null
  } catch (err) {
    console.warn('[telegram] api error:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function sendMessage(chatId: number | string, text: string, keyboard?: unknown): Promise<void> {
  await api('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {}),
  })
}

export async function getMe(): Promise<{ id: number; username: string } | null> {
  return api<{ id: number; username: string }>('getMe')
}

export async function setWebhook(url: string): Promise<boolean> {
  const ok = await api('setWebhook', {
    url,
    secret_token: WEBHOOK_SECRET || undefined,
    allowed_updates: ['message', 'callback_query'],
  })
  // Point the bot's menu button at the Mini App
  await api('setChatMenuButton', {
    menu_button: { type: 'web_app', text: 'Open AFRO Suite', web_app: { url: MINI_APP_URL } },
  })
  return Boolean(ok)
}

/**
 * Validates Telegram Mini App initData against a specific bot token:
 *   secret = HMAC_SHA256(key="WebAppData", data=bot_token)
 *   hash   = HMAC_SHA256(key=secret, data=sorted key=value lines joined by \n)
 * Also enforces freshness (auth_date within 24h) and constant-time compare.
 */
export function verifyInitDataWithToken(initData: string, botToken: string): { userId: number; firstName: string; username?: string } | null {
  if (!botToken || !initData) return null
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash) return null
    params.delete('hash')

    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n')

    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
    const computed = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex')
    const a = Buffer.from(computed, 'hex')
    const b = Buffer.from(hash, 'hex')
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null

    // Freshness — a stolen initData must not be a permanent pass
    const authDate = Number(params.get('auth_date') || 0)
    if (!authDate || Date.now() / 1000 - authDate > 86_400) return null

    const userRaw = params.get('user')
    if (!userRaw) return null
    const user = JSON.parse(userRaw) as { id: number; first_name?: string; username?: string }
    if (!user.id) return null
    return { userId: user.id, firstName: user.first_name ?? 'there', username: user.username }
  } catch {
    return null
  }
}

export function verifyInitData(initData: string): { userId: number; firstName: string; username?: string } | null {
  return verifyInitDataWithToken(initData, BOT_TOKEN)
}

/* ── Link codes ─────────────────────────────────────────── */

export async function createLinkCode(userId: string): Promise<string> {
  const code = crypto.randomBytes(3).toString('hex').toUpperCase() // 6 chars
  await query(`INSERT INTO telegram_link_codes (code, user_id, expires_at) VALUES ($1,$2, now() + interval '15 minutes')`, [code, userId])
  return code
}

/* ── Command handling ───────────────────────────────────── */

interface TgUser {
  id: number
  first_name?: string
}

async function findLinkedUser(chatId: number): Promise<{ id: string; full_name: string; role: string; tenant_id: string | null; tenant_name: string | null; business_type: string | null } | null> {
  return queryOne(
    `SELECT u.id, u.full_name, u.role, u.tenant_id, t.name AS tenant_name, t.business_type
     FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
     WHERE u.telegram_chat_id = $1 AND u.is_active = true LIMIT 1`,
    [chatId]
  )
}

async function handleCommand(chatId: number, text: string, tgUser: TgUser): Promise<void> {
  const [rawCmd, ...args] = text.trim().split(/\s+/)
  const cmd = rawCmd.toLowerCase().replace(/@.*$/, '')

  if (cmd === '/start' || cmd === '/help') {
    const user = await findLinkedUser(chatId)
    await sendMessage(
      chatId,
      user
        ? `<b>${user.full_name}</b> — AFRO-TECH assistant for <b>${user.tenant_name ?? 'AFRO-TECH'}</b>.\n\n` +
            `Commands:\n/today — daily summary\n/lowstock — products to reorder\n/expiring — batches expiring soon\n/shift — your open cash drawer\n/unlink — disconnect this chat\n\n` +
            `Or open the app: ${MINI_APP_URL}`
        : `Welcome to the <b>AFRO-TECH Suite</b> assistant!\n\n` +
            `👨‍🏫 <b>Staff / Work account:</b>\n1. Web app → Settings → Telegram\n2. Send <code>/link CODE</code> here.\n\n` +
            `👨‍👩‍👧 <b>Parents & Guardians:</b>\nTo receive school notices and fee alerts for your child:\nSend: <code>/parent STUDENT_CODE</code>\n(Example: <code>/parent STU-00001</code>)\n\n` +
            `App: ${MINI_APP_URL}`
    )
    return
  }

  /* ── Guardian / Parent Link ── */
  if (cmd === '/parent') {
    const rawCode = (args[0] || '').trim().toUpperCase()
    if (!rawCode) {
      await sendMessage(
        chatId,
        `Please provide your child's student code:\nExample: <code>/parent STU-00001</code>\n\n(Ask the school administration for the student code if you don't have it.)`
      )
      return
    }

    const student = await queryOne<{
      id: string
      code: string
      first_name: string
      last_name: string
      class_name: string | null
      tenant_name: string | null
    }>(
      `SELECT s.id, s.code, s.first_name, s.last_name, c.name AS class_name, t.name AS tenant_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN tenants t ON t.id = s.tenant_id
       WHERE UPPER(s.code) = $1 AND s.status = 'active' LIMIT 1`,
      [rawCode]
    )

    if (!student) {
      await sendMessage(
        chatId,
        `❌ No active student found with code "<b>${rawCode}</b>".\nPlease check the code and try again.\nExample: <code>/parent STU-00001</code>`
      )
      return
    }

    await query(
      `UPDATE students
       SET guardian_telegram_chat_id = $1, guardian_telegram_username = $2
       WHERE id = $3`,
      [String(chatId), tgUser.first_name ? `${tgUser.first_name}` : null, student.id]
    )

    await sendMessage(
      chatId,
      `✅ <b>Successfully Linked as Guardian!</b>\n\n` +
      `👤 <b>Student:</b> ${student.first_name} ${student.last_name}\n` +
      `🆔 <b>Code:</b> <code>${student.code}</code>\n` +
      `🏫 <b>School:</b> ${student.tenant_name || 'School'}\n` +
      `📚 <b>Class:</b> ${student.class_name || 'Not assigned'}\n\n` +
      `You will now receive important school announcements, notices, and fee receipts directly in this chat.\n\n` +
      `Commands for parents:\n` +
      `/child — View linked student info\n` +
      `/myfees — View outstanding fee records`
    )
    return
  }

  /* ── Guardian Inquiries ── */
  if (cmd === '/child' || cmd === '/student') {
    const students = await query<{
      id: string
      code: string
      first_name: string
      last_name: string
      class_name: string | null
      tenant_name: string | null
    }>(
      `SELECT s.id, s.code, s.first_name, s.last_name, c.name AS class_name, t.name AS tenant_name
       FROM students s
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN tenants t ON t.id = s.tenant_id
       WHERE s.guardian_telegram_chat_id = $1::text AND s.status = 'active'`,
      [String(chatId)]
    )

    if (!students.length) {
      await sendMessage(
        chatId,
        `You have not linked any students to this chat yet.\nSend <code>/parent STUDENT_CODE</code> to link your child.`
      )
      return
    }

    const list = students
      .map(
        (s) =>
          `• <b>${s.first_name} ${s.last_name}</b> (Code: <code>${s.code}</code>)\n  Class: ${s.class_name || 'N/A'} | School: ${s.tenant_name || 'School'}`
      )
      .join('\n\n')

    await sendMessage(chatId, `👨‍👩‍👧 <b>Linked Students:</b>\n\n${list}\n\nType /myfees to check fee status.`)
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
      school_name: string
    }>(
      `SELECT f.title, f.amount::text, f.paid_amount::text, f.status, f.due_date,
              s.first_name || ' ' || s.last_name AS student_name, t.name AS school_name
       FROM fees f
       JOIN students s ON s.id = f.student_id
       LEFT JOIN tenants t ON t.id = f.tenant_id
       WHERE s.guardian_telegram_chat_id = $1::text
       ORDER BY f.created_at DESC LIMIT 6`,
      [String(chatId)]
    )

    if (!fees.length) {
      await sendMessage(chatId, `No fee records found for your linked student(s).`)
      return
    }

    const textList = fees
      .map((f) => {
        const remaining = Math.max(0, Number(f.amount) - Number(f.paid_amount))
        const statusEmoji = f.status === 'paid' ? '✅ Paid' : remaining > 0 ? `⚠️ Due: ${remaining.toFixed(2)} ETB` : 'Pending'
        return `• <b>${f.title}</b> (${f.student_name})\n  Total: ${Number(f.amount).toFixed(2)} ETB | Paid: ${Number(f.paid_amount).toFixed(2)} ETB\n  Status: ${statusEmoji}${f.due_date ? ` (Due: ${f.due_date.toString().slice(0, 10)})` : ''}`
      })
      .join('\n\n')

    await sendMessage(chatId, `📋 <b>Fee Statements:</b>\n\n${textList}`)
    return
  }

  if (cmd === '/link') {
    const code = (args[0] || '').toUpperCase()
    if (!code) {
      await sendMessage(chatId, 'Send it like this: <code>/link ABC123</code>\nGenerate the code in the web app → Settings → Telegram.')
      return
    }
    const row = await queryOne<{ user_id: string; expires_at: Date }>(`SELECT user_id, expires_at FROM telegram_link_codes WHERE code = $1`, [code])
    if (!row || new Date(row.expires_at).getTime() < Date.now()) {
      await sendMessage(chatId, 'That code is invalid or expired. Generate a fresh one in Settings → Telegram.')
      return
    }
    await query(`UPDATE users SET telegram_chat_id = $1, telegram_linked_at = now() WHERE id = $2`, [chatId, row.user_id])
    await query(`DELETE FROM telegram_link_codes WHERE code = $1`, [code])
    const user = await queryOne<{ full_name: string; tenant_name: string | null }>(
      `SELECT u.full_name, t.name AS tenant_name FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id WHERE u.id = $1`,
      [row.user_id]
    )
    logAudit({ userId: row.user_id, userName: user?.full_name, action: 'telegram.link', entity: 'user', entityId: row.user_id, details: { telegram: tgUser.id } })
    await sendMessage(chatId, `Linked! You'll receive alerts for <b>${user?.tenant_name ?? 'your workspace'}</b>.\nTry /today or open ${MINI_APP_URL}`)
    return
  }

  const user = await findLinkedUser(chatId)
  if (!user) {
    // Check if this user is a linked parent
    const isParent = await queryOne(`SELECT id FROM students WHERE guardian_telegram_chat_id = $1::text LIMIT 1`, [String(chatId)])
    if (isParent) {
      await sendMessage(chatId, 'Parent options:\n/child — View linked student info\n/myfees — View fee statement\n/parent CODE — Link another student')
      return
    }
    await sendMessage(chatId, 'This chat is not linked yet. Send /start to see how to link your staff or parent account.')
    return
  }

  if (cmd === '/unlink') {
    await query(`UPDATE users SET telegram_chat_id = NULL, telegram_linked_at = NULL WHERE id = $1`, [user.id])
    await sendMessage(chatId, 'Unlinked. You will no longer receive alerts here.')
    return
  }

  if (cmd === '/today') {
    if (user.role === 'afrotech_admin') {
      await sendMessage(chatId, 'Platform-wide summaries are in the admin panel: ' + MINI_APP_URL)
      return
    }
    if (user.business_type === 'hospital' || user.business_type === 'school') {
      const stats =
        user.business_type === 'hospital'
          ? await queryOne<{ today: string }>(
              `SELECT count(*)::text AS today FROM appointments WHERE tenant_id = $1 AND scheduled_at >= CURRENT_DATE AND scheduled_at < CURRENT_DATE + interval '1 day'`,
              [user.tenant_id]
            )
          : await queryOne<{ today: string }>(
              `SELECT count(*)::text AS today FROM attendance WHERE tenant_id = $1 AND att_date = CURRENT_DATE`,
              [user.tenant_id]
            )
      const label = user.business_type === 'hospital' ? 'appointments today' : 'attendance entries today'
      await sendMessage(chatId, `<b>${user.tenant_name}</b>\n${stats?.today ?? 0} ${label}.`)
      return
    }
    const s = await queryOne<{ total: string; count: string }>(
      `SELECT COALESCE(SUM(total),0)::text AS total, count(*)::text AS count FROM sales
       WHERE tenant_id = $1 AND status = 'completed' AND created_at >= CURRENT_DATE`,
      [user.tenant_id]
    )
    await sendMessage(chatId, `<b>${user.tenant_name} — today</b>\n${s?.count ?? 0} sales · ${Number(s?.total ?? 0).toFixed(2)} ETB`)
    return
  }

  if (cmd === '/lowstock') {
    if (!user.tenant_id || (user.business_type !== 'pharmacy' && user.business_type !== 'store')) {
      await sendMessage(chatId, 'Low stock applies to pharmacy/store workspaces.')
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
      [user.tenant_id]
    )
    if (!rows.length) {
      await sendMessage(chatId, 'Stock levels look healthy — nothing to reorder.')
      return
    }
    await sendMessage(chatId, `<b>Low stock — reorder these:</b>\n${rows.map((r) => `• ${r.name} — ${r.sellable} left (min ${r.threshold})`).join('\n')}`)
    return
  }

  if (cmd === '/expiring') {
    if (!user.tenant_id) return
    const { rows } = await pool.query<{ name: string; expiry_date: string; quantity: number }>(
      `SELECT p.name, b.expiry_date, b.quantity FROM product_batches b JOIN products p ON p.id = b.product_id
       WHERE b.tenant_id = $1 AND b.quantity > 0 AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60
       ORDER BY b.expiry_date ASC LIMIT 10`,
      [user.tenant_id]
    )
    if (!rows.length) {
      await sendMessage(chatId, 'Nothing expiring in the next 60 days.')
      return
    }
    await sendMessage(
      chatId,
      `⏳ <b>Expiring within 60 days:</b>\n${rows.map((r) => `• ${r.name} — ${r.quantity} units, ${new Date(r.expiry_date).toLocaleDateString('en-GB')}`).join('\n')}\n\nWrite them off from the Expiry page.`
    )
    return
  }

  if (cmd === '/shift') {
    const shift = await queryOne(
      `SELECT opening_balance, cash_sales, expenses FROM cash_drawer_shifts WHERE tenant_id = $1 AND user_id = $2 AND status = 'open'`,
      [user.tenant_id, user.id]
    )
    if (!shift) {
      await sendMessage(chatId, 'No open shift. Start one from the Cash Drawer page.')
      return
    }
    const expected = Number(shift.opening_balance) + Number(shift.cash_sales) - Number(shift.expenses)
    await sendMessage(chatId, `<b>Open shift</b>\nCash sales: ${Number(shift.cash_sales).toFixed(2)} ETB\nExpected in drawer: ${expected.toFixed(2)} ETB`)
    return
  }

  await sendMessage(chatId, 'Unknown command. Try /help')
}

/** Entry point for both webhook updates and polling results. */
export async function handleUpdate(update: { message?: { chat: { id: number }; text?: string; from?: TgUser } }): Promise<void> {
  const msg = update.message
  if (!msg?.text || !msg.from) return
  await handleCommand(msg.chat.id, msg.text, msg.from)
}

/** Long-polling loop for development (no public URL needed). */
let pollingOffset = 0
let polling = false

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export function startPolling(): void {
  if (!telegramEnabled() || polling) return
  polling = true
  console.log('[telegram] long-polling started')
  let consecutiveFailures = 0
  const tick = async (): Promise<void> => {
    while (polling) {
      const updates = await api<Array<{ update_id: number; message?: { chat: { id: number }; text?: string; from?: TgUser } }>>('getUpdates', {
        offset: pollingOffset,
        timeout: 25,
      })
      if (updates) {
        consecutiveFailures = 0
        for (const u of updates) {
          pollingOffset = u.update_id + 1
          await handleUpdate(u).catch(() => undefined)
        }
      } else {
        // Back off on failures (bad token, network down) so we never hammer the API or starve the event loop
        consecutiveFailures++
        if (consecutiveFailures >= 5) {
          console.warn('[telegram] repeated polling failures — stopping the loop. Check TELEGRAM_BOT_TOKEN.')
          polling = false
          break
        }
        await sleep(3000)
      }
    }
  }
  void tick()
}

export function stopPolling(): void {
  polling = false
}
