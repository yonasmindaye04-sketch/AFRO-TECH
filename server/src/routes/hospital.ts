import { Router } from 'express'
import { z } from 'zod'
import { pool, query, queryOne } from '../config/db.js'
import { asyncHandler, AppError, nextCode, withTransaction } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { authenticate, requireActiveTenant } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()
router.use(authenticate, requireActiveTenant)
const t = (req: { user?: { tenant_id: string | null } }) => req.user!.tenant_id as string

/* ══════════════ PATIENTS ══════════════ */
const patientSchema = z.object({
  first_name: z.string().trim().min(1).max(80),
  last_name: z.string().trim().min(1).max(80),
  gender: z.enum(['male', 'female']),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  phone: z.string().trim().max(40).optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  blood_type: z.string().trim().max(8).optional().nullable(),
  allergies: z.string().trim().max(500).optional().nullable(),
})

router.get(
  '/patients',
  asyncHandler(async (req, res) => {
    const search = String(req.query.search || '').trim()
    const params: unknown[] = [t(req)]
    let where = `WHERE tenant_id = $1`
    if (search) {
      params.push(`%${search}%`)
      where += ` AND (first_name ILIKE $${params.length} OR last_name ILIKE $${params.length} OR code ILIKE $${params.length} OR phone ILIKE $${params.length})`
    }
    const rows = await query(`SELECT * FROM patients ${where} ORDER BY created_at DESC LIMIT 300`, params)
    res.json({ patients: rows })
  })
)

