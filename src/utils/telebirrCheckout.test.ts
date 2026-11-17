import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendTelebirrErrorLog,
  buildTelebirrOrderSummary,
  classifyTelebirrVerifyOutcome,
  evaluateTelebirrPollCycle,
  evaluateTelebirrSessionCountdown,
  extractTelebirrBackendError,
  formatTelebirrStageLabel,
  normalizeTelebirrMerchantConfig,
  resolveTelebirrGatewayIndicator,
  sanitizeTelebirrOrderNote,
  TELEBIRR_GATEWAY_HEARTBEAT_MS,
  TELEBIRR_MAX_POLL_ATTEMPTS,
  TELEBIRR_POLL_INTERVAL_MS,
  TELEBIRR_SESSION_TTL_MS,
  validateTelebirrDirectForm,
} from './telebirrCheckout';

test('sanitizeTelebirrOrderNote strips Fabric-disallowed punctuation and caps at 24 characters', () => {
  assert.equal(
    sanitizeTelebirrOrderNote('  Milestone #1 <urgent> & QA phase extra chars  '),
    'Milestone 1 urgent QA ph',
  );
  assert.equal(sanitizeTelebirrOrderNote('   '), '');
});

test('normalizeTelebirrMerchantConfig parses live and sandbox responses safely without exposing secrets', () => {
  const live = normalizeTelebirrMerchantConfig({
    mode: 'live',
    merchant_configured: true,
    merchant_code_masked: '55••20',
    public_key_configured: true,
    web_gateway_host: 'developerportal.ethiotelebirr.et:38443',
  });
  assert.equal(live.mode, 'live');
  assert.equal(live.merchantConfigured, true);
  assert.equal(live.merchantCodeMasked, '55••20');
  assert.equal(live.publicKeyConfigured, true);
  assert.equal(live.webGatewayHost, 'developerportal.ethiotelebirr.et:38443');
  assert.equal(live.connectionStatus, 'live');

  const fallback = normalizeTelebirrMerchantConfig(null);
  assert.equal(fallback.mode, 'sandbox');
  assert.equal(fallback.merchantConfigured, false);
  assert.equal(fallback.merchantCodeMasked, null);
  assert.equal(fallback.connectionStatus, 'pending');
});

test('resolveTelebirrGatewayIndicator distinguishes Live vs Pending real-time connection states', () => {
  assert.equal(TELEBIRR_GATEWAY_HEARTBEAT_MS, 15000);
  const liveCfg = normalizeTelebirrMerchantConfig({
    mode: 'live',
    connection_status: 'live',
    connection_reason: 'Telebirr Fabric merchant gateway connected.',
    checked_at: '2026-11-16T12:00:00.000Z',
  });
  assert.deepEqual(
    resolveTelebirrGatewayIndicator({ probing: false, config: liveCfg }),
    { status: 'live', label: 'Live', detail: 'Telebirr Fabric merchant gateway connected.' },
  );

  const pendingCfg = normalizeTelebirrMerchantConfig({
    mode: 'sandbox',
    connection_status: 'pending',
    connection_reason: 'Awaiting live Telebirr merchant credentials.',
    checked_at: '2026-11-16T12:00:00.000Z',
  });
  assert.deepEqual(
    resolveTelebirrGatewayIndicator({ probing: false, config: pendingCfg }),
    { status: 'pending', label: 'Pending', detail: 'Awaiting live Telebirr merchant credentials.' },
  );

  assert.equal(
    resolveTelebirrGatewayIndicator({ probing: false, config: liveCfg, networkError: true }).label,
    'Pending',
  );
});

test('buildTelebirrOrderSummary formats deposit, full, and custom ETB totals with sanitized title preview', () => {
  const summary = buildTelebirrOrderSummary({
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    notes: 'Phase 1 @ Bole',
  });
  assert.equal(summary.amount, 4000);
  assert.equal(summary.formattedAmount, '4,000 ETB');
  assert.equal(summary.sanitizedNote, 'Phase 1 Bole');
  assert.match(summary.fabricTitlePreview, /40% Deposit.*Phase 1 Bole/);
});

