import { pool } from '../../config/db.js'
import { marketingQueues } from '../../config/queue.js'
import type { MarketingJobData } from '../../config/queue.js'
import { renderTemplate, validateVariables } from './templateEngine.js'

export async function queueCampaign(
  tenantId: string,
  campaignId: string,
  createdBy: string
): Promise<{ queued: number; errors: string[] }> {
  const campaign = await pool.query(
    `SELECT c.*, json_agg(json_build_object('channel', cc.channel, 'template_id', cc.template_id, 'provider', cc.provider, 'config', cc.config)) as channels
     FROM marketing_campaigns c
     LEFT JOIN marketing_campaign_channels cc ON cc.campaign_id = c.id
     WHERE c.id = $1 AND c.tenant_id = $2
     GROUP BY c.id`,
    [campaignId, tenantId]
  )

  if (campaign.rows.length === 0) {
    throw new Error('Campaign not found')
  }

  const camp = campaign.rows[0]
  const channels = camp.channels?.[0]?.channel ? camp.channels : []

  if (channels.length === 0) {
    throw new Error('Campaign has no channels configured')
  }

  const audienceMembers = await getAudienceMemberContacts(tenantId, camp.audience_id)

  if (audienceMembers.length === 0) {
    await pool.query(`UPDATE marketing_campaigns SET status = 'completed', completed_at = now() WHERE id = $1`, [campaignId])
    return { queued: 0, errors: ['Audience has no members'] }
  }

  await pool.query(`UPDATE marketing_campaigns SET status = 'queued', started_at = now() WHERE id = $1`, [campaignId])

  let totalQueued = 0
  const errors: string[] = []

  for (const channel of channels) {
    const template = await pool.query(
      `SELECT id, name, channel, subject, content, variables FROM marketing_templates WHERE id = $1`,
      [channel.template_id]
    )

    if (template.rows.length === 0) {
      errors.push(`Template ${channel.template_id} not found for channel ${channel.channel}`)
      continue
    }

    const tmpl = template.rows[0]
    const provider = channel.provider || (channel.channel === 'email' ? 'resend' : channel.channel === 'sms' ? 'ethiotelecom' : 'default')

    for (const contact of audienceMembers) {
      const contactChannel = await pool.query(
        `SELECT address, subscribed, verified FROM marketing_contact_channels WHERE contact_id = $1 AND channel = $2 AND tenant_id = $3`,
        [contact.id, channel.channel, tenantId]
      )

      if (contactChannel.rows.length === 0 || !contactChannel.rows[0].subscribed) {
        continue
      }

      const variables = buildContactVariables(contact)
      const validation = validateVariables(tmpl.content, variables)

      if (!validation.valid) {
        errors.push(`Missing variables for contact ${contact.id}: ${validation.missing.join(', ')}`)
        continue
      }

      const renderedContent = renderTemplate(tmpl.content, variables)
      const renderedSubject = tmpl.subject ? renderTemplate(tmpl.subject, variables) : undefined

      const messageResult = await pool.query(
        `INSERT INTO marketing_messages (tenant_id, campaign_id, contact_id, channel, template_id, subject, content, provider, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'queued')
         RETURNING id`,
        [tenantId, campaignId, contact.id, channel.channel, tmpl.id, renderedSubject, renderedContent, provider]
      )

      const messageId = messageResult.rows[0].id

      await pool.query(
        `INSERT INTO marketing_campaign_recipients (campaign_id, contact_id, channel, status, message_id)
         VALUES ($1,$2,$3,'queued',$4)
         ON CONFLICT (campaign_id, contact_id, channel) DO UPDATE SET status = 'queued', message_id = $4`,
        [campaignId, contact.id, channel.channel, messageId]
      )

      const jobData: MarketingJobData = {
        messageId,
        tenantId,
        campaignId,
        contactId: contact.id,
        channel: channel.channel,
        provider,
        to: contactChannel.rows[0].address,
        subject: renderedSubject,
        content: renderedContent,
        templateId: tmpl.id,
      }

      await marketingQueues[channel.channel].add('send', jobData, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })
      totalQueued++
    }
  }

  if (totalQueued === 0) {
    await pool.query(`UPDATE marketing_campaigns SET status = 'failed' WHERE id = $1`, [campaignId])
  } else {
    await pool.query(`UPDATE marketing_campaigns SET status = 'sending' WHERE id = $1`, [campaignId])
  }

  return { queued: totalQueued, errors }
}