router.post(
  '/patients',
  validateBody(patientSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof patientSchema>
    const row = await withTransaction(pool, async (client) => {
      const code = await nextCode(client, 'patients', 'PAT', t(req))
      const r = await client.query(
        `INSERT INTO patients (tenant_id, code, first_name, last_name, gender, dob, phone, address, blood_type, allergies)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [t(req), code, d.first_name, d.last_name, d.gender, d.dob || null, d.phone ?? null, d.address ?? null, d.blood_type ?? null, d.allergies ?? null]
      )
      return r.rows[0]
    })
    res.status(201).json({ patient: row })
  })
)

router.get(
  '/patients/:id',
  asyncHandler(async (req, res) => {
    const patient = await queryOne(`SELECT * FROM patients WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!patient) throw new AppError(404, 'Patient not found', 'NOT_FOUND')
    const records = await query(`SELECT * FROM medical_records WHERE patient_id = $1 ORDER BY visit_date DESC LIMIT 50`, [req.params.id])
    const appointments = await query(
      `SELECT a.*, d.full_name AS doctor_name FROM appointments a LEFT JOIN doctors d ON d.id = a.doctor_id
       WHERE a.patient_id = $1 ORDER BY a.scheduled_at DESC LIMIT 20`,
      [req.params.id]
    )
    const invoices = await query(`SELECT * FROM invoices WHERE patient_id = $1 ORDER BY issued_on DESC LIMIT 20`, [req.params.id])
    res.json({ patient, records, appointments, invoices })
  })
)

/* ══════════════ DOCTORS ══════════════ */
const doctorSchema = z.object({
  full_name: z.string().trim().min(2).max(120),
  specialty: z.string().trim().max(120).default('General'),
  phone: z.string().trim().max(40).optional().nullable(),
  fee: z.number().min(0).default(0),
})
router.get(
  '/doctors',
  asyncHandler(async (req, res) => {
    res.json({ doctors: await query(`SELECT * FROM doctors WHERE tenant_id = $1 ORDER BY full_name ASC`, [t(req)]) })
  })
)
router.post(
  '/doctors',
  validateBody(doctorSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof doctorSchema>
    const row = await queryOne(
      `INSERT INTO doctors (tenant_id, full_name, specialty, phone, fee) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [t(req), d.full_name, d.specialty, d.phone ?? null, d.fee]
    )
    res.status(201).json({ doctor: row })
  })
)

/* ══════════════ APPOINTMENTS ══════════════ */
const apptSchema = z.object({
  patient_id: z.string().uuid(),
  doctor_id: z.string().uuid().optional().nullable(),
  scheduled_at: z.string(), // ISO datetime
  reason: z.string().trim().max(300).optional().nullable(),
  notes: z.string().trim().max(1000).optional().nullable(),
  status: z.enum(['scheduled', 'completed', 'cancelled', 'no_show']).optional(),
})
router.get(
  '/appointments',
  asyncHandler(async (req, res) => {
    const scope = String(req.query.scope || 'upcoming')
    const params: unknown[] = [t(req)]
    let where = `WHERE a.tenant_id = $1`
    if (scope === 'today') where += ` AND a.scheduled_at >= CURRENT_DATE AND a.scheduled_at < CURRENT_DATE + interval '1 day'`
    else if (scope === 'upcoming') where += ` AND a.scheduled_at >= now() - interval '2 hours'`
    const rows = await query(
      `SELECT a.*, p.first_name || ' ' || p.last_name AS patient_name, p.code AS patient_code, d.full_name AS doctor_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN doctors d ON d.id = a.doctor_id
       ${where} ORDER BY a.scheduled_at ${scope === 'past' ? 'DESC' : 'ASC'} LIMIT 200`,
      params
    )
    res.json({ appointments: rows })
  })
)
router.post(
  '/appointments',
  validateBody(apptSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof apptSchema>
    const when = new Date(d.scheduled_at)
    if (Number.isNaN(when.getTime())) throw new AppError(400, 'Invalid appointment date/time', 'VALIDATION')
    const row = await queryOne(
      `INSERT INTO appointments (tenant_id, patient_id, doctor_id, scheduled_at, reason, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [t(req), d.patient_id, d.doctor_id ?? null, when.toISOString(), d.reason ?? null, d.notes ?? null]
    )
    res.status(201).json({ appointment: row })
  })
)
router.patch(
  '/appointments/:id',
  validateBody(apptSchema.partial()),
  asyncHandler(async (req, res) => {
    const d = req.body as Partial<z.infer<typeof apptSchema>>
    const cur = await queryOne(`SELECT * FROM appointments WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!cur) throw new AppError(404, 'Appointment not found', 'NOT_FOUND')
    const row = await queryOne(
      `UPDATE appointments SET status=$3, notes=$4, scheduled_at=COALESCE($5, scheduled_at), doctor_id=COALESCE($6, doctor_id)
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [req.params.id, t(req), d.status ?? cur.status, d.notes ?? cur.notes, d.scheduled_at ? new Date(d.scheduled_at).toISOString() : null, d.doctor_id ?? null]
    )
    res.json({ appointment: row })
  })
)

/* ══════════════ MEDICAL RECORDS ══════════════ */
const recordSchema = z.object({
  patient_id: z.string().uuid(),
  doctor_name: z.string().trim().max(120).optional().nullable(),
  visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  diagnosis: z.string().trim().max(1000).optional().nullable(),
  prescription: z.string().trim().max(2000).optional().nullable(),
  notes: z.string().trim().max(2000).optional().nullable(),
  vitals: z
    .object({
      bp: z.string().trim().max(20).optional(),
      temperature: z.string().trim().max(10).optional(),
      pulse: z.string().trim().max(10).optional(),
      weight: z.string().trim().max(10).optional(),
      height: z.string().trim().max(10).optional(),
      spo2: z.string().trim().max(10).optional(),
    })
    .optional()
    .nullable(),
})
router.get(
  '/records',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [t(req)]
    let where = `WHERE r.tenant_id = $1`
    if (req.query.patient_id) {
      params.push(String(req.query.patient_id))
      where += ` AND r.patient_id = $${params.length}`
    }
    const rows = await query(
      `SELECT r.*, p.first_name || ' ' || p.last_name AS patient_name, p.code AS patient_code
       FROM medical_records r JOIN patients p ON p.id = r.patient_id
       ${where} ORDER BY r.visit_date DESC LIMIT 200`,
      params
    )
    res.json({ records: rows })
  })
)
router.post(
  '/records',
  validateBody(recordSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof recordSchema>
    const row = await queryOne(
      `INSERT INTO medical_records (tenant_id, patient_id, doctor_name, visit_date, diagnosis, prescription, notes, vitals)
       VALUES ($1,$2,$3,COALESCE($4::date, CURRENT_DATE),$5,$6,$7,$8::jsonb) RETURNING *`,
      [t(req), d.patient_id, d.doctor_name ?? null, d.visit_date ?? null, d.diagnosis ?? null, d.prescription ?? null, d.notes ?? null, d.vitals ? JSON.stringify(d.vitals) : null]
    )
    res.status(201).json({ record: row })
  })
)

