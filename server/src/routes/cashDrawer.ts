import { Router } from 'express'
import { z } from 'zod'
import { pool, query, queryOne } from '../config/db.js'
import { asyncHandler, AppError, nextCode, withTransaction } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { authenticate, requireActiveTenant, requirePermission } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()
router.use(authenticate, requireActiveTenant)
const t = (req: { user?: { tenant_id: string | null } }) => req.user!.tenant_id as string

/* ═══════════════ SCHEMAS ═══════════════ */

const startShiftSchema = z.object({ opening_balance: z.number().min(0).default(0), vertical: z.enum(['retail', 'pharmacy', 'hospital', 'school', 'shared']).optional() })
const endShiftSchema = z.object({ counted_cash: z.number().min(0) })
const expenseSchema = z.object({
  category: z.string().trim().max(80).default('General'),
  description: z.string().trim().max(300).optional().nullable(),
  amount: z.number().min(0.01),
  spent_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vertical: z.enum(['retail', 'pharmacy', 'hospital', 'school', 'shared']).optional(),
})
const incomeSchema = z.object({
  category: z.string().trim().max(80).default('General'),
  description: z.string().trim().max(300).optional().nullable(),
  amount: z.number().min(0.01),
  income_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  vertical: z.enum(['retail', 'pharmacy', 'hospital', 'school', 'shared']).optional(),
})
const supplierPaymentSchema = z.object({
  supplier_id: z.string().uuid(),
  amount: z.number().min(0.01),
  payment_method: z.enum(['cash', 'card', 'mobile', 'bank']).default('cash'),
  notes: z.string().trim().max(300).optional().nullable(),
  vertical: z.enum(['retail', 'pharmacy', 'hospital', 'school', 'shared']).optional(),
})
const customerPaymentSchema = z.object({
  customer_id: z.string().uuid(),
  amount: z.number().min(0.01),
  payment_method: z.enum(['cash', 'card', 'mobile', 'bank']).default('cash'),
  note: z.string().trim().max(300).optional().nullable(),
  vertical: z.enum(['retail', 'pharmacy', 'hospital', 'school', 'shared']).optional(),
})

/* ═══════════════ CASH DRAWER SHIFTS (horizontal) ═══════════════ */

router.get(
  '/cash-drawer/shift',
  requirePermission('cash_drawer.view'),
  asyncHandler(async (req, res) => {
    const row = await queryOne(
      `SELECT * FROM cash_drawer_shifts WHERE tenant_id = $1 AND user_id = $2 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [t(req), req.user!.id]
    )
    if (!row) return res.json({ shift: null })
    const expected = Number(row.opening_balance) + Number(row.cash_sales) - Number(row.expenses)
    res.json({ shift: { ...row, expected_cash: expected } })
  })
)

router.post(
  '/cash-drawer/shift/start',
  requirePermission('cash_drawer.manage'),
  validateBody(startShiftSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof startShiftSchema>
    const existing = await queryOne(`SELECT id FROM cash_drawer_shifts WHERE tenant_id = $1 AND user_id = $2 AND status = 'open'`, [
      t(req),
      req.user!.id,
    ])
    if (existing) throw new AppError(409, 'You already have an open shift', 'SHIFT_OPEN')
    const row = await queryOne(
      `INSERT INTO cash_drawer_shifts (tenant_id, user_id, opening_balance, vertical) VALUES ($1,$2,$3,$4) RETURNING *`,
      [t(req), req.user!.id, d.opening_balance, d.vertical ?? 'retail']
    )
    logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'shift.start', entity: 'shift', entityId: row!.id })
    res.status(201).json({ shift: row })
  })
)

router.post(
  '/cash-drawer/shift/end',
  requirePermission('cash_drawer.manage'),
  validateBody(endShiftSchema),
  asyncHandler(async (req, res) => {
    const tId = t(req)
    const row = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE cash_drawer_shifts
         SET counted_cash = $3,
             expected_cash = opening_balance + cash_sales - expenses,
             difference = $3 - (opening_balance + cash_sales - expenses),
             status = 'closed', closed_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND status = 'open'
         RETURNING *`,
        [tId, req.user!.id, (req.body as z.infer<typeof endShiftSchema>).counted_cash]
      )
      if (!rows.length) throw new AppError(404, 'No open shift found', 'NOT_FOUND')
      return rows[0]
    })
    logAudit({ tenantId: tId, userId: req.user!.id, userName: req.user!.full_name, action: 'shift.end', entity: 'shift', entityId: row.id, details: { difference: row.difference } })
    res.json({ shift: row })
  })
)

