import { Router } from 'express';
import { z } from 'zod';
import { pool, query, queryOne } from '../config/db.js';
import { asyncHandler, AppError } from '../utils/helpers.js';
import { authenticate, requireActiveTenant, requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { calculateEmployeePayroll, buildExecutionOrder, evaluateFormula, ComponentDef, TaxBracket, TaxBracketLine } from '../utils/payrollEngine.js';

const router = Router();
router.use(authenticate, requireActiveTenant);

function tenantId(req: { user?: { tenant_id: string | null } }): string {
    return req.user!.tenant_id as string;
}

// ── Components CRUD ──────────────────────────────────────────

const componentSchema = z.object({
    code: z.string().min(1),
    label: z.string().min(1),
    category: z.enum(['EARNING', 'DEDUCTION', 'EMPLOYER_COST', 'MEMO']),
    source: z.enum(['PROFILE', 'MANUAL', 'DERIVED']),
    taxability: z.enum(['TAXABLE', 'NON_TAXABLE']),
    pensionable: z.boolean().default(false),
    formula: z.string().nullable().optional(),
    rounding_decimals: z.number().int().min(0).max(4).default(2),
    applies_to: z.string().default('ALL'),
    display_order: z.number().int().default(0)
});

router.get('/components', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const components = await query(`SELECT * FROM payroll_components WHERE tenant_id = $1 ORDER BY display_order`, [tId]);
    res.json({ components });
}));

router.post('/components', requireRole('afrotech_admin', 'owner'), validateBody(componentSchema), asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const { code, label, category, source, taxability, pensionable, formula, rounding_decimals, applies_to, display_order } = req.body;
    
    if (source === 'DERIVED' && !formula) {
        throw new AppError(400, 'Formula is required for DERIVED components', 'VALIDATION_ERROR');
    }

    if (source === 'DERIVED' && formula) {
        try {
            // Load existing to test for cycles
            const componentsList = await query(`SELECT * FROM payroll_components WHERE tenant_id = $1`, [tId]);
            const componentsMap: Record<string, ComponentDef> = {};
            for (const c of componentsList) componentsMap[c.code] = c as ComponentDef;

            // Inject the new one
            componentsMap[code] = { code, category, source, taxability, pensionable, formula, rounding_decimals } as ComponentDef;

            // Check topological sort to ensure no cycles are created
            buildExecutionOrder(componentsMap);

            // Check syntax by parsing it
            evaluateFormula(formula, { components: componentsMap, values: {}, brackets: {} });
        } catch (e: any) {
             throw new AppError(400, `Formula validation failed: ${e.message}`, 'VALIDATION_ERROR');
        }
    }

    const sql = `
        INSERT INTO payroll_components
        (tenant_id, code, label, category, source, taxability, pensionable, formula, rounding_decimals, applies_to, display_order)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        ON CONFLICT (tenant_id, code)
        DO UPDATE SET
            label = EXCLUDED.label,
            category = EXCLUDED.category,
            source = EXCLUDED.source,
            taxability = EXCLUDED.taxability,
            pensionable = EXCLUDED.pensionable,
            formula = EXCLUDED.formula,
            rounding_decimals = EXCLUDED.rounding_decimals,
            applies_to = EXCLUDED.applies_to,
            display_order = EXCLUDED.display_order,
            updated_at = NOW()
        RETURNING *
    `;
    const component = await queryOne(sql, [tId, code, label, category, source, taxability, pensionable, formula || null, rounding_decimals, applies_to, display_order]);
    res.json(component);
}));

router.delete('/components/:id', requireRole('afrotech_admin', 'owner'), asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    await query(`DELETE FROM payroll_components WHERE id = $1 AND tenant_id = $2`, [req.params.id, tId]);
    res.json({ success: true });
}));

// ── Tax Brackets CRUD ──────────────────────────────────────────

const bracketSchema = z.object({
    code: z.string().min(1),
    name: z.string().min(1),
    lines: z.array(z.object({
        min_amount: z.number().min(0),
        max_amount: z.number().nullable(),
        rate: z.number().min(0).max(100),
        deduction: z.number().min(0)
    }))
});

