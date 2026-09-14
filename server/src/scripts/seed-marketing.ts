import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool, query, queryOne } from '../config/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const firstNames = ['Abebe', 'Almaz', 'Dawit', 'Hana', 'Samuel', 'Selam', 'Yonas', 'Meron', 'Kaleb', 'Lidia', 'Nahom', 'Eden', 'Tadesse', 'Sara', 'Henok', 'Bethel', 'Mesfin', 'Rahel', 'Abel', 'Tsion']
const lastNames = ['Bekele', 'Tesfaye', 'Kebede', 'Alemu', 'Mengistu', 'Hailu', 'Tadesse', 'Worku', 'Girma', 'Wolde']
const cities = ['Addis Ababa', 'Bahir Dar', 'Hawassa', 'Mekelle', 'Dire Dawa', 'Adama', 'Gondar', 'Jimma']
const customerTypes = ['business', 'freelancer', 'individual', 'reseller', 'wholesale']

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

async function seedMarketingForTenant(tenantId: string, ownerId: string): Promise<void> {
  const existing = await queryOne(`SELECT COUNT(*) AS n FROM marketing_contacts WHERE tenant_id = $1`, [tenantId])
  if (Number(existing?.n ?? 0) > 0) {
    console.log('  Marketing data already exists, skipping')
    return
  }

  // ── Contacts ──────────────────────────────────────────────
  const contactIds: string[] = []
  for (let i = 0; i < 30; i++) {
    const firstName = randomItem(firstNames)
    const lastName = randomItem(lastNames)
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`
    const phone = `+2519${Math.floor(10000000 + Math.random() * 90000000)}`
    const status = Math.random() < 0.85 ? 'active' : 'unsubscribed'

    const contact = await queryOne(
      `INSERT INTO marketing_contacts (tenant_id, first_name, last_name, email, phone, country, city, customer_type, status)
       VALUES ($1,$2,$3,$4,$5,'Ethiopia',$6,$7,$8) RETURNING id`,
      [tenantId, firstName, lastName, email, phone, randomItem(cities), randomItem(customerTypes), status]
    )
    contactIds.push(contact!.id)

    // Channel preferences
    await queryOne(
      `INSERT INTO marketing_contact_channels (contact_id, tenant_id, channel, address, subscribed, verified)
       VALUES ($1,$2,'email',$3,true,true) ON CONFLICT (contact_id, channel) DO NOTHING`,
      [contact!.id, tenantId, email]
    )
    await queryOne(
      `INSERT INTO marketing_contact_channels (contact_id, tenant_id, channel, address, subscribed, verified)
       VALUES ($1,$2,'sms',$3,$4,true) ON CONFLICT (contact_id, channel) DO NOTHING`,
      [contact!.id, tenantId, phone, status === 'active']
    )
  }
  console.log(`  Created ${contactIds.length} contacts with channels`)

  // ── Templates ─────────────────────────────────────────────
  const smsTemplate = await queryOne(
    `INSERT INTO marketing_templates (tenant_id, name, channel, content, variables, status, created_by)
     VALUES ($1,'Promo Blast — SMS','sms','Hi {{first_name}}! Exclusive offer just for you. Visit us today and enjoy 20% off your next purchase.', $2, 'published', $3) RETURNING id`,
    [tenantId, JSON.stringify(['first_name']), ownerId]
  )
  const emailTemplate = await queryOne(
    `INSERT INTO marketing_templates (tenant_id, name, channel, subject, content, variables, status, created_by)
     VALUES ($1,'Monthly Newsletter — Email','email','Your {{city}} update from us','<h2>Hello {{first_name}},</h2><p>Here is what is new this month in {{city}}. We have fresh arrivals, special deals, and community events lined up for you.</p><p>Stay connected,<br/>The Team</p>', $2, 'published', $3) RETURNING id`,
    [tenantId, JSON.stringify(['first_name', 'city']), ownerId]
  )
  console.log('  Created 2 templates (SMS + Email)')

  // ── Audiences ─────────────────────────────────────────────
  const dynamicAudience = await queryOne(
    `INSERT INTO marketing_audiences (tenant_id, name, description, type, created_by)
     VALUES ($1,'Active Addis Ababa Customers','All active contacts based in Addis Ababa','dynamic',$2) RETURNING id`,
    [tenantId, ownerId]
  )
  await queryOne(
    `INSERT INTO marketing_audience_rules (audience_id, field, operator, value, logical_op, sort_order)
     VALUES ($1,'city','=',$2,'AND',0)`,
    [dynamicAudience!.id, JSON.stringify('Addis Ababa')]
  )
  await queryOne(
    `INSERT INTO marketing_audience_rules (audience_id, field, operator, value, logical_op, sort_order)
     VALUES ($1,'status','=','"active"','AND',1)`,
    [dynamicAudience!.id]
  )

  const staticAudience = await queryOne(
    `INSERT INTO marketing_audiences (tenant_id, name, description, type, created_by)
     VALUES ($1,'VIP Customers — Handpicked','Manually selected high-value contacts','static',$2) RETURNING id`,
    [tenantId, ownerId]
  )
  const vipCount = Math.min(10, contactIds.length)
  for (let i = 0; i < vipCount; i++) {
    await queryOne(
      `INSERT INTO marketing_audience_members (audience_id, contact_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [staticAudience!.id, contactIds[i]]
    )
  }
  console.log('  Created 2 audiences (dynamic + static)')

  // ── Campaigns ─────────────────────────────────────────────
  // Completed campaign (so analytics shows data)
  const doneCampaign = await queryOne(
    `INSERT INTO marketing_campaigns (tenant_id, name, description, audience_id, status, started_at, completed_at, created_by)
     VALUES ($1,'September Promo Blast','SMS promo to active Addis Ababa customers',$2,'completed', now() - interval '10 days', now() - interval '9 days', $3) RETURNING id`,
    [tenantId, dynamicAudience!.id, ownerId]
  )
  await queryOne(
    `INSERT INTO marketing_campaign_channels (campaign_id, channel, template_id, provider)
     VALUES ($1,'sms',$2,'ethiotelecom') ON CONFLICT (campaign_id, channel) DO NOTHING`,
    [doneCampaign!.id, smsTemplate!.id]
  )

  // Draft campaign (so the Send button is testable)
  const draftCampaign = await queryOne(
    `INSERT INTO marketing_campaigns (tenant_id, name, description, audience_id, status, created_by)
     VALUES ($1,'October Newsletter','Monthly newsletter via email',$2,'draft',$3) RETURNING id`,
    [tenantId, staticAudience!.id, ownerId]
  )
  await queryOne(
    `INSERT INTO marketing_campaign_channels (campaign_id, channel, template_id, provider)
     VALUES ($1,'email',$2,'resend') ON CONFLICT (campaign_id, channel) DO NOTHING`,
    [draftCampaign!.id, emailTemplate!.id]
  )

  // Completed campaign: recipients + messages (delivered/failed mix for analytics)
  const addisContacts = await query(
    `SELECT id, first_name, phone FROM marketing_contacts WHERE tenant_id = $1 AND city = 'Addis Ababa' AND status = 'active' LIMIT 15`,
    [tenantId]
  )
  const recipients = addisContacts.length > 0 ? addisContacts : (await query(`SELECT id, first_name, phone FROM marketing_contacts WHERE tenant_id = $1 AND status = 'active' LIMIT 15`, [tenantId]))

  for (const c of recipients) {
    const status = Math.random() < 0.85 ? 'delivered' : 'failed'
    const msg = await queryOne(
      `INSERT INTO marketing_messages (tenant_id, campaign_id, contact_id, channel, template_id, subject, content, provider, provider_msg_id, status, error, queued_at, sent_at, delivered_at)
       VALUES ($1,$2,$3,'sms',$4,NULL,$5,'ethiotelecom',$6,$7,$8, now() - interval '10 days', now() - interval '10 days' + interval '5 minutes', $9) RETURNING id`,
      [
        tenantId, doneCampaign!.id, c.id, smsTemplate!.id,
        `Hi ${c.first_name}! Exclusive offer just for you. Visit us today and enjoy 20% off your next purchase.`,
        `msg_${Date.now()}_${Math.floor(Math.random() * 100000)}`,
        status,
        status === 'failed' ? 'Provider rejected: invalid destination' : null,
        status === 'delivered' ? new Date(Date.now() - 10 * 86400000 + 6 * 60000).toISOString() : null,
      ]
    )
    await queryOne(
      `INSERT INTO marketing_campaign_recipients (campaign_id, contact_id, channel, status, message_id, sent_at, delivered_at)
       VALUES ($1,$2,'sms',$3,$4, now() - interval '10 days', $5)
       ON CONFLICT (campaign_id, contact_id, channel) DO NOTHING`,
      [doneCampaign!.id, c.id, status === 'delivered' ? 'delivered' : 'failed', msg!.id, status === 'delivered' ? new Date(Date.now() - 10 * 86400000 + 6 * 60000).toISOString() : null]
    )
    if (status === 'delivered') {
      await queryOne(
        `INSERT INTO marketing_message_events (message_id, event_type, provider) VALUES ($1,'sent','ethiotelecom'), ($1,'delivered','ethiotelecom')`,
        [msg!.id]
      )
    }
  }

  // Draft campaign: pending recipients
  const staticMembers = await query(`SELECT contact_id FROM marketing_audience_members WHERE audience_id = $1`, [staticAudience!.id])
  for (const m of staticMembers) {
    await queryOne(
      `INSERT INTO marketing_campaign_recipients (campaign_id, contact_id, channel, status)
       VALUES ($1,$2,'email','pending') ON CONFLICT (campaign_id, contact_id, channel) DO NOTHING`,
      [draftCampaign!.id, m.contact_id]
    )
  }

  console.log(`  Created 2 campaigns (1 completed with ${recipients.length} messages, 1 draft)`)

  // Email engagement events for the Analytics page (opened/clicked)
  const emailMsgs = await query(
    `SELECT id FROM marketing_messages WHERE tenant_id = $1 AND channel = 'email' LIMIT 10`,
    [tenantId]
  )
  for (const m of emailMsgs) {
    if (Math.random() < 0.5) {
      await queryOne(`INSERT INTO marketing_message_events (message_id, event_type, provider) VALUES ($1,'opened','resend')`, [m.id])
    }
    if (Math.random() < 0.3) {
      await queryOne(`INSERT INTO marketing_message_events (message_id, event_type, provider) VALUES ($1,'clicked','resend')`, [m.id])
    }
  }
}

async function main(): Promise<void> {
  console.log(' Seeding marketing demo data for ALL tenants...\n')

  const tenants = await query(`SELECT id, name, business_type FROM tenants ORDER BY business_type, name`)

  for (const tenant of tenants) {
    const owner = await queryOne(`SELECT id FROM users WHERE tenant_id = $1 AND role = 'owner' ORDER BY created_at LIMIT 1`, [tenant.id])
    const ownerId = owner?.id ?? (await queryOne(`SELECT id FROM users WHERE tenant_id = $1 ORDER BY created_at LIMIT 1`, [tenant.id]))?.id
    if (!ownerId) {
      console.log(`${tenant.name}: no user found, skipping`)
      continue
    }
    console.log(`Seeding marketing for ${tenant.name} (${tenant.business_type})...`)
    try {
      await seedMarketingForTenant(tenant.id, ownerId)
    } catch (err) {
      console.error(`  Failed for ${tenant.name}:`, err instanceof Error ? err.message : err)
    }
  }

  console.log('\n Marketing demo seeding complete!')
  await pool.end()
}

main().catch((err) => {
  console.error(' Marketing seeding failed:', err)
  process.exit(1)
})
