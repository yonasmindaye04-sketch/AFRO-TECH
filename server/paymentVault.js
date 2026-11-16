import crypto from 'crypto';

const DEFAULT_FALLBACK_KEY = 'afrosuite-tenant-vault-dev-key-32b';

function deriveAesKey(rawSecret) {
  const source = rawSecret || process.env.PAYMENT_VAULT_KEY || process.env.BOT_TOKEN_ENCRYPTION_KEY || process.env.JWT_SECRET || DEFAULT_FALLBACK_KEY;
  return crypto.createHash('sha256').update(String(source)).digest();
}

export function maskSecret(value) {
  const str = String(value ?? '').trim();
  if (!str) return '';
  if (str.length <= 6) return '••••••••';
  const prefix = str.includes('_') ? `${str.split('_')[0]}_` : '';
  const tail = str.slice(-4);
  return `${prefix}••••••••${tail}`;
}

export function encryptSecret(plainText, keyMaterial) {
  const clean = String(plainText ?? '').trim();
  if (!clean) return '';
  const key = deriveAesKey(keyMaterial);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(clean, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(cipherText, keyMaterial) {
  const raw = String(cipherText ?? '').trim();
  if (!raw) return '';
  const parts = raw.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted secret format');
  }
  const [ivHex, tagHex, payloadHex] = parts;
  const key = deriveAesKey(keyMaterial);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(payloadHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function signWebhookPayload(payload, secret) {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  return crypto.createHmac('sha256', String(secret)).update(data).digest('hex');
}

export function verifyWebhookSignature(payload, secret, signature) {
  const sig = String(signature ?? '').trim().toLowerCase();
  if (!sig || !secret) return false;
  const expected = signWebhookPayload(payload, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(sig, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