router.get('/brackets', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const brackets = await query(`SELECT * FROM tax_brackets WHERE tenant_id = $1`, [tId]);
    const lines = await query(`
        SELECT tbl.* FROM tax_bracket_lines tbl
        JOIN tax_brackets tb ON tbl.bracket_id = tb.id
        WHERE tb.tenant_id = $1 ORDER BY tbl.min_amount`, [tId]);

    for (const b of brackets) {
        b.lines = lines.filter(l => l.bracket_id === b.id);
    }
    res.json({ brackets });
}));

router.post('/brackets', requireRole('afrotech_admin', 'owner'), validateBody(bracketSchema), asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const { code, name, lines } = req.body;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const bRes = await client.query(`
            INSERT INTO tax_brackets (tenant_id, code, name) VALUES ($1, $2, $3)
            ON CONFLICT (tenant_id, code) DO UPDATE SET name = EXCLUDED.name RETURNING id
        `, [tId, code, name]);

        const bracketId = bRes.rows[0].id;
        await client.query(`DELETE FROM tax_bracket_lines WHERE bracket_id = $1`, [bracketId]);

        for (const line of lines) {
            await client.query(`
                INSERT INTO tax_bracket_lines (bracket_id, min_amount, max_amount, rate, deduction)
                VALUES ($1, $2, $3, $4, $5)
            `, [bracketId, line.min_amount, line.max_amount, line.rate, line.deduction]);
        }
        await client.query('COMMIT');
        res.json({ success: true });
    } catch (err) {
        await client.query('ROLLBACK');
        throw err;
    } finally {
        client.release();
    }
}));


// ── Employees Salary Profile ─────────────────────────────────

router.get('/employees', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const sql = `
        SELECT u.id, u.full_name, u.email, es.profile_values, es.is_active
        FROM users u
        LEFT JOIN employee_salaries es ON es.user_id = u.id AND es.tenant_id = u.tenant_id
        WHERE u.tenant_id = $1 AND u.role != 'patient'
        ORDER BY u.full_name
    `;
    const employees = await query(sql, [tId]);
    // Send defaults if profile_values is null
    res.json({ employees: employees.map(e => ({ ...e, profile_values: e.profile_values || {} })) });
}));

router.post('/employees/:id', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const userId = req.params.id;
    const { profile_values } = req.body;
    
    // We still have the old columns for backward compatibility for now if we didn't drop them,
    // but we use profile_values going forward.
    const sql = `
        INSERT INTO employee_salaries 
        (tenant_id, user_id, profile_values, is_active)
        VALUES ($1, $2, $3, true)
        ON CONFLICT (tenant_id, user_id) 
        DO UPDATE SET 
            profile_values = EXCLUDED.profile_values,
            is_active = EXCLUDED.is_active
        RETURNING *
    `;
    const updated = await queryOne(sql, [tId, userId, profile_values || {}]);
    res.json(updated);
}));

// ── Payroll Runs ──────────────────────────────────────────

const runSchema = z.object({
    period_label: z.string().min(1).optional(),
    period_header: z.string().min(1).optional(),
    frequency: z.enum(['weekly', 'biweekly', 'monthly']).default('monthly'),
    overrides: z.record(z.record(z.object({ value: z.union([z.number(), z.string()]), reason: z.string(), by: z.string() }))).optional(),
    dry_run: z.boolean().default(false)
});

