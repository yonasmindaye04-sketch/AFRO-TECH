import {
  buildChapaInitPayload,
  initializeChapaPayment,
  verifyChapaPayment,
} from './chapaService.js';
import {
  initializeTelebirrOrder,
  queryTelebirrOrder,
} from './telebirrService.js';
import {
  initiateMpesaStkPush,
  normalizeMpesaPhone,
  queryMpesaStkStatus,
} from './mpesaService.js';

const PROVIDER_ALIASES = {
  cbe: 'cbe_bank',
  cbe_birr: 'cbe_bank',
  cbe_bank: 'cbe_bank',
  bank: 'cbe_bank',
  telebirr: 'telebirr',
  mpesa: 'mpesa',
  'm-pesa': 'mpesa',
  chapa: 'chapa',
  card: 'chapa',
  stripe: 'stripe',
};

export const SUPPORTED_GATEWAY_PROVIDERS = new Set([
  'chapa',
  'telebirr',
  'mpesa',
  'cbe_bank',
  'stripe',
]);

/**
 * Normalizes POS rail names or gateway aliases to canonical server provider IDs.
 * Returns null if no recognized gateway was specified.
 */
export function normalizeGatewayProvider(input) {
  const key = String(input || '').trim().toLowerCase();
  if (!key) return null;
  return PROVIDER_ALIASES[key] || (SUPPORTED_GATEWAY_PROVIDERS.has(key) ? key : null);
}

/**
 * Reads platform-level live gateway credentials from process.env.
 */
export function getPlatformGatewayEnv(provider, env = process.env) {
  if (provider === 'chapa') {
    const secretKey = String(env.CHAPA_SECRET_KEY || '').trim();
    const webhookSecret = String(env.CHAPA_WEBHOOK_SECRET || secretKey).trim();
    return {
      configured: Boolean(secretKey),
      credentials: secretKey ? { secretKey, webhookSecret } : {},
      publicConfig: {
        settlement_account: 'Platform Chapa Merchant',
      },
    };
  }

  if (provider === 'telebirr') {
    const fabricAppId = String(env.TELEBIRR_FABRIC_APP_ID || '').trim();
    const appSecret = String(env.TELEBIRR_APP_SECRET || '').trim();
    const merchantAppId = String(env.TELEBIRR_MERCHANT_APP_ID || '').trim();
    const merchantCode = String(env.TELEBIRR_MERCHANT_CODE || '').trim();
    const privateKey = String(env.TELEBIRR_PRIVATE_KEY || '').trim();
    const publicKey = String(env.TELEBIRR_PUBLIC_KEY || '').trim();
    const baseUrl = String(env.TELEBIRR_BASE_URL || '').trim();
    const webBaseUrl = String(env.TELEBIRR_WEB_BASE_URL || '').trim();
    const configured = Boolean(fabricAppId && appSecret && merchantAppId && merchantCode && privateKey);
    return {
      configured,
      credentials: configured
        ? {
            fabricAppId,
            appSecret,
            merchantAppId,
            merchantCode,
            privateKey,
            publicKey,
            ...(baseUrl ? { baseUrl } : {}),
            ...(webBaseUrl ? { webBaseUrl } : {}),
          }
        : {},
      publicConfig: configured
        ? { merchant_id: merchantCode, settlement_account: `Shortcode ${merchantCode}` }
        : {},
    };
  }

  if (provider === 'mpesa') {
    const consumerKey = String(env.MPESA_CONSUMER_KEY || '').trim();
    const consumerSecret = String(env.MPESA_CONSUMER_SECRET || '').trim();
    const shortCode = String(env.MPESA_SHORTCODE || '').trim();
    const passkey = String(env.MPESA_PASSKEY || '').trim();
    const baseUrl = String(env.MPESA_BASE_URL || '').trim();
    const configured = Boolean(consumerKey && consumerSecret && shortCode && passkey);
    return {
      configured,
      credentials: configured
        ? {
            consumerKey,
            consumerSecret,
            shortCode,
            passkey,
            ...(baseUrl ? { baseUrl } : {}),
          }
        : {},
      publicConfig: configured
        ? { merchant_id: shortCode, settlement_account: `Paybill ${shortCode}` }
        : {},
    };
  }

  return { configured: false, credentials: {}, publicConfig: {} };
}

