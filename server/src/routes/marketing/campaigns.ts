import { Router, type Request, type Response } from 'express'
import { pool } from '../../config/db.js'
import { authenticate, requirePermission } from '../../middleware/auth.js'
import { AppError, asyncHandler } from '../../utils/helpers.js'
import { queueCampaign, getCampaignStats } from '../../services/marketing/campaignEngine.js'

const router = Router()

router.use(authenticate)

router.get('/', asyncHandler(async (req: Request, res: Response) => {
  const { page = '1', limit = '20', status } = req.query
  const offset = (parseInt(page as string) - 1) * parseInt(limit as string)
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id

  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const where: string[] = ['c.tenant_id = $1']
  const params: unknown[] = [tenantId]
  let paramIndex = 2

  if (status) {
    where.push(`c.status = $${paramIndex}`)
    params.push(status)
    paramIndex++
  }

  const { rows: campaigns } = await pool.query(
    `SELECT c.*, a.name as audience_name, u.full_name as created_by_name,
       (SELECT COUNT(*) FROM marketing_campaign_channels WHERE campaign_id = c.id) as channel_count
     FROM marketing_campaigns c
     LEFT JOIN marketing_audiences a ON a.id = c.audience_id
     LEFT JOIN users u ON u.id = c.created_by
     WHERE ${where.join(' AND ')}
     ORDER BY c.created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, parseInt(limit as string), offset]
  )

  const { rows: count } = await pool.query(`SELECT COUNT(*) FROM marketing_campaigns WHERE ${where.join(' AND ')}`, params)

  res.json({ campaigns, total: parseInt(count[0].count, 10), page: parseInt(page as string), limit: parseInt(limit as string) })
}))
router.post('/', requirePermission('marketing.campaigns.create'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { name, description, audience_id, channels, scheduled_at } = req.body
  if (!name || !audience_id || !Array.isArray(channels) || channels.length === 0) {
    throw new AppError(400, 'name, audience_id, and at least one channel required', 'VALIDATION_ERROR')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO marketing_campaigns (tenant_id, name, description, audience_id, scheduled_at, created_by, status)
       VALUES ($1,$2,$3,$4,$5,$6,'draft') RETURNING *`,
      [tenantId, name, description, audience_id, scheduled_at, req.user!.id]
    )

    const campaign = rows[0]

    for (const ch of channels) {
      await client.query(
        `INSERT INTO marketing_campaign_channels (campaign_id, channel, template_id, provider, config)
         VALUES ($1,$2,$3,$4,$5)`,
        [campaign.id, ch.channel, ch.template_id, ch.provider, JSON.stringify(ch.config || {})]
      )
    }

    await client.query('COMMIT')
    res.status(201).json(campaign)
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

  const { rows: campaign } = await pool.query(
    `SELECT c.*, a.name as audience_name, u.full_name as created_by_name FROM marketing_campaigns c
     LEFT JOIN marketing_audiences a ON a.id = c.audience_id
     LEFT JOIN users u ON u.id = c.created_by
     WHERE c.id = $1 AND c.tenant_id = $2`,
    [req.params.id, tenantId]
  )

  if (!campaign[0]) throw new AppError(404, 'Campaign not found', 'NOT_FOUND')

  const { rows: channels } = await pool.query(
    `SELECT cc.*, t.name as template_name FROM marketing_campaign_channels cc
     LEFT JOIN marketing_templates t ON t.id = cc.template_id
     WHERE cc.campaign_id = $1`,
    [req.params.id]
  )

  const stats = await getCampaignStats(req.params.id, tenantId)

  res.json({ ...campaign[0], channels, stats })
}))
router.put('/:id', requirePermission('marketing.campaigns.update'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { name, description, audience_id, channels, scheduled_at, status } = req.body

  const current = await pool.query(`SELECT status FROM marketing_campaigns WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  if (!current.rows[0]) throw new AppError(404, 'Campaign not found', 'NOT_FOUND')
  if (['sending', 'completed'].includes(current.rows[0].status) && status !== current.rows[0].status) {
    throw new AppError(400, 'Cannot modify campaign in current state', 'INVALID_STATE')
  }

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE marketing_campaigns SET
         name = COALESCE($1, name), description = COALESCE($2, description),
         audience_id = COALESCE($3, audience_id), scheduled_at = COALESCE($4, scheduled_at),
         status = COALESCE($5, status), updated_at = now()
       WHERE id = $6 AND tenant_id = $7`,
      [name, description, audience_id, scheduled_at, status, req.params.id, tenantId]
    )

    if (Array.isArray(channels)) {
      await client.query(`DELETE FROM marketing_campaign_channels WHERE campaign_id = $1`, [req.params.id])
      for (const ch of channels) {
        await client.query(
          `INSERT INTO marketing_campaign_channels (campaign_id, channel, template_id, provider, config)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.params.id, ch.channel, ch.template_id, ch.provider, JSON.stringify(ch.config || {})]
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
router.delete('/:id', requirePermission('marketing.campaigns.delete'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const current = await pool.query(`SELECT status FROM marketing_campaigns WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  if (!current.rows[0]) throw new AppError(404, 'Campaign not found', 'NOT_FOUND')
  if (['sending', 'completed'].includes(current.rows[0].status)) {
    throw new AppError(400, 'Cannot delete campaign in current state', 'INVALID_STATE')
  }

  await pool.query(`DELETE FROM marketing_campaigns WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  res.json({ success: true })
}))
router.post('/:id/send', requirePermission('marketing.campaigns.send'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const current = await pool.query(`SELECT status FROM marketing_campaigns WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  if (!current.rows[0]) throw new AppError(404, 'Campaign not found', 'NOT_FOUND')
  if (!['draft', 'scheduled', 'failed', 'cancelled'].includes(current.rows[0].status)) {
    throw new AppError(400, 'Campaign cannot be sent in current state', 'INVALID_STATE')
  }

  const result = await queueCampaign(tenantId, req.params.id, req.user!.id)

  res.json({ success: true, ...result })
}))
router.post('/:id/pause', requirePermission('marketing.campaigns.send'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  await pool.query(`UPDATE marketing_campaigns SET status = 'paused' WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  res.json({ success: true })
}))
router.post('/:id/cancel', requirePermission('marketing.campaigns.send'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  await pool.query(`UPDATE marketing_campaigns SET status = 'cancelled', completed_at = now() WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  res.json({ success: true })
}))
export default router
