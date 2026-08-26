import { Router } from 'express'
import { z } from 'zod'
import { pool, query, queryOne } from '../config/db.js'
import { asyncHandler, AppError, nextCode, parsePagination, withTransaction } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { authenticate, requireActiveTenant, requireRole } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'

const router = Router()
router.use(authenticate, requireActiveTenant)

function tenantId(req: { user?: { tenant_id: string | null } }): string {
  return req.user!.tenant_id as string
}

/* ══════════════════ PRODUCTS ══════════════════ */

router.get(
  '/products',
  asyncHandler(async (req, res) => {
    const t = tenantId(req)
    const search = String(req.query.search || '').trim()
    const params: unknown[] = [t]
    let where = `WHERE p.tenant_id = $1`
    if (search) {
      params.push(`%${search}%`)
      where += ` AND (p.name ILIKE $${params.length} OR p.category ILIKE $${params.length})`
    }
    const rows = await query(
      `SELECT p.*, COALESCE(b.stock, 0)::int AS stock,
              COALESCE(b.sellable, 0)::int AS sellable_stock,
              COALESCE(b.expired_qty, 0)::int AS expired_qty,
              b.expiring_soon::int AS expiring_soon,
              CASE WHEN p.sell_by_pill THEN COALESCE(b.sellable,0) * p.pills_per_unit + p.loose_pills ELSE COALESCE(b.sellable,0) END::int AS display_stock
       FROM products p
       LEFT JOIN (
         SELECT product_id, SUM(quantity) AS stock,
                SUM(CASE WHEN expiry_date IS NULL OR expiry_date >= CURRENT_DATE THEN quantity ELSE 0 END) AS sellable,
                SUM(CASE WHEN expiry_date < CURRENT_DATE AND quantity > 0 THEN quantity ELSE 0 END) AS expired_qty,
                SUM(CASE WHEN expiry_date IS NOT NULL AND expiry_date <= CURRENT_DATE + 90 AND quantity > 0 THEN quantity ELSE 0 END) AS expiring_soon
         FROM product_batches WHERE tenant_id = $1 GROUP BY product_id
       ) b ON b.product_id = p.id
       ${where}
       ORDER BY p.name ASC LIMIT 500`,
      params
    )
    res.json({ products: rows })
  })
)

const productSchema = z.object({
  name: z.string().trim().min(1).max(160),
  category: z.string().trim().max(80).default('General'),
  unit: z.string().trim().max(40).default('pcs'),
  sell_price: z.number().min(0),
  cost_price: z.number().min(0).default(0),
  low_stock_threshold: z.number().int().min(0).default(10),
  barcode: z.string().trim().max(60).optional().nullable(),
  // PPR parity: pill-level selling + margin defaults
  sell_by_pill: z.boolean().default(false),
  pills_per_unit: z.number().int().min(1).default(1),
  default_margin: z.number().min(0).max(1000).default(25),
})
router.post(
  '/products',
  validateBody(productSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof productSchema>
    const row = await queryOne(
      `INSERT INTO products (tenant_id, name, category, unit, sell_price, cost_price, low_stock_threshold, barcode, sell_by_pill, pills_per_unit, default_margin)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [tenantId(req), d.name, d.category, d.unit, d.sell_price, d.cost_price, d.low_stock_threshold, d.barcode || null, d.sell_by_pill, d.pills_per_unit, d.default_margin]
    )
    logAudit({ tenantId: tenantId(req), userId: req.user!.id, userName: req.user!.full_name, action: 'product.create', entity: 'product', entityId: row!.id, details: { name: d.name } })
    res.status(201).json({ product: row })
  })
)

/** GET /retail/products/barcode/:code — scan-to-cart lookup */
router.get(
  '/products/barcode/:code',
  asyncHandler(async (req, res) => {
    const row = await queryOne(
      `SELECT p.*, COALESCE((SELECT SUM(quantity) FROM product_batches b WHERE b.product_id = p.id AND (b.expiry_date IS NULL OR b.expiry_date >= CURRENT_DATE)),0)::int AS stock
       FROM products p WHERE p.tenant_id = $1 AND p.barcode = $2 LIMIT 1`,
      [tenantId(req), req.params.code]
    )
    if (!row) throw new AppError(404, 'No product with that barcode', 'NOT_FOUND')
    res.json({ product: row })
  })
)

router.patch(
  '/products/:id',
  validateBody(productSchema.partial()),
  asyncHandler(async (req, res) => {
    const d = req.body as Partial<z.infer<typeof productSchema>>
    const cur = await queryOne<{
      name: string
      category: string
      unit: string
      sell_price: string
      cost_price: string
      low_stock_threshold: number
      barcode: string | null
      sell_by_pill: boolean
      pills_per_unit: number
      default_margin: string
    }>(`SELECT name, category, unit, sell_price, cost_price, low_stock_threshold, barcode, sell_by_pill, pills_per_unit, default_margin FROM products WHERE id = $1 AND tenant_id = $2`, [
      req.params.id,
      tenantId(req),
    ])
    if (!cur) throw new AppError(404, 'Product not found', 'NOT_FOUND')
    const row = await queryOne(
      `UPDATE products SET name=$3, category=$4, unit=$5, sell_price=$6, cost_price=$7, low_stock_threshold=$8, barcode=$9,
              sell_by_pill=$10, pills_per_unit=$11, default_margin=$12
       WHERE id=$1 AND tenant_id=$2 RETURNING *`,
      [
        req.params.id,
        tenantId(req),
        d.name ?? cur.name,
        d.category ?? cur.category,
        d.unit ?? cur.unit,
        d.sell_price ?? Number(cur.sell_price),
        d.cost_price ?? Number(cur.cost_price),
        d.low_stock_threshold ?? cur.low_stock_threshold,
        'barcode' in d ? (d.barcode || null) : cur.barcode,
        d.sell_by_pill ?? cur.sell_by_pill,
        d.pills_per_unit ?? cur.pills_per_unit,
        d.default_margin ?? Number(cur.default_margin),
      ]
    )
    logAudit({ tenantId: tenantId(req), userId: req.user!.id, userName: req.user!.full_name, action: 'product.update', entity: 'product', entityId: req.params.id, details: { name: row?.name } })
    res.json({ product: row })
  })
)

/** GET /api/v1/retail/products/:id/batches — batch list for restock/expiry view */
router.get(
  '/products/:id/batches',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT * FROM product_batches WHERE product_id = $1 AND tenant_id = $2 ORDER BY expiry_date NULLS LAST, created_at ASC`,
      [req.params.id, tenantId(req)]
    )
    res.json({ batches: rows })
  })
)

/* ══════════════════ SUPPLIERS / CUSTOMERS ══════════════════ */

const personSchema = z.object({
  name: z.string().trim().min(1).max(160),
  phone: z.string().trim().max(40).optional().nullable(),
  email: z.string().trim().email().optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  payment_terms: z.number().int().min(0).max(365).optional(),
})