function extractTenantLiveCredentials(provider, gw, decryptSecretFn) {
  if (!gw || gw.mode !== 'live' || !gw.enabled || !gw.configured) {
    return null;
  }
  const pub = gw.public_config || {};
  const enc = gw.encrypted_secrets || {};
  const dec = (k) => (enc[k] ? decryptSecretFn(enc[k]) : '');

  if (provider === 'chapa') {
    const secretKey = dec('secret_key');
    if (!secretKey) return null;
    return {
      secretKey,
      webhookSecret: dec('webhook_secret') || secretKey,
    };
  }

  if (provider === 'telebirr') {
    const fabricAppId = String(pub.fabric_app_id || pub.merchant_id || '').trim();
    const merchantAppId = String(pub.merchant_app_id || pub.merchant_id || '').trim();
    const merchantCode = String(pub.merchant_id || '').trim();
    const appSecret = dec('secret_key');
    const privateKey = dec('private_key');
    const publicKey = dec('public_key') || String(pub.public_key || '').trim();
    const baseUrl = String(pub.base_url || '').trim();
    const webBaseUrl = String(pub.web_base_url || '').trim();
    if (!fabricAppId || !merchantAppId || !merchantCode || !appSecret || !privateKey) {
      return null;
    }
    return {
      fabricAppId,
      appSecret,
      merchantAppId,
      merchantCode,
      privateKey,
      publicKey,
      ...(baseUrl ? { baseUrl } : {}),
      ...(webBaseUrl ? { webBaseUrl } : {}),
    };
  }

  if (provider === 'mpesa') {
    const consumerKey = String(pub.public_key || '').trim();
    const shortCode = String(pub.merchant_id || '').trim();
    const consumerSecret = dec('secret_key');
    const passkey = dec('passkey');
    const baseUrl = String(pub.base_url || '').trim();
    if (!consumerKey || !shortCode || !consumerSecret || !passkey) {
      return null;
    }
    return {
      consumerKey,
      consumerSecret,
      shortCode,
      passkey,
      ...(baseUrl ? { baseUrl } : {}),
    };
  }

  return null;
}

/**
 * Resolves the exact payment gateway runtime for a tenant payment intent.
 * Never silently substitutes a different provider (e.g. cbe_bank) when an explicit provider is requested.
 */
export function resolveGatewayRuntime({
  store,
  provider,
  env = process.env,
  decryptSecretFn = (v) => v,
}) {
  const normalized = normalizeGatewayProvider(provider);
  const gwMap = store?.paymentGateways || {};

  const chosenProvider =
    normalized ||
    Object.values(gwMap).find((g) => g.enabled && g.configured && g.is_default)?.provider ||
    Object.values(gwMap).find((g) => g.enabled && g.configured)?.provider ||
    'cbe_bank';

  if (!SUPPORTED_GATEWAY_PROVIDERS.has(chosenProvider)) {
    return {
      ok: false,
      provider: chosenProvider,
      mode: 'sandbox',
      source: 'unsupported',
      error: `Unsupported payment provider "${provider}".`,
    };
  }

  const gw = gwMap[chosenProvider] || null;
  if (chosenProvider === 'cbe_bank') {
    return {
      ok: true,
      provider: 'cbe_bank',
      mode: 'direct',
      source: 'tenant_bank',
      credentials: {},
      publicConfig: gw?.public_config || {
        account_holder: 'Merchant Account',
        settlement_account: '1000248910332',
        bank_name: 'Commercial Bank of Ethiopia',
      },
    };
  }

  // 1. Tenant's own live credentials
  const tenantCreds = extractTenantLiveCredentials(chosenProvider, gw, decryptSecretFn);
  if (tenantCreds) {
    return {
      ok: true,
      provider: chosenProvider,
      mode: 'live',
      source: 'tenant_live',
      credentials: tenantCreds,
      publicConfig: gw?.public_config || {},
    };
  }

  // 2. Platform environment live credentials (when tenant uses platform gateway keys)
  const envCfg = getPlatformGatewayEnv(chosenProvider, env);
  if (envCfg.configured) {
    return {
      ok: true,
      provider: chosenProvider,
      mode: 'live',
      source: 'platform_live',
      credentials: envCfg.credentials,
      publicConfig: {
        ...(gw?.public_config || {}),
        ...(envCfg.publicConfig || {}),
      },
    };
  }

  // 3. Sandbox fallback ONLY for the exact requested provider (never swapped to CBE)
  return {
    ok: true,
    provider: chosenProvider,
    mode: 'sandbox',
    source: gw?.enabled && gw?.configured ? 'tenant_sandbox' : 'platform_sandbox',
    credentials: {},
    publicConfig: gw?.public_config || {},
  };
}

