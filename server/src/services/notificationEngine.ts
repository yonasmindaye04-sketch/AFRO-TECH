import { query, queryOne } from '../config/db.js'
import { sendMessage, telegramEnabled } from './telegram.js'

/**
 * Unified notification engine — DB-stored templates, multi-channel,
 * role/department/user targeting, throttle per tenant:type.
 */

interface Template {
  id: string
  code: string
  name: string
  channel: 'telegram' | 'email' | 'both'
  subject: string | null
  body: string
  variables: string[]
  is_active: boolean
}

interface SendOpts {
  tenantId: string
  code: string
  data: Record<string, unknown>
  target?: {
    userIds?: string[]
    roleNames?: string[]
    departmentIds?: string[]
    channels?: ('telegram' | 'email')[]
  }
  skipThrottle?: boolean
}

const THROTTLE_HOURS = 12
const lastSent = new Map<string, number>()

function throttleKey(tenantId: string, code: string): string {
  return `${tenantId}:${code}`
}

function shouldSend(key: string): boolean {
  const last = lastSent.get(key) ?? 0
  if (Date.now() - last < THROTTLE_HOURS * 3_600_000) return false
  lastSent.set(key, Date.now())
  return true
}

async function getTemplate(tenantId: string, code: string): Promise<Template | null> {
  // Try tenant-specific template first
  const tenantTpl = await queryOne<Template>(
    `SELECT id, code, name, channel, subject, body, variables, is_active
     FROM notification_templates WHERE tenant_id = $1 AND code = $2 AND is_active = true`,
    [tenantId, code]
  )
  if (tenantTpl) return tenantTpl

  // Fallback to system template (tenant_id = '00000000-0000-0000-0000-000000000000')
  const sysTpl = await queryOne<Template>(
    `SELECT id, code, name, channel, subject, body, variables, is_active
     FROM notification_templates WHERE tenant_id = '00000000-0000-0000-0000-000000000000' AND code = $1 AND is_active = true`,
    [code]
  )
  return sysTpl
}

async function resolveRecipients(opts: {
  tenantId: string
  userIds?: string[]
  roleNames?: string[]
  departmentIds?: string[]
}): Promise<string[]> {
  const { tenantId, userIds, roleNames, departmentIds } = opts
  const chatIds: string[] = []

  // 1. Direct user IDs
  if (userIds?.length) {
    const rows = await query<{ chat_id: string }>(
      `SELECT DISTINCT telegram_chat_id AS chat_id FROM users
       WHERE id = ANY($1) AND tenant_id = $2 AND telegram_chat_id IS NOT NULL AND is_active = true`,
      [userIds, opts.tenantId]
    )
    chatIds.push(...rows.map(r => r.chat_id))
  }

  // 2. Users by role name
  if (roleNames?.length) {
    const rows = await query<{ chat_id: string }>(
      `SELECT DISTINCT u.telegram_chat_id AS chat_id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN roles r ON r.id = ur.role_id
       WHERE u.tenant_id = $1 AND r.name = ANY($2)
         AND u.telegram_chat_id IS NOT NULL AND u.is_active = true`,
      [opts.tenantId, roleNames]
    )
    chatIds.push(...rows.map(r => r.chat_id))
  }

  // 3. Users assigned to departments
  if (departmentIds?.length) {
    const rows = await query<{ chat_id: string }>(
      `SELECT DISTINCT u.telegram_chat_id AS chat_id FROM users u
       JOIN department_staff ds ON ds.user_id = u.id
       WHERE u.tenant_id = $1 AND ds.department_id = ANY($2)
         AND u.telegram_chat_id IS NOT NULL AND u.is_active = true`,
      [opts.tenantId, departmentIds]
    )
    chatIds.push(...rows.map(r => r.chat_id))
  }

  // 4. Fallback: all active users in tenant with telegram_chat_id
  if (chatIds.length === 0) {
    const rows = await query<{ chat_id: string }>(
      `SELECT DISTINCT telegram_chat_id AS chat_id FROM users
       WHERE tenant_id = $1 AND telegram_chat_id IS NOT NULL AND is_active = true`,
      [opts.tenantId]
    )
    chatIds.push(...rows.map(r => r.chat_id))
  }

  return [...new Set(chatIds)] // deduplicate
}