/* ══════════════ BILLING ══════════════ */
const invoiceSchema = z.object({
  patient_id: z.string().uuid().optional().nullable(),
  description: z.string().trim().max(500).optional().nullable(),
  amount: z.number().min(0.01),
  paid_amount: z.number().min(0).default(0),
  issued_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
router.get(
  '/invoices',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [t(req)]
    let where = `WHERE i.tenant_id = $1`
    if (req.query.status && ['unpaid', 'partial', 'paid'].includes(String(req.query.status))) {
      params.push(String(req.query.status))
      where += ` AND i.status = $${params.length}`
    }
    const rows = await query(
      `SELECT i.*, p.first_name || ' ' || p.last_name AS patient_name FROM invoices i
       LEFT JOIN patients p ON p.id = i.patient_id ${where} ORDER BY i.created_at DESC LIMIT 200`,
      params
    )
    res.json({ invoices: rows })
  })
)
router.post(
  '/invoices',
  validateBody(invoiceSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof invoiceSchema>
    const row = await withTransaction(pool, async (client) => {
      const number = await nextCode(client, 'invoices', 'INV', t(req))
      const status = d.paid_amount >= d.amount ? 'paid' : d.paid_amount > 0 ? 'partial' : 'unpaid'
      const r = await client.query(
        `INSERT INTO invoices (tenant_id, patient_id, number, description, amount, paid_amount, status, issued_on)
         VALUES ($1,$2,$3,$4,$5,$6,$7,COALESCE($8::date, CURRENT_DATE)) RETURNING *`,
        [t(req), d.patient_id ?? null, number, d.description ?? null, d.amount, d.paid_amount, status, d.issued_on ?? null]
      )
      return r.rows[0]
    })
    res.status(201).json({ invoice: row })
  })
)
router.patch(
  '/invoices/:id/pay',
  validateBody(z.object({ amount: z.number().min(0.01) })),
  asyncHandler(async (req, res) => {
    const row = await queryOne<{ amount: string; paid_amount: string }>(
      `UPDATE invoices SET paid_amount = LEAST(amount, paid_amount + $3),
              status = CASE WHEN paid_amount + $3 >= amount THEN 'paid' ELSE 'partial' END
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t(req), req.body.amount]
    )
    if (!row) throw new AppError(404, 'Invoice not found', 'NOT_FOUND')
    logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'invoice.payment', entity: 'invoice', entityId: req.params.id, details: { amount: req.body.amount } })
    res.json({ invoice: row })
  })
)

/* ══════════════ QUEUE (today's patient flow) ══════════════ */

router.get(
  '/queue',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT a.id, a.status, a.scheduled_at, a.reason, a.notes,
              p.id AS patient_id, p.first_name || ' ' || p.last_name AS patient_name, p.code AS patient_code, p.phone,
              d.full_name AS doctor_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN doctors d ON d.id = a.doctor_id
       WHERE a.tenant_id = $1 AND a.scheduled_at >= CURRENT_DATE AND a.scheduled_at < CURRENT_DATE + interval '1 day'
       ORDER BY (a.status = 'in_service') DESC, (a.status='scheduled') DESC, a.scheduled_at ASC`,
      [t(req)]
    )
    res.json({ queue: rows })
  })
)

/** POST /queue/walk-in — register an immediate walk-in consultation */
router.post(
  '/queue/walk-in',
  validateBody(z.object({ patient_id: z.string().uuid(), doctor_id: z.string().uuid().optional().nullable(), reason: z.string().trim().max(300).optional().nullable() })),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof apptSchema>
    const row = await queryOne(
      `INSERT INTO appointments (tenant_id, patient_id, doctor_id, scheduled_at, reason, status) VALUES ($1,$2,$3,now(),$4,'in_service') RETURNING *`,
      [t(req), d.patient_id, d.doctor_id ?? null, d.reason ?? null]
    )
    res.status(201).json({ appointment: row })
  })
)

/* ══════════════ LAB TESTS ══════════════ */

const LAB_CATALOG = [
  { name: 'CBC (Complete Blood Count)', normal_range: 'Hb 12-16 g/dL, WBC 4-11 ×10⁹/L', price: 350 },
  { name: 'Malaria RDT', normal_range: 'Negative', price: 150 },
  { name: 'Blood Glucose (Fasting)', normal_range: '70-100 mg/dL', price: 120 },
  { name: 'Blood Glucose (Random)', normal_range: '70-140 mg/dL', price: 120 },
  { name: 'Urinalysis', normal_range: 'No protein, glucose or blood', price: 200 },
  { name: 'Stool Analysis', normal_range: 'No parasites or ova', price: 200 },
  { name: 'HIV Screening', normal_range: 'Non-reactive', price: 250 },
  { name: 'Pregnancy Test (hCG)', normal_range: 'Negative', price: 150 },
  { name: 'Widal Test', normal_range: 'Negative (<1:80)', price: 300 },
  { name: 'Liver Function Test', normal_range: 'ALT 7-56 U/L, AST 10-40 U/L', price: 800 },
  { name: 'Kidney Function Test', normal_range: 'Creatinine 0.6-1.2 mg/dL', price: 800 },
  { name: 'Blood Group & Rh', normal_range: '—', price: 150 },
  { name: 'Lipid Profile', normal_range: 'TC <200 mg/dL, LDL <100 mg/dL', price: 900 },
  { name: 'Typhoid (IgG/IgM)', normal_range: 'Negative', price: 450 },
  { name: 'H. Pylori Stool Antigen', normal_range: 'Negative', price: 500 },
]