/**
 * Initiates a real upstream checkout / STK push (in live mode) or validates a sandbox session (in sandbox mode).
 */
export async function initiateGatewayCheckout({
  runtime,
  intent,
  payerName = '',
  payerEmail = '',
  payerPhone = '',
  businessName = 'AFRO Suite Merchant',
  callbacks,
  fetchFn = fetch,
}) {
  const provider = runtime.provider;
  const amount = Number(intent.amount || 0);
  const currency = intent.currency || 'ETB';
  const cleanName = String(payerName || intent.party_name || 'Customer').trim();
  const cleanEmail = String(payerEmail || intent.customer_email || '').trim();
  const cleanPhone = String(payerPhone || intent.customer_phone || '').trim();

  if (provider === 'cbe_bank') {
    return {
      ok: true,
      action: 'bank_transfer',
      mode: 'direct',
      provider,
      customerMessage: 'Transfer the exact ETB total to the merchant CBE account below and enter your FT reference.',
    };
  }

  if (provider === 'chapa') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return {
        ok: false,
        statusCode: 400,
        error: 'A valid receipt email address is required for Chapa checkout.',
      };
    }

    if (runtime.mode === 'live') {
      let payload;
      try {
        payload = buildChapaInitPayload({
          amount,
          currency,
          email: cleanEmail,
          fullName: cleanName,
          phone: cleanPhone,
          txRef: intent.tx_ref,
          callbackUrl: callbacks.chapaCallbackUrl,
          returnUrl: callbacks.returnUrl,
          serviceTitle: businessName,
          description: intent.description || 'Invoice Payment',
        });
      } catch (err) {
        return {
          ok: false,
          statusCode: 400,
          error: err instanceof Error ? err.message : 'Invalid Chapa checkout payload.',
        };
      }

      const chapaRes = await initializeChapaPayment({
        secretKey: runtime.credentials.secretKey,
        payload,
        fetchFn,
      });
      if (!chapaRes.ok) {
        return {
          ok: false,
          statusCode: chapaRes.statusCode || 502,
          error: chapaRes.error || 'Chapa gateway declined transaction initialization.',
        };
      }
      return {
        ok: true,
        action: 'redirect',
        mode: 'live',
        provider,
        checkoutUrl: chapaRes.checkoutUrl,
        customerMessage: 'Redirecting to Chapa hosted checkout…',
      };
    }

    return {
      ok: true,
      action: 'sandbox_authorize',
      mode: 'sandbox',
      provider,
      customerMessage: 'Chapa Sandbox checkout ready. Complete test authorization below.',
    };
  }

  if (provider === 'telebirr') {
    if (runtime.mode === 'live') {
      const tbRes = await initializeTelebirrOrder({
        config: runtime.credentials,
        orderParams: {
          merchOrderId: intent.tx_ref,
          title: intent.description || `${businessName} Payment`,
          amount,
          notifyUrl: callbacks.telebirrNotifyUrl,
          redirectUrl: callbacks.returnUrl,
        },
        fetchFn,
      });
      if (!tbRes.ok) {
        return {
          ok: false,
          statusCode: tbRes.statusCode || 502,
          error: tbRes.error || 'Telebirr gateway declined pre-order initialization.',
        };
      }
      return {
        ok: true,
        action: 'redirect',
        mode: 'live',
        provider,
        checkoutUrl: tbRes.checkoutUrl,
        prepayId: tbRes.prepayId || null,
        receiveCode: tbRes.receiveCode || null,
        customerMessage: 'Telebirr pre-order created. Complete payment on Ethio Telecom Telebirr PayGate.',
      };
    }

    return {
      ok: true,
      action: 'sandbox_authorize',
      mode: 'sandbox',
      provider,
      customerMessage: 'Telebirr Sandbox checkout ready. Enter Telebirr wallet phone or sandbox ref to test settlement.',
    };
  }

  if (provider === 'mpesa') {
    const msisdn = normalizeMpesaPhone(cleanPhone);
    if (!msisdn) {
      return {
        ok: false,
        statusCode: 400,
        error: 'Enter a valid Ethiopian mobile number (e.g. +251 711 223344 or 0711223344) to send an M-Pesa STK Push.',
      };
    }

    if (runtime.mode === 'live') {
      const pushRes = await initiateMpesaStkPush({
        config: runtime.credentials,
        orderParams: {
          amount: Math.round(amount),
          phoneNumber: msisdn,
          callbackUrl: callbacks.mpesaCallbackUrl,
          accountReference: String(intent.tx_ref || 'AFROPAY').slice(0, 12),
          transactionDesc: String(intent.description || 'POS Payment').slice(0, 40),
        },
        fetchFn,
      });
      if (!pushRes.ok) {
        return {
          ok: false,
          statusCode: pushRes.statusCode || 502,
          error: pushRes.error || 'Safaricom M-Pesa STK Push failed.',
        };
      }
      return {
        ok: true,
        action: 'stk_poll',
        mode: 'live',
        provider,
        msisdn: `+${msisdn}`,
        checkoutRequestId: pushRes.checkoutRequestId,
        merchantRequestId: pushRes.merchantRequestId || null,
        customerMessage: pushRes.customerMessage,
      };
    }

    return {
      ok: true,
      action: 'sandbox_stk',
      mode: 'sandbox',
      provider,
      msisdn: `+${msisdn}`,
      checkoutRequestId: intent.checkout_request_id || `ws_CO_SBX_${String(intent.tx_ref || '').replace(/[^A-Z0-9]/gi, '').slice(-8)}`,
      customerMessage: `Sandbox STK Push prepared for +${msisdn}. Authorize below to simulate confirmation.`,
    };
  }

  return {
    ok: true,
    action: 'sandbox_authorize',
    mode: runtime.mode,
    provider,
    customerMessage: 'Proceed with gateway checkout authorization.',
  };
}

