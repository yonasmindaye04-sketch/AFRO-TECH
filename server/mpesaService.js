import crypto from 'crypto';

export const MPESA_DEFAULT_BASE_URL = 'https://apisandbox.safaricom.et';

/**
 * Normalizes an Ethiopian mobile number into canonical Safaricom M-Pesa MSISDN format (251XXXXXXXXX).
 * Accepts +2517..., 2517..., 07..., +2519..., 2519..., 09...
 */
export function normalizeMpesaPhone(phone) {
  const digits = String(phone || '').replace(/[^\d]/g, '');
  if (!digits) return null;

  if (digits.startsWith('251') && digits.length === 12 && (digits[3] === '7' || digits[3] === '9')) {
    return digits;
  }
  if (digits.startsWith('0') && digits.length === 10 && (digits[1] === '7' || digits[1] === '9')) {
    return `251${digits.slice(1)}`;
  }
  if (digits.length === 9 && (digits[0] === '7' || digits[0] === '9')) {
    return `251${digits}`;
  }
  return null;
}

/**
 * Generates an M-Pesa timestamp in YYYYMMDDHHmmss UTC+3 / UTC format.
 */
export function generateMpesaTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join('');
}

/**
 * Builds Base64(BusinessShortCode + Passkey + Timestamp) required by Safaricom STK Push.
 */
export function buildMpesaPassword(shortCode, passkey, timestamp) {
  const raw = `${String(shortCode || '').trim()}${String(passkey || '').trim()}${String(timestamp || '').trim()}`;
  return Buffer.from(raw, 'utf8').toString('base64');
}

