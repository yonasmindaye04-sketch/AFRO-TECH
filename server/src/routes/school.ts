import { Router } from 'express'
import { z } from 'zod'
import { pool, query, queryOne } from '../config/db.js'
import { asyncHandler, AppError, nextCode, withTransaction } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { authenticate, requireActiveTenant, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()
router.use(authenticate, requireActiveTenant)
const t = (req: { user?: { tenant_id: string | null } }) => req.user!.tenant_id as string

interface ReportCard {
  student_id: string
  code: string
  name: string
  subjects: { subject: string; pct: number; exams: number }[]
  total: number
  average: number
  grade: string
  attendance_pct: number | null
  rank: number
}

/* ══════════════ TEACHERS ══════════════ */
const teacherSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  subject: z.string().trim().max(120).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
})
router.get(
  '/teachers',
  asyncHandler(async (req, res) => {
    res.json({ teachers: await query(`SELECT * FROM teachers WHERE tenant_id = $1 ORDER BY full_name ASC`, [t(req)]) })
  })
)
router.post(
  '/teachers',
  validateBody(teacherSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof teacherSchema>
    const row = await queryOne(
      `INSERT INTO teachers (tenant_id, full_name, subject, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [t(req), d.full_name, d.subject ?? null, d.phone ?? null, d.email ?? null]
    )
    res.status(201).json({ teacher: row })
  })
)

/* ══════════════ CLASSES ══════════════ */
const classSchema = z.object({
  name: z.string().trim().min(1).max(80),
  academic_year: z.string().trim().max(20).default('2025/2026'),
  homeroom_teacher_id: z.string().uuid().optional().nullable(),
})
router.get(
  '/classes',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT c.*, tr.full_name AS homeroom_teacher,
              (SELECT count(*) FROM students s WHERE s.class_id = c.id AND s.status='active')::int AS student_count
       FROM classes c LEFT JOIN teachers tr ON tr.id = c.homeroom_teacher_id
       WHERE c.tenant_id = $1 ORDER BY c.name ASC`,
      [t(req)]
    )
    res.json({ classes: rows })
  })
)
router.post(
  '/classes',
  validateBody(classSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof classSchema>
    const dup = await queryOne(`SELECT id FROM classes WHERE tenant_id = $1 AND name = $2 AND academic_year = $3`, [
      t(req),
      d.name,
      d.academic_year,
    ])
    if (dup) throw new AppError(409, 'A class with this name already exists for the year', 'DUPLICATE')
    const row = await queryOne(
      `INSERT INTO classes (tenant_id, name, academic_year, homeroom_teacher_id) VALUES ($1,$2,$3,$4) RETURNING *`,
      [t(req), d.name, d.academic_year, d.homeroom_teacher_id ?? null]
    )
    res.status(201).json({ class: row })
  })
)

