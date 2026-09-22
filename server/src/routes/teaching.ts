import { Router } from 'express'
import type { Request } from 'express'
import { z } from 'zod'
import { query, queryOne } from '../config/db.js'
import { asyncHandler, AppError } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { authenticate, requireActiveTenant, requirePermission } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { generateSessions } from '../services/teachingMonitor.js'

const router = Router()
router.use(authenticate, requireActiveTenant)
const t = (req: { user?: { tenant_id: string | null } }) => req.user!.tenant_id as string

/* ── permission helpers (owner / afrotech_admin have everything) ── */
function hasPerm(req: Request, perm: string): boolean {
  return req.user?.role === 'owner' || req.user?.role === 'afrotech_admin' || !!req.permissions?.includes(perm)
}
function requireAny(req: Request, ...perms: string[]): void {
  if (!perms.some((p) => hasPerm(req, p))) {
    throw new AppError(403, `Permission denied: one of ${perms.join(', ')} required`, 'FORBIDDEN')
  }
}

/** Teacher record linked to the logged-in staff account, if any. */
async function teacherForUser(req: Request): Promise<{ id: string } | null> {
  return queryOne<{ id: string }>(`SELECT id FROM teachers WHERE tenant_id = $1 AND user_id = $2`, [t(req), req.user!.id])
}

async function addEvent(
  tenantId: string,
  opts: { sessionId?: string; activityId?: string; teacherId?: string | null; type: string; actorId?: string; meta?: unknown }
): Promise<void> {
  await query(
    `INSERT INTO teaching_activity_events (tenant_id, session_id, activity_id, teacher_id, event_type, actor_user_id, meta)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)`,
    [tenantId, opts.sessionId ?? null, opts.activityId ?? null, opts.teacherId ?? null, opts.type, opts.actorId ?? null, JSON.stringify(opts.meta ?? {})]
  )
}

/* ══════════════ SESSIONS ══════════════ */
router.get(
  '/sessions',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.view', 'teaching.own')
    const tid = t(req)
    const { date, from, to, teacher_id, class_id, status } = req.query as Record<string, string | undefined>
    let teacherFilter = teacher_id ?? null
    if (!hasPerm(req, 'teaching.view')) {
      const me = await teacherForUser(req)
      if (!me) return res.json({ sessions: [] }) // staff account not linked to a teacher record
      teacherFilter = me.id
    }
    const rows = await query(
      `SELECT cs.*, tr.full_name AS teacher_name, c.name AS class_name,
              st.full_name AS substitute_name
       FROM class_sessions cs
       JOIN teachers tr ON tr.id = cs.teacher_id
       JOIN classes c ON c.id = cs.class_id
       LEFT JOIN teachers st ON st.id = cs.substitute_teacher_id
       WHERE cs.tenant_id = $1
         AND cs.session_date = COALESCE($2::date, cs.session_date)
         AND cs.session_date >= COALESCE($3::date, cs.session_date)
         AND cs.session_date <= COALESCE($4::date, cs.session_date)
         AND ($5::uuid IS NULL OR cs.teacher_id = $5)
         AND ($6::uuid IS NULL OR cs.class_id = $6)
         AND ($7::text IS NULL OR cs.status = $7)
       ORDER BY cs.session_date DESC, cs.scheduled_start ASC
       LIMIT 500`,
      [tid, date ?? null, from ?? null, to ?? null, teacherFilter, class_id ?? null, status ?? null]
    )
    res.json({ sessions: rows })
  })
)

router.post(
  '/sessions/generate',
  requirePermission('teaching.manage'),
  asyncHandler(async (req, res) => {
    const date = typeof req.body?.date === 'string' ? req.body.date : new Date().toISOString().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new AppError(400, 'date must be YYYY-MM-DD', 'VALIDATION')
    const created = await generateSessions(t(req), date)
    res.json({ date, created })
  })
)

interface SessionRow {
  id: string
  tenant_id: string
  teacher_id: string
  status: string
  scheduled_start: string
  scheduled_end: string
  grace_period_minutes: number
  actual_start: string | null
  is_completed: boolean
}

