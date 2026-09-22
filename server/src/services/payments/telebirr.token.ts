import { getRedisConnection } from '../../config/queue.js'

/**
 * Telebirr Fabric Token Manager.
 * Ported from the yekis project (telebirr.token.ts), adapted for AFRO Suite:
 * caches in Redis (UPSTASH_REDIS_URL) when configured, otherwise falls back
 * to a process-local in-memory cache with the same TTL.
 *
 * The fabric token is required for all authenticated Telebirr API calls.
 * It is obtained via POST /payment/v1/token and is valid for 1 hour; we
 * cache it for 50 minutes to keep a safety margin before expiry.
 */

const REDIS_KEY = 'telebirr:fabric_token'
const CACHE_TTL_MS = 50 * 60 * 1000 // 50 minutes
const CACHE_TTL_SECONDS = Math.floor(CACHE_TTL_MS / 1000)

// In-memory fallback (single-process dev / no Redis)
let memCache: { token: string; expiresAt: number } | null = null

function baseUrl(): string {
  return (
    process.env.TELEBIRR_BASE_URL ||
    'https://developerportal.ethiotelebirr.et:38443/apiaccess/payment/gateway'
  ).replace(/\/$/, '')
}

/** Returns a valid fabric token, fetching a new one when the cache is cold. */
export async function getFabricToken(): Promise<string> {
  const redis = getRedisConnection()

  // 1. Cache lookup
  if (redis) {
    try {
      const cached = await redis.get(REDIS_KEY)
      if (cached) return cached
    } catch (err) {
      console.warn('[telebirr] redis token cache read failed - fetching directly:', err instanceof Error ? err.message : err)
    }
  } else if (memCache && memCache.expiresAt > Date.now()) {
    return memCache.token
  }

  // 2. Request a new token from Telebirr
  const response = await fetch(baseUrl() + '/payment/v1/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-APP-Key': process.env.TELEBIRR_FABRIC_APP_ID || '',
    },
    body: JSON.stringify({ appSecret: process.env.TELEBIRR_APP_SECRET || '' }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error('Telebirr token request failed: HTTP ' + response.status + ' - ' + body)
  }

  const data = (await response.json()) as {
    code?: number
    msg?: string
    token?: string
    errorCode?: number
    errorMsg?: string
  }
  if (!data.token) {
    throw new Error('Telebirr token request returned error: code=' + (data.code || data.errorCode) + ', msg=' + (data.msg || data.errorMsg))
  }

  // The token may include the "Bearer " prefix - strip it so callers attach their own.
  const token = data.token.startsWith('Bearer ') ? data.token.slice(7) : data.token

  // 3. Cache
  if (redis) {
    try {
      await redis.set(REDIS_KEY, token, 'EX', CACHE_TTL_SECONDS)
    } catch (err) {
      console.warn('[telebirr] redis token cache write failed:', err instanceof Error ? err.message : err)
    }
  } else {
    memCache = { token, expiresAt: Date.now() + CACHE_TTL_MS }
  }
  return token
}

/** Invalidate the cached token (call on 401 / token-expired responses). */
export async function invalidateFabricToken(): Promise<void> {
  memCache = null
  const redis = getRedisConnection()
  if (redis) {
    try {
      await redis.del(REDIS_KEY)
    } catch (err) {
      console.warn('[telebirr] redis token invalidation failed:', err instanceof Error ? err.message : err)
    }
  }
}