/* ══════════════ STUDENTS ══════════════ */
const studentSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  gender: z.enum(['male', 'female']),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  class_id: z.string().uuid().optional().nullable(),
  guardian_name: z.string().trim().max(160).optional().nullable(),
  guardian_phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
})
router.get(
  '/students',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [t(req)]
    let where = `WHERE s.tenant_id = $1`
    if (req.query.class_id) {
      params.push(String(req.query.class_id))
      where += ` AND s.class_id = $${params.length}`
    }
    if (req.query.search) {
      params.push(`%${String(req.query.search)}%`)
      where += ` AND (s.first_name ILIKE $${params.length} OR s.last_name ILIKE $${params.length} OR s.code ILIKE $${params.length})`
    }
    const rows = await query(
      `SELECT s.*, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id
       ${where} ORDER BY s.first_name ASC LIMIT 500`,
      params
    )
    res.json({ students: rows })
  })
)
router.post(
  '/students',
  validateBody(studentSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof studentSchema>
    const row = await withTransaction(pool, async (client) => {
      const code = await nextCode(client, 'students', 'STU', t(req))
      const r = await client.query(
        `INSERT INTO students (tenant_id, code, first_name, last_name, gender, dob, class_id, guardian_name, guardian_phone, address)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [t(req), code, d.first_name, d.last_name, d.gender, d.dob || null, d.class_id ?? null, d.guardian_name ?? null, d.guardian_phone ?? null, d.address ?? null]
      )
      return r.rows[0]
    })
    res.status(201).json({ student: row })
  })
)
router.patch(
  '/students/:id',
  validateBody(studentSchema.partial()),
  asyncHandler(async (req, res) => {
    const cur = await queryOne(`SELECT * FROM students WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!cur) throw new AppError(404, 'Student not found', 'NOT_FOUND')
    const d = req.body as Partial<z.infer<typeof studentSchema>> & { status?: string }
    const row = await queryOne(
      `UPDATE students SET first_name=$3, last_name=$4, gender=$5, dob=$6, class_id=$7,
              guardian_name=$8, guardian_phone=$9, address=$10, status=COALESCE($11, status)
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        req.params.id, t(req), d.first_name ?? cur.first_name, d.last_name ?? cur.last_name, d.gender ?? cur.gender,
        d.dob ?? cur.dob, d.class_id ?? cur.class_id, d.guardian_name ?? cur.guardian_name,
        d.guardian_phone ?? cur.guardian_phone, d.address ?? cur.address, (d as { status?: string }).status ?? cur.status,
      ]
    )
    res.json({ student: row })
  })
)

/* ══════════════ ATTENDANCE ══════════════ */
const attendanceSchema = z.object({
  class_id: z.string().uuid(),
  att_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  entries: z.array(z.object({ student_id: z.string().uuid(), status: z.enum(['present', 'absent', 'late', 'excused']) })).min(1),
})
router.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const classId = String(req.query.class_id || '')
    const date = String(req.query.date || new Date().toISOString().slice(0, 10))
    if (!classId) throw new AppError(400, 'class_id is required', 'VALIDATION')
    const roster = await query(
      `SELECT s.id AS student_id, s.code, s.first_name, s.last_name,
              a.status, a.att_date
       FROM students s
       LEFT JOIN attendance a ON a.student_id = s.id AND a.att_date = $3
       WHERE s.tenant_id = $1 AND s.class_id = $2 AND s.status = 'active'
       ORDER BY s.first_name ASC`,
      [t(req), classId, date]
    )
    res.json({ roster, date })
  })
)
/** POST — upsert a full day's register for one class */
router.post(
  '/attendance',
  validateBody(attendanceSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof attendanceSchema>
    await withTransaction(pool, async (client) => {
      for (const e of d.entries) {
        await client.query(
          `INSERT INTO attendance (tenant_id, student_id, class_id, att_date, status, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (student_id, att_date) DO UPDATE SET status = EXCLUDED.status, recorded_by = EXCLUDED.recorded_by`,
          [t(req), e.student_id, d.class_id, d.att_date, e.status, req.user!.id]
        )
      }
    })
    res.status(201).json({ ok: true })
  })
)
router.get(
  '/attendance/summary',
  asyncHandler(async (req, res) => {
    const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
    const to = String(req.query.to || new Date().toISOString().slice(0, 10))
    const rows = await query<{ status: string; n: string }>(
      `SELECT status, count(*) AS n FROM attendance WHERE tenant_id = $1 AND att_date BETWEEN $2 AND $3 GROUP BY status`,
      [t(req), from, to]
    )
    res.json({ summary: Object.fromEntries(rows.map((r) => [r.status, Number(r.n)])) })
  })
)

/* ══════════════ GRADES ══════════════ */
const gradeBase = z.object({
  student_id: z.string().uuid(),
  subject: z.string().trim().min(1).max(80),
  exam_type: z.enum(['test', 'assignment', 'mid', 'final']).default('test'),
  term: z.string().trim().max(40).default('Semester 1'),
  score: z.number().min(0),
  max_score: z.number().min(1).default(100),
})
const gradeSchema = gradeBase.refine((g) => g.score <= g.max_score, { message: 'Score cannot be greater than the maximum score' })
router.get(
  '/grades',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [t(req)]
    let where = `WHERE g.tenant_id = $1`
    if (req.query.student_id) {
      params.push(String(req.query.student_id))
      where += ` AND g.student_id = $${params.length}`
    }
    if (req.query.class_id) {
      params.push(String(req.query.class_id))
      where += ` AND g.class_id = $${params.length}`
    }
    if (req.query.subject) {
      params.push(String(req.query.subject))
      where += ` AND g.subject = $${params.length}`
    }
    const rows = await query(
      `SELECT g.*, s.first_name || ' ' || s.last_name AS student_name, s.code AS student_code, c.name AS class_name
       FROM grades g JOIN students s ON s.id = g.student_id LEFT JOIN classes c ON c.id = g.class_id
       ${where} ORDER BY g.created_at DESC LIMIT 400`,
      params
    )
    res.json({ grades: rows })
  })
)
/** POST /grades/bulk — record grades for a whole class at once */
router.post(
  '/grades/bulk',
  validateBody(
    z.object({
      entries: z
        .array(gradeBase.extend({ class_id: z.string().uuid().optional() }))
        .min(1)
        .refine((entries) => entries.every((e) => e.score <= e.max_score), { message: 'A score exceeds its maximum' }),
    })
  ),
  asyncHandler(async (req, res) => {
    const { entries } = req.body as { entries: (z.infer<typeof gradeSchema> & { class_id?: string })[] }
    await withTransaction(pool, async (client) => {
      for (const e of entries) {
        await client.query(
          `INSERT INTO grades (tenant_id, student_id, class_id, subject, exam_type, term, score, max_score, recorded_by)
           VALUES ($1,$2,(SELECT class_id FROM students WHERE id = $2),$3,$4,$5,$6,$7,$8)
           ON CONFLICT (student_id, subject, exam_type, term)
           DO UPDATE SET score = EXCLUDED.score, max_score = EXCLUDED.max_score, recorded_by = EXCLUDED.recorded_by`,
          [t(req), e.student_id, e.subject, e.exam_type, e.term, e.score, e.max_score, req.user!.id]
        )
      }
    })
    res.status(201).json({ ok: true, saved: entries.length })
  })
)

/* ══════════════ FEES ══════════════ */
const feeSchema = z.object({
  student_ids: z.array(z.string().uuid()).min(1),
  title: z.string().trim().min(1).max(160),
  amount: z.number().min(0.01),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
})
router.get(
  '/fees',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [t(req)]
    let where = `WHERE f.tenant_id = $1`
    if (req.query.status && ['unpaid', 'partial', 'paid'].includes(String(req.query.status))) {
      params.push(String(req.query.status))
      where += ` AND f.status = $${params.length}`
    }
    if (req.query.student_id) {
      params.push(String(req.query.student_id))
      where += ` AND f.student_id = $${params.length}`
    }
    const rows = await query(
      `SELECT f.*, s.first_name || ' ' || s.last_name AS student_name, s.code AS student_code, c.name AS class_name
       FROM fees f JOIN students s ON s.id = f.student_id LEFT JOIN classes c ON c.id = s.class_id
       ${where} ORDER BY f.created_at DESC LIMIT 400`,
      params
    )
    res.json({ fees: rows })
  })
)
/** POST /fees — assign a fee to one or many students (e.g. whole class tuition) */
router.post(
  '/fees',
  validateBody(feeSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof feeSchema>
    let created = 0
    await withTransaction(pool, async (client) => {
      for (const sid of d.student_ids) {
        await client.query(`INSERT INTO fees (tenant_id, student_id, title, amount, due_date) VALUES ($1,$2,$3,$4,$5)`, [
          t(req),
          sid,
          d.title,
          d.amount,
          d.due_date || null,
        ])
        created++
      }
    })
    res.status(201).json({ ok: true, created })
  })
)
router.patch(
  '/fees/:id/pay',
  validateBody(z.object({ amount: z.number().min(0.01) })),
  asyncHandler(async (req, res) => {
    const row = await queryOne(
      `UPDATE fees SET paid_amount = LEAST(amount, paid_amount + $3),
              status = CASE WHEN paid_amount + $3 >= amount THEN 'paid' ELSE 'partial' END,
              paid_at = CASE WHEN paid_amount + $3 >= amount THEN now() ELSE NULL END
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t(req), req.body.amount]
    )
    if (!row) throw new AppError(404, 'Fee not found', 'NOT_FOUND')
    logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'fee.payment', entity: 'fee', entityId: req.params.id, details: { amount: req.body.amount } })
    res.json({ fee: row })
  })
)

