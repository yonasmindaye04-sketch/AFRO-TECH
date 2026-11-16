import crypto from 'crypto';

export const CHAPA_API_BASE = 'https://api.chapa.co/v1';

/**
 * Splits a customer's full name into Chapa's required first_name & last_name.
 * @param {string} fullName
 * @returns {{ firstName: string, lastName: string }}
 */
export function splitCustomerName(fullName) {
  const parts = String(fullName || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return { firstName: 'AFRO-TECH', lastName: 'Client' };
  if (parts.length === 1) return { firstName: parts[0], lastName: 'Client' };
  return {
    firstName: parts[0],
    lastName: parts.slice(1).join(' '),
  };
}

/**
 * Normalizes Chapa phone numbers when supplied.
 * @param {string | undefined | null} phone
 * @returns {string | undefined}
 */
export function normalizeChapaPhone(phone) {
  const raw = String(phone || '').replace(/[\s\-()]/g, '').trim();
  if (!raw) return undefined;
  return raw.slice(0, 20);
}

/**
 * Builds a validated payload for POST https://api.chapa.co/v1/transaction/initialize
 */
export function buildChapaInitPayload({
  amount,
  currency = 'ETB',
  email,
  fullName,
  phone,
  txRef,
  callbackUrl,
  returnUrl,
  serviceTitle,
  description,
}) {
  const numericAmount = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }
  const cleanEmail = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    throw new Error('A valid email address is required for Chapa receipts.');
  }
  if (!txRef || typeof txRef !== 'string') {
    throw new Error('A unique transaction reference (tx_ref) is required.');
  }

  const { firstName, lastName } = splitCustomerName(fullName);
  const cleanPhone = normalizeChapaPhone(phone);

  // Chapa customization title strictly allows max 16 chars in some regions/accounts; keep concise & safe
  const safeTitle = String(serviceTitle || 'AFRO-TECH Pay')
    .replace(/[^a-zA-Z0-9\s\-_]/g, '')
    .trim()
    .slice(0, 16) || 'AFRO-TECH';

  const safeDesc = String(description || 'Digital service payment')
    .replace(/[^a-zA-Z0-9\s\-_.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);

  return {
    amount: String(numericAmount),
    currency: String(currency || 'ETB').toUpperCase(),
    email: cleanEmail,
    first_name: firstName,
    last_name: lastName,
    ...(cleanPhone ? { phone_number: cleanPhone } : {}),
    tx_ref: txRef,
    callback_url: callbackUrl,
    return_url: returnUrl,
    customization: {
      title: safeTitle,
      description: safeDesc,
    },
  };
}

/**
 * Strips any accidental bearer/secret strings before returning upstream errors to callers.
 */
export function sanitizeChapaError(message, secretKey = '') {
  let msg = String(message || 'Chapa gateway request failed.');
  if (secretKey && secretKey.length >= 6) {
    msg = msg.split(secretKey).join('[REDACTED]');
  }
  return msg.replace(/CHASECK_[A-Za-z0-9_-]+/g, '[REDACTED]');
}

/**
 * Calls Chapa Transaction Initialize API using CHAPA_SECRET_KEY.
 */
export async function initializeChapaPayment({ secretKey, payload, fetchFn = fetch }) {
  const key = String(secretKey || '').trim();
  if (!key) {
    return {
      ok: false,
      configured: false,
      error: 'CHAPA_SECRET_KEY is not configured on the server.',
    };
  }

  try {
    const res = await fetchFn(`${CHAPA_API_BASE}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || data?.status !== 'success' || !data?.data?.checkout_url) {
      const upstreamMsg =
        (typeof data?.message === 'string' && data.message) ||
        (data?.message && typeof data.message === 'object' ? JSON.stringify(data.message) : null) ||
        `Chapa API returned HTTP ${res.status}`;
      return {
        ok: false,
        configured: true,
        statusCode: res.status,
        error: sanitizeChapaError(upstreamMsg, key),
      };
    }

    return {
      ok: true,
      configured: true,
      checkoutUrl: String(data.data.checkout_url),
      raw: data,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: sanitizeChapaError(err instanceof Error ? err.message : 'Network error reaching Chapa API', key),
    };
  }
}

/**
 * Calls Chapa Transaction Verify API using CHAPA_SECRET_KEY.
 */
export async function verifyChapaPayment({ secretKey, txRef, fetchFn = fetch }) {
  const key = String(secretKey || '').trim();
  if (!key) {
    return { ok: false, configured: false, verified: false, error: 'CHAPA_SECRET_KEY is not configured.' };
  }
  const cleanRef = encodeURIComponent(String(txRef || '').trim());
  try {
    const res = await fetchFn(`${CHAPA_API_BASE}/transaction/verify/${cleanRef}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
      },
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    const verified = res.ok && data?.status === 'success' && String(data?.data?.status || '').toLowerCase() === 'success';
    return {
      ok: res.ok,
      configured: true,
      verified,
      amount: Number(data?.data?.amount || 0),
      currency: String(data?.data?.currency || 'ETB'),
      reference: data?.data?.reference || null,
      status: data?.data?.status || (res.ok ? 'pending' : 'failed'),
      error: res.ok ? null : sanitizeChapaError(data?.message || `Verify failed (${res.status})`, key),
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      verified: false,
      error: sanitizeChapaError(err instanceof Error ? err.message : 'Failed to verify transaction', key),
    };
  }
}

/**
 * Generates an unguessable checkout reference for public service payments.
 */
export function generateServiceTxRef(prefix = 'CHAPA-SVC') {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