/** Suppliers list with computed outstanding balance (purchases due − payments) + payment terms */
router.get(
  '/suppliers',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT s.*,
              COALESCE(due.total - COALESCE(due.paid, 0), 0) - COALESCE(pay.paid, 0) AS balance
       FROM suppliers s
       LEFT JOIN (
         SELECT supplier_id, SUM(total) AS total, SUM(paid_amount) AS paid
         FROM purchases WHERE tenant_id = $1 AND record_status = 'Active' GROUP BY supplier_id
       ) due ON due.supplier_id = s.id
       LEFT JOIN (
         SELECT supplier_id, SUM(amount) AS paid FROM supplier_payments WHERE tenant_id = $1 GROUP BY supplier_id
       ) pay ON pay.supplier_id = s.id
       WHERE s.tenant_id = $1
       ORDER BY s.name ASC LIMIT 1000`,
      [tenantId(req)]
    )
    res.json({ suppliers: rows })
  })
)

for (const [path, table] of [['suppliers', 'suppliers'], ['customers', 'customers']] as const) {
  router.get(
    `/${path}`,
    asyncHandler(async (req, res) => {
      const rows = await query(`SELECT * FROM ${table} WHERE tenant_id = $1 ORDER BY name ASC LIMIT 1000`, [tenantId(req)])
      res.json({ [path]: rows })
    })
  )
  router.post(
    `/${path}`,
    validateBody(personSchema),
    asyncHandler(async (req, res) => {
      const d = req.body as z.infer<typeof personSchema>
      if (table === 'suppliers') {
        const row = await queryOne(
          `INSERT INTO suppliers (tenant_id, name, phone, email, address, payment_terms) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [tenantId(req), d.name, d.phone ?? null, d.email ?? null, d.address ?? null, d.payment_terms ?? 30]
        )
        return res.status(201).json({ supplier: row })
      }
      const row = await queryOne(`INSERT INTO customers (tenant_id, name, phone, email) VALUES ($1,$2,$3,$4) RETURNING *`, [
        tenantId(req),
        d.name,
        d.phone ?? null,
        d.email ?? null,
      ])
      return res.status(201).json({ customer: row })
    })
  )
  router.delete(
    `/${path}/:id`,
    asyncHandler(async (req, res) => {
      const n = await queryOne<{ n: string }>(`DELETE FROM ${table} WHERE id = $1 AND tenant_id = $2 RETURNING 1 AS n`, [
        req.params.id,
        tenantId(req),
      ])
      if (!n) throw new AppError(404, 'Not found', 'NOT_FOUND')
      res.json({ ok: true })
    })
  )
}

/* ══════════════════ SALES / POS ══════════════════ */

const saleSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().positive(),
        // PPR parity: margin-based pricing (percent markup over cost). Falls back to list price.
        margin: z.number().min(0).max(1000).optional(),
        unit_price: z.number().min(0).optional(),
      })
    )
    .min(1),
  customer_id: z.string().uuid().nullable().optional(),
  discount: z.number().min(0).default(0),
  payment_method: z.enum(['cash', 'card', 'mobile', 'credit']).default('cash'),
  amount_paid: z.number().min(0).default(0),
})

/**
 * POST /api/v1/retail/sales — atomic POS checkout.
 * PPR parity: FEFO batch deduction, sell-by-pill products (quantity = PILLS,
 * loose pills used first, packs broken as needed), margin-based unit pricing,
 * cash drawer shift accumulation.
 */
router.post(
  '/sales',
  validateBody(saleSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof saleSchema>
    const t = tenantId(req)

    const result = await withTransaction(pool, async (client) => {
      // Lock product rows to prevent overselling under concurrency
      const ids = d.items.map((i) => i.product_id)
      const { rows: prods } = await client.query<{
        id: string
        name: string
        sell_price: string
        sell_by_pill: boolean
        pills_per_unit: number
        loose_pills: number
        loose_pills_batch_id: string | null
      }>(
        `SELECT id, name, sell_price, sell_by_pill, pills_per_unit, loose_pills, loose_pills_batch_id
         FROM products WHERE tenant_id = $1 AND id = ANY($2::uuid[]) FOR UPDATE`,
        [t, ids]
      )
      const prodMap = new Map(prods.map((p) => [p.id, p]))

      let subtotal = 0
      const lines: {
        product_id: string
        batch_id: string | null
        name: string
        quantity: number
        unit_price: number
        cost_price: number
        line_total: number
        margin_used: number
        sold_as_pills: boolean
      }[] = []

      for (const item of d.items) {
        const prod = prodMap.get(item.product_id)
        if (!prod) throw new AppError(404, `Product not found: ${item.product_id}`, 'PRODUCT_MISSING')

        // Real-life compliance: expired batches are NEVER dispensed — they stay
        // in stock for the Expiry page's write-off flow only.
        const { rows: batches } = await client.query<{ id: string; quantity: number; cost_price: string }>(
          `SELECT id, quantity, cost_price FROM product_batches
           WHERE tenant_id = $1 AND product_id = $2 AND quantity > 0
             AND (expiry_date IS NULL OR expiry_date >= CURRENT_DATE)
           ORDER BY expiry_date NULLS LAST, created_at ASC FOR UPDATE`,
          [t, item.product_id]
        )
        const availableUnits = batches.reduce((s, b) => s + Number(b.quantity), 0)

        if (prod.sell_by_pill) {
          // ── Pill-level sale (PPR deductPillsFEFO port) ──
          const ppu = Math.max(1, prod.pills_per_unit)
          const availablePills = availableUnits * ppu + prod.loose_pills
          if (availablePills < item.quantity)
            throw new AppError(400, `Insufficient stock for "${prod.name}" — ${availablePills} pills left`, 'OUT_OF_STOCK')

          let loose = prod.loose_pills
          let looseBatchId = prod.loose_pills_batch_id
          let perPillCost = 0

          if (loose >= item.quantity) {
            // Enough loose pills already broken out
            loose -= item.quantity
            if (looseBatchId) {
              const b = batches.find((x) => x.id === looseBatchId)
              perPillCost = b ? Number(b.cost_price) / ppu : 0
            }
          } else {
            // Break whole packs FEFO
            const unitsToBreak = Math.ceil((item.quantity - loose) / ppu)
            let brokenPills = 0
            let brokenCost = 0
            let remaining = unitsToBreak
            for (const b of batches) {
              if (remaining <= 0) break
              const take = Math.min(Number(b.quantity), remaining)
              await client.query(`UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`, [take, b.id])
              brokenPills += take * ppu
              brokenCost += take * Number(b.cost_price)
              looseBatchId = b.id
              remaining -= take
            }
            loose = loose + brokenPills - item.quantity
            perPillCost = brokenPills > 0 ? brokenCost / brokenPills : 0
          }

          await client.query(`UPDATE products SET loose_pills = $1, loose_pills_batch_id = $2 WHERE id = $3`, [
            loose,
            looseBatchId ?? prod.loose_pills_batch_id,
            item.product_id,
          ])

          // Price: margin-based (over per-pill cost) or list per-pill price
          const listPerPill = Number(prod.sell_price) / ppu
          const unitPrice =
            item.unit_price !== undefined
              ? item.unit_price
              : item.margin !== undefined
                ? perPillCost * (1 + item.margin / 100)
                : listPerPill
          subtotal += item.quantity * unitPrice
          lines.push({
            product_id: item.product_id,
            batch_id: looseBatchId,
            name: prod.name,
            quantity: item.quantity,
            unit_price: unitPrice,
            cost_price: perPillCost,
            line_total: item.quantity * unitPrice,
            margin_used: item.margin ?? 0,
            sold_as_pills: true,
          })
        } else {
          // ── Whole-unit sale with FEFO ──
          if (availableUnits < item.quantity)
            throw new AppError(400, `Insufficient stock for "${prod.name}" — ${availableUnits} left`, 'OUT_OF_STOCK')

          let remaining = item.quantity
          while (remaining > 0) {
            const batch = batches.find((b) => Number(b.quantity) > 0)!
            const take = Math.min(Number(batch.quantity), remaining)
            await client.query(`UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`, [take, batch.id])
            remaining -= take
            const cost = Number(batch.cost_price)
            const unitPrice =
              item.unit_price !== undefined ? item.unit_price : item.margin !== undefined ? cost * (1 + item.margin / 100) : Number(prod.sell_price)
            lines.push({
              product_id: item.product_id,
              batch_id: batch.id,
              name: prod.name,
              quantity: take,
              unit_price: unitPrice,
              cost_price: cost,
              line_total: take * unitPrice,
              margin_used: item.margin ?? 0,
              sold_as_pills: false,
            })
          }
          const firstLine = lines[lines.length - 1]
          subtotal += item.quantity * (firstLine?.unit_price ?? Number(prod.sell_price))
        }
      }
      subtotal = lines.reduce((s, l) => s + l.line_total, 0)

      const total = Math.max(0, subtotal - d.discount)
      const changeDue = Math.max(0, d.amount_paid - total)
      const invoiceNo = await nextCode(client, 'sales', 'INV', t)

      const saleRow = await client.query(
        `INSERT INTO sales (tenant_id, user_id, customer_id, subtotal, discount, total, payment_method, amount_paid, change_due, invoice_no)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [t, req.user!.id, d.customer_id ?? null, subtotal, d.discount, total, d.payment_method, d.amount_paid, changeDue, invoiceNo]
      )
      for (const l of lines) {
        await client.query(
          `INSERT INTO sale_items (tenant_id, sale_id, product_id, batch_id, name, quantity, unit_price, cost_price, line_total, margin_used, sold_as_pills)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [t, saleRow.rows[0].id, l.product_id, l.batch_id, l.name, l.quantity, l.unit_price, l.cost_price, l.line_total, l.margin_used, l.sold_as_pills]
        )
      }

      // ── Cash drawer shift accumulation (PPR parity) ──
      if (d.payment_method !== 'credit') {
        const field = d.payment_method === 'card' ? 'card_sales' : d.payment_method === 'mobile' ? 'mobile_sales' : 'cash_sales'
        await client.query(
          `UPDATE cash_drawer_shifts SET ${field} = ${field} + $1
           WHERE tenant_id = $2 AND user_id = $3 AND status = 'open'`,
          [total, t, req.user!.id]
        )
      }

      return { sale: saleRow.rows[0], items: lines }
    })

    logAudit({ tenantId: t, userId: req.user!.id, userName: req.user!.full_name, action: 'sale.create', entity: 'sale', entityId: result.sale.id, details: { total: result.sale.total, items: d.items.length } })
    res.status(201).json(result)
  })
)

