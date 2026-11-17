import { useEffect, useState } from 'react';
import { formatEtb } from '../utils/serviceCheckout';
import {
  evaluateTelebirrSessionCountdown,
  type TelebirrErrorLogEntry,
  type TelebirrPollDecision,
} from '../utils/telebirrCheckout';
import {
  renderTelebirrQrDataUrl,
  type TelebirrQrSession,
} from '../utils/telebirrQr';

interface ChapaQrContainerProps {
  loading: boolean;
  session: TelebirrQrSession | null;
  error: TelebirrErrorLogEntry | null;
  verifying: boolean;
  pollCountdownSec: number;
  pollAttempts: number;
  pollPaused: boolean;
  pollReason: TelebirrPollDecision['reason'];
  gatewayIndicator: {
    status: 'live' | 'pending';
    label: 'Live' | 'Pending';
    detail: string;
  };
  onRegenerate: () => void;
  onVerifyNow: () => void;
  onTogglePollPause: () => void;
}

export function ChapaQrContainer({
  loading,
  session,
  error,
  verifying,
  pollCountdownSec,
  pollAttempts,
  pollPaused,
  pollReason,
  gatewayIndicator,
  onRegenerate,
  onVerifyNow,
  onTogglePollPause,
}: ChapaQrContainerProps): JSX.Element {
  const [fallbackQr, setFallbackQr] = useState<{ payload: string; url: string } | null>(null);
  const [copiedPayload, setCopiedPayload] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!session || session.qrDataUrl) return;
    let cancelled = false;
    void renderTelebirrQrDataUrl(session.qrPayload)
      .then((url) => {
        if (!cancelled) setFallbackQr({ payload: session.qrPayload, url });
      })
      .catch(() => {
        if (!cancelled) setFallbackQr(null);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!session?.expiresAt) return;
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [session?.expiresAt]);

  const resolvedQrSrc =
    session?.qrDataUrl ||
    (session && fallbackQr?.payload === session.qrPayload ? fallbackQr.url : '') ||
    '';
  const expiry = evaluateTelebirrSessionCountdown(session?.expiresAt ?? null, nowMs);
  const containerState = loading ? 'loading' : error ? 'error' : session ? 'ready' : 'idle';

  const handleCopyPayload = async (): Promise<void> => {
    if (!session) return;
    const target = session.receiveCode || session.qrPayload;
    try {
      await navigator.clipboard.writeText(target);
      setCopiedPayload(true);
      window.setTimeout(() => setCopiedPayload(false), 1800);
    } catch {
      setCopiedPayload(false);
    }
  };

  return (
    <section
      className="chapa-qr-container"
      data-testid="chapa-qr-container"
      data-state={containerState}
      aria-busy={loading}
      aria-live="polite"
      aria-label="Telebirr scan-to-pay QR checkout"
    >
      <div className="chapa-qr-head">
        <div className="chapa-qr-title-group">
          <div className="chapa-qr-kicker">
            <i className="fa-solid fa-qrcode" aria-hidden="true" />
            <span>Telebirr SuperApp QR Checkout</span>
          </div>
          <p className="chapa-qr-sub">
            Scan with the Ethio Telecom Telebirr app to pay this exact transaction reference.
          </p>
        </div>
        <div
          className={`tb-gateway-status is-${gatewayIndicator.status}`}
          role="status"
          aria-live="polite"
          title={gatewayIndicator.detail}
          data-testid="qr-telebirr-status"
          data-status={gatewayIndicator.status}
        >
          <span className={`tb-status-dot is-${gatewayIndicator.status}`} aria-hidden="true" />
          <strong>{gatewayIndicator.label}</strong>
          <span className="tb-status-sub">
            {gatewayIndicator.status === 'live' ? 'Merchant Gateway' : 'Gateway Pending'}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="chapa-qr-loading" role="status" data-testid="chapa-qr-loading">
          <div className="chapa-qr-skeleton" aria-hidden="true">
            <div className="chapa-qr-scan-line" />
            <i className="fa-solid fa-spinner fa-spin" />
          </div>
          <div className="chapa-qr-loading-copy">
            <strong>Generating unique Telebirr QR code…</strong>
            <span>Signing transaction reference and preparing SuperApp scan payload</span>
          </div>
        </div>
      ) : error ? (
        <div className="chapa-qr-error" role="alert" data-testid="chapa-qr-error">
          <div className="chapa-alert chapa-alert-error">
            <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
            <span>
              <code>[{error.code}]</code> {error.message}
            </span>
          </div>
          <button
            type="button"
            className="btn-primary"
            onClick={onRegenerate}
            data-testid="telebirr-qr-retry"
          >
            <i className="fa-solid fa-rotate-right" aria-hidden="true" /> Retry QR Generation
          </button>
        </div>
      ) : session ? (
        <div className="chapa-qr-body">
          <div className="chapa-qr-stage">
            <div className="chapa-qr-frame">
              {resolvedQrSrc ? (
                <img
                  src={resolvedQrSrc}
                  alt={`Telebirr QR code for transaction ${session.txRef}`}
                  width={220}
                  height={220}
                  className="chapa-qr-img"
                  data-testid="telebirr-qr-image"
                />
              ) : (
                <div className="chapa-qr-skeleton" aria-label="Rendering QR graphic">
                  <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
                </div>
              )}
              {expiry.expired && (
                <div className="chapa-qr-expired-overlay">
                  <span>Session Expired</span>
                  <button type="button" className="btn-primary" onClick={onRegenerate}>
                    Refresh QR
                  </button>
                </div>
              )}
            </div>
            <div className="chapa-qr-scan-caption">
              <span>{session.serviceName}</span>
              <span aria-hidden="true">·</span>
              <strong className="tb-tabular">{formatEtb(session.amount)}</strong>
            </div>
          </div>

          <div className="chapa-qr-meta">
            <div
              className={`tb-session-timer ${expiry.expired ? 'is-expired' : expiry.isUrgent ? 'is-urgent' : ''}`}
              data-testid="qr-session-timer"
              data-expired={expiry.expired ? 'true' : 'false'}
            >
              <div className="tb-session-timer-row">
                <span className="tb-session-timer-label">
                  <i
                    className={`fa-solid ${expiry.expired ? 'fa-hourglass-end' : 'fa-hourglass-half'}`}
                    aria-hidden="true"
                  />{' '}
                  {expiry.expired ? 'Session Expired' : 'QR Session Expires'}
                </span>
                <strong className="tb-session-timer-clock tb-tabular" data-testid="qr-session-clock">
                  {expiry.label}
                </strong>
              </div>
              <div className="tb-session-progress" aria-hidden="true">
                <div className="tb-session-progress-bar" style={{ width: `${expiry.progressPct}%` }} />
              </div>
            </div>

            {expiry.expired && (
              <div
                className="chapa-alert chapa-alert-error tb-session-expired-alert"
                role="alert"
                data-testid="chapa-qr-expired-alert"
              >
                <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
                <span>
                  <strong>Session Expired</strong> — Your 10-minute Telebirr QR session has timed out. Generate a new QR code to continue.
                </span>
              </div>
            )}

            <dl className="chapa-qr-specs">
              <div>
                <dt>Transaction Ref</dt>
                <dd>
                  <code data-testid="telebirr-qr-txref">{session.txRef}</code>
                </dd>
              </div>
              <div>
                <dt>QR Validity</dt>
                <dd className={`tb-tabular ${expiry.expired ? 'is-expired' : ''}`}>
                  {expiry.expired ? 'Session Expired' : `Expires in ${expiry.label}`}
                </dd>
              </div>
              <div>
                <dt>Payment Rail</dt>
                <dd>{session.mode === 'live' ? 'Telebirr Fabric QR' : 'Telebirr QR Preview'}</dd>
              </div>
              <div>
                <dt>Payable Amount</dt>
                <dd className="tb-tabular">{formatEtb(session.amount)}</dd>
              </div>
              {session.receiveCode && (
                <div>
                  <dt>Telebirr Receive Code</dt>
                  <dd>
                    <code>{session.receiveCode}</code>
                  </dd>
                </div>
              )}
              {session.merchantCodeMasked && (
                <div>
                  <dt>Merchant ID</dt>
                  <dd className="tb-tabular">{session.merchantCodeMasked}</dd>
                </div>
              )}
            </dl>

            <div className="chapa-qr-actions">
              <button
                type="button"
                className="chapa-secondary-btn"
                disabled={expiry.expired}
                onClick={() => void handleCopyPayload()}
                data-testid="telebirr-qr-copy"
              >
                <i className={`fa-solid ${copiedPayload ? 'fa-check' : 'fa-copy'}`} aria-hidden="true" />{' '}
                {copiedPayload ? 'Copied Scan Code' : 'Copy Scan Code'}
              </button>
              <button
                type="button"
                className="chapa-secondary-btn"
                onClick={onRegenerate}
                data-testid="telebirr-qr-regenerate"
              >
                <i className="fa-solid fa-arrows-rotate" aria-hidden="true" /> Generate New QR
              </button>
            </div>

            <div className="tb-poll-bar" role="status" aria-live="polite" data-testid="qr-telebirr-poll-status">
              <div className="tb-poll-info">
                <i
                  className={
                    pollReason === 'active'
                      ? 'fa-solid fa-arrows-rotate'
                      : pollReason === 'paused'
                        ? 'fa-solid fa-pause'
                        : 'fa-solid fa-circle-info'
                  }
                  aria-hidden="true"
                />
                <span className="tb-tabular">
                  {pollReason === 'active'
                    ? `Auto-checking Telebirr every 5s · Next check in ${pollCountdownSec}s${pollAttempts > 0 ? ` · Checks: ${pollAttempts}` : ''}`
                    : pollReason === 'expired'
                      ? 'Session Expired · Automatic status checks stopped.'
                      : pollReason === 'paused'
                        ? 'Automatic 5s status check paused.'
                        : 'Automatic status polling stopped.'}
                </span>
              </div>
              {(pollReason === 'active' || pollReason === 'paused') && (
                <button
                  type="button"
                  className="tb-poll-toggle"
                  onClick={onTogglePollPause}
                  data-testid="qr-telebirr-poll-toggle"
                >
                  {pollPaused ? 'Resume 5s check' : 'Pause'}
                </button>
              )}
            </div>

            <div className="chapa-qr-footer-links">
              <button
                type="button"
                className="chapa-secondary-btn"
                disabled={verifying || expiry.expired}
                onClick={onVerifyNow}
                data-testid="telebirr-qr-verify-btn"
              >
                {verifying ? 'Checking Status…' : 'Check Payment Status'}
              </button>
              {session.checkoutUrl && (
                <button
                  type="button"
                  className="btn-primary chapa-proceed-btn chapa-qr-open-btn"
                  disabled={expiry.expired}
                  onClick={() => {
                    if (!expiry.expired && session.checkoutUrl) {
                      window.location.assign(session.checkoutUrl);
                    }
                  }}
                  data-testid="telebirr-qr-open-link"
                >
                  <i className="fa-solid fa-lock" aria-hidden="true" />{' '}
                  {expiry.expired ? 'Session Expired — Pay Disabled' : 'Pay via Telebirr Checkout'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : (
        <div className="chapa-qr-idle">
          <p>Create a transaction-specific QR code for any Telebirr mobile app to scan.</p>
          <button
            type="button"
            className="btn-primary"
            onClick={onRegenerate}
            data-testid="telebirr-qr-generate-btn"
          >
            <i className="fa-solid fa-qrcode" aria-hidden="true" /> Generate Telebirr QR Code
          </button>
        </div>
      )}
    </section>
  );
}
