import { Router, type Request, type Response } from 'express'
import { pool } from '../../config/db.js'
import { authenticate, requirePermission } from '../../middleware/auth.js'
import { AppError, asyncHandler } from '../../utils/helpers.js'
import { extractVariables } from '../../services/marketing/templateEngine.js'

const router = Router()

router.use(authenticate)

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page = '1', limit = '20', channel, status } = req.query
  const offset = (parseInt(page as string) - 1) * parseInt(limit as string)
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id

  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const where: string[] = ['tenant_id = $1']
  const params: unknown[] = [tenantId]
  let paramIndex = 2

  if (channel) {
    where.push(`channel = $${paramIndex}`)
    params.push(channel)
    paramIndex++
  }
  if (status) {
    where.push(`status = $${paramIndex}`)
    params.push(status)
    paramIndex++
  }

  const { rows: templates } = await pool.query(
    `SELECT t.*, u.full_name as created_by_name FROM marketing_templates t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY t.updated_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, parseInt(limit as string), offset]
  )

  const { rows: count } = await pool.query(`SELECT COUNT(*) FROM marketing_templates WHERE ${where.join(' AND ')}`, params)

  res.json({ templates, total: parseInt(count[0].count, 10), page: parseInt(page as string), limit: parseInt(limit as string) })
}))
router.post('/', requirePermission('marketing.templates.create'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { name, channel, subject, content, variables, status = 'draft' } = req.body
  if (!name || !channel || !content) throw new AppError(400, 'name, channel, content required', 'VALIDATION_ERROR')

  const detectedVars = extractVariables(content)
  const finalVars = variables && variables.length > 0 ? variables : detectedVars

  const { rows } = await pool.query(
    `INSERT INTO marketing_templates (tenant_id, name, channel, subject, content, variables, status, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tenantId, name, channel, subject, content, JSON.stringify(finalVars), status, req.user!.id]
  )

  res.status(201).json(rows[0])
}))
router.get('/:id', asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { rows } = await pool.query(
    `SELECT t.*, u.full_name as created_by_name FROM marketing_templates t
     LEFT JOIN users u ON u.id = t.created_by
     WHERE t.id = $1 AND t.tenant_id = $2`,
    [req.params.id, tenantId]
  )

  if (!rows[0]) throw new AppError(404, 'Template not found', 'NOT_FOUND')

  const { rows: versions } = await pool.query(
    `SELECT * FROM marketing_template_versions WHERE template_id = $1 ORDER BY version DESC`,
    [req.params.id]
  )

  res.json({ ...rows[0], versions })
}))
router.put('/:id', requirePermission('marketing.templates.update'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { name, channel, subject, content, variables, status, change_note } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const current = await client.query(`SELECT * FROM marketing_templates WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
    if (!current.rows[0]) throw new AppError(404, 'Template not found', 'NOT_FOUND')

    const detectedVars = content ? extractVariables(content) : JSON.parse(current.rows[0].variables)
    const finalVars = variables && variables.length > 0 ? variables : detectedVars

    await client.query(
      `INSERT INTO marketing_template_versions (template_id, subject, content, variables, version, changed_by, change_note)
       SELECT $1, subject, content, variables, version, $2, $3 FROM marketing_templates WHERE id = $1`,
      [req.params.id, req.user!.id, change_note || 'Updated via API']
    )

    await client.query(
      `UPDATE marketing_templates SET
         name = COALESCE($1, name), channel = COALESCE($2, channel), subject = COALESCE($3, subject),
         content = COALESCE($4, content), variables = COALESCE($5, variables), status = COALESCE($6, status),
         version = version + 1, updated_at = now()
       WHERE id = $7 AND tenant_id = $8`,
      [name, channel, subject, content, JSON.stringify(finalVars), status, req.params.id, tenantId]
    )

    await client.query('COMMIT')
    res.json({ success: true })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}))
router.delete('/:id', requirePermission('marketing.templates.delete'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  await pool.query(`DELETE FROM marketing_templates WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  res.json({ success: true })
}))
export default router