/* ══════════════ SUBJECTS ══════════════ */

router.get(
  '/subjects',
  asyncHandler(async (req, res) => {
    res.json({ subjects: await query(`SELECT * FROM subjects WHERE tenant_id = $1 ORDER BY name ASC`, [t(req)]) })
  })
)
router.post(
  '/subjects',
  validateBody(z.object({ name: z.string().trim().min(1).max(80) })),
  asyncHandler(async (req, res) => {
    const row = await queryOne(`INSERT INTO subjects (tenant_id, name) VALUES ($1,$2) RETURNING *`, [t(req), (req.body as { name: string }).name])
    res.status(201).json({ subject: row })
  })
)
router.delete(
  '/subjects/:id',
  asyncHandler(async (req, res) => {
    const row = await queryOne(`DELETE FROM subjects WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, t(req)])
    if (!row) throw new AppError(404, 'Subject not found', 'NOT_FOUND')
    res.json({ ok: true })
  })
)

/* ══════════════ TIMETABLE ══════════════ */

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

router.get(
  '/timetable',
  asyncHandler(async (req, res) => {
    const classId = String(req.query.class_id || '')
    if (!classId) throw new AppError(400, 'class_id is required', 'VALIDATION')
    const cls = await queryOne(`SELECT id, name FROM classes WHERE id = $1 AND tenant_id = $2`, [classId, t(req)])
    if (!cls) throw new AppError(404, 'Class not found', 'NOT_FOUND')
    const rows = await query(
      `SELECT s.*, tr.full_name AS teacher_name FROM timetable_slots s LEFT JOIN teachers tr ON tr.id = s.teacher_id
       WHERE s.tenant_id = $1 AND s.class_id = $2 ORDER BY s.day_of_week ASC, s.start_time ASC`,
      [t(req), classId]
    )
    res.json({ class: cls, slots: rows, days: DAYS })
  })
)

const slotSchema = z.object({
  class_id: z.string().uuid(),
  day_of_week: z.number().int().min(1).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  subject: z.string().trim().min(1).max(80),
  teacher_id: z.string().uuid().optional().nullable(),
})
router.post(
  '/timetable',
  validateBody(slotSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof slotSchema>
    if (d.end_time <= d.start_time) throw new AppError(400, 'End time must be after start time', 'VALIDATION')
    const row = await queryOne(
      `INSERT INTO timetable_slots (tenant_id, class_id, day_of_week, start_time, end_time, subject, teacher_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [t(req), d.class_id, d.day_of_week, d.start_time, d.end_time, d.subject, d.teacher_id ?? null]
    )
    res.status(201).json({ slot: row })
  })
)
router.delete(
  '/timetable/:id',
  asyncHandler(async (req, res) => {
    const row = await queryOne(`DELETE FROM timetable_slots WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, t(req)])
    if (!row) throw new AppError(404, 'Slot not found', 'NOT_FOUND')
    res.json({ ok: true })
  })
)

/* ══════════════ REPORT CARDS ══════════════ */

/** GET /report-cards?class_id&term — computed per-student results with class rank */
router.get(
  '/report-cards',
  asyncHandler(async (req, res) => {
    const classId = String(req.query.class_id || '')
    const term = String(req.query.term || 'Semester 1')
    if (!classId) throw new AppError(400, 'class_id is required', 'VALIDATION')

    const cls = await queryOne(
      `SELECT c.*, tr.full_name AS homeroom_teacher FROM classes c LEFT JOIN teachers tr ON tr.id = c.homeroom_teacher_id
       WHERE c.id = $1 AND c.tenant_id = $2`,
      [classId, t(req)]
    )
    if (!cls) throw new AppError(404, 'Class not found', 'NOT_FOUND')

    // Per-student per-subject: percentage-weighted average across exam types in the term
    const subjectRows = await query<{ student_id: string; student_code: string; student_name: string; subject: string; avg_pct: string; exams: string }>(
      `SELECT g.student_id, s.code AS student_code, s.first_name || ' ' || s.last_name AS student_name,
              g.subject,
              ROUND(SUM(g.score) / NULLIF(SUM(g.max_score),0) * 100, 1)::text AS avg_pct,
              count(*)::text AS exams
       FROM grades g JOIN students s ON s.id = g.student_id
       WHERE g.tenant_id = $1 AND g.class_id = $2 AND g.term = $3
       GROUP BY g.student_id, s.code, s.first_name, s.last_name, g.subject`,
      [t(req), classId, term]
    )
    const attendanceRows = await query<{ student_id: string; present: string; total: string }>(
      `SELECT student_id,
              SUM((status='present')::int)::text AS present,
              count(*)::text AS total
       FROM attendance WHERE tenant_id = $1 AND class_id = $2 AND att_date >= date_trunc('month', CURRENT_DATE)
       GROUP BY student_id`,
      [t(req), classId]
    )
    const attMap = new Map(attendanceRows.map((r) => [r.student_id, r]))
    const byStudent = new Map<string, { code: string; name: string; subjects: { subject: string; pct: number; exams: number }[] }>()
    for (const r of subjectRows) {
      if (!byStudent.has(r.student_id)) byStudent.set(r.student_id, { code: r.student_code, name: r.student_name, subjects: [] })
      byStudent.get(r.student_id)!.subjects.push({ subject: r.subject, pct: Number(r.avg_pct), exams: Number(r.exams) })
    }
    const cards = [...byStudent.entries()].map(([id, v]) => {
      const total = v.subjects.reduce((s, x) => s + x.pct, 0)
      const average = v.subjects.length ? total / v.subjects.length : 0
      const att = attMap.get(id)
      const card: ReportCard = {
        student_id: id,
        code: v.code,
        name: v.name,
        subjects: v.subjects.sort((a, b) => a.subject.localeCompare(b.subject)),
        total: Math.round(total * 10) / 10,
        average: Math.round(average * 10) / 10,
        grade: average >= 90 ? 'A' : average >= 80 ? 'B' : average >= 70 ? 'C' : average >= 60 ? 'D' : average >= 50 ? 'D' : 'F',
        attendance_pct: att && Number(att.total) > 0 ? Math.round((Number(att.present) / Number(att.total)) * 100) : null,
        rank: 0,
      }
      return card
    })
    cards.sort((a, b) => b.average - a.average)
    cards.forEach((c, i) => {
      c.rank = i + 1
    })
    res.json({ class: cls, term, students: cards })
  })
)

/* ══════════════ ANNOUNCEMENTS ══════════════ */

router.get(
  '/announcements',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT a.*, u.full_name AS posted_by FROM announcements a LEFT JOIN users u ON u.id = a.created_by
       WHERE a.tenant_id = $1 ORDER BY a.pinned DESC, a.created_at DESC LIMIT 50`,
      [t(req)]
    )
    res.json({ announcements: rows })
  })
)
router.post(
  '/announcements',
  validateBody(z.object({ title: z.string().trim().min(2).max(160), body: z.string().trim().min(2).max(3000), pinned: z.boolean().default(false) })),
  asyncHandler(async (req, res) => {
    const d = req.body as { title: string; body: string; pinned: boolean }
    const row = await queryOne(
      `INSERT INTO announcements (tenant_id, title, body, pinned, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [t(req), d.title, d.body, d.pinned, req.user!.id]
    )
    res.status(201).json({ announcement: row })
  })
)
router.delete(
  '/announcements/:id',
  asyncHandler(async (req, res) => {
    const row = await queryOne(`DELETE FROM announcements WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, t(req)])
    if (!row) throw new AppError(404, 'Announcement not found', 'NOT_FOUND')
    res.json({ ok: true })
  })
)