async function loadSession(req: Request): Promise<SessionRow> {
  const s = await queryOne<SessionRow>(`SELECT * FROM class_sessions WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
  if (!s) throw new AppError(404, 'Session not found', 'NOT_FOUND')
  return s
}

/** Teacher check-in. Allowed while the session is scheduled or already flagged late. */
router.post(
  '/sessions/:id/start',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.own')
    const me = await teacherForUser(req)
    if (!me) throw new AppError(403, 'Your account is not linked to a teacher record', 'NOT_LINKED')
    const s = await loadSession(req)
    if (s.teacher_id !== me.id) throw new AppError(403, 'This session belongs to another teacher', 'FORBIDDEN')
    if (!['scheduled', 'late'].includes(s.status))
      throw new AppError(409, `Cannot start a session with status ${s.status}`, 'BAD_STATE')
    if (new Date() > new Date(s.scheduled_end))
      throw new AppError(409, 'This period has already ended — ask an administrator to update the record', 'PERIOD_OVER')

    const lateBy = Math.floor((Date.now() - new Date(s.scheduled_start).getTime()) / 60000)
    const isLate = lateBy > s.grace_period_minutes
    const status = isLate ? 'late' : 'present'
    const row = await queryOne(
      `UPDATE class_sessions
       SET actual_start = COALESCE(actual_start, now()), status = $2, minutes_late = $3, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [s.id, status, isLate ? lateBy : 0]
    )
    await addEvent(t(req), {
      sessionId: s.id, teacherId: s.teacher_id, type: 'session_started',
      actorId: req.user!.id, meta: { minutes_late: isLate ? lateBy : 0, status },
    })
    res.json({ session: row })
  })
)

