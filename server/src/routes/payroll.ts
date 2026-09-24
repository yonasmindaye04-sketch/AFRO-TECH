import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../config/db.js';
import { asyncHandler, AppError } from '../utils/helpers.js';
import { authenticate, requireActiveTenant, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
router.use(authenticate, requireActiveTenant);

function tenantId(req: { user?: { tenant_id: string | null } }): string {
    return req.user!.tenant_id as string;
}

function calcIncomeTax(taxable: number): number {
    if (taxable <= 600) return 0;
    
    let tax = 0;
    if (taxable > 600) {
        let amt = Math.min(taxable, 1650) - 600;
        tax += amt * 0.10;
    }
    if (taxable > 1650) {
        let amt = Math.min(taxable, 3200) - 1650;
        tax += amt * 0.15;
    }
    if (taxable > 3200) {
        let amt = Math.min(taxable, 5250) - 3200;
        tax += amt * 0.20;
    }
    if (taxable > 5250) {
        let amt = Math.min(taxable, 7800) - 5250;
        tax += amt * 0.25;
    }
    if (taxable > 7800) {
        let amt = Math.min(taxable, 10900) - 7800;
        tax += amt * 0.30;
    }
    if (taxable > 10900) {
        let amt = taxable - 10900;
        tax += amt * 0.35;
    }
    return tax;
}

// Any authenticated employee can view their payslips
router.get('/my-payslips', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const userId = req.user!.id;
    const sql = `
        SELECT pi.*, pr.period_label, pr.status as run_status, pr.created_at as run_created_at 
        FROM payroll_items pi
        JOIN payroll_runs pr ON pi.run_id = pr.id AND pi.tenant_id = pr.tenant_id
        WHERE pi.user_id = $1 AND pi.tenant_id = $2
        ORDER BY pr.period_label DESC
    `;
    const items = await query(sql, [userId, tId]);
    res.json(items);
}));

// Apply role restrictions for management routes
router.use(requireRole('owner', 'admin'));

router.get('/employees', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const sql = `
        SELECT u.id, u.full_name, u.email, u.role, 
               es.base_salary, es.transport_allow, es.housing_allow, es.other_allow, es.pension_pct, es.is_active
        FROM users u 
        LEFT JOIN employee_salaries es ON es.user_id = u.id AND es.tenant_id = u.tenant_id 
        WHERE u.tenant_id = $1 AND u.is_active = true 
        ORDER BY u.full_name
    `;
    const employees = await query(sql, [tId]);
    res.json(employees);
}));

const salarySchema = z.object({
    base_salary: z.number().min(0),
    transport_allow: z.number().min(0).default(0),
    housing_allow: z.number().min(0).default(0),
    other_allow: z.number().min(0).default(0),
    pension_pct: z.number().min(0).max(100).default(7)
});

router.post('/employees/:userId', validateBody(salarySchema), asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const userId = req.params.userId;
    const { base_salary, transport_allow, housing_allow, other_allow, pension_pct } = req.body;
    
    const sql = `
        INSERT INTO employee_salaries 
        (tenant_id, user_id, base_salary, transport_allow, housing_allow, other_allow, pension_pct, is_active)
        VALUES ($1, $2, $3, $4, $5, $6, $7, true)
        ON CONFLICT (tenant_id, user_id) 
        DO UPDATE SET 
            base_salary = EXCLUDED.base_salary,
            transport_allow = EXCLUDED.transport_allow,
            housing_allow = EXCLUDED.housing_allow,
            other_allow = EXCLUDED.other_allow,
            pension_pct = EXCLUDED.pension_pct,
            is_active = EXCLUDED.is_active,
            updated_at = CURRENT_TIMESTAMP
        RETURNING *
    `;
    const updated = await queryOne(sql, [
        tId, userId, base_salary, transport_allow, housing_allow, other_allow, pension_pct
    ]);
    res.json(updated);
}));

const runSchema = z.object({
    period_label: z.string(),
    frequency: z.enum(['weekly', 'biweekly', 'monthly']).default('monthly')
});