/** GET /api/v1/retail/sales — history with filters */
router.get(
  '/sales',
  asyncHandler(async (req, res) => {
    const t = tenantId(req)
    const { limit, offset, page } = parsePagination(req.query as Record<string, string>)
    const params: unknown[] = [t]
    let where = `WHERE s.tenant_id = $1`
    if (req.query.from) {
      params.push(String(req.query.from))
      where += ` AND s.created_at >= $${params.length}::date`
    }
    if (req.query.to) {
      params.push(String(req.query.to))
      where += ` AND s.created_at < ($${params.length}::date + interval '1 day')`
    }
    params.push(limit, offset)
    const rows = await query(
      `SELECT s.*, c.name AS customer_name, u.full_name AS cashier,
              (SELECT json_agg(json_build_object('product_id', si.product_id, 'name', si.name, 'quantity', si.quantity, 'unit_price', si.unit_price, 'sold_as_pills', si.sold_as_pills, 'margin_used', si.margin_used))
               FROM sale_items si WHERE si.sale_id = s.id) AS items
       FROM sales s
       LEFT JOIN customers c ON c.id = s.customer_id
       LEFT JOIN users u ON u.id = s.user_id
       ${where} ORDER BY s.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    )
    const total = await queryOne<{ n: string }>(`SELECT count(*) AS n FROM sales s ${where}`, params.slice(0, Math.max(1, params.length - 2)))
    res.json({ sales: rows, page, limit, total: Number(total?.n ?? 0) })
  })
)

/** POST /api/v1/retail/sales/:id/refund — restore stock & mark refunded */
router.post(
  '/sales/:id/refund',
  asyncHandler(async (req, res) => {
    const t = tenantId(req)
    const result = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `SELECT id FROM sales WHERE id = $1 AND tenant_id = $2 AND status = 'completed' FOR UPDATE`,
        [req.params.id, t]
      )
      if (!rows.length) throw new AppError(404, 'Sale not found or already refunded', 'NOT_FOUND')

      const items = await client.query<{ product_id: string; batch_id: string | null; quantity: number }>(
        `SELECT product_id, batch_id, quantity FROM sale_items WHERE sale_id = $1`,
        [req.params.id]
      )
      for (const it of items.rows) {
        if (it.batch_id) {
          await client.query(`UPDATE product_batches SET quantity = quantity + $1 WHERE id = $2`, [it.quantity, it.batch_id])
        } else if (it.product_id) {
          // Legacy sale without batch info — restore into a single 'REFUND' batch (create once, then increment)
          const refundBatch = await client.query<{ id: string }>(
            `SELECT id FROM product_batches WHERE tenant_id = $1 AND product_id = $2 AND batch_no = 'REFUND' LIMIT 1 FOR UPDATE`,
            [t, it.product_id]
          )
          let batchId = refundBatch.rows[0]?.id
          if (!batchId) {
            const created = await client.query<{ id: string }>(
              `INSERT INTO product_batches (tenant_id, product_id, batch_no, quantity) VALUES ($1,$2,'REFUND',0) RETURNING id`,
              [t, it.product_id]
            )
            batchId = created.rows[0].id
          }
          await client.query(`UPDATE product_batches SET quantity = quantity + $2 WHERE id = $1`, [batchId, it.quantity])
        }
      }
      return client.query(`UPDATE sales SET status = 'refunded' WHERE id = $1 RETURNING *`, [req.params.id])
    })
    // Reflect refund in the processor's open cash drawer shift
    const refunded = Number(result.rows[0]?.total ?? 0)
    const method = String(result.rows[0]?.payment_method ?? 'cash')
    if (refunded > 0 && method !== 'credit') {
      const field = method === 'card' ? 'card_sales' : method === 'mobile' ? 'mobile_sales' : 'cash_sales'
      await query(`UPDATE cash_drawer_shifts SET ${field} = GREATEST(0, ${field} - $1) WHERE tenant_id = $2 AND user_id = $3 AND status = 'open'`, [
        refunded,
        t,
        req.user!.id,
      ])
    }
    logAudit({ tenantId: t, userId: req.user!.id, userName: req.user!.full_name, action: 'sale.refund', entity: 'sale', entityId: req.params.id })
    res.json({ sale: result.rows[0] })
  })
)

/* ══════════════════ STRUCTURED RETURNS (PPR parity) ══════════════════ */

const RETURN_REASONS = ['Damaged', 'Expired', 'WrongItem', 'CustomerReturn', 'Other'] as const

router.get(
  '/returns',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT r.*, si.name AS product_name, u.full_name AS processed_by, s.invoice_no
       FROM sale_returns r
       LEFT JOIN sale_items si ON si.sale_id = r.sale_id AND si.product_id = r.product_id AND si.sold_as_pills = r.sold_as_pills
       LEFT JOIN users u ON u.id = r.user_id
       LEFT JOIN sales s ON s.id = r.sale_id
       WHERE r.tenant_id = $1 ORDER BY r.created_at DESC LIMIT 200`,
      [tenantId(req)]
    )
    // Deduplicate (sale_items may have multiple batch rows per product)
    const seen = new Set<string>()
    const unique = rows.filter((r) => {
      const k = String(r.id)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    res.json({ returns: unique })
  })
)

const returnSchema = z.object({
  product_id: z.string().uuid(),
  quantity: z.number().int().positive(),
  reason: z.enum(RETURN_REASONS),
  sold_as_pills: z.boolean().default(false),
})
/** POST /sales/:id/returns — per-item return with reason; resalable stock goes back */
router.post(
  '/sales/:id/returns',
  validateBody(returnSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof returnSchema>
    const t = tenantId(req)

    const result = await withTransaction(pool, async (client) => {
      const { rows: items } = await client.query<{ quantity: number; unit_price: string; sold_as_pills: boolean; name: string }>(
        `SELECT quantity, unit_price, sold_as_pills, name FROM sale_items
         WHERE sale_id = $1 AND tenant_id = $2 AND product_id = $3 AND sold_as_pills = $4`,
        [req.params.id, t, d.product_id, d.sold_as_pills]
      )
      if (!items.length) throw new AppError(404, 'Product not found on this sale', 'NOT_FOUND')
      const sold = items.reduce((s, i) => s + i.quantity, 0)

      const { rows: prior } = await client.query<{ returned: string }>(
        `SELECT COALESCE(SUM(quantity),0)::text AS returned FROM sale_returns
         WHERE sale_id = $1 AND product_id = $2 AND sold_as_pills = $3`,
        [req.params.id, d.product_id, d.sold_as_pills]
      )
      const alreadyReturned = Number(prior[0]?.returned ?? 0)
      if (alreadyReturned + d.quantity > sold)
        throw new AppError(400, `Cannot return more than sold — sold ${sold}, already returned ${alreadyReturned}`, 'TOO_MANY')

      const unitPrice = Number(items[0].unit_price)
      const refundAmount = d.quantity * unitPrice
      const isResalable = d.reason !== 'Damaged' && d.reason !== 'Expired'

      const { rows: prodRows } = await client.query<{ sell_by_pill: boolean; pills_per_unit: number; loose_pills: number; loose_pills_batch_id: string | null }>(
        `SELECT sell_by_pill, pills_per_unit, loose_pills, loose_pills_batch_id FROM products WHERE id = $1 AND tenant_id = $2 FOR UPDATE`,
        [d.product_id, t]
      )
      const pillProduct = prodRows[0]?.sell_by_pill ?? false

      if (isResalable) {
        if (pillProduct || d.sold_as_pills) {
          // Pills go back to the loose pill pool (PPR behavior)
          const { rows: origBatch } = await client.query<{ batch_id: string | null }>(
            `SELECT batch_id FROM sale_items WHERE sale_id = $1 AND product_id = $2 LIMIT 1`,
            [req.params.id, d.product_id]
          )
          await client.query(
            `UPDATE products SET loose_pills = loose_pills + $1,
                    loose_pills_batch_id = COALESCE(loose_pills_batch_id, $2)
             WHERE id = $3 AND tenant_id = $4`,
            [d.quantity, origBatch[0]?.batch_id ?? null, d.product_id, t]
          )
        } else {
          // Units: restock into the original batch, else a fresh RETURN batch
          const { rows: origBatch } = await client.query<{ batch_id: string | null }>(
            `SELECT batch_id FROM sale_items WHERE sale_id = $1 AND product_id = $2 LIMIT 1`,
            [req.params.id, d.product_id]
          )
          const batchId = origBatch[0]?.batch_id ?? null
          if (batchId) {
            await client.query(`UPDATE product_batches SET quantity = quantity + $1 WHERE id = $2 AND tenant_id = $3`, [d.quantity, batchId, t])
          } else {
            await client.query(
              `INSERT INTO product_batches (tenant_id, product_id, batch_no, quantity, cost_price)
               VALUES ($1,$2,'RETURN',$3,(SELECT cost_price FROM products WHERE id = $2))`,
              [t, d.product_id, d.quantity]
            )
          }
        }
      }

      const { rows: ret } = await client.query(
        `INSERT INTO sale_returns (tenant_id, sale_id, product_id, user_id, quantity, sold_as_pills, reason, refund_amount, is_resalable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
        [t, req.params.id, d.product_id, req.user!.id, d.quantity, d.sold_as_pills, d.reason, refundAmount, isResalable]
      )

      // Refund leaves the drawer of the processor's open shift
      const field = 'cash_sales'
      await client.query(
        `UPDATE cash_drawer_shifts SET ${field} = GREATEST(0, ${field} - $1)
         WHERE tenant_id = $2 AND user_id = $3 AND status = 'open'`,
        [refundAmount, t, req.user!.id]
      )
      return ret[0]
    })

    logAudit({ tenantId: t, userId: req.user!.id, userName: req.user!.full_name, action: 'sale.return', entity: 'sale', entityId: req.params.id, details: { qty: d.quantity, reason: d.reason, refund: result.refund_amount } })
    res.status(201).json({ return: result })
  })
)

/* ══════════════════ CASH DRAWER SHIFTS (PPR parity) ══════════════════ */

router.get(
  '/shift',
  asyncHandler(async (req, res) => {
    const row = await queryOne(
      `SELECT * FROM cash_drawer_shifts WHERE tenant_id = $1 AND user_id = $2 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [tenantId(req), req.user!.id]
    )
    if (!row) return res.json({ shift: null })
    const expected = Number(row.opening_balance) + Number(row.cash_sales) - Number(row.expenses)
    res.json({ shift: { ...row, expected_cash: expected } })
  })
)

const startShiftSchema = z.object({ opening_balance: z.number().min(0).default(0) })
router.post(
  '/shift/start',
  validateBody(startShiftSchema),
  asyncHandler(async (req, res) => {
    const existing = await queryOne(`SELECT id FROM cash_drawer_shifts WHERE tenant_id = $1 AND user_id = $2 AND status = 'open'`, [
      tenantId(req),
      req.user!.id,
    ])
    if (existing) throw new AppError(409, 'You already have an open shift', 'SHIFT_OPEN')
    const row = await queryOne(
      `INSERT INTO cash_drawer_shifts (tenant_id, user_id, opening_balance) VALUES ($1,$2,$3) RETURNING *`,
      [tenantId(req), req.user!.id, (req.body as z.infer<typeof startShiftSchema>).opening_balance]
    )
    logAudit({ tenantId: tenantId(req), userId: req.user!.id, userName: req.user!.full_name, action: 'shift.start', entity: 'shift', entityId: row!.id })
    res.status(201).json({ shift: row })
  })
)

const endShiftSchema = z.object({ counted_cash: z.number().min(0) })
router.post(
  '/shift/end',
  validateBody(endShiftSchema),
  asyncHandler(async (req, res) => {
    const t = tenantId(req)
    const row = await withTransaction(pool, async (client) => {
      const { rows } = await client.query(
        `UPDATE cash_drawer_shifts
         SET counted_cash = $3,
             expected_cash = opening_balance + cash_sales - expenses,
             difference = $3 - (opening_balance + cash_sales - expenses),
             status = 'closed', closed_at = now()
         WHERE tenant_id = $1 AND user_id = $2 AND status = 'open'
         RETURNING *`,
        [t, req.user!.id, (req.body as z.infer<typeof endShiftSchema>).counted_cash]
      )
      if (!rows.length) throw new AppError(404, 'No open shift found', 'NOT_FOUND')
      return rows[0]
    })
    logAudit({ tenantId: t, userId: req.user!.id, userName: req.user!.full_name, action: 'shift.end', entity: 'shift', entityId: row.id, details: { difference: row.difference } })
    res.json({ shift: row })
  })
)

router.get(
  '/shift/history',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT s.*, u.full_name AS cashier FROM cash_drawer_shifts s LEFT JOIN users u ON u.id = s.user_id
       WHERE s.tenant_id = $1 ORDER BY s.opened_at DESC LIMIT 100`,
      [tenantId(req)]
    )
    res.json({ shifts: rows })
  })
)

/* ══════════════════ INCOME (PPR finance parity) ══════════════════ */

const incomeSchema = z.object({
  category: z.string().trim().max(80).default('General'),
  description: z.string().trim().max(300).optional().nullable(),
  amount: z.number().min(0.01),
  income_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
router.get(
  '/income',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT i.*, u.full_name AS recorded_by FROM income i LEFT JOIN users u ON u.id = i.user_id
       WHERE i.tenant_id = $1 ORDER BY i.income_date DESC, i.created_at DESC LIMIT 200`,
      [tenantId(req)]
    )
    res.json({ income: rows })
  })
)
router.post(
  '/income',
  validateBody(incomeSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof incomeSchema>
    const row = await queryOne(
      `INSERT INTO income (tenant_id, category, description, amount, income_date, user_id) VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6) RETURNING *`,
      [tenantId(req), d.category, d.description ?? null, d.amount, d.income_date ?? null, req.user!.id]
    )
    res.status(201).json({ income: row })
  })
)
router.delete(
  '/income/:id',
  asyncHandler(async (req, res) => {
    const row = await queryOne(`DELETE FROM income WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, tenantId(req)])
    if (!row) throw new AppError(404, 'Income entry not found', 'NOT_FOUND')
    res.json({ ok: true })
  })
)

/* ══════════════════ CATEGORIES (PPR masters parity) ══════════════════ */

router.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const rows = await query(`SELECT * FROM product_categories WHERE tenant_id = $1 ORDER BY name ASC`, [tenantId(req)])
    res.json({ categories: rows })
  })
)
router.post(
  '/categories',
  validateBody(z.object({ name: z.string().trim().min(1).max(80) })),
  asyncHandler(async (req, res) => {
    const row = await queryOne(`INSERT INTO product_categories (tenant_id, name) VALUES ($1,$2) RETURNING *`, [
      tenantId(req),
      (req.body as { name: string }).name,
    ])
    res.status(201).json({ category: row })
  })
)
router.delete(
  '/categories/:id',
  asyncHandler(async (req, res) => {
    const row = await queryOne(`DELETE FROM product_categories WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, tenantId(req)])
    if (!row) throw new AppError(404, 'Category not found', 'NOT_FOUND')
    res.json({ ok: true })
  })
)

