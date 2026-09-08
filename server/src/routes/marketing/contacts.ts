import { Router, type Request, type Response } from 'express'
import { pool } from '../../config/db.js'
import { authenticate, requirePermission, type AuthRequest } from '../../middleware/auth.js'
import { AppError } from '../../utils/helpers.js'
import { renderTemplate, extractVariables } from '../../services/marketing/templateEngine.js'

const router = Router()

router.use(authenticate)

router.get('/', async (req: Request, res: Response) => {
  const { page = '1', limit = '20', search, status } = req.query
  const offset = (parseInt(page as string) - 1) * parseInt(limit as string)
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id

  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const where: string[] = ['tenant_id = $1']
  const params: unknown[] = [tenantId]
  let paramIndex = 2

  if (search) {
    where.push(`(first_name ILIKE $${paramIndex} OR last_name ILIKE $${paramIndex} OR email ILIKE $${paramIndex} OR phone ILIKE $${paramIndex})`)
    params.push(`%${search}%`)
    paramIndex++
  }
  if (status) {
    where.push(`status = $${paramIndex}`)
    params.push(status)
    paramIndex++
  }

  const { rows: contacts } = await pool.query(
    `SELECT *, (SELECT json_agg(json_build_object('channel', channel, 'address', address, 'subscribed', subscribed, 'verified', verified))
     FROM marketing_contact_channels mcc WHERE mcc.contact_id = marketing_contacts.id) as channels
     FROM marketing_contacts
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, parseInt(limit as string), offset]
  )

  const { rows: count } = await pool.query(
    `SELECT COUNT(*) FROM marketing_contacts WHERE ${where.join(' AND ')}`,
    params
  )

  res.json({ contacts, total: parseInt(count[0].count, 10), page: parseInt(page as string), limit: parseInt(limit as string) })
})

router.post('/', requirePermission('marketing.contacts.create'), async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { first_name, last_name, email, phone, country, city, customer_type, metadata, channels } = req.body
  if (!first_name || !last_name) throw new AppError(400, 'first_name and last_name required', 'VALIDATION_ERROR')

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const { rows } = await client.query(
      `INSERT INTO marketing_contacts (tenant_id, first_name, last_name, email, phone, country, city, customer_type, metadata)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [tenantId, first_name, last_name, email?.toLowerCase(), phone, country, city, customer_type, JSON.stringify(metadata || {})]
    )

    const contact = rows[0]

    if (channels && Array.isArray(channels)) {
      for (const ch of channels) {
        if (ch.channel && ch.address) {
          await client.query(
            `INSERT INTO marketing_contact_channels (contact_id, tenant_id, channel, address, subscribed, verified)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (contact_id, channel) DO UPDATE SET address = $4, subscribed = $5, verified = $6`,
            [contact.id, tenantId, ch.channel, ch.address, ch.subscribed ?? true, ch.verified ?? false]
          )
        }
      }
    }

    await client.query('COMMIT')
    res.status(201).json(contact)
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

router.get('/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { rows } = await pool.query(
    `SELECT mc.*, json_agg(json_build_object('channel', mcc.channel, 'address', mcc.address, 'subscribed', mcc.subscribed, 'verified', mcc.verified)) as channels
     FROM marketing_contacts mc
     LEFT JOIN marketing_contact_channels mcc ON mcc.contact_id = mc.id
     WHERE mc.id = $1 AND mc.tenant_id = $2
     GROUP BY mc.id`,
    [req.params.id, tenantId]
  )

  if (!rows[0]) throw new AppError(404, 'Contact not found', 'NOT_FOUND')
  res.json(rows[0])
})

