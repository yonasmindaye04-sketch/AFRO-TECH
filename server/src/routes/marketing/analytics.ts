import { Router, type Request, type Response } from 'express'
import { pool } from '../../config/db.js'
import { authenticate, requirePermission } from '../../middleware/auth.js'
import { AppError, asyncHandler } from '../../utils/helpers.js'

const router = Router()

router.use(authenticate)

router.get('/overview', requirePermission('marketing.analytics.view'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { rows: contacts } = await pool.query(
    `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'active') as active
     FROM marketing_contacts WHERE tenant_id = $1`,
    [tenantId]
  )

  const { rows: campaigns } = await pool.query(
    `SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'completed') as completed,
            COUNT(*) FILTER (WHERE status = 'sending') as sending,
            COUNT(*) FILTER (WHERE status = 'failed') as failed
     FROM marketing_campaigns WHERE tenant_id = $1`,
    [tenantId]
  )

  const { rows: messages } = await pool.query(
    `SELECT COUNT(*) as total,
            COUNT(*) FILTER (WHERE status = 'sent') as sent,
            COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
            COUNT(*) FILTER (WHERE status = 'failed') as failed,
            COUNT(*) FILTER (WHERE status = 'bounced') as bounced,
            COUNT(*) FILTER (WHERE status = 'unsubscribed') as unsubscribed
     FROM marketing_messages WHERE tenant_id = $1`,
    [tenantId]
  )

  const { rows: recent } = await pool.query(
    `SELECT c.id, c.name, c.status, c.created_at,
       (SELECT COUNT(*) FROM marketing_campaign_recipients WHERE campaign_id = c.id) as recipients
     FROM marketing_campaigns c
     WHERE c.tenant_id = $1
     ORDER BY c.created_at DESC LIMIT 5`,
    [tenantId]
  )

  res.json({ contacts: contacts[0], campaigns: campaigns[0], messages: messages[0], recent })
}))
router.get('/campaigns/:id', requirePermission('marketing.analytics.view'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { rows: campaign } = await pool.query(
    `SELECT * FROM marketing_campaigns WHERE id = $1 AND tenant_id = $2`,
    [req.params.id, tenantId]
  )
  if (!campaign[0]) throw new AppError(404, 'Campaign not found', 'NOT_FOUND')

  const { rows: byChannel } = await pool.query(
    `SELECT channel,
       COUNT(*) as total,
       COUNT(*) FILTER (WHERE status = 'pending') as pending,
       COUNT(*) FILTER (WHERE status = 'queued') as queued,
       COUNT(*) FILTER (WHERE status = 'sent') as sent,
       COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
       COUNT(*) FILTER (WHERE status = 'failed') as failed,
       COUNT(*) FILTER (WHERE status = 'bounced') as bounced,
       COUNT(*) FILTER (WHERE status = 'unsubscribed') as unsubscribed
     FROM marketing_campaign_recipients
     WHERE campaign_id = $1
     GROUP BY channel`,
    [req.params.id]
  )

  const { rows: timeline } = await pool.query(
    `SELECT DATE_TRUNC('hour', created_at) as hour,
       COUNT(*) as sent,
       COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
       COUNT(*) FILTER (WHERE status = 'failed') as failed
     FROM marketing_messages
     WHERE campaign_id = $1
     GROUP BY DATE_TRUNC('hour', created_at)
     ORDER BY hour DESC LIMIT 48`,
    [req.params.id]
  )

  res.json({ campaign: campaign[0], byChannel, timeline })
}))
router.get('/channels', requirePermission('marketing.analytics.view'), asyncHandler(async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { rows: sms } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'sent') as sent,
            COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
            COUNT(*) FILTER (WHERE status = 'failed') as failed
     FROM marketing_messages WHERE tenant_id = $1 AND channel = 'sms'`,
    [tenantId]
  )

  const { rows: email } = await pool.query(
    `SELECT COUNT(*) FILTER (WHERE status = 'sent') as sent,
            COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
            COUNT(*) FILTER (WHERE status = 'failed') as failed,
            COUNT(*) FILTER (WHERE event_type = 'opened') as opened,
            COUNT(*) FILTER (WHERE event_type = 'clicked') as clicked
     FROM marketing_message_events mme
     JOIN marketing_messages mm ON mm.id = mme.message_id
     WHERE mm.tenant_id = $1 AND mm.channel = 'email'`,
    [tenantId]
  )

  res.json({ sms: sms[0], email: email[0] })
}))
export default router
