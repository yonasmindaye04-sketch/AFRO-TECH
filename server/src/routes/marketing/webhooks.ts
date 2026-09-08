import { Router, type Response } from 'express'
import { pool } from '../../config/db.js'
import { AppError } from '../../utils/helpers.js'

const router = Router()

// Resend webhook
router.post('/webhooks/email', async (req, res: Response) => {
  try {
    const events = Array.isArray(req.body) ? req.body : [req.body]

    for (const event of events) {
      const providerMsgId = event.data?.email_id || event.data?.message_id
      if (!providerMsgId) continue

      const { rows } = await pool.query(
        `SELECT id FROM marketing_messages WHERE provider_msg_id = $1`,
        [providerMsgId]
      )

      if (rows.length === 0) continue

      const messageId = rows[0].id
      let newStatus = 'sent'
      let eventType = 'sent'

      switch (event.type) {
        case 'email.sent': newStatus = 'sent'; eventType = 'sent'; break
        case 'email.delivered': newStatus = 'delivered'; eventType = 'delivered'; break
        case 'email.bounced': newStatus = 'bounced'; eventType = 'bounced'; break
        case 'email.complained': newStatus = 'failed'; eventType = 'complained'; break
        case 'email.opened': eventType = 'opened'; break
        case 'email.clicked': eventType = 'clicked'; break
        case 'email.unsubscribed': newStatus = 'unsubscribed'; eventType = 'unsubscribed'; break
      }

      await pool.query(
        `INSERT INTO marketing_message_events (message_id, event_type, provider, provider_event_id, payload)
         VALUES ($1,$2,'resend',$3,$4)
         ON CONFLICT DO NOTHING`,
        [messageId, eventType, event.id || `${Date.now()}`, JSON.stringify(event)]
      )

      if (newStatus !== 'sent') {
        await pool.query(
          `UPDATE marketing_messages SET status = $1, ${newStatus === 'delivered' ? 'delivered_at = now()' : ''} WHERE id = $2`,
          [newStatus, messageId]
        )
        await pool.query(
          `UPDATE marketing_campaign_recipients SET status = $1 WHERE message_id = $2`,
          [newStatus, messageId]
        )
      }
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[webhook] email error:', err)
    res.status(500).json({ error: 'Webhook processing failed' })
  }
})

// EthioTelecom SMPP webhook (delivery receipts)
router.post('/webhooks/sms', async (req, res: Response) => {
  try {
    const { message_id, status, error_code, timestamp } = req.body

    if (!message_id) return res.json({ success: true })

    const { rows } = await pool.query(
      `SELECT id FROM marketing_messages WHERE provider_msg_id = $1`,
      [message_id]
    )

    if (rows.length === 0) return res.json({ success: true })

    const messageId = rows[0].id
    let newStatus = 'sent'
    let eventType = 'delivered'

    switch (status) {
      case 'DELIVRD': newStatus = 'delivered'; eventType = 'delivered'; break
      case 'EXPIRED': newStatus = 'failed'; eventType = 'failed'; break
      case 'DELETED': newStatus = 'failed'; eventType = 'failed'; break
      case 'UNDELIV': newStatus = 'failed'; eventType = 'failed'; break
      case 'ACCEPTD': newStatus = 'sent'; eventType = 'sent'; break
      case 'ENROUTE': newStatus = 'sending'; eventType = 'sent'; break
    }

    await pool.query(
      `INSERT INTO marketing_message_events (message_id, event_type, provider, provider_event_id, payload)
       VALUES ($1,$2,'ethiotelecom',$3,$4)
       ON CONFLICT DO NOTHING`,
      [messageId, eventType, message_id, JSON.stringify(req.body)]
    )

    if (newStatus !== 'sent') {
      await pool.query(
        `UPDATE marketing_messages SET status = $1, ${newStatus === 'delivered' ? 'delivered_at = now()' : ''} WHERE id = $2`,
        [newStatus, messageId]
      )
      await pool.query(
        `UPDATE marketing_campaign_recipients SET status = $1 WHERE message_id = $2`,
        [newStatus, messageId]
      )
    }

    res.json({ success: true })
  } catch (err) {
    console.error('[webhook] sms error:', err)
    res.status(500).json({ error: 'Webhook processing failed' })
  }
})

export default router