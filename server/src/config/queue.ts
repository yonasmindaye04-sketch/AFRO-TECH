import { Queue, QueueEvents } from 'bullmq'
import { Redis } from 'ioredis'

const redisUrl = process.env.UPSTASH_REDIS_URL

export const redisEnabled = Boolean(redisUrl)

export const redisConnection: Redis | null = redisUrl
  ? new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      enableReadyCheck: true,
    })
  : null

/**
 * BullMQ requires maxRetriesPerRequest=null on any connection it uses for
 * blocking commands (BRPOPLPUSH etc.) — it throws ERR_ERL at construction
 * otherwise. The shared connection above keeps retries bounded for ordinary
 * commands, so BullMQ gets its own connection instance.
 */
export const bullConnection: Redis | null = redisUrl
  ? new Redis(redisUrl, {
      maxRetriesPerRequest: null,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      enableReadyCheck: true,
    })
  : null

if (bullConnection) {
  bullConnection.on('error', (err: Error) => console.error('[redis:bull] connection error:', err.message))
}

if (redisConnection) {
  redisConnection.on('error', (err: Error) => {
    console.error('[redis] connection error:', err.message)
  })
  redisConnection.on('connect', () => {
    console.log('[redis] connected to Upstash')
  })
}

export const marketingQueues: Record<'sms' | 'email' | 'whatsapp' | 'push', Queue> = bullConnection
  ? {
      sms: new Queue('marketing-sms', { connection: bullConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
      email: new Queue('marketing-email', { connection: bullConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
      whatsapp: new Queue('marketing-whatsapp', { connection: bullConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
      push: new Queue('marketing-push', { connection: bullConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
    }
  : ({} as Record<'sms' | 'email' | 'whatsapp' | 'push', Queue>)

export function getMarketingQueues(): Record<'sms' | 'email' | 'whatsapp' | 'push', Queue> {
  if (!redisEnabled) throw new Error('UPSTASH_REDIS_URL is not configured')
  return marketingQueues
}

export function getQueueEvents(): Record<'sms' | 'email' | 'whatsapp' | 'push', QueueEvents> {
  if (!bullConnection) throw new Error('UPSTASH_REDIS_URL is not configured')
  return {
    sms: new QueueEvents('marketing-sms', { connection: bullConnection }),
    email: new QueueEvents('marketing-email', { connection: bullConnection }),
    whatsapp: new QueueEvents('marketing-whatsapp', { connection: bullConnection }),
    push: new QueueEvents('marketing-push', { connection: bullConnection }),
  }
}

export function getRedisConnection(): Redis | null {
  return redisConnection
}

export async function closeQueues(): Promise<void> {
  if (bullConnection) {
    await Promise.all(Object.values(marketingQueues).map((q) => q.close()))
    await bullConnection.quit()
  }
  if (redisConnection) await redisConnection.quit()
}

export type MarketingJobData = {
  messageId: string
  tenantId: string
  campaignId?: string
  automationId?: string
  contactId: string
  channel: 'sms' | 'email' | 'whatsapp' | 'push'
  provider: string
  to: string
  subject?: string
  content: string
  templateId?: string
  metadata?: Record<string, unknown>
}