import { Router } from 'express'
import { z } from 'zod'
import { pool, query, queryOne } from '../config/db.js'
import { asyncHandler, AppError, nextCode, withTransaction } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { authenticate, requireActiveTenant, requirePermission } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { notifyOrderCreated, notifyOrderCompleted } from '../services/hospitalNotify.js'
import { sendNotification, notifyLongWait } from '../services/notificationEngine.js'
import { assertCanProcessDepartment } from './hospitalFlow.js'

const router = Router()
router.use(authenticate, requireActiveTenant)
const t = (req: { user?: { tenant_id: string | null } }) => req.user!.tenant_id as string

/* ═══════════════ DEPARTMENTS ═══════════════ */

const departmentSchema = z.object({
  name: z.string().trim().min(2).max(80),
  type: z.enum(['reception', 'consultation', 'laboratory', 'injection', 'procedure', 'billing', 'nurse', 'counseling', 'compounding', 'verification', 'nurse_referral', 'screening', 'sales', 'returns', 'special_orders', 'admin', 'records', 'other']),
})

router.get(
  '/departments',
  requirePermission('visits.view'),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT d.*,
        COALESCE((SELECT json_agg(json_build_object('id', u.id, 'full_name', u.full_name))
          FROM department_staff ds JOIN users u ON u.id = ds.user_id WHERE ds.department_id = d.id), '[]') AS staff,
        (SELECT COUNT(*) FROM visits v WHERE v.current_department_id = d.id AND v.status = 'waiting') AS waiting,
        (SELECT COUNT(*) FROM service_orders s WHERE s.target_department_id = d.id AND s.status = 'pending') AS pending_orders
       FROM departments d WHERE d.tenant_id = $1 ORDER BY d.created_at ASC`,
      [t(req)]
    )
    res.json({ departments: rows })
  })
)

router.post(
  '/departments',
  requirePermission('departments.manage'),
  validateBody(departmentSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof departmentSchema>
    const row = await queryOne(
      `INSERT INTO departments (tenant_id, name, type, sort_order) VALUES ($1,$2,$3,0) RETURNING *`,
      [t(req), d.name, d.type]
    )
    res.status(201).json({ department: row })
  })
)

router.patch(
  '/departments/:id',
  requirePermission('departments.manage'),
  validateBody(z.object({ name: z.string().trim().min(2).max(80).optional(), is_active: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const d = req.body as { name?: string; is_active?: boolean }
    const row = await queryOne(
      `UPDATE departments SET name = COALESCE($3, name), is_active = COALESCE($4, is_active)
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t(req), d.name ?? null, d.is_active ?? null]
    )
    if (!row) throw new AppError(404, 'Department not found', 'NOT_FOUND')
    res.json({ department: row })
  })
)

