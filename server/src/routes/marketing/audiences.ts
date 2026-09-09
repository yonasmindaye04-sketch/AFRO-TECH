import { Router, type Request, type Response } from 'express'
import { pool } from '../../config/db.js'
import { authenticate, requirePermission } from '../../middleware/auth.js'
import { AppError, asyncHandler } from '../../utils/helpers.js'
import { getAudienceMembers, getAudienceCount } from '../../services/marketing/audienceEngine.js'

const router = Router()

router.use(authenticate)

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page = '1', limit = '20' } = req.query
  const offset = (parseInt(page as string) - 1) * parseInt(limit as string)
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id

  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { rows: audiences } = await pool.query(
    `SELECT a.*, u.full_name as created_by_name,
       (SELECT COUNT(*) FROM marketing_audience_members mam WHERE mam.audience_id = a.id) as member_count
     FROM marketing_audiences a
     LEFT JOIN users u ON u.id = a.created_by
     WHERE a.tenant_id = $1
     ORDER BY a.created_at DESC
     LIMIT $2 OFFSET $3`,
    [tenantId, parseInt(limit as string), offset]
  )

  const { rows: count } = await pool.query(`SELECT COUNT(*) FROM marketing_audiences WHERE tenant_id = $1`, [tenantId])

  res.json({ audiences, total: parseInt(count[0].count, 10), page: parseInt(page as string), limit: parseInt(limit as string) })
}))
router.post('/', requirePermission('marketing.audiences.create'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { name, description, type = 'dynamic', rules, members } = req.body
  if (!name) throw new AppError(400, 'name required', 'VALIDATION_ERROR')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO marketing_audiences (tenant_id, name, description, type, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tenantId, name, description, type, req.user!.id]
    )

    const audience = rows[0]

    if (type === 'dynamic' && Array.isArray(rules)) {
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]
        await client.query(
          `INSERT INTO marketing_audience_rules (audience_id, field, operator, value, logical_op, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [audience.id, rule.field, rule.operator, JSON.stringify(rule.value), rule.logicalOp || 'AND', i]
        )
      }
    } else if ((type === 'static' || type === 'imported') && Array.isArray(members)) {
      for (const contactId of members) {
        await client.query(
          `INSERT INTO marketing_audience_members (audience_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [audience.id, contactId]
        )
      }
    }

    await client.query('COMMIT')
    res.status(201).json(audience)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}))
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { rows } = await pool.query(
    `SELECT a.*, u.full_name as created_by_name FROM marketing_audiences a
     LEFT JOIN users u ON u.id = a.created_by
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [req.params.id, tenantId]
  )

  if (!rows[0]) throw new AppError(404, 'Audience not found', 'NOT_FOUND')

  const audience = rows[0]

  if (audience.type === 'dynamic') {
    const { rows: rules } = await pool.query(
      `SELECT * FROM marketing_audience_rules WHERE audience_id = $1 ORDER BY sort_order`,
      [audience.id]
    )
    audience.rules = rules
  } else {
    const { rows: members } = await pool.query(
      `SELECT mc.* FROM marketing_contacts mc
       JOIN marketing_audience_members mam ON mam.contact_id = mc.id
       WHERE mam.audience_id = $1`,
      [audience.id]
    )
    audience.members = members
  }

  res.json(audience)
}))
router.put('/:id', requirePermission('marketing.audiences.update'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { name, description, type, rules, members } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE marketing_audiences SET name = COALESCE($1, name), description = COALESCE($2, description), type = COALESCE($3, type), updated_at = now()
       WHERE id = $4 AND tenant_id = $5`,
      [name, description, type, req.params.id, tenantId]
    )

    if (type === 'dynamic' && Array.isArray(rules)) {
      await client.query(`DELETE FROM marketing_audience_rules WHERE audience_id = $1`, [req.params.id])
      for (let i = 0; i < rules.length; i++) {
        const rule = rules[i]
        await client.query(
          `INSERT INTO marketing_audience_rules (audience_id, field, operator, value, logical_op, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [req.params.id, rule.field, rule.operator, JSON.stringify(rule.value), rule.logicalOp || 'AND', i]
        )
      }
      await client.query(`DELETE FROM marketing_audience_members WHERE audience_id = $1`, [req.params.id])
    } else if ((type === 'static' || type === 'imported') && Array.isArray(members)) {
      await client.query(`DELETE FROM marketing_audience_members WHERE audience_id = $1`, [req.params.id])
      await client.query(`DELETE FROM marketing_audience_rules WHERE audience_id = $1`, [req.params.id])
      for (const contactId of members) {
        await client.query(
          `INSERT INTO marketing_audience_members (audience_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [req.params.id, contactId]
        )
      }
    }

    await client.query('COMMIT')
    res.json({ success: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}))
router.delete('/:id', requirePermission('marketing.audiences.delete'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  await pool.query(`DELETE FROM marketing_audiences WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  res.json({ success: true })
}))
router.get('/:id/members', asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { page = '1', limit = '50' } = req.query
  const offset = (parseInt(page as string) - 1) * parseInt(limit as string)

  const audience = await pool.query(`SELECT type FROM marketing_audiences WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  if (!audience.rows[0]) throw new AppError(404, 'Audience not found', 'NOT_FOUND')

  let members: string[]
  if (audience.rows[0].type === 'static' || audience.rows[0].type === 'imported') {
    const { rows } = await pool.query(
      `SELECT contact_id FROM marketing_audience_members WHERE audience_id = $1 LIMIT $2 OFFSET $3`,
      [req.params.id, parseInt(limit as string), offset]
    )
    members = rows.map(r => r.contact_id)
  } else {
    members = await getAudienceMembers(tenantId, req.params.id)
  }

  const total = await getAudienceCount(tenantId, req.params.id)

  const { rows: contacts } = await pool.query(
    `SELECT * FROM marketing_contacts WHERE id = ANY($1)`,
    [members.slice(offset, offset + parseInt(limit as string))]
  )

  res.json({ contacts, total, page: parseInt(page as string), limit: parseInt(limit as string) })
}))
router.get('/:id/count', asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const count = await getAudienceCount(tenantId, req.params.id)
  res.json({ count })
}))
export default router
