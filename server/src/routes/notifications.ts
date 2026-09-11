import { Router } from 'express'
import { z } from 'zod'
import { pool, query, queryOne } from '../config/db.js'
import { asyncHandler, AppError } from '../utils/helpers.js'
import { logAudit } from '../utils/audit.js'
import { authenticate, requireActiveTenant, requirePermission } from '../middleware/auth.js'
import { validateBody } from '../middleware/validate.js'
import { sendNotification, notifyRole, notifyDepartment, notifyUsers, notifyLongWait } from '../services/notificationEngine.js'

const router = Router()
router.use(authenticate, requireActiveTenant)
const t = (req: { user?: { tenant_id: string | null } }) => req.user!.tenant_id as string

/* ═══════════════ NOTIFICATION TEMPLATES ═══════════════ */

const templateSchema = z.object({
   name: z.string().trim().min(2).max(120),
   code: z.string().trim().min(2).max(80).regex(/^[a-z_]+$/),
   channel: z.enum(['telegram', 'email', 'both']),
   subject: z.string().trim().max(200).optional().nullable(),
   body: z.string().trim().min(1).max(5000),
   variables: z.array(z.string()).default([]),
   is_active: z.boolean().default(true),
 })

router.get(
  '/templates',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const { page = '1', limit = '20', channel, is_active } = req.query
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string)
    const where: string[] = ['tenant_id = $1']
    const params: unknown[] = [t(req)]
    let paramIndex = 2

    if (channel) {
      where.push(`channel = $${paramIndex}`)
      params.push(channel)
      paramIndex++
    }
    if (is_active !== undefined) {
      where.push(`is_active = $${paramIndex}`)
      params.push(is_active === 'true')
      paramIndex++
    }

const templates = await query(
       `SELECT * FROM notification_templates
        WHERE ${where.join(' AND ')}
        ORDER BY is_system DESC, code ASC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
       [...params, parseInt(limit as string), offset]
     )

     const count = await query(
       `SELECT COUNT(*) FROM notification_templates WHERE ${where.join(' AND ')}`,
       params
     )

    res.json({ templates, total: parseInt(count[0].count, 10), page: parseInt(page as string), limit: parseInt(limit as string) })
  })
)

router.post(
  '/templates',
  requirePermission('notifications.manage'),
  validateBody(templateSchema),
  asyncHandler(async (req, res) => {
    const d = req.body as z.infer<typeof templateSchema>
    const row = await queryOne(
      `INSERT INTO notification_templates (tenant_id, code, name, channel, subject, body, variables, is_system, is_active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,false,true,$8) RETURNING *`,
      [t(req), d.code, d.name, d.channel, d.subject, d.body, JSON.stringify(d.variables), req.user!.id]
    )
    res.status(201).json({ template: row })
  })
)

router.get(
   '/templates/:id',
   requirePermission('notifications.view'),
   asyncHandler(async (req, res) => {
     const templates = await query(
       `SELECT * FROM notification_templates WHERE id = $1 AND tenant_id = $2`,
       [req.params.id, t(req)]
     )
     if (!templates[0]) throw new AppError(404, 'Template not found', 'NOT_FOUND')
     res.json({ template: templates[0] })
   })
 )

router.put(
  '/templates/:id',
  requirePermission('notifications.manage'),
  validateBody(templateSchema.partial()),
  asyncHandler(async (req, res) => {
    const d = req.body as Partial<z.infer<typeof templateSchema>>
    const cur = await queryOne(`SELECT * FROM notification_templates WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!cur) throw new AppError(404, 'Template not found', 'NOT_FOUND')
    if (cur.is_system) throw new AppError(403, 'Cannot modify system template', 'FORBIDDEN')

    const variables = d.variables ? JSON.stringify(d.variables) : cur.variables

    await query(
      `UPDATE notification_templates SET
         name = COALESCE($3, name), channel = COALESCE($4, channel),
         subject = COALESCE($5, subject), body = COALESCE($6, body),
         variables = COALESCE($7, variables), is_active = COALESCE($8, is_active),
         updated_at = now()
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, t(req), d.name, d.channel, d.subject, d.body, variables, d.is_active]
    )
    res.json({ success: true })
  })
)

router.delete(
  '/templates/:id',
  requirePermission('notifications.manage'),
  asyncHandler(async (req, res) => {
    const cur = await queryOne(`SELECT * FROM notification_templates WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    if (!cur) throw new AppError(404, 'Template not found', 'NOT_FOUND')
    if (cur.is_system) throw new AppError(403, 'Cannot delete system template', 'FORBIDDEN')
    await query(`DELETE FROM notification_templates WHERE id = $1 AND tenant_id = $2`, [req.params.id, t(req)])
    res.json({ success: true })
  })
)

