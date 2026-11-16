import crypto from 'crypto';

export const TELEBIRR_DEFAULT_BASE_URL = 'https://196.188.120.3:38443/apiaccess/payment/gateway';
export const TELEBIRR_DEFAULT_WEB_BASE_URL = 'https://196.188.120.3:38443/payment/web/paygate';

const TELEBIRR_EXCLUDE_FIELDS = new Set([
  'sign',
  'sign_type',
  'header',
  'refund_info',
  'openType',
  'raw_request',
]);

export function createTelebirrTimestamp(date = new Date()) {
  return String(Math.floor(date.getTime() / 1000));
}

export function createTelebirrNonceStr() {
  return crypto.randomBytes(16).toString('hex');
}

export function generateTelebirrOrderId(prefix = 'TB-SVC') {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

/**
 * Normalizes a PEM private key (supports \n-escaped env vars or raw base64 PKCS8 content).
 */
export function normalizeTelebirrPemKey(rawKey, type = 'PRIVATE KEY') {
  const clean = String(rawKey || '').replace(/\\n/g, '\n').trim();
  if (!clean) return '';
  if (clean.includes('-----BEGIN')) return clean;
  const lines = clean.match(/.{1,64}/g)?.join('\n') || clean;
  return `-----BEGIN ${type}-----\n${lines}\n-----END ${type}-----`;
}

/**
 * Builds the canonical sorted query string (excluding sign/sign_type and flattening biz_content).
 */
export function buildTelebirrSignString(requestObject) {
  const map = new Map();

  for (const [key, val] of Object.entries(requestObject || {})) {
    if (TELEBIRR_EXCLUDE_FIELDS.has(key)) continue;
    if (key === 'biz_content' && val && typeof val === 'object') {
      for (const [bizKey, bizVal] of Object.entries(val)) {
        if (TELEBIRR_EXCLUDE_FIELDS.has(bizKey)) continue;
        if (bizVal !== undefined && bizVal !== null && String(bizVal) !== '') {
          map.set(bizKey, String(bizVal));
        }
      }
      continue;
    }
    if (val !== undefined && val !== null && String(val) !== '') {
      map.set(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
    }
  }

  return Array.from(map.keys())
    .sort()
    .map((key) => `${key}=${map.get(key)}`)
    .join('&');
}

/**
 * Signs a Telebirr request payload using SHA256WithRSA (RSA-SHA256).
 */
export function signTelebirrRequest(requestObject, privateKeyInput) {
  const pem = normalizeTelebirrPemKey(privateKeyInput, 'PRIVATE KEY');
  if (!pem) {
    throw new Error('Telebirr RSA private key is required to sign requests.');
  }
  const signString = buildTelebirrSignString(requestObject);
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(signString, 'utf8');
  signer.end();
  return signer.sign(pem, 'base64');
}

/**
 * Verifies a Telebirr async webhook notification signature with Ethio Telecom's public key.
 */
export function verifyTelebirrSignature(payload, signature, publicKeyInput) {
  const pem = normalizeTelebirrPemKey(publicKeyInput, 'PUBLIC KEY');
  if (!pem || !signature) return false;
  try {
    const signString = buildTelebirrSignString(payload);
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signString, 'utf8');
    verifier.end();
    return verifier.verify(pem, String(signature).trim(), 'base64');
  } catch {
    return false;
  }
}

/**
 * Strips any secret keys or raw credentials from error messages.
 */
export function sanitizeTelebirrError(message, secrets = []) {
  let msg = String(message || 'Telebirr gateway request failed.');
  for (const s of secrets) {
    const clean = String(s || '').trim();
    if (clean.length >= 6) {
      msg = msg.split(clean).join('[REDACTED]');
    }
  }
  return msg.replace(/-----BEGIN[^-]+-----[\s\S]*?-----END[^-]+-----/g, '[REDACTED_KEY]');
}

/**
 * Builds the canonical Telebirr payment.preorder payload.
 */
export function buildTelebirrPreOrderPayload({
  merchantAppId,
  merchantCode,
  merchOrderId,
  title,
  amount,
  notifyUrl,
  redirectUrl,
  privateKey,
  tradeType = 'Checkout',
  timestamp = createTelebirrTimestamp(),
  nonceStr = createTelebirrNonceStr(),
}) {
  const numericAmount = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }
  if (!merchantAppId || !merchantCode) {
    throw new Error('Telebirr Merchant App ID and Merchant Code are required.');
  }

  const safeTitle = String(title || 'AFRO-TECH Service')
    .replace(/[~`!@#$%^&*()_+=[\]{};':"\\|<>?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64) || 'AFRO-TECH Pay';

  const basePayload = {
    timestamp: String(timestamp),
    nonce_str: String(nonceStr),
    method: 'payment.preorder',
    sign_type: 'SHA256WithRSA',
    version: '1.0',
    biz_content: {
      notify_url: notifyUrl,
      redirect_url: redirectUrl,
      appid: String(merchantAppId).trim(),
      merch_code: String(merchantCode).trim(),
      merch_order_id: String(merchOrderId).trim(),
      trade_type: tradeType,
      title: safeTitle,
      total_amount: String(numericAmount),
      trans_currency: 'ETB',
      timeout_express: '120m',
      business_type: 'BuyGoods',
      payee_identifier: String(merchantCode).trim(),
      payee_identifier_type: '04',
      payee_type: '5000',
    },
  };

  return {
    ...basePayload,
    sign: signTelebirrRequest(basePayload, privateKey),
  };
}

/**
 * Builds the signed H5 WebCheckout URL from a Telebirr prepay_id.
 */
export function buildTelebirrCheckoutUrl({
  prepayId,
  merchantAppId,
  merchantCode,
  privateKey,
  webBaseUrl = TELEBIRR_DEFAULT_WEB_BASE_URL,
  timestamp = createTelebirrTimestamp(),
  nonceStr = createTelebirrNonceStr(),
}) {
  const rawObj = {
    appid: String(merchantAppId).trim(),
    merch_code: String(merchantCode).trim(),
    nonce_str: String(nonceStr),
    prepay_id: String(prepayId).trim(),
    timestamp: String(timestamp),
  };
  const sign = signTelebirrRequest(rawObj, privateKey);
  const rawRequest = [
    `appid=${rawObj.appid}`,
    `merch_code=${rawObj.merch_code}`,
    `nonce_str=${rawObj.nonce_str}`,
    `prepay_id=${rawObj.prepay_id}`,
    `timestamp=${rawObj.timestamp}`,
    `sign=${encodeURIComponent(sign)}`,
    'sign_type=SHA256WithRSA',
  ].join('&');

  const base = String(webBaseUrl || TELEBIRR_DEFAULT_WEB_BASE_URL).replace(/\?+$/, '');
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}${rawRequest}&version=1.0&trade_type=Checkout`;
}

/**
 * Step 1: Obtains a Fabric token from POST /payment/v1/token.
 */
export async function applyTelebirrFabricToken({
  baseUrl = TELEBIRR_DEFAULT_BASE_URL,
  fabricAppId,
  appSecret,
  fetchFn = fetch,
}) {
  const appKey = String(fabricAppId || '').trim();
  const secret = String(appSecret || '').trim();
  if (!appKey || !secret) {
    return { ok: false, configured: false, error: 'Telebirr Fabric App ID and App Secret are required.' };
  }

  const endpoint = `${String(baseUrl || TELEBIRR_DEFAULT_BASE_URL).replace(/\/+$/, '')}/payment/v1/token`;
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': appKey,
      },
      body: JSON.stringify({ appSecret: secret }),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    const token = data?.token || data?.data?.token;
    if (!res.ok || !token) {
      return {
        ok: false,
        configured: true,
        statusCode: res.status,
        error: sanitizeTelebirrError(data?.errorMsg || data?.message || `Telebirr token HTTP ${res.status}`, [secret, appKey]),
      };
    }

    return { ok: true, configured: true, token: String(token) };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: sanitizeTelebirrError(err instanceof Error ? err.message : 'Failed to reach Telebirr token API', [secret, appKey]),
    };
  }
}

