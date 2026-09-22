import { createSign, createVerify, randomBytes, constants } from 'node:crypto'

/**
 * Telebirr RSA-PSS signing and verification utilities.
 * Ported from the yekis project (apps/backend/src/modules/escrow/providers/telebirr.signing.ts).
 *
 * Implements the SHA256withRSAandMGF1 signing algorithm required by
 * Telebirr's payment gateway. Uses Node.js native crypto — zero external
 * dependencies (replaces the jsrsasign library used in the official demo).
 */

// Fields excluded from the signing string per Telebirr's specification.
const EXCLUDED_FIELDS = new Set([
  'sign',
  'sign_type',
  'header',
  'refund_info',
  'openType',
  'raw_request',
  'biz_content',
])

/** Current Unix epoch time as a string (seconds, not ms). */
export function createTimestamp(): string {
  return String(Math.floor(Date.now() / 1000))
}

/** Random alphanumeric nonce string (0-9, A-Z), 32 chars like the Telebirr demo. */
export function createNonceStr(len = 32): string {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'
  const bytes = randomBytes(len)
  let result = ''
  for (let i = 0; i < len; i++) result += chars[bytes[i]! % chars.length]
  return result
}

/**
 * Builds the canonical signing string from a Telebirr request object.
 * 1. Collect all root-level fields except EXCLUDED_FIELDS
 * 2. Flatten all fields from biz_content into the same map
 * 3. Sort keys in ASCII alphabetical order
 * 4. Join as key=value&key=value
 */
export function buildSigningString(requestObject: Record<string, unknown>): string {
  const fieldMap: Record<string, string> = {}

  for (const key of Object.keys(requestObject)) {
    if (EXCLUDED_FIELDS.has(key)) continue
    const val = requestObject[key]
    if (val !== undefined && val !== null) {
      fieldMap[key] = typeof val === 'object' ? JSON.stringify(val) : String(val)
    }
  }

  const bizContent = requestObject.biz_content
  if (bizContent && typeof bizContent === 'object') {
    for (const key of Object.keys(bizContent as Record<string, unknown>)) {
      if (EXCLUDED_FIELDS.has(key)) continue
      const val = (bizContent as Record<string, unknown>)[key]
      if (val !== undefined && val !== null) {
        fieldMap[key] = typeof val === 'object' ? JSON.stringify(val) : String(val)
      }
    }
  }

  return Object.keys(fieldMap)
    .sort()
    .map((key) => `${key}=${fieldMap[key]}`)
    .join('&')
}

/** Sign a data string using RSA-PSS with SHA-256 (SHA256withRSAandMGF1). */
export function signWithRsaPss(dataString: string, privateKeyPem: string): string {
  const signer = createSign('RSA-SHA256')
  signer.update(dataString, 'utf8')
  signer.end()
  return signer.sign(
    {
      key: privateKeyPem,
      padding: constants.RSA_PKCS1_PSS_PADDING,
      saltLength: constants.RSA_PSS_SALTLEN_DIGEST, // 32 bytes for SHA-256
    },
    'base64'
  )
}

/** Verify an RSA-PSS signature against Telebirr's public key. */
export function verifyWithRsaPss(dataString: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const verifier = createVerify('RSA-SHA256')
    verifier.update(dataString, 'utf8')
    verifier.end()
    return verifier.verify(
      {
        key: publicKeyPem,
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: constants.RSA_PSS_SALTLEN_DIGEST,
      },
      signatureBase64,
      'base64'
    )
  } catch {
    return false
  }
}

/** Convenience: build the signing string from a request object and sign it. */
export function signRequestObject(requestObject: Record<string, unknown>, privateKeyPem: string): string {
  return signWithRsaPss(buildSigningString(requestObject), privateKeyPem)
}