router.post('/run', validateBody(runSchema), asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const { frequency, dry_run } = req.body;
    const overrides = req.body.overrides || {};
    const period_label: string = String(req.body.period_label ?? req.body.period_header ?? '').trim();
    if (!period_label && !dry_run) throw new AppError(400, 'period_label is required', 'VALIDATION_ERROR');
    
    if (!dry_run) {
        const existing = await queryOne(
            `SELECT id FROM payroll_runs WHERE tenant_id = $1 AND period_label = $2 LIMIT 1`,
            [tId, period_label]
        );
        if (existing) throw new AppError(400, 'Payroll run already exists for this period', 'BAD_STATE');
    }

    // Load Engine configurations
    const componentsList = await query(`SELECT * FROM payroll_components WHERE tenant_id = $1`, [tId]);
    if (!componentsList.length) throw new AppError(400, 'No payroll components defined', 'BAD_STATE');

    const componentsMap: Record<string, ComponentDef> = {};
    for (const c of componentsList) componentsMap[c.code] = c as ComponentDef;

    const bracketsList = await query(`SELECT * FROM tax_brackets WHERE tenant_id = $1`, [tId]);
    const linesList = await query(`
        SELECT tbl.* FROM tax_bracket_lines tbl
        JOIN tax_brackets tb ON tbl.bracket_id = tb.id
        WHERE tb.tenant_id = $1 ORDER BY tbl.min_amount`, [tId]);

    const bracketsMap: Record<string, TaxBracket> = {};
    for (const b of bracketsList) {
        bracketsMap[b.code] = {
            code: b.code,
            lines: linesList.filter(l => l.bracket_id === b.id) as TaxBracketLine[]
        };
    }
    
    // Get active salaries
    const salaries = await query(
        `SELECT es.*, u.full_name
         FROM employee_salaries es
         JOIN users u ON u.id = es.user_id AND u.tenant_id = es.tenant_id
         WHERE es.tenant_id = $1 AND es.is_active = true`,
        [tId]
    );
    if (!salaries.length) throw new AppError(400, 'No active employee salaries found', 'BAD_STATE');

    let totalGross = 0;
    let totalNet = 0;
    const computedItems: any[] = [];

    for (const emp of salaries) {
        const profileVals = emp.profile_values || {};
        const empOverrides = overrides[emp.user_id] || {};

        try {
            const { values, netPay } = calculateEmployeePayroll(componentsMap, bracketsMap, profileVals, empOverrides);

            // Extract Gross for total if it exists, otherwise sum earnings
            let gross = values['GROSS'];
            if (gross === undefined) {
               gross = 0;
               for (const [code, def] of Object.entries(componentsMap)) {
                   if (def.category === 'EARNING') gross += (typeof values[code] === 'number' ? values[code] as number : 0);
               }
            }

            totalGross += (typeof gross === 'number' ? gross : 0);
            totalNet += netPay;

            computedItems.push({
                user_id: emp.user_id,
                employee_name: emp.full_name ?? 'Employee',
                values,
                overrides: empOverrides,
                net_pay: netPay
            });
        } catch (err: any) {
             throw new AppError(400, `Error calculating for ${emp.full_name}: ${err.message}`, 'CALCULATION_ERROR');
        }
    }
    
    if (dry_run) {
        return res.json({ run: { period_label, frequency, total_gross: totalGross, total_net: totalNet, status: 'calculated' }, items: computedItems });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        const runRes = await client.query(
            `INSERT INTO payroll_runs (tenant_id, period_label, frequency, status, total_gross, total_net, created_by, prepared_by, components_snapshot)
             VALUES ($1, $2, $3, 'calculated', $4, $5, $6, $6, $7) RETURNING *`,
            [tId, period_label, frequency, totalGross, totalNet, req.user!.id, JSON.stringify(componentsMap)]
        );
        const runId = runRes.rows[0].id;
        
        for (const item of computedItems) {
            await client.query(
                `INSERT INTO payroll_lines
                 (tenant_id, payroll_run_id, user_id, employee_name, values, overrides, net_pay)
                 VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                [
                    tId, runId, item.user_id, item.employee_name,
                    JSON.stringify(item.values), JSON.stringify(item.overrides), item.net_pay
                ]
            );
        }
        
        await client.query('COMMIT');
        
        const itemsRes = await query(
            `SELECT * FROM payroll_lines WHERE payroll_run_id = $1 AND tenant_id = $2 ORDER BY employee_name`,
            [runId, tId]
        );
        
        res.status(201).json({ run: { ...runRes.rows[0], items: itemsRes }, items: itemsRes });
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
        SELECT pr.*, COUNT(pl.id)::int as item_count
        FROM payroll_runs pr
        LEFT JOIN payroll_lines pl ON pl.payroll_run_id = pr.id AND pl.tenant_id = pr.tenant_id
        WHERE pr.tenant_id = $1
        GROUP BY pr.id
        ORDER BY pr.created_at DESC
    `;
    const runs = await query(sql, [tId]);
    res.json({ runs });
}));

router.get('/runs/:id', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const runId = req.params.id;
    
    const run = await queryOne(`SELECT * FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tId]);
    if (!run) throw new AppError(404, 'Payroll run not found', 'NOT_FOUND');
    
    const items = await query(
        `SELECT pl.*, u.full_name, u.email
         FROM payroll_lines pl
         JOIN users u ON pl.user_id = u.id AND pl.tenant_id = u.tenant_id
         WHERE pl.payroll_run_id = $1 AND pl.tenant_id = $2`,
        [runId, tId]
    );
    
    res.json({ run: { ...run, items }, items });
}));

router.patch('/runs/:id/approve', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const runId = req.params.id;
    
    const run = await queryOne(`SELECT status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tId]);
    if (!run) throw new AppError(404, 'Payroll run not found', 'NOT_FOUND');
    if (run.status === 'paid') throw new AppError(400, 'Already paid', 'BAD_STATE');
    
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
        `UPDATE payroll_runs SET status = 'paid' WHERE id = $1 AND tenant_id = $2 RETURNING *`,
        [runId, tId]
    );
    res.json(updated);
}));