router.post(
  '/departments/:id/staff',
  requirePermission('departments.manage'),
  validateBody(z.object({ user_id: z.string().uuid() })),
  asyncHandler(async (req, res) => {
    await queryOne(
      `INSERT INTO department_staff (department_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [req.params.id, req.body.user_id]
    )
    res.json({ success: true })
  })
)

router.delete(
  '/departments/:id/staff/:userId',
  requirePermission('departments.manage'),
  asyncHandler(async (req, res) => {
    await queryOne(`DELETE FROM department_staff WHERE department_id = $1 AND user_id = $2`, [req.params.id, req.params.userId])
    res.json({ success: true })
  })
)

/* ═══════════════ VISITS ═══════════════ */

const DEFAULT_CONSULT_DEPT = `(SELECT d.id FROM departments d WHERE d.tenant_id = $1 AND d.type = 'consultation' ORDER BY d.created_at LIMIT 1)`

const checkinSchema = z.object({
  patient_id: z.string().uuid(),
  appointment_id: z.string().uuid().optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  chief_complaint: z.string().trim().max(500).optional().nullable(),
  priority: z.enum(['normal', 'urgent']).optional(),
  source_entity_type: z.enum(['patient', 'student', 'customer', 'staff']).optional(),
  source_entity_id: z.string().uuid().optional().nullable(),
})

router.get(
  '/visits',
  requirePermission('visits.view'),
  asyncHandler(async (req, res) => {
    const departmentId = req.query.department_id ? String(req.query.department_id) : null
    const status = req.query.status ? String(req.query.status) : null
    const sourceEntityType = req.query.source_entity_type ? String(req.query.source_entity_type) : null
    const params: unknown[] = [t(req)]
    let where = `WHERE v.tenant_id = $1 AND v.status != 'completed' AND v.status != 'no_show'`

    if (departmentId && departmentId !== 'all') {
      params.push(departmentId)
      where += ` AND v.current_department_id = $${params.length}`
    }
    if (status) {
      params.push(status)
      where += ` AND v.status = $${params.length}`
    }
    if (sourceEntityType) {
      params.push(sourceEntityType)
      where += ` AND v.source_entity_type = $${params.length}`
    }

    const rows = await query(
      `SELECT v.*, p.first_name || ' ' || p.last_name AS patient_name, p.code AS patient_code, p.phone,
              d.name AS department_name, d.type AS department_type,
              (SELECT COUNT(*) FROM service_orders s WHERE s.visit_id = v.id AND s.status != 'cancelled') AS order_count,
              v.opened_at > now() - interval '1 day' AS is_today
       FROM visits v
       JOIN patients p ON p.id = v.patient_id
       LEFT JOIN departments d ON d.id = v.current_department_id
       ${where}
       ORDER BY v.priority = 'urgent' DESC, v.opened_at ASC
       LIMIT 300`,
      params
    )
    res.json({ visits: rows })
  })
)

router.post(
  '/visits',
  requirePermission('visits.manage'),
  validateBody(checkinSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof checkinSchema>
    const isWalkIn = !d.appointment_id

    const visit = await withTransaction(pool, async (client) => {
      const deptId =
        d.department_id ??
        (await client.query(`SELECT id FROM departments WHERE tenant_id = $1 AND type = 'consultation' ORDER BY d.created_at LIMIT 1`, [t(req)])
        ).rows[0]?.id

      const r = await client.query(
        `INSERT INTO visits (tenant_id, patient_id, appointment_id, visit_type, current_department_id, status, priority, chief_complaint, opened_by, source_entity_type, source_entity_id)
         VALUES ($1,$2,$3,$4,$5,'waiting',$6,$7,$8,$9,$10) RETURNING *`,
        [t(req), d.patient_id, d.appointment_id ?? null, isWalkIn ? 'walk_in' : 'scheduled', deptId ?? null, d.priority ?? 'normal', d.chief_complaint ?? null, req.user!.id, d.source_entity_type ?? 'patient', d.source_entity_id ?? null]
      )
      const v = r.rows[0]

      await client.query(
        `INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by, note)
         VALUES ($1,$2,$3,'checked_in',$4,$5)`,
        [v.id, t(req), deptId ?? null, req.user!.id, isWalkIn ? 'Walk-in' : 'Scheduled check-in']
      )

      if (d.appointment_id) {
        await client.query(`UPDATE appointments SET status = 'in_service' WHERE id = $1 AND tenant_id = $2`, [d.appointment_id, t(req)])
      }
      return v
    })

    await logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'visit.checkin', entity: 'visit', entityId: visit.id, details: { visit_type: visit.visit_type } })
    res.status(201).json({ visit })
  })
)

router.get(
  '/visits/:id',
  requirePermission('visits.view'),
  asyncHandler(async (req, res) => {
    const visit = await queryOne(
      `SELECT v.*, p.first_name || ' ' || p.last_name AS patient_name, p.code AS patient_code, p.phone, p.dob, p.blood_type, p.allergies,
              d.name AS department_name, d.type AS department_type
       FROM visits v JOIN patients p ON p.id = v.patient_id LEFT JOIN departments d ON d.id = v.current_department_id
       WHERE v.id = $1 AND v.tenant_id = $2`,
      [req.params.id, t(req)]
    )
    if (!visit) throw new AppError(404, 'Visit not found', 'NOT_FOUND')

    const history = await query(
      `SELECT h.*, d.name AS department_name, u.full_name AS handler_name
       FROM visit_status_history h LEFT JOIN departments d ON d.id = h.department_id LEFT JOIN users u ON u.id = h.handled_by
       WHERE h.visit_id = $1 ORDER BY h.created_at ASC`,
      [req.params.id]
    )
    const orders = await query(
      `SELECT s.*, d.name AS department_name, d.type AS department_type,
              doc.full_name AS doctor_name, ucomp.full_name AS completed_by_name, uord.full_name AS ordered_by_name
       FROM service_orders s
       JOIN departments d ON d.id = s.target_department_id
       LEFT JOIN doctors doc ON doc.id = s.doctor_id
       LEFT JOIN users ucomp ON ucomp.id = s.completed_by
       LEFT JOIN users uord ON uord.id = s.ordered_by
       WHERE s.visit_id = $1 ORDER BY s.created_at ASC`,
      [req.params.id]
    )
    res.json({ visit, history, orders })
  })
)

router.post(
  '/visits/:id/call',
  requirePermission('visits.serve'),
  asyncHandler(async (req, res) => {
    const visit = await queryOne(`SELECT * FROM visits WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!visit) throw new AppError(404, 'Visit not found', 'NOT_FOUND')
    if (visit.status !== 'waiting') throw new AppError(409, 'Patient is not waiting', 'INVALID_STATE')

    const row = await queryOne(
      `UPDATE visits SET status = 'in_service' WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t(req)]
    )
    await queryOne(
      `INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by) VALUES ($1,$2,$3,'in_service',$4)`,
      [req.params.id, t(req), visit.current_department_id, req.user!.id]
    )
    res.json({ visit: row })
  })
)

router.post(
  '/visits/:id/transfer',
  requirePermission('visits.manage'),
  validateBody(z.object({ department_id: z.string().uuid(), note: z.string().trim().max(500).optional().nullable() })),
  asyncHandler(async (req, res) => {
    const { department_id, note } = req.body as { department_id: string; note?: string | null }
    const visit = await queryOne(`SELECT * FROM visits WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!visit) throw new AppError(404, 'Visit not found', 'NOT_FOUND')

    const row = await queryOne(
      `UPDATE visits SET current_department_id = $3, status = 'waiting' WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t(req), department_id]
    )
    await queryOne(
      `INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by, note) VALUES ($1,$2,$3,'transferred',$4,$5)`,
      [req.params.id, t(req), department_id, req.user!.id, note ?? null]
    )
    res.json({ visit: row })
  })
)

router.post(
  '/visits/:id/complete',
  requirePermission('visits.manage'),
  asyncHandler(async (req, res) => {
    const visit = await queryOne(`SELECT * FROM visits WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!visit) throw new AppError(404, 'Visit not found', 'NOT_FOUND')

    const row = await queryOne(
      `UPDATE visits SET status = 'completed', closed_at = now(), closed_by = $3 WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t(req), req.user!.id]
    )
    await queryOne(
      `INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by) VALUES ($1,$2,$3,'completed',$4)`,
      [req.params.id, t(req), visit.current_department_id, req.user!.id]
    )
    if (visit.appointment_id) {
      await queryOne(`UPDATE appointments SET status = 'completed' WHERE id = $1 AND tenant_id = $2`, [visit.appointment_id, t(req)])
    }
    await logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'visit.complete', entity: 'visit', entityId: req.params.id })
    res.json({ visit: row })
  })
)

router.post(
  '/visits/:id/no-show',
  requirePermission('visits.manage'),
  asyncHandler(async (req, res) => {
    const row = await queryOne(
      `UPDATE visits SET status = 'no_show', closed_at = now(), closed_by = $3 WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t(req), req.user!.id]
    )
    if (!row) throw new AppError(404, 'Visit not found', 'NOT_FOUND')
    res.json({ visit: row })
  })
)