/**
 * Step 2: Applies Fabric token and calls POST /payment/v1/merchant/preOrder.
 */
export async function initializeTelebirrOrder({
  config,
  orderParams,
  fetchFn = fetch,
}) {
  const {
    baseUrl = TELEBIRR_DEFAULT_BASE_URL,
    webBaseUrl = TELEBIRR_DEFAULT_WEB_BASE_URL,
    fabricAppId,
    appSecret,
    merchantAppId,
    merchantCode,
    privateKey,
  } = config || {};

  if (!fabricAppId || !appSecret || !merchantAppId || !merchantCode || !privateKey) {
    return { ok: false, configured: false, error: 'Telebirr live credentials are incomplete.' };
  }

  const tokenRes = await applyTelebirrFabricToken({ baseUrl, fabricAppId, appSecret, fetchFn });
  if (!tokenRes.ok) {
    return tokenRes;
  }

  let payload;
  try {
    payload = buildTelebirrPreOrderPayload({
      merchantAppId,
      merchantCode,
      merchOrderId: orderParams.merchOrderId,
      title: orderParams.title,
      amount: orderParams.amount,
      notifyUrl: orderParams.notifyUrl,
      redirectUrl: orderParams.redirectUrl,
      privateKey,
    });
  } catch (err) {
    return { ok: false, configured: true, error: sanitizeTelebirrError(err instanceof Error ? err.message : 'Telebirr signing failed', [appSecret, privateKey]) };
  }

  const endpoint = `${String(baseUrl || TELEBIRR_DEFAULT_BASE_URL).replace(/\/+$/, '')}/payment/v1/merchant/preOrder`;
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': String(fabricAppId).trim(),
        Authorization: tokenRes.token,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    const prepayId = data?.biz_content?.prepay_id || data?.data?.prepayId || data?.data?.prepay_id;
    const directUrl = data?.data?.checkoutUrl || data?.biz_content?.checkout_url;
    const receiveCode = data?.data?.receiveCode || data?.biz_content?.receive_code || null;

    if (!res.ok || (!prepayId && !directUrl)) {
      return {
        ok: false,
        configured: true,
        statusCode: res.status,
        error: sanitizeTelebirrError(
          data?.errorMsg || data?.msg || data?.message || `Telebirr preOrder HTTP ${res.status}`,
          [appSecret, privateKey],
        ),
      };
    }

    const checkoutUrl = directUrl || buildTelebirrCheckoutUrl({
      prepayId,
      merchantAppId,
      merchantCode,
      privateKey,
      webBaseUrl,
    });

    return {
      ok: true,
      configured: true,
      prepayId: prepayId || null,
      receiveCode,
      checkoutUrl,
      raw: data,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      error: sanitizeTelebirrError(err instanceof Error ? err.message : 'Network error calling Telebirr preOrder', [appSecret, privateKey]),
    };
  }
}