router.delete('/runs/:id', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const runId = req.params.id;
    
    const run = await queryOne(`SELECT status FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tId]);
    if (!run) throw new AppError(404, 'Payroll run not found', 'NOT_FOUND');
    if (run.status === 'paid') throw new AppError(400, 'Cannot delete paid runs', 'BAD_STATE');
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM payroll_lines WHERE payroll_run_id = $1 AND tenant_id = $2`, [runId, tId]);
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

router.get('/my-payslips', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const sql = `
        SELECT pl.*, pr.period_label, pr.status, pr.created_at as run_date, pr.components_snapshot
        FROM payroll_lines pl
        JOIN payroll_runs pr ON pl.payroll_run_id = pr.id
        WHERE pl.user_id = $1 AND pl.tenant_id = $2 AND pr.status IN ('approved', 'paid')
        ORDER BY pr.created_at DESC
    `;
    const payslips = await query(sql, [req.user!.id, tId]);
    res.json({ payslips });
}));

router.get('/runs/:id/export', asyncHandler(async (req, res) => {
    const tId = tenantId(req);
    const runId = req.params.id;
    
    const run = await queryOne(`SELECT * FROM payroll_runs WHERE id = $1 AND tenant_id = $2`, [runId, tId]);
    if (!run) throw new AppError(404, 'Payroll run not found', 'NOT_FOUND');

    const componentsMap = run.components_snapshot || {};
    const cols = Object.keys(componentsMap).sort((a,b) => componentsMap[a].display_order - componentsMap[b].display_order);

    const items = await query(
        `SELECT pl.*, u.full_name
         FROM payroll_lines pl
         JOIN users u ON pl.user_id = u.id AND pl.tenant_id = u.tenant_id
         WHERE pl.payroll_run_id = $1 AND pl.tenant_id = $2`,
        [runId, tId]
    );
    
    if (!items.length) {
        throw new AppError(404, 'No items found to export', 'NOT_FOUND');
    }
    
    const headers = ['Employee', ...cols, 'Net Pay'];
    const csvRows = [headers.join(',')];
    
    for (const item of items) {
        const row = [`"${item.full_name ?? item.employee_name ?? ''}"`];
        for (const col of cols) {
           row.push(item.values[col] ?? 0);
        }
        row.push(item.net_pay);
        csvRows.push(row.join(','));
    }
    
    res.header('Content-Type', 'text/csv');
    res.attachment(`payroll_export_${runId}.csv`);
    res.send(csvRows.join('\n'));
}));

export default router;