/* ══════════════ YEAR-END PROMOTION ══════════════ */

const promoteSchema = z.object({
  from_class_id: z.string().uuid(),
  to_class_id: z.string().uuid().nullable(), // null = graduate out
})
/** POST /students/promote — move a whole cohort at year end (or graduate them) */
router.post(
  '/students/promote',
  requireRole('owner'),
  validateBody(promoteSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof promoteSchema>
    const tid = t(req)
    const result = await withTransaction(pool, async (client) => {
      if (d.to_class_id) {
        const target = await client.query(`SELECT id FROM classes WHERE id = $1 AND tenant_id = $2`, [d.to_class_id, tid])
        if (!target.rows.length) throw new AppError(404, 'Target class not found', 'NOT_FOUND')
      }
      const r = await client.query<{ id: string }>(
        d.to_class_id
          ? `UPDATE students SET class_id = $2 WHERE tenant_id = $1 AND class_id = $3 AND status = 'active' RETURNING id`
          : `UPDATE students SET class_id = NULL, status = 'graduated' WHERE tenant_id = $1 AND class_id = $3 AND status = 'active' RETURNING id`,
        [tid, d.to_class_id, d.from_class_id]
      )
      return r.rows.length
    })
    logAudit({ tenantId: tid, userId: req.user!.id, userName: req.user!.full_name, action: 'students.promote', entity: 'class', entityId: d.from_class_id, details: { to: d.to_class_id, moved: result } })
    res.json({ moved: result })
  })
)