/* ═══════════════ SEND NOTIFICATIONS ═══════════════ */

const sendSchema = z.object({
  code: z.string().trim().min(2),
  data: z.record(z.unknown()).default({}),
  target: z.object({
    userIds: z.array(z.string().uuid()).optional(),
    roleNames: z.array(z.string()).optional(),
    departmentIds: z.array(z.string().uuid()).optional(),
    channels: z.array(z.enum(['telegram', 'email'])).optional(),
  }).optional(),
  skipThrottle: z.boolean().optional(),
})

router.post(
  '/send',
  requirePermission('notifications.send'),
  validateBody(sendSchema),
  asyncHandler(async (req, res) => {
    const { code, data, target, skipThrottle } = req.body as z.infer<typeof sendSchema>
    const result = await sendNotification({ tenantId: t(req), code, data, target, skipThrottle })
    res.json({ success: true, ...result })
  })
)

/* ═══════════════ CONVENIENCE ENDPOINTS ═══════════════ */

// Notify by role
router.post(
  '/notify/role',
  requirePermission('notifications.send'),
  validateBody(z.object({
    code: z.string().trim().min(2),
    data: z.record(z.unknown()).default({}),
    roleNames: z.array(z.string()).min(1),
  })),
  asyncHandler(async (req, res) => {
    const { code, data, roleNames } = req.body
    const result = await notifyRole(t(req), code, data, roleNames)
    res.json({ success: true, ...result })
  })
)

// Notify department
router.post(
  '/notify/department',
  requirePermission('notifications.send'),
  validateBody(z.object({
    code: z.string().trim().min(2),
    data: z.record(z.unknown()).default({}),
    departmentIds: z.array(z.string().uuid()).min(1),
  })),
  asyncHandler(async (req, res) => {
    const { code, data, departmentIds } = req.body
    const result = await notifyDepartment(t(req), code, data, departmentIds)
    res.json({ success: true, ...result })
  })
)

// Notify specific users
router.post(
  '/notify/users',
  requirePermission('notifications.send'),
  validateBody(z.object({
    code: z.string().trim().min(2),
    data: z.record(z.unknown()).default({}),
    userIds: z.array(z.string().uuid()).min(1),
  })),
  asyncHandler(async (req, res) => {
    const { code, data, userIds } = req.body
    const result = await notifyUsers(t(req), code, data, userIds)
    res.json({ success: true, ...result })
  })
)

// Long wait escalation
router.post(
  '/notify/long-wait',
  requirePermission('notifications.send'),
  validateBody(z.object({
    patientName: z.string().trim().min(1),
    departmentName: z.string().nullable(),
    minutes: z.number().int().min(1),
  })),
  asyncHandler(async (req, res) => {
    const { patientName, departmentName, minutes } = req.body
    const result = await notifyLongWait(t(req), patientName, departmentName, minutes)
    res.json({ success: true, ...result })
  })
)

/* ═══════════════ DELIVERY LOGS / AUDIT ═══════════════ */

router.get(
  '/logs',
  requirePermission('notifications.view'),
  asyncHandler(async (req, res) => {
    const { page = '1', limit = '50', template_code, channel, status } = req.query
    const offset = (parseInt(page as string) - 1) * parseInt(limit as string)
    const params: unknown[] = [t(req)]
    let where = `WHERE n.tenant_id = $1`
    let paramIndex = 2

    if (template_code) {
      where += ` AND n.template_code = $${paramIndex}`
      params.push(template_code)
      paramIndex++
    }
    if (channel) {
      where += ` AND n.channel = $${paramIndex}`
      params.push(channel)
      paramIndex++
    }
    if (status) {
      where += ` AND n.status = $${paramIndex}`
      params.push(status)
      paramIndex++
    }

    const logs = await query(
      `SELECT n.*, t.name AS template_name FROM notification_events n
       LEFT JOIN notification_templates t ON t.id = n.template_id
       ${where} ORDER BY n.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, parseInt(limit as string), offset]
    )

    const count = await query(
      `SELECT COUNT(*) FROM notification_events n ${where}`,
      params
    )

    res.json({ logs: logs, total: parseInt(count[0].count, 10), page: parseInt(page as string), limit: parseInt(limit as string) })
  })
)

export default router