/** Teacher marks the session finished. Server records the real end time. */
router.post(
  '/sessions/:id/complete',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.own')
    const me = await teacherForUser(req)
    if (!me) throw new AppError(403, 'Your account is not linked to a teacher record', 'NOT_LINKED')
    const s = await loadSession(req)
    if (s.teacher_id !== me.id) throw new AppError(403, 'This session belongs to another teacher', 'FORBIDDEN')
    if (!s.actual_start) throw new AppError(409, 'Start the session before completing it', 'BAD_STATE')
    if (s.is_completed) return res.json({ session: s }) // idempotent
    const row = await queryOne(
      `UPDATE class_sessions SET actual_end = now(), is_completed = true, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [s.id]
    )
    await addEvent(t(req), { sessionId: s.id, teacherId: s.teacher_id, type: 'session_completed', actorId: req.user!.id })
    res.json({ session: row })
  })
)

const overrideSchema = z.object({
  status: z.enum(['excused', 'cancelled', 'substituted', 'absent', 'present']),
  reason: z.string().trim().min(3).max(500),
  substitute_teacher_id: z.string().uuid().optional().nullable(),
})

/** Admin correction with mandatory reason — fully audited. */
router.post(
  '/sessions/:id/override',
  requirePermission('teaching.manage'),
  validateBody(overrideSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof overrideSchema>
    const s = await loadSession(req)
    if (d.status === 'substituted') {
      if (!d.substitute_teacher_id) throw new AppError(400, 'substitute_teacher_id is required for substituted sessions', 'VALIDATION')
      const sub = await queryOne(`SELECT id FROM teachers WHERE id = $1 AND tenant_id = $2`, [d.substitute_teacher_id, t(req)])
      if (!sub) throw new AppError(404, 'Substitute teacher not found', 'NOT_FOUND')
    }
    const row = await queryOne(
      `UPDATE class_sessions
       SET status = $2, status_reason = $3, substitute_teacher_id = $4, updated_at = now()
       WHERE id = $1 RETURNING *`,
      [s.id, d.status, d.reason, d.status === 'substituted' ? d.substitute_teacher_id : null]
    )
    await addEvent(t(req), {
      sessionId: s.id, teacherId: s.teacher_id, type: 'session_overridden',
      actorId: req.user!.id, meta: { from: s.status, to: d.status, reason: d.reason },
    })
    logAudit({
      tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name,
      action: 'session_override', entity: 'class_session', entityId: s.id,
      details: { from: s.status, to: d.status, reason: d.reason },
    })
    res.json({ session: row })
  })
)

router.get(
  '/sessions/:id/events',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.view', 'teaching.manage')
    const rows = await query(
      `SELECT e.*, u.full_name AS actor_name FROM teaching_activity_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.session_id = $1 AND e.tenant_id = $2 ORDER BY e.created_at ASC`,
      [req.params.id, t(req)]
    )
    res.json({ events: rows })
  })
)

/** Link a teacher record to a staff login account (enables teacher self-service). */
router.post(
  '/teachers/:id/link-account',
  requirePermission('teaching.manage'),
  validateBody(z.object({ user_id: z.string().uuid().nullable() })),
  asyncHandler(async (req, res) => {
    const { user_id } = req.body as { user_id: string | null }
    if (user_id) {
      const u = await queryOne(`SELECT id FROM users WHERE id = $1 AND tenant_id = $2 AND is_active = true`, [user_id, t(req)])
      if (!u) throw new AppError(404, 'User not found in this workspace', 'NOT_FOUND')
    }
    const row = await queryOne(
      `UPDATE teachers SET user_id = $2 WHERE id = $1 AND tenant_id = $3 RETURNING *`,
      [req.params.id, user_id, t(req)]
    )
    if (!row) throw new AppError(404, 'Teacher not found', 'NOT_FOUND')
    logAudit({
      tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name,
      action: 'teacher_account_linked', entity: 'teacher', entityId: req.params.id, details: { user_id },
    })
    res.json({ teacher: row })
  })
)

/* ══════════════ ACTIVITIES ══════════════ */
router.get(
  '/activities',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.view', 'teaching.own')
    const tid = t(req)
    const { teacher_id, class_id, status, type, from, to } = req.query as Record<string, string | undefined>
    let teacherFilter = teacher_id ?? null
    if (!hasPerm(req, 'teaching.view')) {
      const me = await teacherForUser(req)
      if (!me) return res.json({ activities: [] })
      teacherFilter = me.id
    }
    const rows = await query(
      `SELECT a.*, tr.full_name AS teacher_name, c.name AS class_name,
              (SELECT count(*) FROM activity_submissions s WHERE s.activity_id = a.id)::int AS submission_count,
              (SELECT count(*) FROM activity_submissions s WHERE s.activity_id = a.id AND s.status IN ('submitted','graded'))::int AS submitted_count
       FROM teaching_activities a
       JOIN teachers tr ON tr.id = a.teacher_id
       JOIN classes c ON c.id = a.class_id
       WHERE a.tenant_id = $1
         AND ($2::uuid IS NULL OR a.teacher_id = $2)
         AND ($3::uuid IS NULL OR a.class_id = $3)
         AND ($4::text IS NULL OR a.status = $4)
         AND ($5::text IS NULL OR a.type = $5)
         AND a.created_at >= COALESCE($6::date, a.created_at)
         AND a.created_at < COALESCE(($7::date + interval '1 day'), a.created_at + interval '1 day')
       ORDER BY a.created_at DESC LIMIT 500`,
      [tid, teacherFilter, class_id ?? null, status ?? null, type ?? null, from ?? null, to ?? null]
    )
    res.json({ activities: rows })
  })
)

const activitySchema = z.object({
  class_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(120),
  type: z.enum(['classwork', 'homework', 'quiz', 'exercise', 'assignment', 'project', 'reading', 'practical', 'exam', 'other']),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  session_id: z.string().uuid().optional().nullable(),
  due_at: z.string().datetime({ offset: true }).optional().nullable(),
  max_score: z.number().min(0).max(10000).optional().nullable(),
  teacher_id: z.string().uuid().optional(), // admins only; teachers always log as themselves
})

router.post(
  '/activities',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.own', 'teaching.manage')
    const d = req.body as z.infer<typeof activitySchema>
    const tid = t(req)
    let teacherId: string
    if (d.teacher_id && hasPerm(req, 'teaching.manage')) {
      teacherId = d.teacher_id
    } else {
      const me = await teacherForUser(req)
      if (!me) throw new AppError(403, 'Your account is not linked to a teacher record', 'NOT_LINKED')
      teacherId = me.id
    }
    const cls = await queryOne(`SELECT id FROM classes WHERE id = $1 AND tenant_id = $2`, [d.class_id, tid])
    if (!cls) throw new AppError(404, 'Class not found', 'NOT_FOUND')
    if (d.session_id) {
      const sess = await queryOne(`SELECT id FROM class_sessions WHERE id = $1 AND tenant_id = $2 AND teacher_id = $3`, [d.session_id, tid, teacherId])
      if (!sess) throw new AppError(404, 'Session not found for this teacher', 'NOT_FOUND')
    }
    const row = await queryOne(
      `INSERT INTO teaching_activities (tenant_id, session_id, teacher_id, class_id, subject, type, title, description, due_at, max_score, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tid, d.session_id ?? null, teacherId, d.class_id, d.subject, d.type, d.title, d.description ?? null, d.due_at ?? null, d.max_score ?? null, req.user!.id]
    )
    await addEvent(tid, { activityId: (row as { id: string }).id, sessionId: d.session_id ?? undefined, teacherId, type: 'activity_created', actorId: req.user!.id, meta: { title: d.title, type: d.type } })
    res.status(201).json({ activity: row })
  })
)

