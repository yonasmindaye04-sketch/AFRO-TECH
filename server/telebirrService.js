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
 * Signs a Telebirr request payload using SHA256withRSAandMGF1 (RSA-PSS, 32-byte salt).
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
  return signer.sign(
    {
      key: pem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    'base64',
  );
}

/**
 * Verifies a Telebirr async webhook notification signature with Ethio Telecom's public key.
 * Uses RSA-PSS (SHA256withRSAandMGF1) per Telebirr spec, with PKCS#1 v1.5 fallback for compatibility.
 */
export function verifyTelebirrSignature(payload, signature, publicKeyInput) {
  const pem = normalizeTelebirrPemKey(publicKeyInput, 'PUBLIC KEY');
  if (!pem || !signature) return false;
  const sig = String(signature).trim();
  const signString = buildTelebirrSignString(payload);
  try {
    const pssVerifier = crypto.createVerify('RSA-SHA256');
    pssVerifier.update(signString, 'utf8');
    pssVerifier.end();
    if (
      pssVerifier.verify(
        {
          key: pem,
          padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
          saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
        },
        sig,
        'base64',
      )
    ) {
      return true;
    }
  } catch {
    // Fall through to compatibility check
  }
  try {
    const pkcsVerifier = crypto.createVerify('RSA-SHA256');
    pkcsVerifier.update(signString, 'utf8');
    pkcsVerifier.end();
    return pkcsVerifier.verify(pem, sig, 'base64');
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
 * Classifies transport/network/credential errors into actionable diagnostics without leaking secrets.
 */
export function formatTelebirrTransportError(err, stage = 'gateway', secrets = []) {
  const rawName = err instanceof Error ? err.name : '';
  const rawMessage = err instanceof Error ? err.message : String(err || 'Telebirr gateway request failed');
  const causeCode =
    err && typeof err === 'object' && err.cause && typeof err.cause === 'object'
      ? String(err.cause.code || '')
      : err && typeof err === 'object' && 'code' in err
        ? String(err.code || '')
        : '';

  const upperCombined = `${rawName} ${causeCode} ${rawMessage}`.toUpperCase();
  if (
    rawName === 'TimeoutError'
    || rawName === 'AbortError'
    || upperCombined.includes('TIMEOUT')
    || upperCombined.includes('ETIMEDOUT')
    || upperCombined.includes('UND_ERR_CONNECT_TIMEOUT')
  ) {
    return {
      code: 'GATEWAY_TIMEOUT',
      statusCode: 504,
      stage,
      error: sanitizeTelebirrError(
        `Connection timeout waiting for Telebirr Fabric API (${stage}${causeCode ? ` · ${causeCode}` : ''}).`,
        secrets,
      ),
    };
  }

  if (
    upperCombined.includes('ECONNREFUSED')
    || upperCombined.includes('ENOTFOUND')
    || upperCombined.includes('ECONNRESET')
    || upperCombined.includes('EAI_AGAIN')
    || upperCombined.includes('FETCH FAILED')
  ) {
    return {
      code: causeCode || 'GATEWAY_UNREACHABLE',
      statusCode: 502,
      stage,
      error: sanitizeTelebirrError(
        `Unable to reach Telebirr Fabric gateway (${stage}${causeCode ? ` · ${causeCode}` : ''}: ${rawMessage}).`,
        secrets,
      ),
    };
  }

  return {
    code: causeCode || 'TELEBIRR_REQUEST_ERROR',
    statusCode: 502,
    stage,
    error: sanitizeTelebirrError(rawMessage, secrets),
  };
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
 * Builds the transaction-specific payload encoded in a Telebirr QR code.
 * Uses Ethio Telecom Fabric receiveCode when available in live mode, otherwise
 * falls back to the signed H5 checkout URL or unique hosted pay link.
 */
export function buildTelebirrQrScanPayload({
  mode,
  receiveCode,
  checkoutUrl,
  publicPayUrl,
  txRef,
}) {
  const cleanReceiveCode = String(receiveCode || '').trim();
  const cleanCheckoutUrl = String(checkoutUrl || '').trim();
  const cleanPublicPayUrl = String(publicPayUrl || '').trim();
  const cleanTxRef = String(txRef || '').trim();

  if (mode === 'live') {
    if (cleanReceiveCode) return cleanReceiveCode;
    if (cleanCheckoutUrl) return cleanCheckoutUrl;
  }

  const baseTarget = cleanPublicPayUrl || cleanCheckoutUrl;
  if (!baseTarget) {
    throw new Error('Telebirr QR target URL is required.');
  }
  const sep = baseTarget.includes('?') ? '&' : '?';
  return `${baseTarget}${sep}scan=telebirr${cleanTxRef ? `&tx_ref=${encodeURIComponent(cleanTxRef)}` : ''}`;
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
    return {
      ok: false,
      configured: false,
      code: 'MISSING_MERCHANT_CREDENTIALS',
      statusCode: 400,
      stage: 'fabric_token',
      error: 'Telebirr Fabric App ID and App Secret are missing from merchant configuration.',
    };
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
      const upstreamCode = String(data?.errorCode || data?.code || '').trim();
      const upstreamMsg = String(data?.errorMsg || data?.msg || data?.message || '').trim();
      const isAuthError =
        res.status === 401
        || res.status === 403
        || /invalid|unauthoriz|secret|app.?key|credential|auth/i.test(`${upstreamCode} ${upstreamMsg}`);
      const errorCode = isAuthError
        ? 'INVALID_MERCHANT_CREDENTIALS'
        : upstreamCode || `FABRIC_TOKEN_HTTP_${res.status || 502}`;
      const detail = upstreamMsg
        ? isAuthError
          ? `Invalid Telebirr merchant credentials: ${upstreamMsg}`
          : upstreamMsg
        : isAuthError
          ? `Invalid Telebirr merchant credentials rejected by Fabric token API (HTTP ${res.status}).`
          : `Telebirr Fabric token request failed (HTTP ${res.status}).`;

      return {
        ok: false,
        configured: true,
        code: errorCode,
        stage: 'fabric_token',
        statusCode: res.status || 502,
        error: sanitizeTelebirrError(detail, [secret, appKey]),
      };
    }

    return { ok: true, configured: true, token: String(token) };
  } catch (err) {
    const formatted = formatTelebirrTransportError(err, 'fabric_token', [secret, appKey]);
    return {
      ok: false,
      configured: true,
      ...formatted,
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
    return {
      ok: false,
      configured: false,
      code: 'INCOMPLETE_MERCHANT_CREDENTIALS',
      stage: 'pre_order',
      statusCode: 400,
      error: 'Telebirr live merchant credentials are incomplete.',
    };
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
    return {
      ok: false,
      configured: true,
      code: 'RSA_SIGNING_FAILED',
      stage: 'pre_order',
      statusCode: 500,
      error: sanitizeTelebirrError(err instanceof Error ? err.message : 'Telebirr RSA payload signing failed', [appSecret, privateKey]),
    };
  }

  const authHeader = tokenRes.token.startsWith('Bearer ') ? tokenRes.token : `Bearer ${tokenRes.token}`;
  const endpoint = `${String(baseUrl || TELEBIRR_DEFAULT_BASE_URL).replace(/\/+$/, '')}/payment/v1/merchant/preOrder`;
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': String(fabricAppId).trim(),
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });

    const data = await res.json().catch(() => null);
    const prepayId = data?.biz_content?.prepay_id || data?.data?.prepayId || data?.data?.prepay_id;
    const directUrl = data?.data?.checkoutUrl || data?.biz_content?.checkout_url;
    const receiveCode = data?.data?.receiveCode || data?.biz_content?.receive_code || null;

    if (!res.ok || (!prepayId && !directUrl)) {
      const upstreamCode = String(data?.errorCode || data?.code || '').trim();
      const upstreamMsg = String(data?.errorMsg || data?.msg || data?.message || '').trim();
      return {
        ok: false,
        configured: true,
        code: upstreamCode || `PREORDER_HTTP_${res.status || 502}`,
        stage: 'pre_order',
        statusCode: res.status || 502,
        error: sanitizeTelebirrError(
          upstreamMsg || `Telebirr Fabric preOrder rejected request (HTTP ${res.status}).`,
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
    const formatted = formatTelebirrTransportError(err, 'pre_order', [appSecret, privateKey]);
    return {
      ok: false,
      configured: true,
      ...formatted,
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
    return {
      ok: false,
      configured: false,
      verified: false,
      code: 'MISSING_MERCHANT_CREDENTIALS',
      stage: 'query_order',
      statusCode: 400,
      error: 'Telebirr merchant credentials not configured.',
    };
  }

  const tokenRes = await applyTelebirrFabricToken({ baseUrl, fabricAppId, appSecret, fetchFn });
  if (!tokenRes.ok) {
    return { ...tokenRes, verified: false };
  }

  let payload;
  try {
    const basePayload = {
      timestamp: createTelebirrTimestamp(),
      nonce_str: createTelebirrNonceStr(),
      method: 'payment.query.order',
      sign_type: 'SHA256WithRSA',
      version: '1.0',
      biz_content: {
        appid: String(merchantAppId).trim(),
        merch_code: String(merchantCode).trim(),
        merch_order_id: String(merchOrderId).trim(),
      },
    };
    payload = {
      ...basePayload,
      sign: signTelebirrRequest(basePayload, privateKey),
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      verified: false,
      code: 'RSA_SIGNING_FAILED',
      stage: 'query_order',
      statusCode: 500,
      error: sanitizeTelebirrError(err instanceof Error ? err.message : 'Failed to sign queryOrder request', [appSecret, privateKey]),
    };
  }

  const authHeader = tokenRes.token.startsWith('Bearer ') ? tokenRes.token : `Bearer ${tokenRes.token}`;
  const endpoint = `${String(baseUrl || TELEBIRR_DEFAULT_BASE_URL).replace(/\/+$/, '')}/payment/v1/merchant/queryOrder`;
  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-APP-Key': String(fabricAppId).trim(),
        Authorization: authHeader,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    const data = await res.json().catch(() => null);
    const statusRaw = String(
      data?.biz_content?.trade_status
      || data?.biz_content?.order_status
      || data?.data?.trade_status
      || data?.data?.order_status
      || data?.trade_status
      || data?.order_status
      || '',
    ).toUpperCase();
    const verified = res.ok && ['PAY_SUCCESS', 'TRADE_SUCCESS', 'COMPLETED', 'SUCCESS'].includes(statusRaw);
    const upstreamMsg = String(data?.errorMsg || data?.msg || data?.message || '').trim();
    const upstreamCode = String(data?.errorCode || data?.code || '').trim();
    return {
      ok: res.ok,
      configured: true,
      verified,
      status: statusRaw || (res.ok ? 'PENDING' : 'FAILED'),
      statusCode: res.status,
      ...(res.ok ? {} : {
        code: upstreamCode || `QUERY_HTTP_${res.status || 502}`,
        stage: 'query_order',
        error: sanitizeTelebirrError(
          upstreamMsg || `Telebirr order status query failed (HTTP ${res.status}).`,
          [appSecret, privateKey],
        ),
      }),
      reference:
        data?.biz_content?.payment_order_id
        || data?.biz_content?.trade_voucher
        || data?.data?.payment_order_id
        || data?.data?.trade_voucher
        || null,
      amount: Number(data?.biz_content?.total_amount || data?.data?.total_amount || 0),
    };
  } catch (err) {
    const formatted = formatTelebirrTransportError(err, 'query_order', [appSecret, privateKey]);
    return {
      ok: false,
      configured: true,
      verified: false,
      ...formatted,
    };
  }
}