/* ══════════════════ SUPPLIER PAYMENTS (PPR finance parity) ══════════════════ */

router.get(
  '/supplier-payments',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT p.*, s.name AS supplier_name, u.full_name AS recorded_by FROM supplier_payments p
       JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id
       WHERE p.tenant_id = $1 ORDER BY p.created_at DESC LIMIT 200`,
      [tenantId(req)]
    )
    res.json({ payments: rows })
  })
)

const supplierPaymentSchema = z.object({
  supplier_id: z.string().uuid(),
  amount: z.number().min(0.01),
  payment_method: z.enum(['cash', 'card', 'mobile', 'bank']).default('cash'),
  notes: z.string().trim().max(300).optional().nullable(),
})
router.post(
  '/supplier-payments',
  validateBody(supplierPaymentSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof supplierPaymentSchema>
    const row = await queryOne(
      `INSERT INTO supplier_payments (tenant_id, supplier_id, amount, payment_method, notes, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tenantId(req), d.supplier_id, d.amount, d.payment_method, d.notes ?? null, req.user!.id]
    )
    // Payment leaves the drawer of the processor's open shift
    const field = d.payment_method === 'card' ? 'card_sales' : d.payment_method === 'mobile' ? 'mobile_sales' : 'cash_sales'
    await query(
      `UPDATE cash_drawer_shifts SET ${field} = GREATEST(0, ${field} - $1) WHERE tenant_id = $2 AND user_id = $3 AND status = 'open'`,
      [d.amount, tenantId(req), req.user!.id]
    )
    logAudit({ tenantId: tenantId(req), userId: req.user!.id, userName: req.user!.full_name, action: 'supplier.payment', entity: 'supplier', entityId: d.supplier_id, details: { amount: d.amount } })
    res.status(201).json({ payment: row })
  })
)