interface ActivityRow {
  id: string
  tenant_id: string
  teacher_id: string
  class_id: string
  status: string
}

async function loadActivity(req: Request): Promise<ActivityRow> {
  const a = await queryOne<ActivityRow>(`SELECT * FROM teaching_activities WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
  if (!a) throw new AppError(404, 'Activity not found', 'NOT_FOUND')
  return a
}

/** Teachers may only touch their own activities; managers may touch any. */
async function assertActivityAccess(req: Request, a: ActivityRow): Promise<void> {
  if (hasPerm(req, 'teaching.manage')) return
  const me = await teacherForUser(req)
  if (!me || me.id !== a.teacher_id) throw new AppError(403, 'This activity belongs to another teacher', 'FORBIDDEN')
}

/** Assign to the whole class roster: creates one pending submission per active student. */
router.post(
  '/activities/:id/assign',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.own', 'teaching.manage')
    const a = await loadActivity(req)
    await assertActivityAccess(req, a)
    if (!['draft', 'assigned'].includes(a.status)) throw new AppError(409, `Cannot assign an activity with status ${a.status}`, 'BAD_STATE')
    const dueAt = typeof req.body?.due_at === 'string' ? req.body.due_at : null
    const row = await queryOne(
      `UPDATE teaching_activities
       SET status = 'assigned', assigned_at = COALESCE(assigned_at, now()),
           due_at = COALESCE($2::timestamptz, due_at), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [a.id, dueAt]
    )
    await query(
      `INSERT INTO activity_submissions (tenant_id, activity_id, student_id)
       SELECT $1, $2, s.id FROM students s
       WHERE s.tenant_id = $1 AND s.class_id = $3 AND s.status = 'active'
       ON CONFLICT (activity_id, student_id) DO NOTHING`,
      [t(req), a.id, a.class_id]
    )
    await addEvent(t(req), { activityId: a.id, teacherId: a.teacher_id, type: 'activity_assigned', actorId: req.user!.id, meta: { due_at: dueAt } })
    res.json({ activity: row })
  })
)

const activityPatchSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(2000).optional().nullable(),
  due_at: z.string().datetime({ offset: true }).optional().nullable(),
  max_score: z.number().min(0).max(10000).optional().nullable(),
  status: z.enum(['completed', 'cancelled']).optional(),
})