test('validateTelebirrDirectForm validates required identity, optional wallet phone, and ETB bounds', () => {
  const bad = validateTelebirrDirectForm({
    serviceId: 1,
    paymentPlan: 'custom',
    customAmount: '20',
    fullName: 'A',
    email: 'bad-email',
    phone: '12',
    notes: 'Ref #1',
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.fullName);
  assert.ok(bad.errors.email);
  assert.ok(bad.errors.phone);
  assert.ok(bad.errors.amount);

  const ok = validateTelebirrDirectForm({
    serviceId: 1,
    paymentPlan: 'deposit',
    customAmount: '',
    fullName: 'Selamawit Tadesse',
    email: 'selam@afrotech.et',
    phone: '+251 911 223344',
    notes: 'Kickoff Deposit',
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.amount, 4000);
  assert.equal(ok.sanitizedNote, 'Kickoff Deposit');
});

test('TELEBIRR_POLL_INTERVAL_MS is 5000ms and polling guards stop cleanly on verify, pause, failure, or cap', () => {
  assert.equal(TELEBIRR_POLL_INTERVAL_MS, 5000);
  assert.equal(TELEBIRR_MAX_POLL_ATTEMPTS, 60);

  assert.equal(classifyTelebirrVerifyOutcome(true, { ok: true, verified: true, status: 'settled' }), 'verified');
  assert.equal(classifyTelebirrVerifyOutcome(true, { ok: true, verified: false, status: 'PENDING' }), 'pending');
  assert.equal(classifyTelebirrVerifyOutcome(true, { ok: true, verified: false, status: 'FAILED' }), 'failed');
  assert.equal(classifyTelebirrVerifyOutcome(true, { ok: true, verified: false, status: 'EXPIRED' }), 'failed');
  assert.equal(classifyTelebirrVerifyOutcome(false, null), 'error');

  assert.deepEqual(
    evaluateTelebirrPollCycle({ activeTxRef: null, verified: false, paused: false, attempts: 0 }),
    { shouldPoll: false, reason: 'idle' },
  );
  assert.deepEqual(
    evaluateTelebirrPollCycle({ activeTxRef: 'TB-SVC-1', verified: false, paused: false, attempts: 0 }),
    { shouldPoll: true, reason: 'active' },
  );
  assert.deepEqual(
    evaluateTelebirrPollCycle({ activeTxRef: 'TB-SVC-1', verified: true, paused: false, attempts: 1 }),
    { shouldPoll: false, reason: 'verified' },
  );
  assert.deepEqual(
    evaluateTelebirrPollCycle({ activeTxRef: 'TB-SVC-1', verified: false, paused: true, attempts: 1 }),
    { shouldPoll: false, reason: 'paused' },
  );
  assert.deepEqual(
    evaluateTelebirrPollCycle({
      activeTxRef: 'TB-SVC-1',
      verified: false,
      terminalFailure: true,
      paused: false,
      attempts: 1,
    }),
    { shouldPoll: false, reason: 'failed' },
  );
  assert.deepEqual(
    evaluateTelebirrPollCycle({ activeTxRef: 'TB-SVC-1', verified: false, paused: false, attempts: 60 }),
    { shouldPoll: false, reason: 'max_attempts' },
  );
  assert.deepEqual(
    evaluateTelebirrPollCycle({ activeTxRef: 'TB-SVC-1', verified: false, expired: true, paused: false, attempts: 2 }),
    { shouldPoll: false, reason: 'expired' },
  );
});

test('evaluateTelebirrSessionCountdown tracks 10-minute expiry accurately and flags Session Expired at 00:00', () => {
  assert.equal(TELEBIRR_SESSION_TTL_MS, 10 * 60 * 1000);
  const startMs = Date.parse('2026-11-17T10:00:00.000Z');
  const expiresAt = new Date(startMs + TELEBIRR_SESSION_TTL_MS).toISOString();

  const full = evaluateTelebirrSessionCountdown(expiresAt, startMs);
  assert.equal(full.label, '10:00');
  assert.equal(full.expired, false);
  assert.equal(full.isUrgent, false);
  assert.equal(full.progressPct, 100);

  const urgent = evaluateTelebirrSessionCountdown(expiresAt, startMs + 8 * 60 * 1000 + 5 * 1000);
  assert.equal(urgent.label, '01:55');
  assert.equal(urgent.expired, false);
  assert.equal(urgent.isUrgent, true);

  const atExpiry = evaluateTelebirrSessionCountdown(expiresAt, startMs + TELEBIRR_SESSION_TTL_MS);
  assert.equal(atExpiry.label, '00:00');
  assert.equal(atExpiry.expired, true);
  assert.equal(atExpiry.remainingSec, 0);
  assert.equal(atExpiry.progressPct, 0);

  const pastExpiry = evaluateTelebirrSessionCountdown(expiresAt, startMs + TELEBIRR_SESSION_TTL_MS + 42_000);
  assert.equal(pastExpiry.label, '00:00');
  assert.equal(pastExpiry.expired, true);
});

test('extractTelebirrBackendError and appendTelebirrErrorLog extract exact backend codes and coalesce consecutive duplicates', () => {
  const credErr = extractTelebirrBackendError({
    resStatus: 401,
    payload: {
      ok: false,
      code: 'INVALID_MERCHANT_CREDENTIALS',
      stage: 'fabric_token',
      status_code: 401,
      message: 'Invalid Telebirr merchant credentials: appSecret mismatch',
    },
    defaultStage: 'pre_order',
    fallbackMessage: 'Generic fallback',
  });
  assert.equal(credErr.code, 'INVALID_MERCHANT_CREDENTIALS');
  assert.equal(credErr.stage, 'fabric_token');
  assert.equal(credErr.statusCode, 401);
  assert.equal(credErr.message, 'Invalid Telebirr merchant credentials: appSecret mismatch');
  assert.equal(formatTelebirrStageLabel(credErr.stage), 'Fabric Auth');

  const queryTimeout = extractTelebirrBackendError({
    resStatus: 200,
    payload: {
      ok: true,
      query_ok: false,
      error_code: 'GATEWAY_TIMEOUT',
      stage: 'query_order',
      status_code: 504,
      query_error: 'Connection timeout waiting for Telebirr Fabric API (query_order).',
    },
    defaultStage: 'query_order',
    fallbackMessage: 'Query failed',
    txRef: 'TB-SVC-TIMEOUT1',
  });
  assert.equal(queryTimeout.code, 'GATEWAY_TIMEOUT');
  assert.equal(queryTimeout.statusCode, 504);
  assert.equal(queryTimeout.txRef, 'TB-SVC-TIMEOUT1');

  let log = appendTelebirrErrorLog([], credErr);
  log = appendTelebirrErrorLog(log, queryTimeout);
  log = appendTelebirrErrorLog(log, { ...queryTimeout, timestamp: '2026-11-16T19:55:00.000Z' });
  assert.equal(log.length, 2);
  assert.equal(log[0].code, 'GATEWAY_TIMEOUT');
  assert.equal(log[0].repeatCount, 2);
  assert.equal(log[1].code, 'INVALID_MERCHANT_CREDENTIALS');
});