/* ═══════════════ SERVICE ORDERS ═══════════════ */

const orderSchema = z.object({
  visit_id: z.string().uuid(),
  order_type: z.enum(['lab_test', 'injection', 'procedure', 'vitals', 'counseling', 'compounding', 'verification', 'nurse_referral', 'screening', 'return_inspection', 'repair', 'special_order', 'other']),
  target_department_id: z.string().uuid(),
  details: z.record(z.unknown()).default({}),
  fee: z.number().min(0).default(0),
  priority: z.enum(['normal', 'urgent']).optional(),
  doctor_id: z.string().uuid().optional().nullable(),
})

router.post(
  '/orders',
  requirePermission('orders.create'),
  validateBody(orderSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof orderSchema>
    const visit = await queryOne(`SELECT * FROM visits WHERE id = $1 AND tenant_id = $2`, [d.visit_id, t(req)])
    if (!visit) throw new AppError(404, 'Visit not found', 'NOT_FOUND')

    const order = await queryOne(
      `INSERT INTO service_orders (tenant_id, visit_id, patient_id, order_type, target_department_id, ordered_by, doctor_id, priority, details, fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [t(req), d.visit_id, visit.patient_id, d.order_type, d.target_department_id, req.user!.id, d.doctor_id ?? null, d.priority ?? 'normal', JSON.stringify(d.details), d.fee]
    )
    if (!order) throw new AppError(500, 'Failed to create order', 'CREATE_FAILED')

    await queryOne(
      `INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by, note) VALUES ($1,$2,$3,'order_created',$4,$5)`,
      [d.visit_id, t(req), d.target_department_id, req.user!.id, d.order_type]
    )

    const patient = await queryOne<{ name: string }>(`SELECT first_name || ' ' || last_name AS name FROM patients WHERE id = $1`, [visit.patient_id])
    await notifyOrderCreated({ tenantId: t(req), departmentId: d.target_department_id, orderId: order.id, orderType: d.order_type, patientName: patient?.name ?? 'Patient' })

    await logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'order.create', entity: 'service_order', entityId: order.id, details: { order_type: d.order_type } })
    res.status(201).json({ order })
  })
)

router.get(
  '/orders',
  requirePermission('visits.view'),
  asyncHandler(async (req, res) => {
    const departmentId = req.query.department_id ? String(req.query.department_id) : null
    const status = req.query.status ? String(req.query.status) : 'pending'
    const params: unknown[] = [t(req)]
    let where = `WHERE s.tenant_id = $1`

    if (departmentId && departmentId !== 'all') {
      params.push(departmentId)
      where += ` AND s.target_department_id = $${params.length}`
    }
    if (status && status !== 'all') {
      params.push(status)
      where += ` AND s.status = $${params.length}`
    }

    const rows = await query(
      `SELECT s.*, d.name AS department_name, d.type AS department_type,
              p.first_name || ' ' || p.last_name AS patient_name, p.code AS patient_code,
              doc.full_name AS doctor_name, uord.full_name AS ordered_by_name
       FROM service_orders s
       JOIN departments d ON d.id = s.target_department_id
       JOIN patients p ON p.id = s.patient_id
       LEFT JOIN doctors doc ON doc.id = s.doctor_id
       LEFT JOIN users uord ON uord.id = s.ordered_by
       ${where} ORDER BY s.priority = 'urgent' DESC, s.created_at ASC LIMIT 400`,
      params
    )
    res.json({ orders: rows })
  })
)

router.post(
  '/orders/:id/start',
  requirePermission('visits.view'),
  asyncHandler(async (req, res) => {
    const cur = await queryOne<{ target_department_id: string; target_department_type: string; status: string }>(
      `SELECT s.target_department_id, d.type AS target_department_type, s.status
       FROM service_orders s JOIN departments d ON d.id = s.target_department_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [req.params.id, t(req)]
    )
    if (!cur) throw new AppError(404, 'Order not found', 'NOT_FOUND')
    assertCanProcessDepartment(req.permissions, cur.target_department_type)

    const row = await queryOne(
      `UPDATE service_orders SET status = 'in_progress', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status = 'pending' RETURNING *`,
      [req.params.id, t(req)]
    )
    if (!row) throw new AppError(404, 'Order not found or already started', 'NOT_FOUND')
    res.json({ order: row })
  })
)