/* ══════════════ REPORTS ══════════════ */

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const tid = t(req)
    const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
    const to = String(req.query.to || new Date().toISOString().slice(0, 10))

    const collectionByClass = await query<{ class_name: string; billed: string; collected: string }>(
      `SELECT COALESCE(c.name,'Unassigned') AS class_name, SUM(f.amount)::text AS billed, SUM(f.paid_amount)::text AS collected
       FROM fees f JOIN students s ON s.id = f.student_id LEFT JOIN classes c ON c.id = s.class_id
       WHERE f.tenant_id = $1 AND f.created_at >= $2::date AND f.created_at < ($3::date + interval '1 day')
       GROUP BY c.name ORDER BY SUM(f.amount) DESC`,
      [tid, from, to]
    )
    const defaulters = await query<{ student_name: string; student_code: string; class_name: string | null; due: string }>(
      `SELECT s.first_name || ' ' || s.last_name AS student_name, s.code AS student_code, c.name AS class_name,
              SUM(f.amount - f.paid_amount)::text AS due
       FROM fees f JOIN students s ON s.id = f.student_id LEFT JOIN classes c ON c.id = s.class_id
       WHERE f.tenant_id = $1 AND f.status != 'paid'
       GROUP BY s.id, s.first_name, s.last_name, s.code, c.name
       HAVING SUM(f.amount - f.paid_amount) > 0.001
       ORDER BY SUM(f.amount - f.paid_amount) DESC LIMIT 50`,
      [tid]
    )
    const monthlyCollection = await query<{ month: string; collected: string }>(
      `SELECT to_char(d.month, 'Mon YYYY') AS month, COALESCE(SUM(f.paid_amount),0)::text AS collected
       FROM generate_series(date_trunc('month', CURRENT_DATE) - interval '5 months', date_trunc('month', CURRENT_DATE), interval '1 month') d(month)
       LEFT JOIN fees f ON f.tenant_id = $1 AND f.paid_at >= d.month AND f.paid_at < d.month + interval '1 month'
       GROUP BY d.month ORDER BY d.month`,
      [tid]
    )
    const attendanceByClass = await query<{ class_name: string; pct: string }>(
      `SELECT COALESCE(c.name,'Unassigned') AS class_name,
              ROUND(SUM((a.status='present')::int) * 100.0 / NULLIF(count(*),0), 1)::text AS pct
       FROM attendance a JOIN students s ON s.id = a.student_id LEFT JOIN classes c ON c.id = s.class_id
       WHERE a.tenant_id = $1 AND a.att_date >= $2::date AND a.att_date <= $3::date
       GROUP BY c.name ORDER BY c.name NULLS LAST`,
      [tid, from, to]
    )
    const subjectAverages = await query<{ subject: string; avg_pct: string; n: string }>(
      `SELECT subject, ROUND(SUM(score) / NULLIF(SUM(max_score),0) * 100, 1)::text AS avg_pct, count(*)::text AS n
       FROM grades WHERE tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')
       GROUP BY subject ORDER BY subject`,
      [tid, from, to]
    )
    const totals = await queryOne<{ billed: string; collected: string; outstanding: string }>(
      `SELECT COALESCE(SUM(amount),0)::text AS billed, COALESCE(SUM(paid_amount),0)::text AS collected,
              COALESCE(SUM(amount - paid_amount),0)::text AS outstanding
       FROM fees WHERE tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
      [tid, from, to]
    )
    res.json({
      period: { from, to },
      totals: { billed: Number(totals?.billed ?? 0), collected: Number(totals?.collected ?? 0), outstanding: Number(totals?.outstanding ?? 0) },
      collection_by_class: collectionByClass.map((r) => ({ class: r.class_name, billed: Number(r.billed), collected: Number(r.collected) })),
      defaulters: defaulters.map((r) => ({ name: r.student_name, code: r.student_code, class: r.class_name, due: Number(r.due) })),
      monthly_collection: monthlyCollection.map((r) => ({ month: r.month, collected: Number(r.collected) })),
      attendance_by_class: attendanceByClass.map((r) => ({ class: r.class_name, pct: Number(r.pct) })),
      subject_averages: subjectAverages.map((r) => ({ subject: r.subject, avg: Number(r.avg_pct), entries: Number(r.n) })),
    })
  })
)

/* ══════════════ DASHBOARD ══════════════ */
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const tid = t(req)
    const stats = await queryOne<{ students: string; classes: string; teachers: string; attendance_today: string | null; unpaid_fees: string | null; collected_month: string | null }>(
      `SELECT
        (SELECT count(*) FROM students WHERE tenant_id = $1 AND status='active')::text AS students,
        (SELECT count(*) FROM classes WHERE tenant_id = $1)::text AS classes,
        (SELECT count(*) FROM teachers WHERE tenant_id = $1)::text AS teachers,
        (SELECT COALESCE(SUM((status='present')::int) * 100.0 / GREATEST(count(*),1), 0)
                FROM attendance WHERE tenant_id = $1 AND att_date = CURRENT_DATE)::text AS attendance_today,
        (SELECT COALESCE(SUM(amount - paid_amount),0) FROM fees WHERE tenant_id = $1 AND status != 'paid')::text AS unpaid_fees,
        (SELECT COALESCE(SUM(paid_amount),0) FROM fees WHERE tenant_id = $1 AND paid_at >= date_trunc('month', CURRENT_DATE))::text AS collected_month`,
      [tid]
    )
    const attendanceTrend = await query<{ day: string; pct: string }>(
      `SELECT to_char(d.day,'MM-DD') AS day,
              COALESCE(SUM((a.status='present')::int) * 100.0 / GREATEST(count(a.id),1), 0)::text AS pct
       FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') d(day)
       LEFT JOIN attendance a ON a.tenant_id = $1 AND a.att_date = d.day::date
       GROUP BY d.day ORDER BY d.day`,
      [tid]
    )
    const classOverview = await query<{ name: string; students: number }>(
      `SELECT c.name, (SELECT count(*) FROM students s WHERE s.class_id = c.id AND s.status='active')::int AS students
       FROM classes c WHERE c.tenant_id = $1 ORDER BY c.name LIMIT 12`,
      [tid]
    )
    const recentStudents = await query(
      `SELECT s.*, c.name AS class_name FROM students s LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.tenant_id = $1 ORDER BY s.created_at DESC LIMIT 6`,
      [tid]
    )
    res.json({
      stats: {
        students: Number(stats?.students ?? 0),
        classes: Number(stats?.classes ?? 0),
        teachers: Number(stats?.teachers ?? 0),
        attendance_today: Math.round(Number(stats?.attendance_today ?? 0)),
        unpaid_fees: Number(stats?.unpaid_fees ?? 0),
        collected_this_month: Number(stats?.collected_month ?? 0),
      },
      attendance_trend: attendanceTrend.map((r) => ({ day: r.day, pct: Math.round(Number(r.pct)) })),
      class_overview: classOverview,
      recent_students: recentStudents,
    })
  })
)

export default router
