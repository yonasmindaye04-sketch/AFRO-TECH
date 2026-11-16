import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  formatEtb,
  PAYABLE_SERVICES,
  type PaymentPlanMode,
  type ServicePaymentErrors,
} from '../utils/serviceCheckout';
import {
  buildTelebirrOrderSummary,
  normalizeTelebirrMerchantConfig,
  TELEBIRR_NOTE_MAX_LEN,
  validateTelebirrDirectForm,
  type TelebirrMerchantConfig,
} from '../utils/telebirrCheckout';
import { saveRecentInvoiceContext } from '../utils/invoiceHistory';
import { celebrateVerifiedPayment } from '../utils/paymentCelebration';

interface TelebirrH5Session {
  tx_ref: string;
  amount: number;
  currency: string;
  mode: 'live' | 'sandbox';
  checkout_url: string;
  service_name: string;
  prepay_id: string | null;
  receive_code: string | null;
  merchant_code_masked: string | null;
}

interface TelebirrInvoiceMeta {
  invoice_number: string;
  tx_ref: string;
  recipient_email: string | null;
  delivery_status: 'sent' | 'sandbox_outbox' | 'failed' | 'skipped_no_email';
  delivery_reason?: string;
  send_count?: number;
  filename: string;
  pdf_url: string;
}

interface TelebirrVerifiedReceipt {
  tx_ref: string;
  amount: number;
  currency: string;
  description?: string;
  customer_name?: string;
  customer_email?: string;
  payer_reference?: string | null;
  invoice?: TelebirrInvoiceMeta | null;
}

export interface TelebirrPayPanelProps {
  selectedServiceId?: number | null;
  onSelectService?: (serviceId: number) => void;
  returnPath?: string;
  onStatusToast?: (type: 'success' | 'error', message: string) => void;
  onTransactionTracked?: (txRef: string, email?: string) => void;
}

