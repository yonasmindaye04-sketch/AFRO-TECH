import { Pool, type PoolConfig, type QueryResultRow } from 'pg'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

/**
 * Two ways to connect:
 *  - DATABASE_URL (Neon/Supabase/Render style): full postgres:// string, SSL on cloud URLs.
 *  - Discrete DB_HOST/DB_PORT/... vars (local dev).
 *
 * Set PGSSL=false to force plain TCP on a private network where TLS is terminated elsewhere.
 */
const sslFromUrl =
  !!process.env.DATABASE_URL &&
  /sslmode=(require|verify-ca|verify-full|prefer|allow)/i.test(process.env.DATABASE_URL) &&
  !/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL)

const useSsl =
  process.env.PGSSL === 'false'
    ? false
    : sslFromUrl || process.env.DB_SSL === 'true' || process.env.NODE_ENV === 'production'

export const pool = new Pool(
  process.env.DATABASE_URL
    ? ({
        connectionString: process.env.DATABASE_URL,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
      } satisfies PoolConfig)
    : ({
        host: process.env.DB_HOST || 'localhost',
        port: Number(process.env.DB_PORT || 5432),
        database: process.env.DB_NAME || 'afro_suite',
        user: process.env.DB_USER || 'postgres',
        password: process.env.DB_PASSWORD,
        ssl: useSsl ? { rejectUnauthorized: false } : false,
        max: 20,
        idleTimeoutMillis: 30000,
      } satisfies PoolConfig)
)

export async function query<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params)
  return res.rows as T[]
}

export async function queryOne<T extends QueryResultRow>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params)
  return rows[0] ?? null
}

export const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 45)