/**
 * Verifies real settlement status against the upstream provider API in live mode.
 */
export async function verifyGatewaySettlement({
  runtime,
  intent,
  fetchFn = fetch,
}) {
  if (intent?.status === 'settled') {
    return {
      ok: true,
      verified: true,
      status: 'settled',
      payerReference: intent.payer_reference || intent.tx_ref,
    };
  }

  if (runtime.mode !== 'live') {
    return {
      ok: true,
      verified: false,
      status: intent?.status || 'pending',
      message: 'Transaction is running in Sandbox mode and awaits checkout confirmation.',
    };
  }

  if (runtime.provider === 'chapa') {
    const res = await verifyChapaPayment({
      secretKey: runtime.credentials.secretKey,
      txRef: intent.tx_ref,
      fetchFn,
    });
    return {
      ok: res.ok,
      verified: Boolean(res.verified),
      status: res.verified ? 'settled' : res.status || 'pending',
      payerReference: res.reference || intent.tx_ref,
      message: res.verified ? 'Chapa payment verified.' : res.error || 'Chapa payment is still awaiting customer completion.',
    };
  }

  if (runtime.provider === 'telebirr') {
    const res = await queryTelebirrOrder({
      config: runtime.credentials,
      merchOrderId: intent.tx_ref,
      fetchFn,
    });
    return {
      ok: res.ok,
      verified: Boolean(res.verified),
      status: res.verified ? 'settled' : res.status || 'pending',
      payerReference: res.reference || intent.tx_ref,
      message: res.verified ? 'Telebirr payment verified.' : res.error || 'Telebirr order is not settled yet.',
    };
  }

  if (runtime.provider === 'mpesa') {
    if (!intent.checkout_request_id) {
      return {
        ok: false,
        verified: false,
        status: 'pending',
        message: 'Initiate M-Pesa STK Push before checking status.',
      };
    }
    const res = await queryMpesaStkStatus({
      config: runtime.credentials,
      checkoutRequestId: intent.checkout_request_id,
      fetchFn,
    });
    return {
      ok: res.ok,
      verified: Boolean(res.verified),
      status: res.verified ? 'settled' : res.status || 'pending',
      payerReference: intent.payer_reference || intent.checkout_request_id,
      message: res.verified ? 'M-Pesa payment confirmed.' : res.resultDesc || res.error || 'Waiting for customer M-Pesa PIN confirmation…',
    };
  }

  return {
    ok: true,
    verified: false,
    status: intent?.status || 'pending',
  };
}
