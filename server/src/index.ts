import 'dotenv/config'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'
import nodemailer from 'nodemailer'
import { pool } from './config/db.js'
import { errorHandler, notFound } from './middleware/validate.js'

import authRoutes from './routes/auth.js'
import tenantRoutes from './routes/tenant.js'
import usersRoutes from './routes/users.js'
import adminRoutes from './routes/admin.js'
import retailRoutes from './routes/retail.js'
import hospitalRoutes from './routes/hospital.js'
import schoolRoutes from './routes/school.js'
import telegramRoutes from './routes/telegram.js'
import billingRoutes from './routes/billing.js'
import tenantBotRoutes from './routes/tenant-bots.js'
import marketingRoutes from './routes/marketing/index.js'
import { startPolling, telegramEnabled, setWebhook } from './services/telegram.js'
import { startAlertScheduler } from './services/alerts.js'
import { startAllTenantBots } from './services/tenantBot.js'
import { startWorkers, stopWorkers } from './workers/index.js'
import { closeQueues } from './config/queue.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.set('trust proxy', 1)

/* ── Middleware ─────────────────────────────────────────── */
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }))
// Capture raw body for payment webhooks (HMAC signature verification)
app.use(express.json({ limit: '1mb', verify: (req, _res, buf) => { (req as unknown as { rawBody?: Buffer }).rawBody = Buffer.from(buf) } }))
app.use(express.urlencoded({ extended: false }))

// Brute-force protection on credential endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts — try again in 15 minutes.', code: 'RATE_LIMITED' },
})
app.use('/api/v1/auth/login', authLimiter)
app.use('/api/v1/auth/register', authLimiter)

const allowedOrigins = String(process.env.PUBLIC_URL || 'http://localhost:5173')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) return cb(null, true)
      cb(null, true) // same-origin in production anyway; keep permissive for API clients
    },
  })
)

/* ── API ────────────────────────────────────────────────── */
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'afro-suite', time: new Date().toISOString() }))

app.use('/api/v1/auth', authRoutes)
app.use('/api/v1/tenant', tenantRoutes)
app.use('/api/v1/users', usersRoutes)
app.use('/api/v1/admin', adminRoutes)
app.use('/api/v1/retail', retailRoutes)
app.use('/api/v1/hospital', hospitalRoutes)
app.use('/api/v1/school', schoolRoutes)
app.use('/api/v1/telegram', telegramRoutes)
app.use('/api/v1/billing', billingRoutes)
app.use('/api/v1/tenant-bot', tenantBotRoutes)
app.use('/api/v1/marketing', marketingRoutes)

/* ── Contact form (works on VPS — no Vercel functions needed) */
app.post('/api/contact', async (req, res) => {
  try {
    const { name = '', email = '', message = '' } = req.body ?? {}
    if (!name.trim() || !/.+@.+\..+/.test(email) || !message.trim()) {
      return res.status(400).json({ ok: false, error: 'Name, a valid email and a message are required.' })
    }
    const user = process.env.CONTACT_USER
    const pass = process.env.CONTACT_PASS
    const to = process.env.CONTACT_EMAIL
    if (user && pass && to) {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user, pass },
      })
      await transporter.sendMail({
        from: `"AFRO-TECH Website" <${user}>`,
        to,
        replyTo: email,
        subject: `New portfolio inquiry from ${name}`,
        text: message,
        html: `<p><b>Name:</b> ${name}</p><p><b>Email:</b> ${email}</p><p>${message.replace(/\n/g, '<br>')}</p>`,
      })
    }
    return res.json({ ok: true })
  } catch (err) {
    console.error('[contact]', err)
    return res.status(500).json({ ok: false, error: 'Could not send your message right now.' })
  }
})



app.use(notFound)
app.use(errorHandler)

const port = Number(process.env.PORT || 4000)
app.listen(port, async () => {
  console.log(`AFRO Suite API listening on :${port} (${process.env.NODE_ENV || 'development'})`)
  // Platform bot: webhook in production, long-polling in development.
  if (telegramEnabled()) {
    const isProduction = process.env.NODE_ENV === 'production'
    const publicUrl = (process.env.RENDER_EXTERNAL_URL || process.env.PUBLIC_URL || '').replace(/\/$/, '')
    const webhookUrl = process.env.TELEGRAM_WEBHOOK_URL || (publicUrl.startsWith('https://') ? `${publicUrl}/api/v1/telegram/webhook` : '')

    if (isProduction && webhookUrl) {
      console.log(`[telegram] registering webhook: ${webhookUrl}`)
      void setWebhook(webhookUrl).catch((err) =>
        console.warn('[telegram] auto setWebhook failed:', err instanceof Error ? err.message : err)
      )
    } else {
      console.log('[telegram] starting long-polling')
      startPolling()
    }
  }
  startAlertScheduler()
  void startAllTenantBots().catch((err) => console.warn('[tenant-bots] startup failed:', err instanceof Error ? err.message : err))
  await startWorkers()
})

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await stopWorkers()
    await closeQueues()
    await pool.end().catch(() => undefined)
    process.exit(0)
  })
}