router.post('/run', validateBody(runSchema), asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const { period_label, frequency } = req.body;
    
    // Check for existing run
    const existing = await queryOne(
        `SELECT id FROM payroll_runs WHERE tenant_id = $1 AND period_label = $2 LIMIT 1`,
        [tId, period_label]
    );
    if (existing) {
        throw new AppError(400, 'Payroll run already exists for this period', 'BAD_STATE');
    }
    
    // Get active salaries
    const salaries = await query(
        `SELECT * FROM employee_salaries WHERE tenant_id = $1 AND is_active = true`,
        [tId]
    );
    if (!salaries.length) {
        throw new AppError(400, 'No active employee salaries found', 'BAD_STATE');
    }
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const runRes = await client.query(
            `INSERT INTO payroll_runs (tenant_id, period_label, frequency, status, total_gross, total_net) 
             VALUES ($1, $2, $3, 'draft', 0, 0) RETURNING *`,
            [tId, period_label, frequency]
        );
        const runId = runRes.rows[0].id;
        
        let totalGross = 0;
        let totalNet = 0;
        
        for (const emp of salaries) {
            const base = Number(emp.base_salary) || 0;
            const transport = Number(emp.transport_allow) || 0;
            const housing = Number(emp.housing_allow) || 0;
            const other = Number(emp.other_allow) || 0;
            const pension_pct = Number(emp.pension_pct) || 0;
            
            const gross = base + transport + housing + other;
            // Only base salary is subject to tax and pension based on typical standard, but user instructions say:
            // "taxable = gross", "pension_employee = base * pension_pct/100"
            const taxable = gross;
            const income_tax = calcIncomeTax(taxable);
            const pension_employee = base * (pension_pct / 100);
            const pension_employer = base * 0.11;
            const net = gross - income_tax - pension_employee;
            
            totalGross += gross;
            totalNet += net;
            
            await client.query(
                `INSERT INTO payroll_items 
                 (tenant_id, run_id, user_id, base_salary, transport_allow, housing_allow, other_allow, gross_pay, taxable_income, income_tax, pension_employee, pension_employer, net_pay)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
                [
                    tId, runId, emp.user_id, base, transport, housing, other, 
                    gross, taxable, income_tax, pension_employee, pension_employer, net
                ]
            );
        }
        
        const updateRes = await client.query(
            `UPDATE payroll_runs SET total_gross = $1, total_net = $2 WHERE id = $3 AND tenant_id = $4 RETURNING *`,
            [totalGross, totalNet, runId, tId]
        );
        
        await client.query('COMMIT');
        
        const itemsRes = await query(
            `SELECT * FROM payroll_items WHERE run_id = $1 AND tenant_id = $2`, 
            [runId, tId]
        );
        
        res.status(201).json({ run: updateRes.rows[0], items: itemsRes });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}));

router.get('/runs', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const sql = `
        SELECT pr.*, COUNT(pi.id)::int as item_count 
        FROM payroll_runs pr
        LEFT JOIN payroll_items pi ON pi.run_id = pr.id AND pi.tenant_id = pr.tenant_id
        WHERE pr.tenant_id = $1
        GROUP BY pr.id
        ORDER BY pr.created_at DESC
    `;
    const runs = await query(sql, [tId]);
    res.json(runs);
}));

router.get('/runs/:id', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const runId = req.params.id;
    
    const run = await queryOne(`SELECT * FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tId]);
    if (!run) {
        throw new AppError(404, 'Payroll run not found', 'NOT_FOUND');
    }
    
    const items = await query(
        `SELECT pi.*, u.full_name, u.email 
         FROM payroll_items pi
         JOIN users u ON pi.user_id = u.id AND pi.tenant_id = u.tenant_id
         WHERE pi.run_id = $1 AND pi.tenant_id = $2`, 
        [runId, tId]
    );
    
    res.json({ run, items });
}));

router.patch('/runs/:id/approve', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const runId = req.params.id;
    
    const run = await queryOne(`SELECT status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tId]);
    if (!run) throw new AppError(404, 'Payroll run not found', 'NOT_FOUND');
    if (run.status !== 'draft') throw new AppError(400, 'Only draft runs can be approved', 'BAD_STATE');
    
    const updated = await queryOne(
        `UPDATE payroll_runs SET status = 'approved', approved_by = $1, approved_at = CURRENT_TIMESTAMP WHERE id = $2 AND tenant_id = $3 RETURNING *`,
        [req.user!.id, runId, tId]
    );
    res.json(updated);
}));

router.patch('/runs/:id/paid', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const runId = req.params.id;
    
    const run = await queryOne(`SELECT status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tId]);
    if (!run) throw new AppError(404, 'Payroll run not found', 'NOT_FOUND');
    if (run.status !== 'approved') throw new AppError(400, 'Only approved runs can be marked as paid', 'BAD_STATE');
    
    const updated = await queryOne(
        `UPDATE payroll_runs SET status = 'paid', updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [runId, tId]
    );
    res.json(updated);
}));

router.delete('/runs/:id', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const runId = req.params.id;
    
    const run = await queryOne(`SELECT status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tId]);
    if (!run) throw new AppError(404, 'Payroll run not found', 'NOT_FOUND');
    if (run.status !== 'draft') throw new AppError(400, 'Only draft runs can be deleted', 'BAD_STATE');
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM payroll_items WHERE run_id = $1 AND tenant_id = $2`, [runId, tId]);
        await client.query(`DELETE FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tId]);
        await client.query('COMMIT');
        res.json({ message: 'Payroll run deleted successfully' });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}));

router.get('/runs/:id/export', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const runId = req.params.id;
    
    const items = await query(
        `SELECT pi.*, u.full_name 
         FROM payroll_items pi
         JOIN users u ON pi.user_id = u.id AND pi.tenant_id = u.tenant_id
         WHERE pi.run_id = $1 AND pi.tenant_id = $2`, 
        [runId, tId]
    );
    
    if (!items.length) {
        throw new AppError(404, 'No items found to export', 'NOT_FOUND');
    }
    
    const headers = ['Full Name', 'Base Salary', 'Transport', 'Housing', 'Other', 'Gross', 'Taxable', 'Income Tax', 'Pension (Emp)', 'Pension (Employer)', 'Net Pay'];
    const csvRows = [headers.join(',')];
    
    for (const item of items) {
        const row = [
            `"${item.full_name}"`,
            item.base_salary,
            item.transport_allow,
            item.housing_allow,
            item.other_allow,
            item.gross_pay,
            item.taxable_income,
            item.income_tax,
            item.pension_employee,
            item.pension_employer,
            item.net_pay
        ];
        csvRows.push(row.join(','));
    }
    
    res.header('Content-Type', 'text/csv');
    res.attachment(`payroll_export_${runId}.csv`);
    res.send(csvRows.join('\n'));
}));

export default router;