function renderTemplate(template: string, data: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = data[key]
    return value !== undefined && value !== null ? String(value) : match
  })
}

async function sendTelegram(chatIds: string[], text: string): Promise<number> {
  if (!telegramEnabled() || chatIds.length === 0) return 0
  let sent = 0
  for (const chatId of chatIds) {
    try {
      await sendMessage(chatId, text)
      sent++
    } catch (err) {
      console.warn('[notificationEngine] Telegram send failed:', err instanceof Error ? err.message : err)
    }
  }
  return sent
}

async function sendEmail(chatIds: string[], subject: string, html: string): Promise<number> {
  // TODO: Implement Resend/SMTP email sending
  // For now, log and return 0
  console.log('[notificationEngine] Email send not yet implemented:', { to: chatIds, subject })
  return 0
}

export async function sendNotification(opts: SendOpts): Promise<{ sent: number; failed: number }> {
  const { tenantId, code, data, target, skipThrottle } = opts

  // Throttle check
  if (!skipThrottle && !shouldSend(throttleKey(tenantId, code))) {
    console.log(`[notificationEngine] Throttled: ${code} for tenant ${tenantId}`)
    return { sent: 0, failed: 0 }
  }

  const template = await getTemplate(tenantId, code)
  if (!template) {
    console.warn(`[notificationEngine] Template not found: ${code} for tenant ${tenantId}`)
    return { sent: 0, failed: 0 }
  }

  const channels = target?.channels ?? (template.channel === 'both' ? ['telegram', 'email'] : [template.channel])
  const chatIds = await resolveRecipients({ tenantId, ...target })

  if (chatIds.length === 0) {
    console.log(`[notificationEngine] No recipients for ${code} in tenant ${tenantId}`)
    return { sent: 0, failed: 0 }
  }

  // Render template
  const subject = template.subject ? renderTemplate(template.subject, data) : ''
  const body = renderTemplate(template.body, data)
  const fullText = subject ? `<b>${subject}</b>\n\n${body}` : body

  let totalSent = 0
  let totalFailed = 0

  for (const channel of channels) {
    if (channel === 'telegram') {
      const sent = await sendTelegram(chatIds, fullText)
      totalSent += sent
      totalFailed += chatIds.length - sent
    } else if (channel === 'email') {
      const sent = await sendEmail(chatIds, subject, body)
      totalSent += sent
      totalFailed += chatIds.length - sent
    }
  }

  // Log notification event
  // TODO: Add audit log entry

  return { sent: totalSent, failed: totalFailed }
}

/** Convenience: send to all users with a specific role */
export async function notifyRole(
  tenantId: string,
  code: string,
  data: Record<string, unknown>,
  roleNames: string[]
): Promise<{ sent: number; failed: number }> {
  return sendNotification({ tenantId, code, data, target: { roleNames } })
}

/** Convenience: send to department staff */
export async function notifyDepartment(
  tenantId: string,
  code: string,
  data: Record<string, unknown>,
  departmentIds: string[]
): Promise<{ sent: number; failed: number }> {
  return sendNotification({ tenantId, code, data, target: { departmentIds } })
}

/** Convenience: send to specific users */
export async function notifyUsers(
  tenantId: string,
  code: string,
  data: Record<string, unknown>,
  userIds: string[]
): Promise<{ sent: number; failed: number }> {
  return sendNotification({ tenantId, code, data, target: { userIds } })
}

/** Convenience: send long-wait escalation */
export async function notifyLongWait(
  tenantId: string,
  patientName: string,
  departmentName: string | null,
  minutes: number
): Promise<{ sent: number; failed: number }> {
  return sendNotification({
    tenantId,
    code: 'long_wait_escalation',
    data: { patient_name: patientName, department_name: departmentName, minutes },
    skipThrottle: true // long-wait alerts bypass throttle
  })
}