import { query } from '../config/db.js'
import { sendMessage, telegramEnabled } from './telegram.js'

/**
 * Department connectivity notifications:
 *  - New service order → staff in the target department
 *  - Order completed → ordering doctor
 *  - Long wait escalation → staff in the department
 * All best-effort; failures are logged but never block the request.
 */

async function notifyUsers(chatIds: string[], text: string): Promise<void> {
  if (!telegramEnabled() || chatIds.length === 0) return
  for (const chatId of chatIds) {
    try {
      await sendMessage(chatId, text)
    } catch (err) {
      console.warn('[hospitalNotify] send failed:', err instanceof Error ? err.message : err)
    }
  }
}

/** Users in a specific department who have linked Telegram. */
async function departmentChatIds(tenantId: string, departmentId: string): Promise<string[]> {
  const rows = await query<{ chat_id: string }>(
    `SELECT DISTINCT u.telegram_chat_id AS chat_id FROM users u
     JOIN department_staff ds ON ds.user_id = u.id
     WHERE u.tenant_id = $1 AND ds.department_id = $2
       AND u.telegram_chat_id IS NOT NULL AND u.is_active = true`,
    [tenantId, departmentId]
  )
  return rows.map((r) => r.chat_id)
}

/** Fallback: everyone in the tenant if nobody is assigned to the dept yet. */
async function tenantChatIds(tenantId: string): Promise<string[]> {
  const rows = await query<{ chat_id: string }>(
    `SELECT telegram_chat_id AS chat_id FROM users WHERE tenant_id = $1 AND telegram_chat_id IS NOT NULL AND is_active = true`,
    [tenantId]
  )
  return rows.map((r) => r.chat_id)
}

export async function notifyOrderCreated(opts: {
  tenantId: string
  departmentId: string
  orderId: string
  orderType: string
  patientName: string
  doctorName?: string | null
}): Promise<void> {
  let chats = await departmentChatIds(opts.tenantId, opts.departmentId)
  if (chats.length === 0) chats = await tenantChatIds(opts.tenantId)
  const urgency = opts.orderType === 'injection' ? 'Injection' : opts.orderType === 'lab_test' ? 'Lab test' : 'Service order'
  await notifyUsers(
    chats,
    `<b>New ${urgency.toLowerCase()} order</b>\nPatient: <b>${opts.patientName}</b>\n${opts.doctorName ? `Ordered by: ${opts.doctorName}\n` : ''}Open the department queue to process it.`
  )
}

export async function notifyOrderCompleted(opts: {
  tenantId: string
  doctorUserId: string | null
  orderType: string
  patientName: string
}): Promise<void> {
  if (!opts.doctorUserId) return
  const rows = await query<{ chat_id: string }>(
    `SELECT telegram_chat_id AS chat_id FROM users WHERE id = $1 AND telegram_chat_id IS NOT NULL`,
    [opts.doctorUserId]
  )
  const chatIds = rows.map((r) => r.chat_id)
  await notifyUsers(
    chatIds,
    `<b>Order result ready</b>\n${opts.orderType} for <b>${opts.patientName}</b> is complete — review it in the patient's journey.`
  )
}

export async function notifyLongWait(opts: {
  tenantId: string
  departmentId: string
  patientName: string
  waitingMinutes: number
}): Promise<void> {
  let chats = await departmentChatIds(opts.tenantId, opts.departmentId)
  await notifyUsers(
    chats,
    `<b>Long wait alert</b>\n${opts.patientName} has been waiting ${opts.waitingMinutes} minutes in your department.`
  )
}