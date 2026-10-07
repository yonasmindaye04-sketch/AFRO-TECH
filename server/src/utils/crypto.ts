import crypto from 'crypto'

/**
 * Envelope encryption for tenant bot tokens.
 *
 * Format: `v1.<iv_b64>.<tag_b64>.<ciphertext_b64>` (all base64url).
 * The key comes from BOT_TOKEN_ENCRYPTION_KEY — a 32-byte value, either
 * base64/hex encoded or a passphrase (hashed with scrypt to 32 bytes).
 *
 * When no key is configured we fail closed for writes and pass plaintext
 * through for reads, so an unconfigured dev environment keeps working while
 * production never silently stores tokens in the clear.
 */
const PREFIX = 'v1'

function loadKey(): Buffer | null {
  const raw = process.env.BOT_TOKEN_ENCRYPTION_KEY
  if (!raw) return null
  const trimmed = raw.trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return Buffer.from(trimmed, 'hex')
  if (trimmed.length >= 40) return Buffer.from(trimmed, 'base64')
  return crypto.scryptSync(trimmed, 'afro-suite-bot-tokens', 32)
}

export function encryptionConfigured(): boolean {
  return loadKey() !== null
}

/** Startup check so a missing key is loud in production, quiet in dev. */
export function assertEncryptionConfigured(): void {
  if (!encryptionConfigured() && process.env.NODE_ENV === 'production') {
    throw new Error('BOT_TOKEN_ENCRYPTION_KEY is required in production')
  }
}

export function encryptSecret(plaintext: string): string {
  if (!plaintext) return plaintext
  const key = loadKey()
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('BOT_TOKEN_ENCRYPTION_KEY must be set before storing bot tokens in production')
    }
    return plaintext
  }
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [PREFIX, b64(iv), b64(tag), b64(ciphertext)].join('.')
}

/** Decrypts a sealed value. Plaintext input (legacy rows) passes through unchanged. */
export function decryptSecret(value: string | null | undefined): string {
  if (!value) return ''
  if (!value.startsWith(`${PREFIX}.`)) return value
  const key = loadKey()
  if (!key) {
    // Encrypted value but no key — refusing beats returning ciphertext that
    // would be sent to Telegram as a token.
    throw new Error('BOT_TOKEN_ENCRYPTION_KEY is required to read encrypted bot tokens')
  }
  const [, ivB64, tagB64, dataB64] = value.split('.')
  if (!ivB64 || !tagB64 || !dataB64) throw new Error('Malformed encrypted secret')
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, unb64(ivB64))
  decipher.setAuthTag(unb64(tagB64))
  return Buffer.concat([decipher.update(unb64(dataB64)), decipher.final()]).toString('utf8')
}

const b64 = (buf: Buffer): string => buf.toString('base64url')
const unb64 = (str: string): Buffer => Buffer.from(str, 'base64url')

/** Constant-time string compare for opaque secrets (webhook paths, share codes). */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a)
  const bufB = Buffer.from(b)
  if (bufA.length !== bufB.length) return false
  return crypto.timingSafeEqual(bufA, bufB)
}