router.get(
  '/labs/catalog',
  asyncHandler(async (_req, res) => {
    res.json({ catalog: LAB_CATALOG })
  })
)

router.get(
  '/labs',
  asyncHandler(async (req, res) => {
    const params: unknown[] = [t(req)]
    let where = `WHERE l.tenant_id = $1`
    if (req.query.status && ['ordered', 'sample_collected', 'resulted', 'cancelled'].includes(String(req.query.status))) {
      params.push(String(req.query.status))
      where += ` AND l.status = $${params.length}`
    }
    if (req.query.patient_id) {
      params.push(String(req.query.patient_id))
      where += ` AND l.patient_id = $${params.length}`
    }
    const rows = await query(
      `SELECT l.*, p.first_name || ' ' || p.last_name AS patient_name, p.code AS patient_code
       FROM lab_tests l JOIN patients p ON p.id = l.patient_id
       ${where} ORDER BY l.created_at DESC LIMIT 200`,
      params
    )
    res.json({ labs: rows })
  })
)

const labSchema = z.object({
  patient_id: z.string().uuid(),
  test_name: z.string().trim().min(1).max(160),
  normal_range: z.string().trim().max(300).optional().nullable(),
  price: z.number().min(0).default(0),
  notes: z.string().trim().max(500).optional().nullable(),
})
router.post(
  '/labs',
  validateBody(labSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof labSchema>
    const row = await queryOne(
      `INSERT INTO lab_tests (tenant_id, patient_id, test_name, normal_range, price, notes, ordered_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [t(req), d.patient_id, d.test_name, d.normal_range ?? null, d.price, d.notes ?? null, req.user!.id]
    )
    logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'lab.order', entity: 'lab_test', entityId: row!.id, details: { test: d.test_name } })
    res.status(201).json({ lab: row })
  })
)

const labResultSchema = z.object({
  status: z.enum(['ordered', 'sample_collected', 'resulted', 'cancelled']).optional(),
  result: z.string().trim().max(2000).optional().nullable(),
})
router.patch(
  '/labs/:id',
  validateBody(labResultSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof labResultSchema>
    const cur = await queryOne(`SELECT status FROM lab_tests WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!cur) throw new AppError(404, 'Lab test not found', 'NOT_FOUND')
    const row = await queryOne(
      `UPDATE lab_tests SET status = $3, result = COALESCE($4, result), resulted_at = CASE WHEN $3 = 'resulted' THEN now() ELSE resulted_at END
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t(req), d.status ?? cur.status, d.result ?? null]
    )
    if (d.status === 'resulted') logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'lab.result', entity: 'lab_test', entityId: req.params.id })
    res.json({ lab: row })
  })
)

/* ══════════════ REPORTS ══════════════ */

router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const tid = t(req)
    const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
    const to = String(req.query.to || new Date().toISOString().slice(0, 10))
    const range = `created_at >= $2::date AND created_at < ($3::date + interval '1 day')`

    const apptStats = await queryOne<{ total: string; completed: string; cancelled: string; no_show: string }>(
      `SELECT count(*) AS total,
              count(*) FILTER (WHERE status='completed')::text AS completed,
              count(*) FILTER (WHERE status='cancelled')::text AS cancelled,
              count(*) FILTER (WHERE status='no_show')::text AS no_show
       FROM appointments WHERE tenant_id = $1 AND scheduled_at >= $2::date AND scheduled_at < ($3::date + interval '1 day')`,
      [tid, from, to]
    )
    const billing = await queryOne<{ billed: string; collected: string; outstanding: string; invoices: string }>(
      `SELECT COALESCE(SUM(amount),0)::text AS billed, COALESCE(SUM(paid_amount),0)::text AS collected,
              COALESCE(SUM(amount - paid_amount),0)::text AS outstanding, count(*)::text AS invoices
       FROM invoices WHERE tenant_id = $1 AND issued_on BETWEEN $2::date AND $3::date`,
      [tid, from, to]
    )
    const newPatients = await queryOne<{ n: string }>(
      `SELECT count(*)::text AS n FROM patients WHERE tenant_id = $1 AND ${range.replace(/created_at/g, 'created_at')}`,
      [tid, from, to]
    )
    const topDiagnoses = await query<{ diagnosis: string; n: string }>(
      `SELECT diagnosis, count(*)::text AS n FROM medical_records
       WHERE tenant_id = $1 AND visit_date BETWEEN $2::date AND $3::date AND diagnosis IS NOT NULL AND diagnosis != ''
       GROUP BY diagnosis ORDER BY count(*) DESC LIMIT 10`,
      [tid, from, to]
    )
    const labStats = await queryOne<{ ordered: string; resulted: string; revenue: string }>(
      `SELECT count(*) FILTER (WHERE status != 'cancelled')::text AS ordered,
              count(*) FILTER (WHERE status = 'resulted')::text AS resulted,
              COALESCE(SUM(price) FILTER (WHERE status = 'resulted'),0)::text AS revenue
       FROM lab_tests WHERE tenant_id = $1 AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')`,
      [tid, from, to]
    )
    const doctorLoad = await query<{ doctor_name: string; seen: string }>(
      `SELECT COALESCE(d.full_name,'Unassigned') AS doctor_name, count(*)::text AS seen
       FROM appointments a LEFT JOIN doctors d ON d.id = a.doctor_id
       WHERE a.tenant_id = $1 AND a.status='completed' AND a.scheduled_at >= $2::date AND a.scheduled_at < ($3::date + interval '1 day')
       GROUP BY d.full_name ORDER BY count(*) DESC`,
      [tid, from, to]
    )
    res.json({
      period: { from, to },
      appointments: {
        total: Number(apptStats?.total ?? 0),
        completed: Number(apptStats?.completed ?? 0),
        cancelled: Number(apptStats?.cancelled ?? 0),
        no_show: Number(apptStats?.no_show ?? 0),
      },
      billing: {
        billed: Number(billing?.billed ?? 0),
        collected: Number(billing?.collected ?? 0),
        outstanding: Number(billing?.outstanding ?? 0),
        invoices: Number(billing?.invoices ?? 0),
      },
      new_patients: Number(newPatients?.n ?? 0),
      top_diagnoses: topDiagnoses.map((r) => ({ diagnosis: r.diagnosis, count: Number(r.n) })),
      labs: { ordered: Number(labStats?.ordered ?? 0), resulted: Number(labStats?.resulted ?? 0), revenue: Number(labStats?.revenue ?? 0) },
      doctor_load: doctorLoad.map((r) => ({ doctor: r.doctor_name, seen: Number(r.seen) })),
    })
  })
)

