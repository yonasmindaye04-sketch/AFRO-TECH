import { query, queryOne } from '../config/db.js'
import { sendNotification } from './notificationEngine.js'

/**
 * Teaching activity monitor â€” mirrors the alert scheduler pattern (alerts.ts).
 * Runs every 60s for every trial/active school tenant:
 *   1. Generates today's class sessions from timetable_slots (idempotent).
 *   2. Marks sessions LATE once scheduled_start + grace period passes with no check-in.
 *   3. Marks sessions ABSENT once scheduled_end passes with no check-in.
 *   4. Marks assigned activities OVERDUE once due_at passes.
 * Notifications go through the notification engine and are deduplicated
 * per session via teacher_session_notifications (survives restarts).
 */

const DEFAULT_GRACE_MINUTES = 10

export async function getGraceMinutes(tenantId: string): Promise<number> {
  const row = await queryOne<{ g: string | null }>(
    `SELECT data->'teaching'->>'grace_period_minutes' AS g FROM tenant_settings WHERE tenant_id = $1`,
    [tenantId]
  )
  const n = Number(row?.g)
  return Number.isFinite(n) && n >= 0 && n <= 120 ? Math.floor(n) : DEFAULT_GRACE_MINUTES
}

/**
 * Create class_sessions for every timetable slot scheduled on `date` that has
 * a teacher assigned. Slots without a teacher are skipped (nobody to track).
 * Idempotent via UNIQUE(timetable_slot_id, session_date).
 * Note: scheduled times are interpreted in the database server timezone.
 */
export async function generateSessions(tenantId: string, date: string): Promise<number> {
  const grace = await getGraceMinutes(tenantId)
  const res = await query<{ id: string }>(
    `INSERT INTO class_sessions
       (tenant_id, timetable_slot_id, teacher_id, class_id, subject, session_date,
        scheduled_start, scheduled_end, grace_period_minutes)
     SELECT s.tenant_id, s.id, s.teacher_id, s.class_id, s.subject, $2::date,
            ($2::date + s.start_time)::timestamptz,
            ($2::date + s.end_time)::timestamptz,
            $3
     FROM timetable_slots s
     WHERE s.tenant_id = $1
       AND s.teacher_id IS NOT NULL
       AND s.day_of_week = EXTRACT(ISODOW FROM $2::date)::smallint
     ON CONFLICT (timetable_slot_id, session_date) DO NOTHING
     RETURNING id`,
    [tenantId, date, grace]
  )
  return res.length
}

interface DueSession {
  id: string
  tenant_id: string
  teacher_id: string
  teacher_name: string
  teacher_user_id: string | null
  subject: string
  class_name: string
  scheduled_start: string
  grace_period_minutes: number
}

async function loadDueSessions(tenantId: string, kind: 'late' | 'absent'): Promise<DueSession[]> {
  const timeClause =
    kind === 'late'
      ? `cs.scheduled_start + (cs.grace_period_minutes || ' minutes')::interval < now()`
      : `cs.scheduled_end < now()`
  // A 'late' session whose whole period elapses without check-in must still
  // progress to 'absent' on a later sweep.
  const statusClause = kind === 'late' ? `cs.status = 'scheduled'` : `cs.status IN ('scheduled','late')`
  return query<DueSession>(
    `SELECT cs.id, cs.tenant_id, cs.teacher_id, tr.full_name AS teacher_name, tr.user_id AS teacher_user_id,
            cs.subject, c.name AS class_name, cs.scheduled_start::text, cs.grace_period_minutes
     FROM class_sessions cs
     JOIN teachers tr ON tr.id = cs.teacher_id
     JOIN classes c ON c.id = cs.class_id
     WHERE cs.tenant_id = $1 AND cs.session_date = CURRENT_DATE
       AND ${statusClause} AND ${timeClause}`,
    [tenantId]
  )
}

/** Insert dedup record; returns true when this is the first notification for the key. */
async function claimNotification(tenantId: string, sessionId: string, key: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO teacher_session_notifications (tenant_id, session_id, notification_key)
     VALUES ($1, $2, $3) ON CONFLICT (notification_key) DO NOTHING RETURNING id`,
    [tenantId, sessionId, key]
  )
  return row !== null
}

async function notifySession(tenantId: string, s: DueSession, code: string, data: Record<string, unknown>): Promise<number> {
  // Recipients: the teacher's linked account (if any) + every owner account.
  const owners = await query<{ id: string }>(
    `SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' AND is_active = true`,
    [tenantId]
  )
  const userIds = [...new Set([...owners.map((o) => o.id), ...(s.teacher_user_id ? [s.teacher_user_id] : [])])]
  if (userIds.length === 0) return 0
  // skipThrottle: per-session dedup is handled by teacher_session_notifications;
  // the engine's 12h tenant:code throttle would suppress alerts for different sessions.
  const res = await sendNotification({ tenantId, code, data, target: { userIds }, skipThrottle: true })
  return res.sent
}

