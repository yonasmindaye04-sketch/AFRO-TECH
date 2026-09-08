import { Worker } from 'bullmq'
import { pool } from '../config/db.js'
import { marketingQueues, redisConnection } from '../config/queue.js'
import { ResendEmailChannel } from '../channels/email/ResendEmailChannel.js'
import { EthioTelecomSmppChannel } from '../channels/sms/EthioTelecomSmppChannel.js'
import type { MarketingJobData } from '../config/queue.js'

const emailChannel = new ResendEmailChannel({
  apiKey: process.env.RESEND_API_KEY || '',
  fromEmail: process.env.RESEND_FROM_EMAIL || 'noreply@afrotech.et',
  fromName: 'AFRO-TECH',
})

const smsChannel = new EthioTelecomSmppChannel({
  host: process.env.ETHIOTELECOM_SMPP_HOST || 'localhost',
  port: parseInt(process.env.ETHIOTELECOM_SMPP_PORT || '2775', 10),
  systemId: process.env.ETHIOTELECOM_SMPP_USERNAME || '',
  password: process.env.ETHIOTELECOM_SMPP_PASSWORD || '',
  senderId: process.env.ETHIOTELECOM_SENDER_ID || 'AFROTECH',
  mock: process.env.ETHIOTELECOM_MOCK === 'true',
})

async function processJob(job: { data: MarketingJobData; attemptsMade: number }): Promise<void> {
  const { messageId, tenantId, campaignId, contactId, channel, provider, to, subject, content, templateId } = job.data

  await pool.query(
    `UPDATE marketing_messages SET status = 'sending', sent_at = now() WHERE id = $1`,
    [messageId]
  )

  let result: { success: boolean; providerMessageId?: string; error?: string }

  try {
    if (channel === 'email') {
      result = await emailChannel.send(to, subject, content)
    } else if (channel === 'sms') {
      result = await smsChannel.send(to, subject, content)
    } else {
      result = { success: false, error: `Channel ${channel} not implemented` }
    }
  } catch (err) {
    result = { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }

  if (result.success) {
    await pool.query(
      `UPDATE marketing_messages SET status = 'sent', provider_msg_id = $1, sent_at = now() WHERE id = $2`,
      [result.providerMessageId, messageId]
    )
    await pool.query(
      `UPDATE marketing_campaign_recipients SET status = 'sent', sent_at = now() WHERE message_id = $1`,
      [messageId]
    )
  } else {
    const attempts = job.attemptsMade + 1
    if (attempts >= 3) {
      await pool.query(
        `UPDATE marketing_messages SET status = 'failed', error = $1 WHERE id = $2`,
        [result.error, messageId]
      )
      await pool.query(
        `UPDATE marketing_campaign_recipients SET status = 'failed', error = $1 WHERE message_id = $2`,
        [result.error, messageId]
      )
    } else {
      await pool.query(
        `UPDATE marketing_messages SET status = 'queued', error = $1 WHERE id = $2`,
        [result.error, messageId]
      )
      throw new Error(result.error) // triggers retry
    }
  }
}

const emailWorker = redisConnection
  ? new Worker('marketing-email', processJob, {
      connection: redisConnection,
      concurrency: 5,
    })
  : null

const smsWorker = redisConnection
  ? new Worker('marketing-sms', processJob, {
      connection: redisConnection,
      concurrency: 3,
    })
  : null

if (emailWorker) {
  emailWorker.on('completed', (job) => console.log(`[email-worker] Job ${job.id} completed`))
  emailWorker.on('failed', (job, err) => console.error(`[email-worker] Job ${job?.id} failed:`, err.message))
}

if (smsWorker) {
  smsWorker.on('completed', (job) => console.log(`[sms-worker] Job ${job.id} completed`))
  smsWorker.on('failed', (job, err) => console.error(`[sms-worker] Job ${job?.id} failed:`, err.message))
}

export async function startWorkers(): Promise<void> {
  if (emailWorker && smsWorker) {
    console.log('[workers] Email & SMS workers started')
  }
}

export async function stopWorkers(): Promise<void> {
  const closers: Promise<void>[] = []
  if (emailWorker) closers.push(emailWorker.close())
  if (smsWorker) closers.push(smsWorker.close())
  await Promise.all(closers)
  console.log('[workers] Workers stopped')
}