export function generateMpesaTxRef(prefix = 'MPESA-SVC') {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

export function sanitizeMpesaError(message, secrets = []) {
  let msg = String(message || 'M-Pesa gateway request failed.');
  for (const s of secrets) {
    const clean = String(s || '').trim();
    if (clean.length >= 6) {
      msg = msg.split(clean).join('[REDACTED]');
    }
  }
  return msg;
}

/**
 * Acquires a Bearer OAuth2 token from Safaricom Ethiopia M-Pesa API.
 */
export async function getMpesaAccessToken({
  baseUrl = MPESA_DEFAULT_BASE_URL,
  consumerKey,
  consumerSecret,
  fetchFn = fetch,
}) {
  const key = String(consumerKey || '').trim();
  const secret = String(consumerSecret || '').trim();
  if (!key || !secret) {
    return { ok: false, configured: false, error: 'M-Pesa Consumer Key and Consumer Secret are required.' };
  }

  const credentials = Buffer.from(`${key}:${secret}`, 'utf8').toString('base64');
  const endpoint = `${String(baseUrl || MPESA_DEFAULT_BASE_URL).replace(/\/+$/, '')}/v1/token/generate?grant_type=client_credentials`;
  try {
    const res = await fetchFn(endpoint, {
      method: 'GET',
      headers: {
        Authorization: `Basic ${credentials}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.access_token) {
      return {
        ok: false,
        configured: true,
        statusCode: res.status,
        error: sanitizeMpesaError(data?.errorMessage || data?.message || `M-Pesa OAuth HTTP ${res.status}`, [key, secret]),
      };
    }

    return {
      ok: true,
      configured: true,
      accessToken: String(data.access_token),
      expiresIn: Number(data.expires_in || 3599),
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: sanitizeMpesaError(err instanceof Error ? err.message : 'Failed to reach M-Pesa OAuth API', [key, secret]),
    };
  }
}

/**
 * Builds canonical Safaricom M-Pesa STK / USSD Push JSON payload.
 */
export function buildMpesaStkPayload({
  shortCode,
  passkey,
  amount,
  phoneNumber,
  callbackUrl,
  accountReference,
  transactionDesc,
  timestamp = generateMpesaTimestamp(),
}) {
  const msisdn = normalizeMpesaPhone(phoneNumber);
  if (!msisdn) {
    throw new Error('Enter a valid Ethiopian mobile number (e.g. +251 711 223344 or 0711223344).');
  }
  const numericAmount = Math.round(Number(amount));
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('M-Pesa amount must be a positive whole ETB value.');
  }
  const cleanCode = String(shortCode || '').trim();
  const cleanPasskey = String(passkey || '').trim();
  if (!cleanCode || !cleanPasskey) {
    throw new Error('M-Pesa Business ShortCode and Passkey are required.');
  }

  return {
    BusinessShortCode: cleanCode,
    Password: buildMpesaPassword(cleanCode, cleanPasskey, timestamp),
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: String(numericAmount),
    PartyA: msisdn,
    PartyB: cleanCode,
    PhoneNumber: msisdn,
    CallBackURL: callbackUrl,
    AccountReference: String(accountReference || 'AFROTECH').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 12) || 'AFROTECH',
    TransactionDesc: String(transactionDesc || 'Service Payment').slice(0, 40),
  };
}

/**
 * Initiates an M-Pesa STK / USSD push request on Safaricom Ethiopia Open API.
 */
export async function initiateMpesaStkPush({ config, orderParams, fetchFn = fetch }) {
  const {
    baseUrl = MPESA_DEFAULT_BASE_URL,
    consumerKey,
    consumerSecret,
    shortCode,
    passkey,
  } = config || {};

  if (!consumerKey || !consumerSecret || !shortCode || !passkey) {
    return { ok: false, configured: false, error: 'M-Pesa live credentials are incomplete.' };
  }

  const tokenRes = await getMpesaAccessToken({ baseUrl, consumerKey, consumerSecret, fetchFn });
  if (!tokenRes.ok) {
    return tokenRes;
  }

  let payload;
  try {
    payload = buildMpesaStkPayload({
      shortCode,
      passkey,
      amount: orderParams.amount,
      phoneNumber: orderParams.phoneNumber,
      callbackUrl: orderParams.callbackUrl,
      accountReference: orderParams.accountReference,
      transactionDesc: orderParams.transactionDesc,
    });
  } catch (err) {
    return { ok: false, configured: true, error: sanitizeMpesaError(err instanceof Error ? err.message : 'Invalid M-Pesa payload', [consumerSecret, passkey]) };
  }

  const endpoint = `${String(baseUrl || MPESA_DEFAULT_BASE_URL).replace(/\/+$/, '')}/mpesa/stkpush/v3/processrequest`;
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenRes.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    const accepted = res.ok && String(data?.ResponseCode ?? '') === '0' && Boolean(data?.CheckoutRequestID);
    if (!accepted) {
      return {
        ok: false,
        configured: true,
        statusCode: res.status,
        error: sanitizeMpesaError(
          data?.errorMessage || data?.ResponseDescription || data?.message || `M-Pesa STK Push HTTP ${res.status}`,
          [consumerSecret, passkey],
        ),
      };
    }

    return {
      ok: true,
      configured: true,
      checkoutRequestId: String(data.CheckoutRequestID),
      merchantRequestId: String(data.MerchantRequestID || ''),
      customerMessage: String(data.CustomerMessage || 'Check your phone and enter your M-Pesa PIN to complete payment.'),
      raw: data,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: sanitizeMpesaError(err instanceof Error ? err.message : 'Network error initiating M-Pesa STK push', [consumerSecret, passkey]),
    };
  }
}

/**
 * Queries real-time M-Pesa STK Push status via POST /mpesa/stkpushquery/v3/query.
 */
export async function queryMpesaStkStatus({ config, checkoutRequestId, fetchFn = fetch }) {
  const {
    baseUrl = MPESA_DEFAULT_BASE_URL,
    consumerKey,
    consumerSecret,
    shortCode,
    passkey,
  } = config || {};

  if (!consumerKey || !consumerSecret || !shortCode || !passkey) {
    return { ok: false, configured: false, verified: false, error: 'M-Pesa credentials not configured.' };
  }

  const tokenRes = await getMpesaAccessToken({ baseUrl, consumerKey, consumerSecret, fetchFn });
  if (!tokenRes.ok) {
    return { ...tokenRes, verified: false };
  }

  const timestamp = generateMpesaTimestamp();
  const payload = {
    BusinessShortCode: String(shortCode).trim(),
    Password: buildMpesaPassword(shortCode, passkey, timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: String(checkoutRequestId).trim(),
  };

  const endpoint = `${String(baseUrl || MPESA_DEFAULT_BASE_URL).replace(/\/+$/, '')}/mpesa/stkpushquery/v3/query`;
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenRes.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    const resultCode = String(data?.ResultCode ?? '');
    const verified = res.ok && resultCode === '0';
    return {
      ok: res.ok,
      configured: true,
      verified,
      resultCode: resultCode || null,
      resultDesc: String(data?.ResultDesc || ''),
      status: verified ? 'settled' : res.ok ? 'pending' : 'failed',
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      verified: false,
      error: sanitizeMpesaError(err instanceof Error ? err.message : 'Failed to query M-Pesa STK status', [consumerSecret, passkey]),
    };
  }
}

/**
 * Extracts normalized settlement metadata from a Safaricom M-Pesa async callback body.
 */
export function parseMpesaCallback(body) {
  const cb = body?.Body?.stkCallback || body?.stkCallback || null;
  if (!cb || typeof cb !== 'object') {
    return { valid: false, success: false };
  }
  const resultCode = Number(cb.ResultCode);
  const items = Array.isArray(cb.CallbackMetadata?.Item) ? cb.CallbackMetadata.Item : [];
  const lookup = (name) => items.find((i) => i?.Name === name)?.Value ?? null;

  return {
    valid: true,
    success: resultCode === 0,
    resultCode,
    resultDesc: String(cb.ResultDesc || ''),
    merchantRequestId: String(cb.MerchantRequestID || ''),
    checkoutRequestId: String(cb.CheckoutRequestID || ''),
    amount: Number(lookup('Amount') || 0),
    mpesaReceiptNumber: lookup('MpesaReceiptNumber') ? String(lookup('MpesaReceiptNumber')) : null,
    phoneNumber: lookup('PhoneNumber') ? String(lookup('PhoneNumber')) : null,
  };
}
