import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool, queryOne } from '../config/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

/** Creates (or updates) the AFRO-TECH platform admin account. */
async function seed(): Promise<void> {
  const email = String(process.env.ADMIN_EMAIL || '').toLowerCase()
  const password = process.env.ADMIN_PASSWORD || ''
  const fullName = process.env.ADMIN_NAME || 'AFRO-TECH Admin'

  if (!email || !password || password === 'ChangeMeNow!') {
    console.error('\n⚠ Set ADMIN_EMAIL and a strong ADMIN_PASSWORD in server/.env first.\n')
    process.exit(1)
  }

  const hash = await bcrypt.hash(password, 12)
  const existing = await queryOne(`SELECT id FROM users WHERE email = $1`, [email])
  if (existing) {
    await pool.query(`UPDATE users SET password_hash = $1, role = 'afrotech_admin', tenant_id = NULL, is_active = true WHERE id = $2`, [
      hash,
      existing.id,
    ])
    console.log(`✓ AFRO-TECH admin updated: ${email}`)
  } else {
    await pool.query(`INSERT INTO users (email, password_hash, full_name, role, tenant_id) VALUES ($1,$2,$3,'afrotech_admin',NULL)`, [
      email,
      hash,
      fullName,
    ])
    console.log(`✓ AFRO-TECH admin created: ${email}`)
  }
  await pool.end()
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