router.get(
  '/cash-drawer/shift/history',
  requirePermission('cash_drawer.view'),
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT s.*, u.full_name AS cashier FROM cash_drawer_shifts s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id = $1 ORDER BY s.opened_at DESC LIMIT 100`,
      [t(req)]
    )
    res.json({ shifts: rows })
  })
)

/* ═══════════════ EXPENSES (horizontal) ═══════════════ */

router.get(
  '/cash-drawer/expenses',
  requirePermission('cash_drawer.view'),
  asyncHandler(async (req, res) => {
    const vertical = req.query.vertical ? String(req.query.vertical) : null
    const params: unknown[] = [t(req)]
    let where = `WHERE e.tenant_id = $1`
    if (vertical) {
      params.push(vertical)
      where += ` AND e.vertical = $${params.length}`
    }
    const rows = await query(
      `SELECT e.*, u.full_name AS recorded_by FROM expenses e LEFT JOIN users u ON u.id = e.user_id
       ${where} ORDER BY e.spent_at DESC, e.created_at DESC LIMIT 200`,
      params
    )
    res.json({ expenses: rows })
  })
)

router.post(
  '/cash-drawer/expenses',
  requirePermission('cash_drawer.manage'),
  validateBody(expenseSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof expenseSchema>
    const row = await queryOne(
      `INSERT INTO expenses (tenant_id, category, description, amount, spent_at, user_id, vertical)
       VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7) RETURNING *`,
      [t(req), d.category, d.description ?? null, d.amount, d.spent_at ?? null, req.user!.id, d.vertical ?? 'retail']
    )
    await query(`UPDATE cash_drawer_shifts SET expenses = expenses + $1 WHERE tenant_id = $2 AND user_id = $3 AND status = 'open'`, [
      d.amount,
      t(req),
      req.user!.id,
    ])
    res.status(201).json({ expense: row })
  })
)

/* ═══════════════ INCOME (horizontal) ═══════════════ */

router.get(
  '/cash-drawer/income',
  requirePermission('cash_drawer.view'),
  asyncHandler(async (req, res) => {
    const vertical = req.query.vertical ? String(req.query.vertical) : null
    const params: unknown[] = [t(req)]
    let where = `WHERE i.tenant_id = $1`
    if (vertical) {
      params.push(vertical)
      where += ` AND i.vertical = $${params.length}`
    }
    const rows = await query(
      `SELECT i.*, u.full_name AS recorded_by FROM income i LEFT JOIN users u ON u.id = i.user_id
       ${where} ORDER BY i.income_date DESC, i.created_at DESC LIMIT 200`,
      params
    )
    res.json({ income: rows })
  })
)

router.post(
  '/cash-drawer/income',
  requirePermission('cash_drawer.manage'),
  validateBody(incomeSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof incomeSchema>
    const row = await queryOne(
      `INSERT INTO income (tenant_id, category, description, amount, income_date, user_id, vertical)
       VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7) RETURNING *`,
      [t(req), d.category, d.description ?? null, d.amount, d.income_date ?? null, req.user!.id, d.vertical ?? 'retail']
    )
    res.status(201).json({ income: row })
  })
)

/* ═══════════════ SUPPLIER PAYMENTS (horizontal) ═══════════════ */

router.get(
  '/cash-drawer/supplier-payments',
  requirePermission('cash_drawer.view'),
  asyncHandler(async (req, res) => {
    const vertical = req.query.vertical ? String(req.query.vertical) : null
    const params: unknown[] = [t(req)]
    let where = `WHERE p.tenant_id = $1`
    if (vertical) {
      params.push(vertical)
      where += ` AND p.vertical = $${params.length}`
    }
    const rows = await query(
      `SELECT p.*, s.name AS supplier_name, u.full_name AS recorded_by FROM supplier_payments p
       JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id
       ${where} ORDER BY p.created_at DESC LIMIT 200`,
      params
    )
    res.json({ payments: rows })
  })
)

router.post(
  '/cash-drawer/supplier-payments',
  requirePermission('cash_drawer.manage'),
  validateBody(supplierPaymentSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof supplierPaymentSchema>
    const row = await queryOne(
      `INSERT INTO supplier_payments (tenant_id, supplier_id, amount, payment_method, notes, user_id, vertical)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [t(req), d.supplier_id, d.amount, d.payment_method, d.notes ?? null, req.user!.id, d.vertical ?? 'retail']
    )
    const field = d.payment_method === 'card' ? 'card_sales' : d.payment_method === 'mobile' ? 'mobile_sales' : 'cash_sales'
    await query(
      `UPDATE cash_drawer_shifts SET ${field} = GREATEST(0, ${field} - $1) WHERE tenant_id = $2 AND user_id = $3 AND status = 'open'`,
      [d.amount, t(req), req.user!.id]
    )
    logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'supplier.payment', entity: 'supplier', entityId: d.supplier_id, details: { amount: d.amount } })
    res.status(201).json({ payment: row })
  })
)

/* ═══════════════ CUSTOMER PAYMENTS (horizontal) ═══════════════ */

router.get(
  '/cash-drawer/customer-payments',
  requirePermission('cash_drawer.view'),
  asyncHandler(async (req, res) => {
    const vertical = req.query.vertical ? String(req.query.vertical) : null
    const params: unknown[] = [t(req)]
    let where = `WHERE p.tenant_id = $1`
    if (vertical) {
      params.push(vertical)
      where += ` AND p.vertical = $${params.length}`
    }
    const rows = await query(
      `SELECT p.*, c.name AS customer_name, c.code AS customer_code, u.full_name AS recorded_by FROM customer_payments p
       JOIN customers c ON c.id = p.customer_id LEFT JOIN users u ON u.id = p.user_id
       ${where} ORDER BY p.created_at DESC LIMIT 200`,
      params
    )
    res.json({ payments: rows })
  })
)

router.post(
  '/cash-drawer/customer-payments',
  requirePermission('cash_drawer.manage'),
  validateBody(customerPaymentSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof customerPaymentSchema>
    const row = await queryOne(
      `INSERT INTO customer_payments (tenant_id, customer_id, amount, payment_method, note, user_id, vertical)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [t(req), d.customer_id, d.amount, d.payment_method, d.note ?? null, req.user!.id, d.vertical ?? 'retail']
    )
    const field = d.payment_method === 'card' ? 'card_sales' : d.payment_method === 'mobile' ? 'mobile_sales' : 'cash_sales'
    await query(
      `UPDATE cash_drawer_shifts SET ${field} = ${field} + $1 WHERE tenant_id = $2 AND user_id = $3 AND status = 'open'`,
      [d.amount, t(req), req.user!.id]
    )
    logAudit({ tenantId: t(req), userId: req.user!.id, userName: req.user!.full_name, action: 'customer.payment', entity: 'customer', entityId: d.customer_id, details: { amount: d.amount } })
    res.status(201).json({ payment: row })
  })
)

export default router