router.put('/:id', requirePermission('marketing.contacts.update'), async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { first_name, last_name, email, phone, country, city, customer_type, status, metadata, channels } = req.body

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    await client.query(
      `UPDATE marketing_contacts SET first_name = COALESCE($1, first_name), last_name = COALESCE($2, last_name),
       email = COALESCE($3, email), phone = COALESCE($4, phone), country = COALESCE($5, country),
       city = COALESCE($6, city), customer_type = COALESCE($7, customer_type), status = COALESCE($8, status),
       metadata = COALESCE($9, metadata), updated_at = now()
       WHERE id = $10 AND tenant_id = $11`,
      [first_name, last_name, email?.toLowerCase(), phone, country, city, customer_type, status, JSON.stringify(metadata), req.params.id, tenantId]
    )

    if (channels && Array.isArray(channels)) {
      for (const ch of channels) {
        if (ch.channel && ch.address) {
          await client.query(
            `INSERT INTO marketing_contact_channels (contact_id, tenant_id, channel, address, subscribed, verified)
             VALUES ($1,$2,$3,$4,$5,$6)
             ON CONFLICT (contact_id, channel) DO UPDATE SET address = $4, subscribed = $5, verified = $6`,
            [req.params.id, tenantId, ch.channel, ch.address, ch.subscribed ?? true, ch.verified ?? false]
          )
        }
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
})

router.delete('/:id', requirePermission('marketing.contacts.delete'), async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.query.tenant_id as string : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  await pool.query(`DELETE FROM marketing_contacts WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId])
  res.json({ success: true })
})

router.post('/import', requirePermission('marketing.contacts.import'), async (req: Request, res: Response) => {
  const tenantId = req.user!.role === 'afrotech_admin' ? req.body.tenant_id : req.user!.tenant_id
  if (!tenantId) throw new AppError(400, 'tenant_id required', 'NO_TENANT')

  const { contacts, skipDuplicates = true } = req.body
  if (!Array.isArray(contacts) || contacts.length === 0) throw new AppError(400, 'contacts array required', 'VALIDATION_ERROR')

  const client = await pool.connect()
  let imported = 0
  let skipped = 0
  const errors: string[] = []

  try {
    await client.query('BEGIN')

    for (const c of contacts) {
      if (!c.first_name || !c.last_name) {
        errors.push('Missing first_name or last_name')
        continue
      }

      const existing = await client.query(
        `SELECT id FROM marketing_contacts WHERE tenant_id = $1 AND (email = $2 OR phone = $3)`,
        [tenantId, c.email?.toLowerCase(), c.phone]
      )

      if (existing.rows.length > 0) {
        if (skipDuplicates) {
          skipped++
          continue
        }
        // Update existing
        await client.query(
          `UPDATE marketing_contacts SET first_name = $1, last_name = $2, country = $3, city = $4, customer_type = $5, metadata = $6, updated_at = now() WHERE id = $7`,
          [c.first_name, c.last_name, c.country, c.city, c.customer_type, JSON.stringify(c.metadata || {}), existing.rows[0].id]
        )
        imported++
      } else {
        const { rows } = await client.query(
          `INSERT INTO marketing_contacts (tenant_id, first_name, last_name, email, phone, country, city, customer_type, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [tenantId, c.first_name, c.last_name, c.email?.toLowerCase(), c.phone, c.country, c.city, c.customer_type, JSON.stringify(c.metadata || {})]
        )
        imported++

        if (c.channels && Array.isArray(c.channels)) {
          for (const ch of c.channels) {
            if (ch.channel && ch.address) {
              await client.query(
                `INSERT INTO marketing_contact_channels (contact_id, tenant_id, channel, address, subscribed, verified)
                 VALUES ($1,$2,$3,$4,$5,$6)
                 ON CONFLICT (contact_id, channel) DO UPDATE SET address = $4, subscribed = $5, verified = $6`,
                [rows[0].id, tenantId, ch.channel, ch.address, ch.subscribed ?? true, ch.verified ?? false]
              )
            }
          }
        }
      }
    }

    await client.query('COMMIT')
    res.json({ imported, skipped, errors })
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
})

export default router