export function TelebirrPayPanel({
  selectedServiceId,
  onSelectService,
  returnPath = '/services',
  onStatusToast,
  onTransactionTracked,
}: TelebirrPayPanelProps): JSX.Element {
  const [localServiceId, setLocalServiceId] = useState<number>(PAYABLE_SERVICES[0].id);
  const serviceId =
    selectedServiceId && PAYABLE_SERVICES.some((s) => s.id === selectedServiceId)
      ? selectedServiceId
      : localServiceId;

  const [paymentPlan, setPaymentPlan] = useState<PaymentPlanMode>('deposit');
  const [customAmount, setCustomAmount] = useState('');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<ServicePaymentErrors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [pendingNotice, setPendingNotice] = useState<string | null>(null);
  const [initialReturnTxRef] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const txRef = params.get('tx_ref') || params.get('trx_ref') || '';
    const provider = params.get('provider') || '';
    if (txRef && (provider === 'telebirr' || txRef.startsWith('TB-'))) {
      return txRef;
    }
    return null;
  });
  const [submitting, setSubmitting] = useState(false);
  const [verifying, setVerifying] = useState(() => Boolean(initialReturnTxRef));
  const [resendingInvoice, setResendingInvoice] = useState(false);
  const [invoiceNotice, setInvoiceNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<TelebirrMerchantConfig>(() => normalizeTelebirrMerchantConfig(null));
  const [session, setSession] = useState<TelebirrH5Session | null>(null);
  const [verifiedReceipt, setVerifiedReceipt] = useState<TelebirrVerifiedReceipt | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/telebirr/config')
      .then((res) => res.json().catch(() => null))
      .then((data) => {
        if (!cancelled && data?.ok) {
          setConfig(normalizeTelebirrMerchantConfig(data));
        }
      })
      .catch(() => {
        // Keep sandbox fallback cleanly if config check is offline
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applyVerificationPayload = (
    txRef: string,
    resOk: boolean,
    data: Record<string, unknown> | null,
    silentPending: boolean,
  ): void => {
    if (!resOk || !data?.ok) {
      if (!silentPending) {
        setServerError(
          typeof data?.message === 'string'
            ? data.message
            : 'Unable to verify Telebirr transaction status.',
        );
      }
      return;
    }

    if (data.verified) {
      const order = (data.order && typeof data.order === 'object' ? data.order : {}) as Record<string, unknown>;
      const invoiceMeta = (data.invoice || order.invoice || null) as TelebirrInvoiceMeta | null;
      const resolvedRef = typeof order.tx_ref === 'string' && order.tx_ref ? order.tx_ref : txRef;
      const resolvedEmail =
        (typeof order.customer_email === 'string' && order.customer_email) || email.trim() || undefined;

      saveRecentInvoiceContext({ email: resolvedEmail, txRef: resolvedRef });
      onTransactionTracked?.(resolvedRef, resolvedEmail);
      setSession(null);
      setVerifiedReceipt({
        tx_ref: resolvedRef,
        amount: Number(order.amount ?? data.amount ?? 0),
        currency:
          (typeof order.currency === 'string' && order.currency) ||
          (typeof data.currency === 'string' && data.currency) ||
          'ETB',
        description: typeof order.description === 'string' ? order.description : undefined,
        customer_name: typeof order.customer_name === 'string' ? order.customer_name : undefined,
        customer_email: resolvedEmail,
        payer_reference: typeof order.payer_reference === 'string' ? order.payer_reference : null,
        invoice: invoiceMeta,
      });
      celebrateVerifiedPayment({
        txRef: resolvedRef,
        verified: true,
        status: typeof order.status === 'string' ? order.status : 'settled',
      });
      onStatusToast?.('success', `Telebirr H5 payment ${resolvedRef} verified & PDF invoice ready.`);
    } else if (!silentPending) {
      setPendingNotice(
        `Order ${txRef} status is ${String(data.status || 'PENDING').toUpperCase()}. Authorize payment on Telebirr H5 checkout, then verify again.`,
      );
    }
  };

  const verifyTelebirrTransaction = async (txRef: string, silentPending = false): Promise<void> => {
    if (!txRef) return;
    setVerifying(true);
    setPendingNotice(null);
    setServerError(null);
    try {
      const res = await fetch(`/api/telebirr/verify/${encodeURIComponent(txRef)}`);
      const data = await res.json().catch(() => null);
      applyVerificationPayload(txRef, res.ok, data, silentPending);
    } catch {
      if (!silentPending) {
        setServerError('Could not reach Telebirr verification endpoint.');
      }
    } finally {
      setVerifying(false);
    }
  };

  useEffect(() => {
    if (!initialReturnTxRef) return;
    let cancelled = false;
    fetch(`/api/telebirr/verify/${encodeURIComponent(initialReturnTxRef)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!cancelled) {
          applyVerificationPayload(initialReturnTxRef, res.ok, data, true);
        }
      })
      .catch(() => {
        // Ignore transient return verification error cleanly
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReturnTxRef]);

  const activePackage = useMemo(
    () => PAYABLE_SERVICES.find((s) => s.id === serviceId) ?? PAYABLE_SERVICES[0],
    [serviceId],
  );

  const orderSummary = useMemo(
    () =>
      buildTelebirrOrderSummary({
        serviceId,
        paymentPlan,
        customAmount,
        notes,
      }),
    [serviceId, paymentPlan, customAmount, notes],
  );

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setServerError(null);
    setPendingNotice(null);

    const validation = validateTelebirrDirectForm({
      serviceId,
      paymentPlan,
      customAmount,
      fullName,
      email,
      phone,
      notes,
    });

    if (!validation.valid) {
      setErrors(validation.errors);
      onStatusToast?.('error', 'Please complete the required Telebirr order details.');
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch('/api/telebirr/initialize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId,
          serviceName: activePackage.name,
          paymentPlan,
          amount: validation.amount,
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phone.trim(),
          notes: validation.sanitizedNote,
          returnPath,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.checkout_url) {
        const msg = data?.message || 'Telebirr H5 pre-order initialization failed.';
        setServerError(msg);
        onStatusToast?.('error', msg);
        return;
      }

      saveRecentInvoiceContext({ email: email.trim(), txRef: data.tx_ref });
      onTransactionTracked?.(data.tx_ref, email.trim());
      setVerifiedReceipt(null);
      setSession({
        tx_ref: data.tx_ref,
        amount: Number(data.amount ?? validation.amount),
        currency: data.currency || 'ETB',
        mode: data.mode === 'live' ? 'live' : 'sandbox',
        checkout_url: data.checkout_url,
        service_name: activePackage.name,
        prepay_id: data.prepay_id || null,
        receive_code: data.receive_code || null,
        merchant_code_masked: data.merchant_code_masked || config.merchantCodeMasked,
      });
      onStatusToast?.('success', `Telebirr H5 pre-order ${data.tx_ref} ready.`);
    } catch {
      const msg = 'Telebirr payment service is unreachable. Please try again.';
      setServerError(msg);
      onStatusToast?.('error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleResendInvoice = async (): Promise<void> => {
    if (!verifiedReceipt) return;
    setResendingInvoice(true);
    setInvoiceNotice(null);
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(verifiedReceipt.tx_ref)}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: verifiedReceipt.invoice?.recipient_email || verifiedReceipt.customer_email || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = data?.message || 'Unable to resend PDF invoice email.';
        setInvoiceNotice(msg);
        onStatusToast?.('error', msg);
        return;
      }
      setVerifiedReceipt((prev) => (prev ? { ...prev, invoice: data.invoice } : prev));
      const msg =
        data.invoice?.delivery_status === 'sent'
          ? `PDF invoice emailed to ${data.invoice.recipient_email}.`
          : `PDF invoice queued in outbox (${data.invoice.recipient_email}).`;
      setInvoiceNotice(msg);
      onStatusToast?.('success', msg);
    } catch {
      setInvoiceNotice('Could not reach invoice dispatch service.');
    } finally {
      setResendingInvoice(false);
    }
  };

  return (
    <div className="tb-panel" data-testid="telebirr-dedicated-panel">
      {/* Telebirr Merchant Credential & H5 Protocol Bar */}
      <div className="tb-merchant-bar" data-testid="telebirr-merchant-bar">
        <div className="tb-merchant-head">
          <div className="tb-merchant-title">
            <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />
            <span>Telebirr Direct H5 Checkout</span>
          </div>
          <span className={`tb-mode-text ${config.mode}`}>
            {config.mode === 'live' ? 'Live Merchant Credentials' : 'H5 Sandbox Preview'}
          </span>
        </div>
        <div className="tb-meta-line">
          <span>Ethio Telecom Fabric API</span>
          <span aria-hidden="true">·</span>
          <span>
            {config.merchantConfigured && config.merchantCodeMasked ? (
              <>
                Merchant <strong className="tb-tabular">{config.merchantCodeMasked}</strong>
              </>
            ) : (
              'Sandbox Test Shortcode'
            )}
          </span>
          <span aria-hidden="true">·</span>
          <span>RSA-PSS Signed Paygate</span>
        </div>
        <ol className="tb-flow-steps" aria-label="Telebirr H5 payment stages">
          <li>
            <strong>01.</strong> Sign Pre-Order
          </li>
          <li>
            <strong>02.</strong> Authorize in Telebirr H5
          </li>
          <li>
            <strong>03.</strong> Query &amp; PDF Receipt
          </li>
        </ol>
      </div>

      {verifying && (
        <div className="chapa-alert chapa-alert-info" role="status">
          <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
          <span>Querying Telebirr Fabric order status…</span>
        </div>
      )}

      {pendingNotice && (
        <div className="chapa-alert chapa-alert-info" role="status" data-testid="telebirr-pending-notice">
          <i className="fa-solid fa-clock" aria-hidden="true" />
          <span>{pendingNotice}</span>
        </div>
      )}

      {verifiedReceipt && (
        <div className="chapa-receipt-box" role="status" data-testid="telebirr-verified-receipt">
          <div className="chapa-receipt-top">
            <i className="fa-solid fa-circle-check" aria-hidden="true" />
            <div>
              <strong>Telebirr H5 Payment Confirmed</strong>
              <span>
                {verifiedReceipt.tx_ref} · {formatEtb(verifiedReceipt.amount)}
              </span>
            </div>
          </div>
          {verifiedReceipt.description && (
            <p className="chapa-receipt-meta">
              Service: {verifiedReceipt.description}
              {verifiedReceipt.payer_reference ? ` · Telebirr Voucher: ${verifiedReceipt.payer_reference}` : ''}
            </p>
          )}
          <div className="invoice-status-card" data-testid="telebirr-invoice-card">
            <div className="invoice-status-head">
              <div>
                <strong>
                  <i className="fa-solid fa-file-pdf" aria-hidden="true" />{' '}
                  {verifiedReceipt.invoice?.invoice_number || `Invoice (${verifiedReceipt.tx_ref})`}
                </strong>
                <span>
                  {verifiedReceipt.invoice?.delivery_status === 'sent'
                    ? `Emailed to ${verifiedReceipt.invoice.recipient_email}`
                    : verifiedReceipt.invoice?.delivery_status === 'sandbox_outbox'
                      ? `PDF ready · Outbox queued for ${verifiedReceipt.invoice.recipient_email}`
                      : verifiedReceipt.invoice?.delivery_reason || 'PDF invoice generated automatically'}
                </span>
              </div>
              {verifiedReceipt.invoice?.send_count ? (
                <small className="invoice-count-tag">Sent ×{verifiedReceipt.invoice.send_count}</small>
              ) : null}
            </div>
            <div className="invoice-status-actions">
              <a
                href={verifiedReceipt.invoice?.pdf_url || `/api/invoices/${encodeURIComponent(verifiedReceipt.tx_ref)}/pdf`}
                download={verifiedReceipt.invoice?.filename || `${verifiedReceipt.tx_ref}.pdf`}
                className="invoice-pdf-btn"
                data-testid="telebirr-invoice-download"
              >
                <i className="fa-solid fa-download" aria-hidden="true" /> Download PDF Invoice
              </a>
              <button
                type="button"
                className="invoice-resend-btn"
                disabled={resendingInvoice}
                onClick={() => void handleResendInvoice()}
              >
                <i className="fa-solid fa-paper-plane" aria-hidden="true" />{' '}
                {resendingInvoice ? 'Sending…' : 'Resend Email'}
              </button>
            </div>
            {invoiceNotice && <p className="invoice-feedback">{invoiceNotice}</p>}
          </div>
        </div>
      )}

      {session ? (
        <div className="tb-h5-card" role="status" data-testid="telebirr-h5-session">
          <div className="tb-h5-head">
            <div>
              <div className="chapa-session-kicker">Telebirr H5 Pre-Order Signed</div>
              <h4>{session.service_name}</h4>
            </div>
            <div className="tb-h5-amount tb-tabular">{formatEtb(session.amount)}</div>
          </div>

          <div className="tb-h5-details">
            <div>
              <span>Order Reference</span>
              <code>{session.tx_ref}</code>
            </div>
            <div>
              <span>Gateway Host</span>
              <code>{session.mode === 'live' ? config.webGatewayHost : 'Local H5 Paygate'}</code>
            </div>
            {session.prepay_id && (
              <div>
                <span>Fabric Prepay ID</span>
                <code>{session.prepay_id}</code>
              </div>
            )}
            {session.receive_code && (
              <div>
                <span>Receive Code</span>
                <code>{session.receive_code}</code>
              </div>
            )}
          </div>

          <p className="chapa-session-hint">
            {session.mode === 'live'
              ? 'Your RSA-PSS signed Telebirr H5 checkout URL is ready. Continue to authorize in the Telebirr SuperApp or web paygate, then return for automatic verification.'
              : 'Open the Telebirr H5 test checkout below to simulate wallet authorization, or verify payment status directly.'}
          </p>

          {serverError && (
            <div className="chapa-alert chapa-alert-error" role="alert">
              <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
              <span>{serverError}</span>
            </div>
          )}

          <div className="chapa-session-actions">
            <a
              href={session.checkout_url}
              className="btn-primary chapa-proceed-btn"
              data-testid="telebirr-h5-launch"
            >
              <i className="fa-solid fa-lock" aria-hidden="true" /> Open Telebirr H5 Checkout ({formatEtb(session.amount)})
            </a>
            <div className="tb-secondary-row">
              <button
                type="button"
                className="chapa-secondary-btn"
                disabled={verifying}
                onClick={() => void verifyTelebirrTransaction(session.tx_ref, false)}
                data-testid="telebirr-verify-btn"
              >
                {verifying ? 'Checking…' : 'Check Payment Status'}
              </button>
              <button
                type="button"
                className="chapa-secondary-btn"
                onClick={() => {
                  setSession(null);
                  setPendingNotice(null);
                  setServerError(null);
                }}
              >
                Edit Order
              </button>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>
          <div className="form-group">
            <label htmlFor="tb-pay-service">Digital Service Package</label>
            <select
              id="tb-pay-service"
              className="chapa-select"
              value={serviceId}
              onChange={(e) => {
                const nextId = Number(e.target.value);
                setLocalServiceId(nextId);
                onSelectService?.(nextId);
                setErrors((prev) => ({ ...prev, amount: undefined }));
              }}
            >
              {PAYABLE_SERVICES.map((svc) => (
                <option key={svc.id} value={svc.id}>
                  {svc.name} ({svc.priceRangeLabel})
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <span className="chapa-field-caption">Payment Option</span>
            <div className="chapa-plan-grid" role="radiogroup" aria-label="Telebirr payment option">
              <button
                type="button"
                role="radio"
                aria-checked={paymentPlan === 'deposit'}
                className={`chapa-plan-btn ${paymentPlan === 'deposit' ? 'active' : ''}`}
                onClick={() => {
                  setPaymentPlan('deposit');
                  setErrors((prev) => ({ ...prev, amount: undefined }));
                }}
              >
                <span className="chapa-plan-name">40% Project Deposit</span>
                <span className="chapa-plan-price">{formatEtb(activePackage.depositAmountEtb)}</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={paymentPlan === 'full'}
                className={`chapa-plan-btn ${paymentPlan === 'full' ? 'active' : ''}`}
                onClick={() => {
                  setPaymentPlan('full');
                  setErrors((prev) => ({ ...prev, amount: undefined }));
                }}
              >
                <span className="chapa-plan-name">Full Starting Rate</span>
                <span className="chapa-plan-price">{formatEtb(activePackage.basePriceEtb)}</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={paymentPlan === 'custom'}
                className={`chapa-plan-btn ${paymentPlan === 'custom' ? 'active' : ''}`}
                onClick={() => setPaymentPlan('custom')}
              >
                <span className="chapa-plan-name">Custom Quote</span>
                <span className="chapa-plan-price">Enter ETB</span>
              </button>
            </div>
          </div>

          {paymentPlan === 'custom' && (
            <div className={`form-group ${errors.amount ? 'has-error' : ''}`}>
              <label htmlFor="tb-custom-amount">
                Amount in ETB <span className="req">*</span>
              </label>
              <input
                id="tb-custom-amount"
                type="number"
                min={50}
                max={5000000}
                step="1"
                placeholder="e.g. 12000"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setErrors((prev) => ({ ...prev, amount: undefined }));
                }}
                aria-invalid={Boolean(errors.amount)}
                aria-describedby={errors.amount ? 'tb-amount-error' : undefined}
                className={errors.amount ? 'input-error' : ''}
              />
              {errors.amount && (
                <span id="tb-amount-error" className="field-error" role="alert">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {errors.amount}
                </span>
              )}
            </div>
          )}

          <div className="form-row">
            <div className={`form-group ${errors.fullName ? 'has-error' : ''}`}>
              <label htmlFor="tb-full-name">
                Full Name <span className="req">*</span>
              </label>
              <input
                id="tb-full-name"
                type="text"
                placeholder="Abebe Bikila"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setErrors((prev) => ({ ...prev, fullName: undefined }));
                }}
                aria-invalid={Boolean(errors.fullName)}
                aria-describedby={errors.fullName ? 'tb-name-error' : undefined}
                className={errors.fullName ? 'input-error' : ''}
              />
              {errors.fullName && (
                <span id="tb-name-error" className="field-error" role="alert">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {errors.fullName}
                </span>
              )}
            </div>

            <div className={`form-group ${errors.email ? 'has-error' : ''}`}>
              <label htmlFor="tb-email">
                Receipt Email <span className="req">*</span>
              </label>
              <input
                id="tb-email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrors((prev) => ({ ...prev, email: undefined }));
                }}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'tb-email-error' : undefined}
                className={errors.email ? 'input-error' : ''}
              />
              {errors.email && (
                <span id="tb-email-error" className="field-error" role="alert">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {errors.email}
                </span>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className={`form-group ${errors.phone ? 'has-error' : ''}`}>
              <label htmlFor="tb-phone">
                Telebirr Wallet Phone <span className="chapa-optional">(optional)</span>
              </label>
              <input
                id="tb-phone"
                type="tel"
                placeholder="+251 911 234 567"
                value={phone}
                onChange={(e) => {
                  setPhone(e.target.value);
                  setErrors((prev) => ({ ...prev, phone: undefined }));
                }}
                aria-invalid={Boolean(errors.phone)}
                aria-describedby={errors.phone ? 'tb-phone-error' : 'tb-phone-hint'}
                className={errors.phone ? 'input-error' : ''}
              />
              {errors.phone ? (
                <span id="tb-phone-error" className="field-error" role="alert">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {errors.phone}
                </span>
              ) : (
                <span id="tb-phone-hint" className="pgs-field-hint">
                  Ethio Telecom 09xx wallet number for receipt &amp; customer matching.
                </span>
              )}
            </div>

            <div className="form-group">
              <label htmlFor="tb-notes">
                Order Note <span className="chapa-optional">(max {TELEBIRR_NOTE_MAX_LEN} chars)</span>
              </label>
              <input
                id="tb-notes"
                type="text"
                maxLength={TELEBIRR_NOTE_MAX_LEN}
                placeholder="Milestone or quote ref"
                value={notes}
                onChange={(e) => setNotes(e.target.value.slice(0, TELEBIRR_NOTE_MAX_LEN))}
              />
              <span className="pgs-field-hint">
                {notes.length}/{TELEBIRR_NOTE_MAX_LEN} chars · Telebirr title: {orderSummary.fabricTitlePreview}
              </span>
            </div>
          </div>

          {serverError && (
            <div className="chapa-alert chapa-alert-error" role="alert">
              <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
              <span>{serverError}</span>
            </div>
          )}

          <button
            type="submit"
            className="btn-primary btn-full"
            disabled={submitting}
            data-testid="telebirr-h5-submit"
          >
            <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" />{' '}
            {submitting
              ? 'Signing Telebirr H5 Pre-Order…'
              : `Pay ${orderSummary.formattedAmount} via Telebirr H5`}
          </button>
        </form>
      )}
    </div>
  );
}
