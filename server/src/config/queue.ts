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

if (redisConnection) {
  redisConnection.on('error', (err: Error) => {
    console.error('[redis] connection error:', err.message)
  })
  redisConnection.on('connect', () => {
    console.log('[redis] connected to Upstash')
  })
}

export const marketingQueues: Record<'sms' | 'email' | 'whatsapp' | 'push', Queue> = redisConnection
  ? {
      sms: new Queue('marketing-sms', { connection: redisConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
      email: new Queue('marketing-email', { connection: redisConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
      whatsapp: new Queue('marketing-whatsapp', { connection: redisConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
      push: new Queue('marketing-push', { connection: redisConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
    }
  : ({} as Record<'sms' | 'email' | 'whatsapp' | 'push', Queue>)

export function getMarketingQueues(): Record<'sms' | 'email' | 'whatsapp' | 'push', Queue> {
  if (!redisEnabled) throw new Error('UPSTASH_REDIS_URL is not configured')
  return marketingQueues
}

export function getQueueEvents(): Record<'sms' | 'email' | 'whatsapp' | 'push', QueueEvents> {
  if (!redisConnection) throw new Error('UPSTASH_REDIS_URL is not configured')
  return {
    sms: new QueueEvents('marketing-sms', { connection: redisConnection }),
    email: new QueueEvents('marketing-email', { connection: redisConnection }),
    whatsapp: new QueueEvents('marketing-whatsapp', { connection: redisConnection }),
    push: new QueueEvents('marketing-push', { connection: redisConnection }),
  }
}

export function getRedisConnection(): Redis | null {
  return redisConnection
}

export async function closeQueues(): Promise<void> {
  if (redisConnection) {
    await Promise.all(Object.values(marketingQueues).map((q) => q.close()))
    await redisConnection.quit()
  }
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