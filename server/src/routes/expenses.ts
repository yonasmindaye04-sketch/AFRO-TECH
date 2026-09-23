import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../config/db.js';
import { asyncHandler, AppError } from '../utils/helpers.js';
import { authenticate, requireActiveTenant, requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
router.use(authenticate, requireActiveTenant);

function tenantId(req: any): string {
  return req.user!.tenant_id as string;
}

// Validation Schemas
const expenseCreateSchema = z.object({
  category: z.string().min(1),
  description: z.string().optional(),
  amount: z.number().positive(),
  spent_at: z.string().optional(),
  receipt_url: z.string().optional(),
  is_recurring: z.boolean().optional(),
  recurrence: z.enum(['daily', 'weekly', 'monthly', 'yearly']).optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional()
});

const expenseUpdateSchema = z.object({
  category: z.string().min(1).optional(),
  description: z.string().optional(),
  amount: z.number().positive().optional(),
  spent_at: z.string().optional(),
  receipt_url: z.string().optional(),
  status: z.enum(['pending', 'approved', 'rejected']).optional()
});

// GET / - List expenses with filters
router.get('/', requirePermission('expenses.view'), asyncHandler(async (req, res) => {
  const tId = tenantId(req);
  const { from, to, category, search, status, limit = '200' } = req.query;

  let sql = `
    SELECT e.*, u.full_name AS recorded_by_name 
    FROM expenses e 
    LEFT JOIN users u ON u.id = e.recorded_by 
    WHERE e.tenant_id = $1
  `;
  const params: any[] = [tId];
  let paramIdx = 2;

  if (from) {
    sql += ` AND e.spent_at >= $${paramIdx}`;
    params.push(from);
    paramIdx++;
  }
  if (to) {
    sql += ` AND e.spent_at <= $${paramIdx}`;
    params.push(to);
    paramIdx++;
  }
  if (category) {
    sql += ` AND e.category = $${paramIdx}`;
    params.push(category);
    paramIdx++;
  }
  if (status) {
    sql += ` AND e.status = $${paramIdx}`;
    params.push(status);
    paramIdx++;
  }
  if (search) {
    sql += ` AND (e.description ILIKE $${paramIdx} OR e.category ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  sql += ` ORDER BY e.spent_at DESC, e.created_at DESC LIMIT $${paramIdx}`;
  params.push(parseInt(limit as string, 10) || 200);

  const expenses = await query(sql, params);
  res.json({ data: expenses });
}));

// GET /summary - Monthly aggregates
router.get('/summary', requirePermission('expenses.view'), asyncHandler(async (req, res) => {
  const tId = tenantId(req);

  const thisMonthQuery = `
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM expenses 
    WHERE tenant_id = $1 
      AND date_trunc('month', spent_at) = date_trunc('month', CURRENT_DATE)
      AND status != 'rejected'
  `;
  const lastMonthQuery = `
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM expenses 
    WHERE tenant_id = $1 
      AND date_trunc('month', spent_at) = date_trunc('month', CURRENT_DATE - INTERVAL '1 month')
      AND status != 'rejected'
  `;
  const thisYearQuery = `
    SELECT COALESCE(SUM(amount), 0) as total 
    FROM expenses 
    WHERE tenant_id = $1 
      AND date_trunc('year', spent_at) = date_trunc('year', CURRENT_DATE)
      AND status != 'rejected'
  `;
  const byCategoryQuery = `
    SELECT category, SUM(amount) as total 
    FROM expenses 
    WHERE tenant_id = $1 
      AND date_trunc('month', spent_at) = date_trunc('month', CURRENT_DATE)
      AND status != 'rejected'
    GROUP BY category
    ORDER BY total DESC
  `;

  const [thisMonth, lastMonth, thisYear, byCategory] = await Promise.all([
    queryOne(thisMonthQuery, [tId]),
    queryOne(lastMonthQuery, [tId]),
    queryOne(thisYearQuery, [tId]),
    query(byCategoryQuery, [tId])
  ]);

  res.json({
    data: {
      this_month: parseFloat(thisMonth?.total || 0),
      last_month: parseFloat(lastMonth?.total || 0),
      this_year: parseFloat(thisYear?.total || 0),
      by_category: byCategory.map(c => ({
        category: c.category,
        total: parseFloat(c.total)
      }))
    }
  });
}));

// GET /export - CSV export
router.get('/export', requirePermission('expenses.view'), asyncHandler(async (req, res) => {
  const tId = tenantId(req);
  const { from, to, category, search, status } = req.query;

  let sql = `
    SELECT e.*, u.full_name AS recorded_by_name 
    FROM expenses e 
    LEFT JOIN users u ON u.id = e.recorded_by 
    WHERE e.tenant_id = $1
  `;
  const params: any[] = [tId];
  let paramIdx = 2;

  if (from) {
    sql += ` AND e.spent_at >= $${paramIdx}`;
    params.push(from);
    paramIdx++;
  }
  if (to) {
    sql += ` AND e.spent_at <= $${paramIdx}`;
    params.push(to);
    paramIdx++;
  }
  if (category) {
    sql += ` AND e.category = $${paramIdx}`;
    params.push(category);
    paramIdx++;
  }
  if (status) {
    sql += ` AND e.status = $${paramIdx}`;
    params.push(status);
    paramIdx++;
  }
  if (search) {
    sql += ` AND (e.description ILIKE $${paramIdx} OR e.category ILIKE $${paramIdx})`;
    params.push(`%${search}%`);
    paramIdx++;
  }

  sql += ` ORDER BY e.spent_at DESC, e.created_at DESC`;

  const expenses = await query(sql, params);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=expenses.csv');

  let csv = 'Date,Category,Description,Amount,Status,Recorded By\n';
  expenses.forEach(e => {
    const date = e.spent_at ? new Date(e.spent_at).toISOString().split('T')[0] : '';
    const categoryStr = e.category ? e.category.replace(/"/g, '""') : '';
    const descriptionStr = e.description ? e.description.replace(/"/g, '""') : '';
    const amountStr = Number(e.amount).toFixed(2);
    const statusStr = e.status;
    const recordedByStr = e.recorded_by_name ? e.recorded_by_name.replace(/"/g, '""') : '';
    
    csv += `"${date}","${categoryStr}","${descriptionStr}",${amountStr},"${statusStr}","${recordedByStr}"\n`;
  });

  res.send(csv);
}));

// POST / - Create expense
router.post('/', requirePermission('expenses.manage'), validateBody(expenseCreateSchema), asyncHandler(async (req, res) => {
  const tId = tenantId(req);
  const data = req.body;
  const recordedBy = req.user!.id;
  const userRole = (req.user as any).role;
  const defaultStatus = userRole === 'admin' ? 'approved' : 'pending';
  
  const status = data.status || defaultStatus;
  const spentAt = data.spent_at || new Date().toISOString();
  const isRecurring = data.is_recurring || false;

  const sql = `
    INSERT INTO expenses (
      tenant_id, category, description, amount, spent_at, 
      receipt_url, is_recurring, recurrence, status, recorded_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *
  `;
  const params = [
    tId, data.category, data.description || null, data.amount, spentAt,
    data.receipt_url || null, isRecurring, data.recurrence || null, status, recordedBy
  ];

  const newExpense = await queryOne(sql, params);
  res.status(201).json({ data: newExpense });
}));

// PATCH /:id - Update expense
router.patch('/:id', requirePermission('expenses.manage'), validateBody(expenseUpdateSchema), asyncHandler(async (req, res) => {
  const tId = tenantId(req);
  const { id } = req.params;
  const data = req.body;

  const existing = await queryOne('SELECT id FROM expenses WHERE id = $1 AND tenant_id = $2', [id, tId]);
  if (!existing) {
    throw new AppError('Expense not found', 404);
  }

  const updates: string[] = [];
  const params: any[] = [id, tId];
  let paramIdx = 3;

  const fields = ['category', 'description', 'amount', 'spent_at', 'receipt_url', 'status'];
  fields.forEach(field => {
    if (data[field] !== undefined) {
      updates.push(`${field} = $${paramIdx}`);
      params.push(data[field]);
      paramIdx++;
    }
  });

  if (updates.length === 0) {
    return res.json({ data: existing });
  }

  updates.push(`updated_at = NOW()`);

  const sql = `
    UPDATE expenses 
    SET ${updates.join(', ')} 
    WHERE id = $1 AND tenant_id = $2 
    RETURNING *
  `;

  const updated = await queryOne(sql, params);
  res.json({ data: updated });
}));

// DELETE /:id - Delete expense
router.delete('/:id', requirePermission('expenses.manage'), asyncHandler(async (req, res) => {
  const tId = tenantId(req);
  const { id } = req.params;

  const sql = `DELETE FROM expenses WHERE id = $1 AND tenant_id = $2 RETURNING id`;
  const deleted = await queryOne(sql, [id, tId]);

  if (!deleted) {
    throw new AppError('Expense not found', 404);
  }

  res.json({ message: 'Expense deleted successfully' });
}));

// PATCH /:id/approve - Approve a pending expense
router.patch('/:id/approve', requirePermission('expenses.manage'), asyncHandler(async (req, res) => {
  const tId = tenantId(req);
  const { id } = req.params;
  const userId = req.user!.id;

  const sql = `
    UPDATE expenses 
    SET status = 'approved', approved_by = $1, approved_at = NOW(), updated_at = NOW()
    WHERE id = $2 AND tenant_id = $3 
    RETURNING *
  `;
  const approved = await queryOne(sql, [userId, id, tId]);

  if (!approved) {
    throw new AppError('Expense not found', 404);
  }

  res.json({ data: approved });
}));

// PATCH /:id/reject - Reject a pending expense
router.patch('/:id/reject', requirePermission('expenses.manage'), asyncHandler(async (req, res) => {
  const tId = tenantId(req);
  const { id } = req.params;

  const sql = `
    UPDATE expenses 
    SET status = 'rejected', updated_at = NOW()
    WHERE id = $1 AND tenant_id = $2 
    RETURNING *
  `;
  const rejected = await queryOne(sql, [id, tId]);

  if (!rejected) {
    throw new AppError('Expense not found', 404);
  }

  res.json({ data: rejected });
}));

export default router;
