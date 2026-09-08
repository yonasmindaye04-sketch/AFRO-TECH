import { Queue, Worker, QueueEvents } from 'bullmq'
import IORedis from 'ioredis'

const redisUrl = process.env.UPSTASH_REDIS_URL || ''
const RedisConstructor: any = (IORedis as any).default || IORedis

export const redisConnection = redisUrl
  ? new RedisConstructor(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times: number) => Math.min(times * 100, 3000),
      enableReadyCheck: true,
      lazyConnect: false,
    })
  : null

if (redisConnection) {
  redisConnection.on('error', (err: any) => {
    console.error('[redis] connection error:', err?.message || err)
  })

  redisConnection.on('connect', () => {
    console.log('[redis] connected to Upstash')
  })
}

export const marketingQueues = redisConnection
  ? {
      sms: new Queue('marketing-sms', { connection: redisConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
      email: new Queue('marketing-email', { connection: redisConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
      whatsapp: new Queue('marketing-whatsapp', { connection: redisConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
      push: new Queue('marketing-push', { connection: redisConnection, defaultJobOptions: { removeOnComplete: 1000, removeOnFail: 5000 } }),
    }
  : ({} as Record<string, Queue>)

export const queueEvents = redisConnection
  ? {
      sms: new QueueEvents('marketing-sms', { connection: redisConnection }),
      email: new QueueEvents('marketing-email', { connection: redisConnection }),
      whatsapp: new QueueEvents('marketing-whatsapp', { connection: redisConnection }),
      push: new QueueEvents('marketing-push', { connection: redisConnection }),
    }
  : ({} as Record<string, QueueEvents>)

export async function closeQueues(): Promise<void> {
  if (marketingQueues) {
    await Promise.all(
      Object.values(marketingQueues).map((q) => q.close())
    )
  }
  if (queueEvents) {
    await Promise.all(
      Object.values(queueEvents).map((qe) => qe.close())
    )
  }
  if (redisConnection) {
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