const completeOrderSchema = z.object({
  result: z.record(z.unknown()).default({}),
  note: z.string().trim().max(1000).optional().nullable(),
})

router.post(
  '/orders/:id/complete',
  requirePermission('visits.view'),
  validateBody(completeOrderSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof completeOrderSchema>
    const cur = await queryOne<{ target_department_id: string; target_department_type: string; visit_id: string; patient_id: string; order_type: string; status: string; ordered_by: string | null }>(
      `SELECT s.target_department_id, d.type AS target_department_type, s.visit_id, s.patient_id, s.order_type, s.status, s.ordered_by
       FROM service_orders s JOIN departments d ON d.id = s.target_department_id
       WHERE s.id = $1 AND s.tenant_id = $2`,
      [req.params.id, t(req)]
    )
    if (!cur) throw new AppError(404, 'Order not found', 'NOT_FOUND')
    assertCanProcessDepartment(req.permissions, cur.target_department_type)
    if (cur.status === 'completed') throw new AppError(409, 'Order already completed', 'INVALID_STATE')

    const row = await queryOne(
      `UPDATE service_orders SET status = 'completed', result = $3, completed_by = $4, completed_at = now(), updated_at = now()
       WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [req.params.id, t(req), JSON.stringify(d.result), req.user!.id]
    )

    await queryOne(
      `INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by, note) VALUES ($1,$2,$3,'order_completed',$4,$5)`,
      [cur.visit_id, t(req), cur.target_department_id, req.user!.id, `order:${cur.order_type}`]
    )

    const patient = await queryOne<{ name: string }>(`SELECT first_name || ' ' || last_name AS name FROM patients WHERE id = $1`, [cur.patient_id])
    await notifyOrderCompleted({ tenantId: t(req), doctorUserId: cur.ordered_by, orderType: cur.order_type, patientName: patient?.name ?? 'Patient' })

    await logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'order.complete', entity: 'service_order', entityId: req.params.id })
    res.json({ order: row })
  })
)

router.post(
  '/orders/:id/cancel',
  requirePermission('orders.create'),
  asyncHandler(async (req, res) => {
    const row = await queryOne(
      `UPDATE service_orders SET status = 'cancelled', updated_at = now() WHERE id = $1 AND tenant_id = $2 AND status IN ('pending','in_progress') RETURNING *`,
      [req.params.id, t(req)]
    )
    if (!row) throw new AppError(404, 'Order not found or not cancellable', 'NOT_FOUND')
    res.json({ order: row })
  })
)

/* ═══════════════ BILLING FROM VISIT ═══════════════ */

router.get(
  '/visits/:id/billing-summary',
  requirePermission('billing.view'),
  asyncHandler(async (req, res) => {
    const visit = await queryOne(`SELECT * FROM visits WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!visit) throw new AppError(404, 'Visit not found', 'NOT_FOUND')

    const unbilled = await query(
      `SELECT s.id, s.order_type, s.fee, s.status, d.name AS department_name, s.details
       FROM service_orders s JOIN departments d ON d.id = s.target_department_id
       WHERE s.visit_id = $1 AND s.status = 'completed' AND s.invoice_id IS NULL AND s.fee > 0`,
      [req.params.id]
    )
    const totalFee = unbilled.reduce((sum, o) => sum + Number(o.fee), 0)
    res.json({ unbilled, totalFee })
  })
)