/**
 * Step 3: Queries Telebirr order status via POST /payment/v1/merchant/queryOrder.
 */
export async function queryTelebirrOrder({ config, merchOrderId, fetchFn = fetch }) {
  const {
    baseUrl = TELEBIRR_DEFAULT_BASE_URL,
    fabricAppId,
    appSecret,
    merchantAppId,
    merchantCode,
    privateKey,
  } = config || {};

  if (!fabricAppId || !appSecret || !merchantAppId || !merchantCode || !privateKey) {
    return { ok: false, configured: false, verified: false, error: 'Telebirr credentials not configured.' };
  }

  const tokenRes = await applyTelebirrFabricToken({ baseUrl, fabricAppId, appSecret, fetchFn });
  if (!tokenRes.ok) {
    return { ...tokenRes, verified: false };
  }

  const basePayload = {
    timestamp: createTelebirrTimestamp(),
    nonce_str: createTelebirrNonceStr(),
    method: 'payment.queryorder',
    sign_type: 'SHA256WithRSA',
    version: '1.0',
    biz_content: {
      appid: String(merchantAppId).trim(),
      merch_code: String(merchantCode).trim(),
      merch_order_id: String(merchOrderId).trim(),
    },
  };
  const payload = {
    ...basePayload,
    sign: signTelebirrRequest(basePayload, privateKey),
  };

  const endpoint = `${String(baseUrl || TELEBIRR_DEFAULT_BASE_URL).replace(/\/+$/, '')}/payment/v1/merchant/queryOrder`;
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': String(fabricAppId).trim(),
        Authorization: tokenRes.token,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    const statusRaw = String(
      data?.biz_content?.order_status || data?.data?.order_status || data?.order_status || '',
    ).toUpperCase();
    const verified = res.ok && ['PAY_SUCCESS', 'TRADE_SUCCESS', 'COMPLETED', 'SUCCESS'].includes(statusRaw);
    return {
      ok: res.ok,
      configured: true,
      verified,
      status: statusRaw || (res.ok ? 'PENDING' : 'FAILED'),
      reference: data?.biz_content?.payment_order_id || data?.data?.payment_order_id || null,
      amount: Number(data?.biz_content?.total_amount || data?.data?.total_amount || 0),
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      verified: false,
      error: sanitizeTelebirrError(err instanceof Error ? err.message : 'Failed to query Telebirr order', [appSecret, privateKey]),
    };
  }
}
