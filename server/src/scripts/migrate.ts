import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool } from '../config/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const migrationsDir = path.resolve(__dirname, '../../migrations')

async function run(): Promise<void> {
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())`)
  const applied = new Set((await pool.query<{ name: string }>(`SELECT name FROM schema_migrations`)).rows.map((r) => r.name))

  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort()
  if (!files.length) {
    console.log('No migration files found.')
    return
  }

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} already applied`)
      continue
    }
    const sql = await readFile(path.join(migrationsDir, file), 'utf8')
    try {
      await pool.query(sql)
      await pool.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [file])
      console.log(`✓ applied ${file}`)
    } catch (err) {
      console.error(`✗ failed ${file}:`, err)
      process.exit(1)
    }
  }
  await pool.end()
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