router.patch(
  '/activities/:id',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.own', 'teaching.manage')
    const a = await loadActivity(req)
    await assertActivityAccess(req, a)
    const d = req.body as z.infer<typeof activityPatchSchema>
    const row = await queryOne(
      `UPDATE teaching_activities SET
         title = COALESCE($2, title),
         description = COALESCE($3, description),
         due_at = COALESCE($4::timestamptz, due_at),
         max_score = COALESCE($5, max_score),
         status = COALESCE($6, status),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [a.id, d.title ?? null, d.description ?? null, d.due_at ?? null, d.max_score ?? null, d.status ?? null]
    )
    await addEvent(t(req), { activityId: a.id, teacherId: a.teacher_id, type: 'activity_updated', actorId: req.user!.id, meta: d })
    res.json({ activity: row })
  })
)

router.get(
  '/activities/:id/submissions',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.view', 'teaching.own')
    const a = await loadActivity(req)
    if (!hasPerm(req, 'teaching.view')) await assertActivityAccess(req, a)
    const rows = await query(
      `SELECT sub.*, st.full_name AS student_name, st.code AS student_code
       FROM activity_submissions sub
       JOIN students st ON st.id = sub.student_id
       WHERE sub.activity_id = $1 AND sub.tenant_id = $2
       ORDER BY st.full_name ASC`,
      [a.id, t(req)]
    )
    res.json({ activity: a, submissions: rows })
  })
)

const submissionBulkSchema = z.object({
  entries: z
    .array(
      z.object({
        student_id: z.string().uuid(),
        status: z.enum(['pending', 'submitted', 'graded', 'missing', 'excused']),
        score: z.number().min(0).max(10000).optional().nullable(),
        feedback: z.string().trim().max(1000).optional().nullable(),
      })
    )
    .min(1)
    .max(500),
})

/** Bulk-record submissions (e.g. mark the whole class at once). Upserts per student. */
router.post(
  '/activities/:id/submissions/bulk',
  validateBody(submissionBulkSchema),
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.own', 'teaching.manage')
    const a = await loadActivity(req)
    await assertActivityAccess(req, a)
    const { entries } = req.body as z.infer<typeof submissionBulkSchema>
    let upserted = 0
    for (const e of entries) {
      const row = await queryOne(
        `INSERT INTO activity_submissions (tenant_id, activity_id, student_id, status, score, feedback, submitted_at, graded_at)
         SELECT $1, $2, s.id, $4, $5, $6,
                CASE WHEN $4 = 'submitted' THEN now() END,
                CASE WHEN $4 = 'graded' THEN now() END
         FROM students s WHERE s.id = $3 AND s.tenant_id = $1
         ON CONFLICT (activity_id, student_id) DO UPDATE SET
           status = EXCLUDED.status,
           score = COALESCE(EXCLUDED.score, activity_submissions.score),
           feedback = COALESCE(EXCLUDED.feedback, activity_submissions.feedback),
           submitted_at = COALESCE(activity_submissions.submitted_at, EXCLUDED.submitted_at),
           graded_at = COALESCE(activity_submissions.graded_at, EXCLUDED.graded_at),
           updated_at = now()
         RETURNING id`,
        [t(req), a.id, e.student_id, e.status, e.score ?? null, e.feedback ?? null]
      )
      if (row) upserted++
    }
    await addEvent(t(req), { activityId: a.id, teacherId: a.teacher_id, type: 'submissions_recorded', actorId: req.user!.id, meta: { count: upserted } })
    res.json({ upserted })
  })
)

/* ══════════════ EXPECTATIONS ══════════════ */
router.get(
  '/expectations',
  asyncHandler(async (req, res) => {
    requireAny(req, 'teaching.view', 'teaching.manage', 'teaching.own')
    const rows = await query(
      `SELECT e.*, c.name AS class_name, u.full_name AS created_by_name
       FROM activity_expectations e
       LEFT JOIN classes c ON c.id = e.class_id
       LEFT JOIN users u ON u.id = e.created_by
       WHERE e.tenant_id = $1
       ORDER BY c.name NULLS FIRST, e.subject NULLS FIRST, e.activity_type`,
      [t(req)]
    )
    res.json({ expectations: rows })
  })
)

const expectationSchema = z.object({
  class_id: z.string().uuid().optional().nullable(),
  subject: z.string().trim().max(120).optional().nullable(),
  activity_type: z
    .enum(['any', 'classwork', 'homework', 'quiz', 'exercise', 'assignment', 'project', 'reading', 'practical', 'exam', 'other'])
    .default('any'),
  per_class_count: z.number().int().min(0).max(100).default(0),
  per_week_count: z.number().int().min(0).max(500).default(0),
})

/** Upsert by scope (class + subject + type); the NULL scope is the school-wide default. */
router.post(
  '/expectations',
  requirePermission('teaching.manage'),
  validateBody(expectationSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof expectationSchema>
    const tid = t(req)
    if (d.class_id) {
      const cls = await queryOne(`SELECT id FROM classes WHERE id = $1 AND tenant_id = $2`, [d.class_id, tid])
      if (!cls) throw new AppError(404, 'Class not found', 'NOT_FOUND')
    }
    const subject = d.subject?.trim() || null
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM activity_expectations
       WHERE tenant_id = $1 AND class_id IS NOT DISTINCT FROM $2
         AND subject IS NOT DISTINCT FROM $3 AND activity_type = $4`,
      [tid, d.class_id ?? null, subject, d.activity_type]
    )
    const row = existing
      ? await queryOne(
          `UPDATE activity_expectations SET per_class_count = $2, per_week_count = $3, updated_at = now()
           WHERE id = $1 RETURNING *`,
          [existing.id, d.per_class_count, d.per_week_count]
        )
      : await queryOne(
          `INSERT INTO activity_expectations (tenant_id, class_id, subject, activity_type, per_class_count, per_week_count, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
          [tid, d.class_id ?? null, subject, d.activity_type, d.per_class_count, d.per_week_count, req.user!.id]
        )
    logAudit({
      tenantId: tid, userId: req.user!.id, userName: req.user!.full_name,
      action: existing ? 'expectation_updated' : 'expectation_created', entity: 'activity_expectation',
      entityId: (row as { id: string }).id, details: d,
    })
    res.status(existing ? 200 : 201).json({ expectation: row })
  })
)

router.delete(
  '/expectations/:id',
  requirePermission('teaching.manage'),
  asyncHandler(async (req, res) => {
    const row = await queryOne(`DELETE FROM activity_expectations WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, t(req)])
    if (!row) throw new AppError(404, 'Expectation not found', 'NOT_FOUND')
    res.json({ deleted: true })
  })
)