/* ══════════════════ PURCHASES ══════════════════ */

const purchaseSchema = z.object({
  supplier_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(500).optional().nullable(),
  paid_amount: z.number().min(0).default(0),
  discount: z.number().min(0).default(0),
  tax: z.number().min(0).default(0),
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        quantity: z.number().int().positive(),
        unit_cost: z.number().min(0),
        sell_price: z.number().min(0).optional(),
        batch_no: z.string().trim().max(80).optional().nullable(),
        expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
        new_product: z
          .object({
            name: z.string().trim().min(1).max(160),
            category: z.string().trim().max(80).default('General'),
            unit: z.string().trim().max(40).default('pcs'),
            sell_price: z.number().min(0),
          })
          .optional()
          .nullable(),
      })
    )
    .min(1),
})

/** POST /api/v1/retail/purchases — receive stock (creates batches) atomically */
router.post(
  '/purchases',
  validateBody(purchaseSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof purchaseSchema>
    const t = tenantId(req)

    const purchase = await withTransaction(pool, async (client) => {
      let subtotal = 0
      const resolved: (z.infer<typeof purchaseSchema>['items'][number] & { product_id: string })[] = []
      for (const item of d.items) {
        let pid = item.product_id
        if (pid === '__new__') {
          if (!item.new_product) throw new AppError(400, 'New product details required', 'VALIDATION')
          const np = item.new_product
          const created = await client.query<{ id: string }>(
            `INSERT INTO products (tenant_id, name, category, unit, sell_price, cost_price)
             VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
            [t, np.name, np.category, np.unit, np.sell_price, item.unit_cost]
          )
          pid = created.rows[0].id
        }
        subtotal += item.quantity * item.unit_cost
        resolved.push({ ...item, product_id: pid })
      }

      const grandTotal = Math.max(0, subtotal - (d.discount ?? 0) + (d.tax ?? 0))

      const pur = await client.query(
        `INSERT INTO purchases (tenant_id, supplier_id, total, discount, tax, paid_amount, notes, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [t, d.supplier_id ?? null, grandTotal, d.discount ?? 0, d.tax ?? 0, d.paid_amount, d.notes ?? null, req.user!.id]
      )
      for (const item of resolved) {
        let batchId: string | null = null
        // Merge into an existing open batch when batch no + expiry match, else create a new batch
        if (item.batch_no && item.expiry_date) {
          const existing = await client.query<{ id: string }>(
            `SELECT id FROM product_batches
             WHERE tenant_id = $1 AND product_id = $2 AND batch_no = $3 AND expiry_date = $4 LIMIT 1 FOR UPDATE`,
            [t, item.product_id, item.batch_no, item.expiry_date]
          )
          if (existing.rows.length) {
            batchId = existing.rows[0].id
            await client.query(`UPDATE product_batches SET quantity = quantity + $2 WHERE id = $1`, [batchId, item.quantity])
          } else {
            const created = await client.query<{ id: string }>(
              `INSERT INTO product_batches (tenant_id, product_id, batch_no, expiry_date, quantity, cost_price, selling_price)
               VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
              [t, item.product_id, item.batch_no, item.expiry_date, item.quantity, item.unit_cost, item.sell_price ?? null]
            )
            batchId = created.rows[0].id
          }
        } else {
          const created = await client.query<{ id: string }>(
            `INSERT INTO product_batches (tenant_id, product_id, batch_no, expiry_date, quantity, cost_price, selling_price)
             VALUES ($1,$2,'-',$3,$4,$5,$6) RETURNING id`,
            [t, item.product_id, item.expiry_date || null, item.quantity, item.unit_cost, item.sell_price ?? null]
          )
          batchId = created.rows[0].id
        }
        await client.query(
          `INSERT INTO purchase_items (tenant_id, purchase_id, product_id, batch_id, batch_no, expiry_date, quantity, unit_cost, line_total)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [t, pur.rows[0].id, item.product_id, batchId, item.batch_no || '-', item.expiry_date || null, item.quantity, item.unit_cost, item.quantity * item.unit_cost]
        )
      }
      return pur.rows[0]
    })

    logAudit({ tenantId: t, userId: req.user!.id, userName: req.user!.full_name, action: 'purchase.create', entity: 'purchase', entityId: purchase.id, details: { total: purchase.total } })
    res.status(201).json({ purchase })
  })
)

/** DELETE /api/v1/retail/purchases/:id — owner-only reversal with reason (PPR parity) */
router.delete(
  '/purchases/:id',
  requireRole('owner'),
  asyncHandler(async (req, res) => {
    const reason = String(req.query.reason || '').trim()
    if (reason.length < 3) throw new AppError(400, 'A deletion reason is required', 'VALIDATION')
    const t = tenantId(req)

    await withTransaction(pool, async (client) => {
      const { rows: purchases } = await client.query<{ total: string; paid_amount: string; supplier_id: string | null }>(
        `SELECT total, paid_amount, supplier_id FROM purchases WHERE id = $1 AND tenant_id = $2 AND record_status = 'Active' FOR UPDATE`,
        [req.params.id, t]
      )
      if (!purchases.length) throw new AppError(404, 'Purchase not found or already deleted', 'NOT_FOUND')
      const purchase = purchases[0]

      const { rows: items } = await client.query<{ product_id: string; batch_id: string | null; quantity: number }>(
        `SELECT product_id, batch_id, quantity FROM purchase_items WHERE purchase_id = $1`,
        [req.params.id]
      )
      for (const item of items) {
        if (item.batch_id) {
          await client.query(
            `UPDATE product_batches SET quantity = GREATEST(0, quantity - $1) WHERE id = $2 AND tenant_id = $3`,
            [item.quantity, item.batch_id, t]
          )
        }
      }
      // Reverse the supplier's outstanding balance for the unpaid portion
      const unpaid = Number(purchase.total) - Number(purchase.paid_amount)
      void unpaid // balance is computed dynamically from active purchases
      await client.query(
        `UPDATE purchases SET record_status = 'Deleted', delete_reason = $2 WHERE id = $1`,
        [req.params.id, reason]
      )
    })

    logAudit({ tenantId: t, userId: req.user!.id, userName: req.user!.full_name, action: 'purchase.delete', entity: 'purchase', entityId: req.params.id, details: { reason } })
    res.json({ ok: true })
  })
)

router.get(
  '/purchases',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePagination(req.query as Record<string, string>)
    const rows = await query(
      `SELECT p.*, s.name AS supplier_name, u.full_name AS received_by,
              (SELECT count(*) FROM purchase_items pi WHERE pi.purchase_id = p.id)::int AS item_count
       FROM purchases p LEFT JOIN suppliers s ON s.id = p.supplier_id LEFT JOIN users u ON u.id = p.user_id
       WHERE p.tenant_id = $1 AND p.record_status = 'Active' ORDER BY p.created_at DESC LIMIT $2 OFFSET $3`,
      [tenantId(req), limit, offset]
    )
    res.json({ purchases: rows, page, limit })
  })
)

/* ══════════════════ EXPENSES ══════════════════ */

const expenseSchema = z.object({
  category: z.string().trim().max(80).default('General'),
  description: z.string().trim().max(300).optional().nullable(),
  amount: z.number().min(0.01),
  spent_at: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})
router.get(
  '/expenses',
  asyncHandler(async (req, res) => {
    const { limit, offset, page } = parsePagination(req.query as Record<string, string>)
    const rows = await query(
      `SELECT e.*, u.full_name AS recorded_by FROM expenses e LEFT JOIN users u ON u.id = e.user_id
       WHERE e.tenant_id = $1 ORDER BY e.spent_at DESC, e.created_at DESC LIMIT $2 OFFSET $3`,
      [tenantId(req), limit, offset]
    )
    res.json({ expenses: rows, page, limit })
  })
)
router.post(
  '/expenses',
  validateBody(expenseSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof expenseSchema>
    const row = await queryOne(
      `INSERT INTO expenses (tenant_id, category, description, amount, spent_at, user_id) VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6) RETURNING *`,
      [tenantId(req), d.category, d.description ?? null, d.amount, d.spent_at ?? null, req.user!.id]
    )
    // Expenses count against the recorder's open cash drawer shift (PPR parity)
    await query(`UPDATE cash_drawer_shifts SET expenses = expenses + $1 WHERE tenant_id = $2 AND user_id = $3 AND status = 'open'`, [
      d.amount,
      tenantId(req),
      req.user!.id,
    ])
    res.status(201).json({ expense: row })
  })
)
router.delete(
  '/expenses/:id',
  asyncHandler(async (req, res) => {
    const row = await queryOne(`DELETE FROM expenses WHERE id = $1 AND tenant_id = $2 RETURNING id`, [req.params.id, tenantId(req)])
    if (!row) throw new AppError(404, 'Expense not found', 'NOT_FOUND')
    res.json({ ok: true })
  })
)

/* ══════════════════ STOCK ADJUSTMENTS ══════════════════ */

router.get(
  '/adjustments',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT a.*, p.name AS product_name, u.full_name AS recorded_by
       FROM stock_adjustments a
       JOIN products p ON p.id = a.product_id
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.tenant_id = $1 ORDER BY a.created_at DESC LIMIT 200`,
      [tenantId(req)]
    )
    res.json({ adjustments: rows })
  })
)

const adjustmentSchema = z.object({
  product_id: z.string().uuid(),
  batch_id: z.string().uuid().optional().nullable(),
  delta: z.number().int(),
  reason: z.string().trim().min(3).max(300),
})
/** POST — manual stock correction (count, damage, theft, return to supplier…) */
router.post(
  '/adjustments',
  validateBody(adjustmentSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof adjustmentSchema>
    const t = tenantId(req)
    const row = await withTransaction(pool, async (client) => {
      // Target batch: explicit, or the product's largest FEFO batch
      let batchId = d.batch_id ?? null
      if (!batchId) {
        const b = await client.query<{ id: string }>(
          `SELECT id FROM product_batches WHERE tenant_id = $1 AND product_id = $2 AND quantity > 0
           ORDER BY expiry_date NULLS LAST, quantity DESC LIMIT 1 FOR UPDATE`,
          [t, d.product_id]
        )
        batchId = b.rows[0]?.id ?? null
      }
      if (!batchId && d.delta > 0) {
        // positive adjustment without a batch → create a fresh 'ADJUST' batch
        const created = await client.query<{ id: string }>(
          `INSERT INTO product_batches (tenant_id, product_id, batch_no, quantity, cost_price)
           VALUES ($1,$2,'ADJUST',0,(SELECT cost_price FROM products WHERE id = $2)) RETURNING id`,
          [t, d.product_id]
        )
        batchId = created.rows[0].id
      }
      if (!batchId) throw new AppError(400, 'No stock batch exists for this product', 'NO_BATCH')

      const updated = await client.query<{ quantity: number }>(
        `UPDATE product_batches SET quantity = GREATEST(0, quantity + $2) WHERE id = $1 AND tenant_id = $3 RETURNING quantity`,
        [batchId, d.delta, t]
      )
      if (!updated.rows.length) throw new AppError(404, 'Batch not found', 'NOT_FOUND')

      const adj = await client.query(
        `INSERT INTO stock_adjustments (tenant_id, product_id, batch_id, delta, reason, user_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [t, d.product_id, batchId, d.delta, d.reason, req.user!.id]
      )
      return adj.rows[0]
    })
    logAudit({ tenantId: t, userId: req.user!.id, userName: req.user!.full_name, action: 'stock.adjust', entity: 'product', entityId: d.product_id, details: { delta: d.delta, reason: d.reason } })
    res.status(201).json({ adjustment: row })
  })
)