router.post(
  '/visits/:id/invoice',
  requirePermission('billing.manage'),
  asyncHandler(async (req, res) => {
    const visit = await queryOne(
      `SELECT v.*, p.first_name || ' ' || p.last_name AS patient_name FROM visits v JOIN patients p ON p.id = v.patient_id WHERE v.id = $1 AND v.tenant_id = $2`,
      [req.params.id, t(req)]
    )
    if (!visit) throw new AppError(404, 'Visit not found', 'NOT_FOUND')

    const unbilled = await query(
      `SELECT id, order_type, fee FROM service_orders WHERE visit_id = $1 AND status = 'completed' AND invoice_id IS NULL AND fee > 0`,
      [req.params.id]
    )
    if (unbilled.length === 0) throw new AppError(400, 'No completed, unbilled services on this visit', 'NOTHING_TO_BILL')

    const items = unbilled.map((o) => ({ id: o.id, order_type: o.order_type, fee: Number(o.fee) }))
    const total = items.reduce((s, o) => s + o.fee, 0)
    const description = items.map((o) => o.order_type.replace('_', ' ')).join(', ')

    const invoice = await withTransaction(pool, async (client) => {
      const number = await nextCode(client, 'invoices', 'INV', t(req))
      const r = await client.query(
        `INSERT INTO invoices (tenant_id, patient_id, number, description, amount, paid_amount, status, issued_on)
         VALUES ($1,$2,$3,$4,$5,0,'unpaid',CURRENT_DATE) RETURNING *`,
        [t(req), visit.patient_id, number, description, total]
      )
      for (const o of items) {
        await client.query(`UPDATE service_orders SET invoice_id = $1 WHERE id = $2 AND tenant_id = $3`, [r.rows[0].id, o.id, t(req)])
      }
      return r.rows[0]
    })

    await logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'invoice.from_visit', entity: 'invoice', entityId: invoice.id, details: { visit_id: req.params.id, amount: total } })
    res.status(201).json({ invoice })
  })
)

