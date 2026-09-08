import { pool } from '../../config/db.js'

export interface AudienceRule {
  field: string
  operator: string
  value: unknown
  logicalOp: 'AND' | 'OR'
}

const CONTACT_FIELDS = new Set([
  'first_name', 'last_name', 'email', 'phone', 'country', 'city', 'customer_type', 'status',
  'created_at', 'updated_at'
])

const CHANNEL_FIELDS = new Set(['sms_subscribed', 'email_subscribed', 'whatsapp_subscribed', 'push_subscribed'])

export function buildAudienceQuery(tenantId: string, rules: AudienceRule[]): { sql: string; params: unknown[] } {
  if (rules.length === 0) {
    return {
      sql: `SELECT id FROM marketing_contacts WHERE tenant_id = $1 AND status = 'active'`,
      params: [tenantId],
    }
  }

  const whereClauses: string[] = []
  const params: unknown[] = [tenantId]
  let paramIndex = 2

  for (const rule of rules) {
    const field = rule.field
    const operator = rule.operator
    const value = rule.value

    let clause = ''

    if (CONTACT_FIELDS.has(field)) {
      clause = buildCondition(`mc.${field}`, operator, value, params, paramIndex)
      paramIndex = params.length + 1
    } else if (CHANNEL_FIELDS.has(field)) {
      const channelField = field.replace('_subscribed', '')
      clause = buildCondition(`mcc.subscribed`, operator, value, params, paramIndex)
      paramIndex = params.length + 1
      if (clause) {
        clause = `EXISTS (SELECT 1 FROM marketing_contact_channels mcc WHERE mcc.contact_id = mc.id AND mcc.tenant_id = mc.tenant_id AND mcc.channel = '${channelField}' AND ${clause})`
      }
    }

    if (clause) {
      whereClauses.push(clause)
    }
  }

  const whereSql = whereClauses.length > 0 ? `AND (${whereClauses.join(' AND ')})` : ''

  return {
    sql: `SELECT mc.id FROM marketing_contacts mc WHERE mc.tenant_id = $1 AND mc.status = 'active' ${whereSql}`,
    params,
  }
}

function buildCondition(
  column: string,
  operator: string,
  value: unknown,
  params: unknown[],
  paramIndex: number
): string {
  switch (operator) {
    case '=':
      params.push(value)
      return `${column} = $${paramIndex}`
    case '!=':
      params.push(value)
      return `${column} != $${paramIndex}`
    case 'IN':
      if (Array.isArray(value) && value.length > 0) {
        const placeholders = value.map((_, i) => `$${paramIndex + i}`).join(',')
        params.push(...value)
        return `${column} IN (${placeholders})`
      }
      return 'FALSE'
    case 'NOT IN':
      if (Array.isArray(value) && value.length > 0) {
        const placeholders = value.map((_, i) => `$${paramIndex + i}`).join(',')
        params.push(...value)
        return `${column} NOT IN (${placeholders})`
      }
      return 'TRUE'
    case '>':
      params.push(value)
      return `${column} > $${paramIndex}`
    case '<':
      params.push(value)
      return `${column} < $${paramIndex}`
    case '>=':
      params.push(value)
      return `${column} >= $${paramIndex}`
    case '<=':
      params.push(value)
      return `${column} <= $${paramIndex}`
    case 'LIKE':
      params.push(`%${value}%`)
      return `${column} ILIKE $${paramIndex}`
    case 'ILIKE':
      params.push(`%${value}%`)
      return `${column} ILIKE $${paramIndex}`
    case 'IS NULL':
      return `${column} IS NULL`
    case 'IS NOT NULL':
      return `${column} IS NOT NULL`
    default:
      return ''
  }
}

export async function getAudienceMembers(tenantId: string, audienceId: string): Promise<string[]> {
  const audience = await pool.query(
    `SELECT type FROM marketing_audiences WHERE id = $1 AND tenant_id = $2`,
    [audienceId, tenantId]
  )

  if (audience.rows.length === 0) {
    throw new Error('Audience not found')
  }

  const { rows: rules } = await pool.query(
    `SELECT field, operator, value, logical_op FROM marketing_audience_rules WHERE audience_id = $1 ORDER BY sort_order`,
    [audienceId]
  )

  if (audience.rows[0].type === 'static' || audience.rows[0].type === 'imported') {
    const { rows } = await pool.query(
      `SELECT contact_id FROM marketing_audience_members WHERE audience_id = $1`,
      [audienceId]
    )
    return rows.map(r => r.contact_id)
  }

  const { sql, params } = buildAudienceQuery(tenantId, rules)
  const { rows } = await pool.query(sql, params)
  return rows.map(r => r.id)
}

export async function getAudienceCount(tenantId: string, audienceId: string): Promise<number> {
  const audience = await pool.query(
    `SELECT type FROM marketing_audiences WHERE id = $1 AND tenant_id = $2`,
    [audienceId, tenantId]
  )

  if (audience.rows.length === 0) return 0

  if (audience.rows[0].type === 'static' || audience.rows[0].type === 'imported') {
    const { rows } = await pool.query(
      `SELECT COUNT(*) FROM marketing_audience_members WHERE audience_id = $1`,
      [audienceId]
    )
    return parseInt(rows[0].count, 10)
  }

  const { rows: rules } = await pool.query(
    `SELECT field, operator, value, logical_op FROM marketing_audience_rules WHERE audience_id = $1 ORDER BY sort_order`,
    [audienceId]
  )

  const { sql, params } = buildAudienceQuery(tenantId, rules)
  const countSql = sql.replace('SELECT mc.id', 'SELECT COUNT(*)')
  const { rows } = await pool.query(countSql, params)
  return parseInt(rows[0].count, 10)
}