/* ══════════════ REPORTS (admin) ══════════════ */
function range(req: Request): { from: string; to: string } {
  const q = req.query as Record<string, string | undefined>
  const to = q.to && /^\d{4}-\d{2}-\d{2}$/.test(q.to) ? q.to : new Date().toISOString().slice(0, 10)
  const from =
    q.from && /^\d{4}-\d{2}-\d{2}$/.test(q.from) ? q.from : new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)
  return { from, to }
}

router.get(
  '/reports/overview',
  requirePermission('teaching.view'),
  asyncHandler(async (req, res) => {
    const { from, to } = range(req)
    const tid = t(req)
    const sessions = await queryOne(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'present')::int AS present,
              count(*) FILTER (WHERE status = 'late')::int AS late,
              count(*) FILTER (WHERE status = 'absent')::int AS absent,
              count(*) FILTER (WHERE status IN ('excused','cancelled','substituted'))::int AS excused,
              count(*) FILTER (WHERE status = 'scheduled')::int AS scheduled,
              COALESCE(avg(minutes_late) FILTER (WHERE status = 'late'), 0)::float AS avg_minutes_late,
              count(*) FILTER (WHERE is_completed)::int AS completed
       FROM class_sessions WHERE tenant_id = $1 AND session_date BETWEEN $2 AND $3`,
      [tid, from, to]
    )
    const activities = await queryOne(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE status = 'assigned')::int AS assigned,
              count(*) FILTER (WHERE status = 'completed')::int AS completed,
              count(*) FILTER (WHERE status = 'overdue')::int AS overdue
       FROM teaching_activities WHERE tenant_id = $1 AND created_at::date BETWEEN $2 AND $3`,
      [tid, from, to]
    )
    const subs = await queryOne(
      `SELECT count(*)::int AS total,
              count(*) FILTER (WHERE sub.status IN ('submitted','graded'))::int AS done
       FROM activity_submissions sub
       JOIN teaching_activities a ON a.id = sub.activity_id
       WHERE sub.tenant_id = $1 AND a.created_at::date BETWEEN $2 AND $3`,
      [tid, from, to]
    )
    const s = sessions as unknown as { present: number; late: number; absent: number }
    const held = s.present + s.late + s.absent
    res.json({
      period: { from, to },
      sessions,
      activities,
      submissions: subs,
      on_time_pct: held > 0 ? Math.round((s.present / held) * 100) : null,
    })
  })
)

router.get(
  '/reports/teachers',
  requirePermission('teaching.view'),
  asyncHandler(async (req, res) => {
    const { from, to } = range(req)
    const rows = await query(
      `SELECT tr.id AS teacher_id, tr.full_name AS teacher_name,
              count(cs.id)::int AS sessions,
              count(cs.id) FILTER (WHERE cs.status = 'present')::int AS present,
              count(cs.id) FILTER (WHERE cs.status = 'late')::int AS late,
              count(cs.id) FILTER (WHERE cs.status = 'absent')::int AS absent,
              count(cs.id) FILTER (WHERE cs.status IN ('excused','cancelled','substituted'))::int AS excused,
              COALESCE(avg(cs.minutes_late) FILTER (WHERE cs.status = 'late'), 0)::float AS avg_minutes_late,
              (SELECT count(*) FROM teaching_activities a
                WHERE a.tenant_id = $1 AND a.teacher_id = tr.id AND a.created_at::date BETWEEN $2 AND $3)::int AS activities,
              (SELECT count(*) FROM teaching_activities a
                WHERE a.tenant_id = $1 AND a.teacher_id = tr.id AND a.status = 'overdue')::int AS overdue_activities
       FROM teachers tr
       LEFT JOIN class_sessions cs ON cs.teacher_id = tr.id AND cs.tenant_id = tr.tenant_id AND cs.session_date BETWEEN $2 AND $3
       WHERE tr.tenant_id = $1
       GROUP BY tr.id, tr.full_name
       ORDER BY late DESC, absent DESC, tr.full_name ASC`,
      [t(req), from, to]
    )
    res.json({ period: { from, to }, teachers: rows })
  })
)