/* ═══════════════ REPORTS ═══════════════ */

router.get(
  '/reports/departments',
  requirePermission('journey.reports'),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT d.id, d.name, d.type,
         (SELECT COUNT(*) FROM visits v WHERE v.current_department_id = d.id AND v.opened_at >= CURRENT_DATE) AS today_arrivals,
         (SELECT COUNT(*) FROM visits v WHERE v.current_department_id = d.id AND v.status = 'waiting') AS waiting_now,
         (SELECT COUNT(*) FROM service_orders s WHERE s.target_department_id = d.id AND s.created_at >= CURRENT_DATE) AS orders_today,
         (SELECT COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (s.completed_at - s.created_at))/60)),0)
            FROM service_orders s WHERE s.target_department_id = d.id AND s.status='completed' AND s.completed_at IS NOT NULL) AS avg_turnaround_min
       FROM departments d WHERE d.tenant_id = $1 ORDER BY d.created_at`,
      [t(req)]
    )
    res.json({ departments: rows })
  })
)

router.get(
  '/reports/turnaround',
  requirePermission('journey.reports'),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT s.order_type, d.name AS department_name, d.type AS department_type,
         COUNT(*) AS completed_count,
         COALESCE(ROUND(AVG(EXTRACT(EPOCH FROM (s.completed_at - s.created_at))/60)),0) AS avg_min
       FROM service_orders s JOIN departments d ON d.id = s.target_department_id
       WHERE s.tenant_id = $1 AND s.status = 'completed' AND s.completed_at IS NOT NULL
       GROUP BY s.order_type, d.name, d.type
       ORDER BY avg_min DESC`,
      [t(req)]
    )
    res.json({ turnaround: rows })
  })
)

export default router