async function getAudienceMemberContacts(tenantId: string, audienceId: string): Promise<Array<{ id: string; first_name: string; last_name: string; email: string | null; phone: string | null; country: string | null; city: string | null; customer_type: string | null; metadata: Record<string, unknown> }>> {
  const audience = await pool.query(`SELECT type FROM marketing_audiences WHERE id = $1 AND tenant_id = $2`, [audienceId, tenantId])
  if (audience.rows.length === 0) return []

  if (audience.rows[0].type === 'static' || audience.rows[0].type === 'imported') {
    const { rows } = await pool.query(
      `SELECT mc.* FROM marketing_contacts mc
       JOIN marketing_audience_members mam ON mam.contact_id = mc.id
       WHERE mam.audience_id = $1 AND mc.status = 'active'`,
      [audienceId]
    )
    return rows
  }

  const { rows: rules } = await pool.query(
    `SELECT field, operator, value, logical_op FROM marketing_audience_rules WHERE audience_id = $1 ORDER BY sort_order`,
    [audienceId]
  )

  const whereClauses: string[] = []
  const params: unknown[] = [tenantId]
  let paramIndex = 2

  for (const rule of rules) {
    const field = rule.field
    const operator = rule.operator
    const value = rule.value

    let clause = ''

    if (['first_name','last_name','email','phone','country','city','customer_type','status'].includes(field)) {
      clause = buildCondition(`mc.${field}`, operator, value, params, paramIndex)
      paramIndex = params.length + 1
    }

    if (clause) whereClauses.push(clause)
  }

  const whereSql = whereClauses.length > 0 ? `AND (${whereClauses.join(' AND ')})` : ''
  const sql = `SELECT * FROM marketing_contacts mc WHERE mc.tenant_id = $1 AND mc.status = 'active' ${whereSql}`
  const { rows } = await pool.query(sql, params)
  return rows
}

function buildCondition(column: string, operator: string, value: unknown, params: unknown[], paramIndex: number): string {
  switch (operator) {
    case '=':
      params.push(value); return `${column} = $${paramIndex}`
    case '!=':
      params.push(value); return `${column} != $${paramIndex}`
    case 'IN':
      if (Array.isArray(value) && value.length > 0) {
        const ph = value.map((_, i) => `$${paramIndex + i}`).join(',')
        params.push(...value); return `${column} IN (${ph})`
      }
      return 'FALSE'
    case 'NOT IN':
      if (Array.isArray(value) && value.length > 0) {
        const ph = value.map((_, i) => `$${paramIndex + i}`).join(',')
        params.push(...value); return `${column} NOT IN (${ph})`
      }
      return 'TRUE'
    case '>':
      params.push(value); return `${column} > $${paramIndex}`
    case '<':
      params.push(value); return `${column} < $${paramIndex}`
    case '>=':
      params.push(value); return `${column} >= $${paramIndex}`
    case '<=':
      params.push(value); return `${column} <= $${paramIndex}`
    case 'LIKE':
    case 'ILIKE':
      params.push(`%${value}%`); return `${column} ILIKE $${paramIndex}`
    case 'IS NULL':
      return `${column} IS NULL`
    case 'IS NOT NULL':
      return `${column} IS NOT NULL`
    default:
      return ''
  }
}

function buildContactVariables(contact: { first_name: string; last_name: string; email: string | null; phone: string | null; country: string | null; city: string | null; customer_type: string | null; metadata: Record<string, unknown> }): Record<string, string | number | boolean | null> {
  return {
    first_name: contact.first_name,
    last_name: contact.last_name,
    full_name: `${contact.first_name} ${contact.last_name}`,
    email: contact.email || '',
    phone: contact.phone || '',
    country: contact.country || '',
    city: contact.city || '',
    customer_type: contact.customer_type || '',
    ...contact.metadata,
  }
}

export async function getCampaignStats(campaignId: string, tenantId: string) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending') as pending,
       COUNT(*) FILTER (WHERE status = 'queued') as queued,
       COUNT(*) FILTER (WHERE status = 'sent') as sent,
       COUNT(*) FILTER (WHERE status = 'delivered') as delivered,
       COUNT(*) FILTER (WHERE status = 'failed') as failed,
       COUNT(*) FILTER (WHERE status = 'bounced') as bounced,
       COUNT(*) FILTER (WHERE status = 'unsubscribed') as unsubscribed,
       COUNT(*) as total
     FROM marketing_campaign_recipients
     WHERE campaign_id = $1`,
    [campaignId]
  )
  return rows[0]
}