/* ══════════════════ EXPIRY MANAGEMENT ══════════════════ */

router.get(
  '/expiry',
  asyncHandler(async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 90))
    const rows = await query(
      `SELECT b.id, b.batch_no, b.expiry_date, b.quantity, b.cost_price, p.id AS product_id, p.name AS product_name, p.category,
              (b.expiry_date < CURRENT_DATE) AS expired,
              (b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + $2 * interval '1 day') AS expiring_soon
       FROM product_batches b JOIN products p ON p.id = b.product_id
       WHERE b.tenant_id = $1 AND b.quantity > 0 AND b.expiry_date IS NOT NULL
             AND b.expiry_date <= CURRENT_DATE + $2 * interval '1 day'
       ORDER BY b.expiry_date ASC LIMIT 300`,
      [tenantId(req), days]
    )
    res.json({ batches: rows })
  })
)

/** POST /expiry/:batchId/write-off — zero out expired stock with an audit trail */
router.post(
  '/expiry/:batchId/write-off',
  validateBody(z.object({ reason: z.string().trim().max(300).default('Expired — written off') })),
  asyncHandler(async (req, res) => {
    const t = tenantId(req)
    const row = await withTransaction(pool, async (client) => {
      const b = await client.query<{ id: string; quantity: number; product_id: string }>(
        `UPDATE product_batches SET quantity = 0 WHERE id = $1 AND tenant_id = $2 AND quantity > 0 RETURNING id, quantity, product_id`,
        [req.params.batchId, t]
      )
      if (!b.rows.length) throw new AppError(404, 'Batch not found or already empty', 'NOT_FOUND')
      const adj = await client.query(
        `INSERT INTO stock_adjustments (tenant_id, product_id, batch_id, delta, reason, user_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [t, b.rows[0].product_id, b.rows[0].id, -b.rows[0].quantity, (req.body as { reason: string }).reason, req.user!.id]
      )
      return adj.rows[0]
    })
    logAudit({ tenantId: t, userId: req.user!.id, userName: req.user!.full_name, action: 'stock.writeoff', entity: 'batch', entityId: req.params.batchId })
    res.json({ adjustment: row })
  })
)

/* ══════════════════ CUSTOMER CREDIT LEDGER (khata) ══════════════════ */

/** GET /customers/:id/statement — credit sales, payments, running balance */
router.get(
  '/customers/:id/statement',
  asyncHandler(async (req, res) => {
    const t = tenantId(req)
    const customer = await queryOne(`SELECT id, name, phone FROM customers WHERE id = $1 AND tenant_id = $2`, [req.params.id, t])
    if (!customer) throw new AppError(404, 'Customer not found', 'NOT_FOUND')
    const creditSales = await query(
      `SELECT id, invoice_no, total, amount_paid, (total - amount_paid) AS due, created_at, status
       FROM sales WHERE tenant_id = $1 AND customer_id = $2 AND status = 'completed' AND total > amount_paid
       ORDER BY created_at ASC`,
      [t, req.params.id]
    )
    const payments = await query(
      `SELECT p.*, u.full_name AS recorded_by FROM customer_payments p LEFT JOIN users u ON u.id = p.user_id
       WHERE p.tenant_id = $1 AND p.customer_id = $2 ORDER BY p.created_at DESC`,
      [t, req.params.id]
    )
    const outstanding = creditSales.reduce((s, r) => s + Number(r.due), 0)
    const paid = payments.reduce((s, r) => s + Number(r.amount), 0)
    res.json({ customer, credit_sales: creditSales, payments, balance: outstanding - paid })
  })
)

const paymentSchema = z.object({ amount: z.number().min(0.01), note: z.string().trim().max(300).optional().nullable() })
/** POST /customers/:id/payments — settle credit (FIFO across unpaid credit sales) */
router.post(
  '/customers/:id/payments',
  validateBody(paymentSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof paymentSchema>
    const t = tenantId(req)
    const result = await withTransaction(pool, async (client) => {
      const pay = await client.query(
        `INSERT INTO customer_payments (tenant_id, customer_id, amount, note, user_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [t, req.params.id, d.amount, d.note ?? null, req.user!.id]
      )
      // Allocate FIFO to unpaid credit sales
      let remaining = d.amount
      const { rows: dues } = await client.query<{ id: string; due: string }>(
        `SELECT id, (total - amount_paid) AS due FROM sales
         WHERE tenant_id = $1 AND customer_id = $2 AND status = 'completed' AND total > amount_paid
         ORDER BY created_at ASC FOR UPDATE`,
        [t, req.params.id]
      )
      for (const s of dues) {
        if (remaining <= 0.001) break
        const applied = Math.min(remaining, Number(s.due))
        await client.query(`UPDATE sales SET amount_paid = amount_paid + $2 WHERE id = $1`, [s.id, applied])
        remaining -= applied
      }
      return pay.rows[0]
    })
    logAudit({ tenantId: t, userId: req.user!.id, userName: req.user!.full_name, action: 'credit.payment', entity: 'customer', entityId: req.params.id, details: { amount: d.amount } })
    res.status(201).json({ payment: result })
  })
)

/** GET /credit — all customers with outstanding credit balances */
router.get(
  '/credit',
  asyncHandler(async (req, res) => {
    const rows = await query(
      `SELECT * FROM (
         SELECT c.id, c.name, c.phone,
                COALESCE(credit.total_due, 0) - COALESCE(pay.paid, 0) AS balance
         FROM customers c
         LEFT JOIN (SELECT customer_id, SUM(total - amount_paid) AS total_due FROM sales
                    WHERE tenant_id = $1 AND status = 'completed' GROUP BY customer_id) credit ON credit.customer_id = c.id
         LEFT JOIN (SELECT customer_id, SUM(amount) AS paid FROM customer_payments WHERE tenant_id = $1 GROUP BY customer_id) pay ON pay.customer_id = c.id
         WHERE c.tenant_id = $1
       ) x
       WHERE x.balance > 0.001
       ORDER BY x.balance DESC`,
      [tenantId(req)]
    )
    res.json({ customers: rows })
  })
)

/* ══════════════════ REPORTS ══════════════════ */

/** GET /reports?from&to — P&L, category mix, payment mix, stock valuation */
router.get(
  '/reports',
  asyncHandler(async (req, res) => {
    const t = tenantId(req)
    const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10))
    const to = String(req.query.to || new Date().toISOString().slice(0, 10))

    const pl = await queryOne<{ revenue: string; cogs: string; discounts: string; transactions: string }>(
      `SELECT COALESCE(SUM(s.total),0) AS revenue,
              COALESCE((SELECT SUM(si.cost_price * si.quantity) FROM sale_items si JOIN sales s2 ON s2.id = si.sale_id
                        WHERE s2.tenant_id = $1 AND s2.status='completed' AND s2.created_at >= $2::date AND s2.created_at < ($3::date + interval '1 day')),0) AS cogs,
              COALESCE(SUM(s.discount),0) AS discounts,
              count(*) AS transactions
       FROM sales s WHERE s.tenant_id = $1 AND s.status = 'completed' AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')`,
      [t, from, to]
    )
    const expensesByCat = await query<{ category: string; total: string }>(
      `SELECT category, SUM(amount) AS total FROM expenses
       WHERE tenant_id = $1 AND spent_at BETWEEN $2::date AND $3::date GROUP BY category ORDER BY SUM(amount) DESC`,
      [t, from, to]
    )
    const byCategory = await query<{ category: string; revenue: string; qty: string }>(
      `SELECT p.category, SUM(si.line_total) AS revenue, SUM(si.quantity)::text AS qty
       FROM sale_items si JOIN sales s ON s.id = si.sale_id JOIN products p ON p.id = si.product_id
       WHERE si.tenant_id = $1 AND s.status='completed' AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')
       GROUP BY p.category ORDER BY SUM(si.line_total) DESC LIMIT 15`,
      [t, from, to]
    )
    const byPayment = await query<{ payment_method: string; total: string; n: string }>(
      `SELECT payment_method, SUM(total) AS total, count(*)::text AS n FROM sales
       WHERE tenant_id = $1 AND status='completed' AND created_at >= $2::date AND created_at < ($3::date + interval '1 day')
       GROUP BY payment_method`,
      [t, from, to]
    )
    const topProducts = await query<{ name: string; qty: string; revenue: string; profit: string }>(
      `SELECT si.name, SUM(si.quantity)::text AS qty, SUM(si.line_total)::text AS revenue,
              SUM(si.line_total - si.cost_price * si.quantity)::text AS profit
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.tenant_id = $1 AND s.status='completed' AND s.created_at >= $2::date AND s.created_at < ($3::date + interval '1 day')
       GROUP BY si.name ORDER BY SUM(si.line_total) DESC LIMIT 20`,
      [t, from, to]
    )
    const valuation = await queryOne<{ stock_value: string; retail_value: string; units: string }>(
      `SELECT COALESCE(SUM(b.quantity * b.cost_price),0)::text AS stock_value,
              COALESCE(SUM(b.quantity * p.sell_price),0)::text AS retail_value,
              COALESCE(SUM(b.quantity),0)::text AS units
       FROM product_batches b JOIN products p ON p.id = b.product_id WHERE b.tenant_id = $1`,
      [t]
    )
    const deadStock = await query<{ name: string; stock: number; last_sold: string | null }>(
      `SELECT p.name, COALESCE(SUM(b.quantity),0)::int AS stock, MAX(s.created_at)::text AS last_sold
       FROM products p
       LEFT JOIN product_batches b ON b.product_id = p.id
       LEFT JOIN sale_items si ON si.product_id = p.id
       LEFT JOIN sales s ON s.id = si.sale_id AND s.status='completed'
       WHERE p.tenant_id = $1
       GROUP BY p.id, p.name
       HAVING COALESCE(SUM(b.quantity),0) > 0 AND (MAX(s.created_at) IS NULL OR MAX(s.created_at) < CURRENT_DATE - 30)
       ORDER BY stock DESC LIMIT 15`,
      [t]
    )
    const lowStock = await query<{ name: string; stock: number; threshold: number; suggested: number }>(
      `SELECT name, stock, threshold, GREATEST(threshold * 3 - stock, threshold)::int AS suggested FROM (
         SELECT p.name, COALESCE(SUM(b.quantity),0)::int AS stock, p.low_stock_threshold AS threshold
         FROM products p LEFT JOIN product_batches b ON b.product_id = p.id
         WHERE p.tenant_id = $1 AND p.is_active = true
         GROUP BY p.id, p.name, p.low_stock_threshold
       ) x WHERE stock <= threshold ORDER BY stock ASC`,
      [t]
    )

    const revenue = Number(pl?.revenue ?? 0)
    const cogs = Number(pl?.cogs ?? 0)
    const expenseTotal = expensesByCat.reduce((s, r) => s + Number(r.total), 0)
    const otherIncome = await queryOne<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount),0) AS total FROM income
       WHERE tenant_id = $1 AND income_date BETWEEN $2::date AND $3::date`,
      [t, from, to]
    )
    const incomeTotal = Number(otherIncome?.total ?? 0)
    res.json({
      period: { from, to },
      pnl: {
        revenue,
        cogs,
        gross_profit: revenue - cogs,
        discounts: Number(pl?.discounts ?? 0),
        expenses: expenseTotal,
        expenses_by_category: expensesByCat.map((r) => ({ category: r.category, total: Number(r.total) })),
        other_income: incomeTotal,
        net_profit: revenue - cogs - expenseTotal + incomeTotal,
        transactions: Number(pl?.transactions ?? 0),
      },
      by_category: byCategory.map((r) => ({ category: r.category, revenue: Number(r.revenue), qty: Number(r.qty) })),
      by_payment: byPayment.map((r) => ({ method: r.payment_method, total: Number(r.total), count: Number(r.n) })),
      top_products: topProducts.map((r) => ({ name: r.name, qty: Number(r.qty), revenue: Number(r.revenue), profit: Number(r.profit) })),
      stock: {
        stock_value: Number(valuation?.stock_value ?? 0),
        retail_value: Number(valuation?.retail_value ?? 0),
        units: Number(valuation?.units ?? 0),
        dead_stock: deadStock,
        reorder: lowStock,
      },
    })
  })
)

/* ══════════════════ DASHBOARD ══════════════════ */

router.get(
  '/dashboard',
  asyncHandler(async (req, res) => {
    const t = tenantId(req)
    const todaySales = await queryOne<{ total: string | null; count: string }>(
      `SELECT COALESCE(SUM(total),0) AS total, count(*) AS count FROM sales
       WHERE tenant_id = $1 AND status = 'completed' AND created_at >= CURRENT_DATE`,
      [t]
    )
    const monthStats = await queryOne<{ revenue: string | null; profit: string | null }>(
      `SELECT COALESCE(SUM(s.total),0) AS revenue,
              COALESCE(SUM(s.total - (SELECT COALESCE(SUM(si.cost_price * si.quantity),0) FROM sale_items si WHERE si.sale_id = s.id)),0) AS profit
       FROM sales s WHERE s.tenant_id = $1 AND s.status = 'completed' AND s.created_at >= date_trunc('month', CURRENT_DATE)`,
      [t]
    )
    const monthExpenses = await queryOne<{ total: string | null }>(
      `SELECT COALESCE(SUM(amount),0) AS total FROM expenses WHERE tenant_id = $1 AND spent_at >= date_trunc('month', CURRENT_DATE)`,
      [t]
    )
    const lowStock = await query<{ name: string; stock: number; threshold: number }>(
      `SELECT p.name, COALESCE(SUM(b.quantity),0)::int AS stock, p.low_stock_threshold AS threshold
       FROM products p LEFT JOIN product_batches b ON b.product_id = p.id
       WHERE p.tenant_id = $1 AND p.is_active = true
       GROUP BY p.id, p.name, p.low_stock_threshold
       HAVING COALESCE(SUM(b.quantity),0) <= p.low_stock_threshold
       ORDER BY stock ASC LIMIT 8`,
      [t]
    )
    const expiringSoon = await query<{ name: string; expiry_date: string; quantity: number }>(
      `SELECT p.name, b.expiry_date, b.quantity FROM product_batches b JOIN products p ON p.id = b.product_id
       WHERE b.tenant_id = $1 AND b.quantity > 0 AND b.expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 60
       ORDER BY b.expiry_date ASC LIMIT 8`,
      [t]
    )
    const trend = await query<{ day: string; revenue: string }>(
      `SELECT to_char(d.day, 'MM-DD') AS day, COALESCE(SUM(s.total),0) AS revenue
       FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') d(day)
       LEFT JOIN sales s ON s.tenant_id = $1 AND s.status='completed' AND s.created_at >= d.day AND s.created_at < d.day + interval '1 day'
       GROUP BY d.day ORDER BY d.day`,
      [t]
    )
    const topProducts = await query<{ name: string; qty: string; revenue: string }>(
      `SELECT si.name, SUM(si.quantity)::text AS qty, SUM(si.line_total)::text AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
       WHERE si.tenant_id = $1 AND s.status='completed' AND s.created_at >= date_trunc('month', CURRENT_DATE)
       GROUP BY si.name ORDER BY SUM(si.line_total) DESC LIMIT 5`,
      [t]
    )
    const recent = await query(
      `SELECT s.id, s.total, s.created_at, s.payment_method, c.name AS customer_name
       FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
       WHERE s.tenant_id = $1 ORDER BY s.created_at DESC LIMIT 6`,
      [t]
    )
    // Period comparison (PPR dashboard parity): this month vs last month
    const comparison = await queryOne<{ this_month: string; last_month: string }>(
      `SELECT
         COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE)),0)::text AS this_month,
         COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('month', CURRENT_DATE) - interval '1 month'
                    AND created_at < date_trunc('month', CURRENT_DATE)),0)::text AS last_month
       FROM sales WHERE tenant_id = $1 AND status = 'completed'`,
      [t]
    )
    const thisMonth = Number(comparison?.this_month ?? 0)
    const lastMonth = Number(comparison?.last_month ?? 0)

    res.json({
      today: { sales: Number(todaySales?.total ?? 0), transactions: Number(todaySales?.count ?? 0) },
      month: {
        revenue: Number(monthStats?.revenue ?? 0),
        profit: Number(monthStats?.profit ?? 0),
        expenses: Number(monthExpenses?.total ?? 0),
      },
      comparison: {
        this_month: thisMonth,
        last_month: lastMonth,
        change_pct: lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : thisMonth > 0 ? 100 : 0,
      },
      low_stock: lowStock,
      expiring_soon: expiringSoon,
      trend: trend.map((r) => ({ day: r.day, revenue: Number(r.revenue) })),
      top_products: topProducts.map((r) => ({ name: r.name, qty: Number(r.qty), revenue: Number(r.revenue) })),
      recent_sales: recent,
    })
  })
)

export default router