router.get(
  '/reports/teachers/:id',
  requirePermission('teaching.view'),
  asyncHandler(async (req, res) => {
    const { from, to } = range(req)
    const tid = t(req)
    const teacher = await queryOne(
      `SELECT tr.*, u.email AS linked_email, u.full_name AS linked_user_name
       FROM teachers tr LEFT JOIN users u ON u.id = tr.user_id
       WHERE tr.id = $1 AND tr.tenant_id = $2`,
      [req.params.id, tid]
    )
    if (!teacher) throw new AppError(404, 'Teacher not found', 'NOT_FOUND')
    const sessions = await query(
      `SELECT cs.*, c.name AS class_name
       FROM class_sessions cs JOIN classes c ON c.id = cs.class_id
       WHERE cs.tenant_id = $1 AND cs.teacher_id = $2 AND cs.session_date BETWEEN $3 AND $4
       ORDER BY cs.session_date DESC, cs.scheduled_start DESC LIMIT 200`,
      [tid, req.params.id, from, to]
    )
    const activities = await query(
      `SELECT a.*, c.name AS class_name,
              (SELECT count(*) FROM activity_submissions s WHERE s.activity_id = a.id)::int AS submission_count,
              (SELECT count(*) FROM activity_submissions s WHERE s.activity_id = a.id AND s.status IN ('submitted','graded'))::int AS submitted_count
       FROM teaching_activities a JOIN classes c ON c.id = a.class_id
       WHERE a.tenant_id = $1 AND a.teacher_id = $2
       ORDER BY a.created_at DESC LIMIT 100`,
      [tid, req.params.id]
    )
    const events = await query(
      `SELECT e.*, u.full_name AS actor_name FROM teaching_activity_events e
       LEFT JOIN users u ON u.id = e.actor_user_id
       WHERE e.tenant_id = $1 AND e.teacher_id = $2
       ORDER BY e.created_at DESC LIMIT 50`,
      [tid, req.params.id]
    )
    res.json({ teacher, sessions, activities, events, period: { from, to } })
  })
)

/** Watch list: teachers with any late/absent session in the period or overdue activities. */
router.get(
  '/reports/attention',
  requirePermission('teaching.view'),
  asyncHandler(async (req, res) => {
    const { from, to } = range(req)
    const rows = await query(
      `SELECT tr.id AS teacher_id, tr.full_name AS teacher_name,
              count(cs.id) FILTER (WHERE cs.status = 'late')::int AS late_sessions,
              count(cs.id) FILTER (WHERE cs.status = 'absent')::int AS absent_sessions,
              COALESCE(max(cs.minutes_late) FILTER (WHERE cs.status = 'late'), 0)::int AS worst_delay_minutes,
              (SELECT count(*) FROM teaching_activities a
                WHERE a.tenant_id = $1 AND a.teacher_id = tr.id AND a.status = 'overdue')::int AS overdue_activities,
              (SELECT max(e.created_at) FROM teaching_activity_events e
                WHERE e.tenant_id = $1 AND e.teacher_id = tr.id AND e.event_type IN ('session_late','session_absent')) AS last_incident_at
       FROM teachers tr
       JOIN class_sessions cs ON cs.teacher_id = tr.id AND cs.tenant_id = tr.tenant_id AND cs.session_date BETWEEN $2 AND $3
       WHERE tr.tenant_id = $1
       GROUP BY tr.id, tr.full_name
       HAVING count(cs.id) FILTER (WHERE cs.status IN ('late','absent')) > 0
          OR (SELECT count(*) FROM teaching_activities a
                WHERE a.tenant_id = $1 AND a.teacher_id = tr.id AND a.status = 'overdue') > 0
       ORDER BY absent_sessions DESC, late_sessions DESC, tr.full_name ASC`,
      [t(req), from, to]
    )
    res.json({ period: { from, to }, attention: rows })
  })
)

export default router