/* ══════════════ DASHBOARD ══════════════ */
router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const tid = t(req)
    const stats = await queryOne<{ patients: string; today_appts: string; upcoming: string; unpaid: string | null; revenue_month: string | null }>(
      `SELECT
        (SELECT count(*) FROM patients WHERE tenant_id = $1)::text AS patients,
        (SELECT count(*) FROM appointments WHERE tenant_id = $1 AND scheduled_at >= CURRENT_DATE AND scheduled_at < CURRENT_DATE + interval '1 day')::text AS today_appts,
        (SELECT count(*) FROM appointments WHERE tenant_id = $1 AND status='scheduled' AND scheduled_at > now())::text AS upcoming,
        (SELECT COALESCE(SUM(amount - paid_amount),0) FROM invoices WHERE tenant_id = $1 AND status != 'paid')::text AS unpaid,
        (SELECT COALESCE(SUM(paid_amount),0) FROM invoices WHERE tenant_id = $1 AND issued_on >= date_trunc('month', CURRENT_DATE))::text AS revenue_month`,
      [tid]
    )
    const todaysList = await query(
      `SELECT a.*, p.first_name || ' ' || p.last_name AS patient_name, p.code AS patient_code, d.full_name AS doctor_name
       FROM appointments a JOIN patients p ON p.id = a.patient_id LEFT JOIN doctors d ON d.id = a.doctor_id
       WHERE a.tenant_id = $1 AND a.scheduled_at >= CURRENT_DATE AND a.scheduled_at < CURRENT_DATE + interval '1 day'
       ORDER BY a.scheduled_at ASC`,
      [tid]
    )
    const recentPatients = await query(
      `SELECT * FROM patients WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 6`,
      [tid]
    )
    res.json({
      stats: {
        patients: Number(stats?.patients ?? 0),
        today_appointments: Number(stats?.today_appts ?? 0),
        upcoming_appointments: Number(stats?.upcoming ?? 0),
        unpaid_total: Number(stats?.unpaid ?? 0),
        month_revenue: Number(stats?.revenue_month ?? 0),
      },
      todays_appointments: todaysList,
      recent_patients: recentPatients,
    })
  })
)

export default router
