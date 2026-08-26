import { query, queryOne } from '../config/db.js'
import { sendMessage, telegramEnabled } from './telegram.js'

/**
 * Push notifications that solve real operational problems:
 *  - Retail: stockouts + expiring medicine (silent revenue/waste losses)
 *  - School: unpaid fees becoming defaulters
 *  - Hospital: today's appointments (no-shows)
 * Throttled per tenant+type so nobody gets spammed.
 */

const THROTTLE_HOURS = 12
const lastSent = new Map<string, number>()

function shouldSend(key: string): boolean {
  const last = lastSent.get(key) ?? 0
  if (Date.now() - last < THROTTLE_HOURS * 3_600_000) return false
  lastSent.set(key, Date.now())
  return true
}

async function notifyTenant(tenantId: string, text: string): Promise<number> {
  const recipients = await query<{ chat_id: string }>(
    `SELECT DISTINCT telegram_chat_id AS chat_id FROM users
     WHERE tenant_id = $1 AND telegram_chat_id IS NOT NULL AND is_active = true`,
    [tenantId]
  )
  for (const r of recipients) {
    await sendMessage(r.chat_id, text)
  }
  return recipients.length
}

async function alertRetail(tenantId: string, name: string): Promise<void> {
  if (!shouldSend(`${tenantId}:stock`)) return
  const low = await query<{ name: string; sellable: string; threshold: number }>(
    `SELECT p.name, COALESCE(SUM(b.quantity) FILTER (WHERE b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE), 0)::text AS sellable,
            p.low_stock_threshold AS threshold
     FROM products p LEFT JOIN product_batches b ON b.product_id = p.id
     WHERE p.tenant_id = $1 AND p.is_active = true
     GROUP BY p.id, p.name, p.low_stock_threshold
     HAVING COALESCE(SUM(b.quantity) FILTER (WHERE b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE), 0) <= p.low_stock_threshold
     ORDER BY sellable ASC LIMIT 8`,
    [tenantId]
  )
  const expiring = await query<{ name: string; expiry_date: string; quantity: number }>(
    `SELECT p.name, b.expiry_date, b.quantity FROM product_batches b JOIN products p ON p.id = b.product_id
     WHERE b.tenant_id = $1 AND b.quantity > 0 AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 30
     ORDER BY b.expiry_date ASC LIMIT 8`,
    [tenantId]
  )
  if (!low.length && !expiring.length) return

  const parts: string[] = [`📦 <b>${name} — stock report</b>`]
  if (low.length) {
    parts.push(`\n⚠️ <b>Low stock:</b>\n${low.map((r) => `• ${r.name} — ${r.sellable} left (min ${r.threshold})`).join('\n')}`)
  }
  if (expiring.length) {
    parts.push(
      `\n⏳ <b>Expiring ≤30 days:</b>\n${expiring.map((r) => `• ${r.name} — ${r.quantity} units, ${new Date(r.expiry_date).toLocaleDateString('en-GB')}`).join('\n')}`
    )
  }
  parts.push('\nOpen the app to reorder or write off.')
  await notifyTenant(tenantId, parts.join('\n'))
}

async function alertSchool(tenantId: string, name: string): Promise<void> {
  if (!shouldSend(`${tenantId}:fees`)) return
  const stats = await queryOne<{ defaulters: string; due: string | null }>(
    `SELECT count(*)::text AS defaulters, COALESCE(SUM(amount - paid_amount),0)::text AS due
     FROM fees WHERE tenant_id = $1 AND status != 'paid'
       AND due_date IS NOT NULL AND due_date <= CURRENT_DATE + 7`,
    [tenantId]
  )
  if (Number(stats?.defaulters ?? 0) === 0) return
  await notifyTenant(
    tenantId,
    `🎓 <b>${name} — fees reminder</b>\n${stats?.defaulters} fee${Number(stats?.defaulters) === 1 ? '' : 's'} due within 7 days\nOutstanding: <b>${Number(stats?.due ?? 0).toFixed(2)} ETB</b>\n\nSee the defaulters list in Reports.`
  )
}

async function alertHospital(tenantId: string, name: string): Promise<void> {
  if (!shouldSend(`${tenantId}:appts`)) return
  const today = await query<{ patient_name: string; scheduled_at: string; doctor_name: string | null }>(
    `SELECT p.first_name || ' ' || p.last_name AS patient_name, a.scheduled_at, d.full_name AS doctor_name
     FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN doctors d ON d.id = a.doctor_id
     WHERE a.tenant_id = $1 AND a.status = 'scheduled'
       AND a.scheduled_at >= CURRENT_DATE AND a.scheduled_at < CURRENT_DATE + interval '1 day'
     ORDER BY a.scheduled_at ASC LIMIT 8`,
    [tenantId]
  )
  if (!today.length) return
  await notifyTenant(
    tenantId,
    `🏥 <b>${name} — today's schedule</b>\n${today
      .map((a) => `• ${new Date(a.scheduled_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} — ${a.patient_name}${a.doctor_name ? ` (${a.doctor_name})` : ''}`)
      .join('\n')}`
  )
}

export async function runAlerts(): Promise<void> {
  if (!telegramEnabled()) return
  try {
    const tenants = await query<{ id: string; name: string; business_type: string }>(
      `SELECT id, name, business_type FROM tenants WHERE status IN ('trial','active')`
    )
    for (const t of tenants) {
      try {
        if (t.business_type === 'pharmacy' || t.business_type === 'store') await alertRetail(t.id, t.name)
        else if (t.business_type === 'school') await alertSchool(t.id, t.name)
        else if (t.business_type === 'hospital') await alertHospital(t.id, t.name)
      } catch (err) {
        console.warn(`[alerts] tenant ${t.name} failed:`, err instanceof Error ? err.message : err)
      }
    }
  } catch (err) {
    console.warn('[alerts] run failed:', err instanceof Error ? err.message : err)
  }
}

let timer: ReturnType<typeof setInterval> | null = null

export function startAlertScheduler(): void {
  if (!telegramEnabled() || timer) return
  console.log('[alerts] scheduler started (every 30 min)')
  void runAlerts() // initial pass shortly after boot
  timer = setInterval(() => void runAlerts(), 30 * 60 * 1000)
}

export function stopAlertScheduler(): void {
  if (timer) clearInterval(timer)
  timer = null
}