/** Exported for testing; production callers use runTeachingMonitor(). */
export async function monitorTenant(tenantId: string): Promise<void> {
  await generateSessions(tenantId, new Date().toISOString().slice(0, 10))

  // â”€â”€ LATE: grace period passed, still no check-in â”€â”€
  for (const s of await loadDueSessions(tenantId, 'late')) {
    const minutesLate = Math.max(0, Math.floor((Date.now() - new Date(s.scheduled_start).getTime()) / 60000))
    const updated = await queryOne<{ id: string }>(
      `UPDATE class_sessions SET status = 'late', minutes_late = $2, updated_at = now()
       WHERE id = $1 AND status = 'scheduled' RETURNING id`,
      [s.id, minutesLate]
    )
    if (!updated) continue // another tick/start call beat us to it
    await query(
      `INSERT INTO teaching_activity_events (tenant_id, session_id, teacher_id, event_type, meta)
       VALUES ($1, $2, $3, 'session_marked_late', $4::jsonb)`,
      [tenantId, s.id, s.teacher_id, JSON.stringify({ minutes_late: minutesLate, auto: true })]
    )
    const key = `teacher-session-late-${s.id}`
    if (await claimNotification(tenantId, s.id, key)) {
      const sent = await notifySession(tenantId, s, 'teacher_session_late', {
        teacher_name: s.teacher_name,
        subject: s.subject,
        class_name: s.class_name,
        scheduled_time: new Date(s.scheduled_start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        grace_minutes: s.grace_period_minutes,
        minutes_late: minutesLate,
      })
      await query(`UPDATE teacher_session_notifications SET recipient_count = $2 WHERE notification_key = $1`, [key, sent])
    }
  }

  // â”€â”€ ABSENT: whole period elapsed with no check-in â”€â”€
  for (const s of await loadDueSessions(tenantId, 'absent')) {
    const updated = await queryOne<{ id: string }>(
      `UPDATE class_sessions SET status = 'absent', updated_at = now()
       WHERE id = $1 AND status IN ('scheduled','late') RETURNING id`,
      [s.id]
    )
    if (!updated) continue
    await query(
      `INSERT INTO teaching_activity_events (tenant_id, session_id, teacher_id, event_type, meta)
       VALUES ($1, $2, $3, 'session_marked_absent', $4::jsonb)`,
      [tenantId, s.id, s.teacher_id, JSON.stringify({ auto: true })]
    )
    const key = `teacher-session-absent-${s.id}`
    if (await claimNotification(tenantId, s.id, key)) {
      const sent = await notifySession(tenantId, s, 'teacher_session_absent', {
        teacher_name: s.teacher_name,
        subject: s.subject,
        class_name: s.class_name,
        scheduled_time: new Date(s.scheduled_start).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      })
      await query(`UPDATE teacher_session_notifications SET recipient_count = $2 WHERE notification_key = $1`, [key, sent])
    }
  }

  // â”€â”€ OVERDUE activities â”€â”€
  await query(
    `UPDATE teaching_activities SET status = 'overdue', updated_at = now()
     WHERE tenant_id = $1 AND status = 'assigned' AND due_at IS NOT NULL AND due_at < now()`,
    [tenantId]
  )
}

export async function runTeachingMonitor(): Promise<void> {
  try {
    const tenants = await query<{ id: string }>(
      `SELECT id FROM tenants WHERE status IN ('trial','active') AND business_type = 'school'`
    )
    for (const t of tenants) {
      try {
        await monitorTenant(t.id)
      } catch (err) {
        console.warn(`[teaching] tenant ${t.id} failed:`, err instanceof Error ? err.message : err)
      }
    }
  } catch (err) {
    console.warn('[teaching] monitor run failed:', err instanceof Error ? err.message : err)
  }
}

let timer: ReturnType<typeof setInterval> | null = null

export function startTeachingMonitor(): void {
  if (timer) return
  console.log('[teaching] monitor started (every 60s)')
  void runTeachingMonitor() // initial pass shortly after boot
  timer = setInterval(() => void runTeachingMonitor(), 60 * 1000)
}

export function stopTeachingMonitor(): void {
  if (timer) clearInterval(timer)
  timer = null
}

