import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  formatEtb,
  GATEWAY_REQUIREMENTS,
  PAYABLE_SERVICES,
  resolvePayableAmount,
  SERVICE_PAYMENT_PROVIDERS,
  validateServicePaymentForm,
  type PaymentPlanMode,
  type ServicePaymentErrors,
  type ServicePaymentProvider,
} from '../utils/serviceCheckout';
import { PaymentGatewaySwitcher } from './PaymentGatewaySwitcher';
import { TelebirrPayPanel } from './TelebirrPayPanel';
import { InvoiceHistory } from './InvoiceHistory';
import { saveRecentInvoiceContext } from '../utils/invoiceHistory';
import { celebrateVerifiedPayment } from '../utils/paymentCelebration';

interface CheckoutSession {
  provider: ServicePaymentProvider;
  tx_ref: string;
  amount: number;
  currency: string;
  mode: 'live' | 'sandbox';
  checkout_url: string;
  service_name: string;
  customer_message?: string;
}

interface InvoiceReceiptMeta {
  invoice_number: string;
  tx_ref: string;
  provider: ServicePaymentProvider;
  provider_label: string;
  recipient_email: string | null;
  delivery_status: 'sent' | 'sandbox_outbox' | 'failed' | 'skipped_no_email';
  delivery_transport: string;
  delivery_reason?: string;
  last_sent_at?: string | null;
  send_count?: number;
  filename: string;
  size_bytes?: number;
  pdf_url: string;
}

interface VerifiedOrderReceipt {
  provider: ServicePaymentProvider;
  tx_ref: string;
  status: string;
  amount: number;
  currency: string;
  description?: string;
  customer_name?: string;
  customer_email?: string;
  chapa_reference?: string | null;
  payer_reference?: string | null;
  invoice?: InvoiceReceiptMeta | null;
}

interface ServicePayNowProps {
  selectedServiceId?: number | null;
  onSelectService?: (serviceId: number) => void;
  returnPath?: string;
  onStatusToast?: (type: 'success' | 'error', message: string) => void;
}

function resolveInitialProvider(): ServicePaymentProvider {
  const params = new URLSearchParams(window.location.search);
  const qp = params.get('provider');
  if (qp === 'telebirr' || qp === 'mpesa' || qp === 'chapa') return qp;
  const tx = params.get('tx_ref') || params.get('trx_ref') || '';
  if (tx.startsWith('TB-')) return 'telebirr';
  if (tx.startsWith('MPESA-')) return 'mpesa';
  return 'chapa';
}

function resolveInitialPayView(): 'checkout' | 'telebirr' | 'history' {
  const params = new URLSearchParams(window.location.search);
  if (params.get('provider') === 'telebirr' || (params.get('tx_ref') || '').startsWith('TB-')) {
    return 'telebirr';
  }
  return 'checkout';
}

export function ServicePayNow({
  selectedServiceId,
  onSelectService,
  returnPath = '/#contact-section',
  onStatusToast,
}: ServicePayNowProps): JSX.Element {
  const [provider, setProvider] = useState<ServicePaymentProvider>(resolveInitialProvider);
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
  const [submitting, setSubmitting] = useState(false);
  const [session, setSession] = useState<CheckoutSession | null>(null);
  const [verifiedReceipt, setVerifiedReceipt] = useState<VerifiedOrderReceipt | null>(null);
  const [resendingInvoice, setResendingInvoice] = useState(false);
  const [invoiceNotice, setInvoiceNotice] = useState<string | null>(null);
  const [payView, setPayView] = useState<'checkout' | 'telebirr' | 'history'>(resolveInitialPayView);
  const [trackedRefs, setTrackedRefs] = useState<string[]>([]);
  const [verifyingState, setVerifyingState] = useState<{ txRef: string; provider: ServicePaymentProvider } | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const txRef = params.get('tx_ref') || params.get('trx_ref');
    if (!txRef) return null;
    const initProv = resolveInitialProvider();
    if (initProv === 'telebirr') return null;
    return { txRef, provider: initProv };
  });

  useEffect(() => {
    if (!verifyingState) return;

    let cancelled = false;
    const provOption =
      SERVICE_PAYMENT_PROVIDERS.find((p) => p.id === verifyingState.provider) ?? SERVICE_PAYMENT_PROVIDERS[0];

    fetch(`${provOption.verifyEndpointPrefix}/${encodeURIComponent(verifyingState.txRef)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok || cancelled) return;
        const resolvedProv =
          (data.order?.provider as ServicePaymentProvider | undefined) ?? verifyingState.provider;
        const provLabel =
          SERVICE_PAYMENT_PROVIDERS.find((p) => p.id === resolvedProv)?.label ?? 'Gateway';
        const invoiceMeta: InvoiceReceiptMeta | null = data.invoice || data.order?.invoice || null;
        if (data.verified && data.order) {
          saveRecentInvoiceContext({
            email: data.order.customer_email,
            txRef: data.order.tx_ref,
          });
          setTrackedRefs((prev) => (prev.includes(data.order.tx_ref) ? prev : [data.order.tx_ref, ...prev]));
          setVerifiedReceipt({
            provider: resolvedProv,
            tx_ref: data.order.tx_ref,
            status: 'settled',
            amount: data.order.amount,
            currency: data.order.currency || 'ETB',
            description: data.order.description,
            customer_name: data.order.customer_name,
            customer_email: data.order.customer_email,
            chapa_reference: data.order.chapa_reference,
            payer_reference: data.order.payer_reference,
            invoice: invoiceMeta,
          });
          celebrateVerifiedPayment({
            txRef: data.order.tx_ref,
            verified: true,
            status: data.order.status || 'settled',
          });
          onStatusToast?.('success', `${provLabel} payment ${data.order.tx_ref} verified & PDF invoice ready.`);
        } else if (data.verified) {
          setVerifiedReceipt({
            provider: resolvedProv,
            tx_ref: verifyingState.txRef,
            status: 'settled',
            amount: Number(data.amount || 0),
            currency: data.currency || 'ETB',
            invoice: invoiceMeta,
          });
          celebrateVerifiedPayment({
            txRef: verifyingState.txRef,
            verified: true,
            status: data.status || 'settled',
          });
        }
      })
      .catch(() => {
        // Ignore transient verification error cleanly
      })
      .finally(() => {
        if (!cancelled) setVerifyingState(null);
      });

    return () => {
      cancelled = true;
    };
  }, [verifyingState, onStatusToast]);

  const activeProvider = useMemo(
    () => SERVICE_PAYMENT_PROVIDERS.find((p) => p.id === provider) ?? SERVICE_PAYMENT_PROVIDERS[0],
    [provider],
  );

  const activePackage = useMemo(
    () => PAYABLE_SERVICES.find((s) => s.id === serviceId) ?? PAYABLE_SERVICES[0],
    [serviceId],
  );

  const payableAmount = useMemo(() => {
    const raw = resolvePayableAmount(serviceId, paymentPlan, customAmount);
    return GATEWAY_REQUIREMENTS[provider].wholeEtbOnly ? Math.round(raw) : raw;
  }, [provider, serviceId, paymentPlan, customAmount]);

  const handleSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setServerError(null);

    const validation = validateServicePaymentForm({
      provider,
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
      onStatusToast?.('error', 'Please review the highlighted payment details.');
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      const res = await fetch(activeProvider.initEndpoint, {
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
          notes: notes.trim(),
          returnPath,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.checkout_url) {
        const msg = data?.message || `Unable to start ${activeProvider.label} checkout. Please try again.`;
        setServerError(msg);
        onStatusToast?.('error', msg);
        return;
      }

      saveRecentInvoiceContext({ email: email.trim(), txRef: data.tx_ref });
      setTrackedRefs((prev) => (prev.includes(data.tx_ref) ? prev : [data.tx_ref, ...prev]));
      setSession({
        provider,
        tx_ref: data.tx_ref,
        amount: data.amount,
        currency: data.currency || 'ETB',
        mode: data.mode,
        checkout_url: data.checkout_url,
        service_name: activePackage.name,
        customer_message: data.customer_message,
      });
      setVerifiedReceipt(null);
      onStatusToast?.('success', `${activeProvider.label} session ${data.tx_ref} ready. Proceed to complete payment.`);
    } catch {
      const msg = 'Payment service unreachable. Check your connection and try again.';
      setServerError(msg);
      onStatusToast?.('error', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const receiptProviderLabel = verifiedReceipt
    ? SERVICE_PAYMENT_PROVIDERS.find((p) => p.id === verifiedReceipt.provider)?.label ?? 'Gateway'
    : 'Chapa';

  const sessionProviderLabel = session
    ? SERVICE_PAYMENT_PROVIDERS.find((p) => p.id === session.provider)?.label ?? 'Gateway'
    : activeProvider.label;

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
    <div className="chapa-pay-panel" id="pay-now" data-testid="service-pay-now">
      <div className="chapa-pay-header">
        <div>
          <h3 className="chapa-pay-title">
            {payView === 'history'
              ? 'Invoice History'
              : payView === 'telebirr'
                ? 'Pay via Telebirr H5'
                : `Pay Securely via ${activeProvider.label}`}
          </h3>
          <p className="chapa-pay-sub">
            {payView === 'history'
              ? 'Download past PDF receipts or resend invoice emails'
              : payView === 'telebirr'
                ? 'Ethio Telecom Fabric H5 · Existing Merchant Credentials'
                : `${activeProvider.subtitle} · Server-verified checkout`}
          </p>
        </div>
        {payView === 'checkout' ? (
          <div className="chapa-amount-readout" aria-live="polite">
            <span>Payable Total</span>
            <strong>{formatEtb(payableAmount)}</strong>
          </div>
        ) : null}
      </div>

      <div className="pay-subview-tabs" role="tablist" aria-label="Payment modes and invoice history">
        <button
          type="button"
          role="tab"
          aria-selected={payView === 'checkout'}
          className={`pay-subview-tab ${payView === 'checkout' ? 'active' : ''}`}
          onClick={() => setPayView('checkout')}
          data-testid="pay-tab-checkout"
        >
          <i className="fa-solid fa-credit-card" aria-hidden="true" /> All Gateways
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={payView === 'telebirr'}
          className={`pay-subview-tab ${payView === 'telebirr' ? 'active' : ''}`}
          onClick={() => setPayView('telebirr')}
          data-testid="pay-tab-telebirr"
        >
          <i className="fa-solid fa-mobile-screen-button" aria-hidden="true" /> Telebirr H5
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={payView === 'history'}
          className={`pay-subview-tab ${payView === 'history' ? 'active' : ''}`}
          onClick={() => setPayView('history')}
          data-testid="pay-tab-history"
        >
          <i className="fa-solid fa-file-invoice" aria-hidden="true" /> Invoice History
        </button>
      </div>

      {payView === 'history' ? (
        <InvoiceHistory
          scope="public"
          defaultEmail={email || verifiedReceipt?.customer_email || ''}
          extraTxRefs={trackedRefs}
          onStatusToast={onStatusToast}
        />
      ) : payView === 'telebirr' ? (
        <TelebirrPayPanel
          selectedServiceId={selectedServiceId}
          onSelectService={onSelectService}
          returnPath={returnPath}
          onStatusToast={onStatusToast}
          onTransactionTracked={(txRef, trackedEmail) => {
            setTrackedRefs((prev) => (prev.includes(txRef) ? prev : [txRef, ...prev]));
            if (trackedEmail && !email) setEmail(trackedEmail);
          }}
        />
      ) : (
        <>

      {verifyingState && (
        <div className="chapa-alert chapa-alert-info" role="status">
          <i className="fa-solid fa-spinner fa-spin" aria-hidden="true" />
          <span>Verifying transaction reference {verifyingState.txRef}…</span>
        </div>
      )}

      {verifiedReceipt && (
        <div className="chapa-receipt-box" role="status" data-testid="chapa-verified-receipt">
          <div className="chapa-receipt-top">
            <i className="fa-solid fa-circle-check" aria-hidden="true" />
            <div>
              <strong>Payment Confirmed via {receiptProviderLabel}</strong>
              <span>
                {verifiedReceipt.tx_ref} · {formatEtb(verifiedReceipt.amount)}
              </span>
            </div>
          </div>
          {verifiedReceipt.description && (
            <p className="chapa-receipt-meta">
              Service: {verifiedReceipt.description}
              {verifiedReceipt.payer_reference ? ` · Ref: ${verifiedReceipt.payer_reference}` : ''}
            </p>
          )}

          <div className="invoice-status-card" data-testid="service-invoice-card">
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
                <small className="invoice-count-tag">
                  Sent ×{verifiedReceipt.invoice.send_count}
                </small>
              ) : null}
            </div>
            <div className="invoice-status-actions">
              <a
                href={verifiedReceipt.invoice?.pdf_url || `/api/invoices/${encodeURIComponent(verifiedReceipt.tx_ref)}/pdf`}
                download={verifiedReceipt.invoice?.filename || `${verifiedReceipt.tx_ref}.pdf`}
                className="invoice-pdf-btn"
                data-testid="invoice-pdf-download"
              >
                <i className="fa-solid fa-download" aria-hidden="true" /> Download PDF Invoice
              </a>
              <button
                type="button"
                className="invoice-resend-btn"
                disabled={resendingInvoice}
                onClick={() => void handleResendInvoice()}
                data-testid="invoice-resend-btn"
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
        <div className="chapa-session-card" role="status" data-testid="chapa-checkout-ready">
          <div className="chapa-session-top">
            <div>
              <div className="chapa-session-kicker">{sessionProviderLabel} Checkout Session Ready</div>
              <h4>{session.service_name}</h4>
              <p className="chapa-session-meta">
                Reference: <code>{session.tx_ref}</code> · {formatEtb(session.amount)}
              </p>
            </div>
          </div>

          <p className="chapa-session-hint">
            {session.customer_message
              ? session.customer_message
              : session.mode === 'live'
                ? `Your encrypted checkout session has been created with ${sessionProviderLabel}. Continue below to authorize payment.`
                : 'Continue to the encrypted checkout page below to enter your payment authorization and receive an instant verified receipt.'}
          </p>

          <div className="chapa-session-actions">
            <a
              href={session.checkout_url}
              className="btn-primary chapa-proceed-btn"
              data-testid="chapa-proceed-link"
            >
              <i className="fa-solid fa-lock" aria-hidden="true" />{' '}
              {session.provider === 'mpesa' && session.mode === 'live'
                ? `Verify M-Pesa STK Payment (${formatEtb(session.amount)})`
                : `Continue to ${sessionProviderLabel} Checkout (${formatEtb(session.amount)})`}
            </a>
            <button
              type="button"
              className="chapa-secondary-btn"
              onClick={() => setSession(null)}
            >
              Edit Details
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleSubmit} noValidate>

          <div className="form-group">
            <label htmlFor="pay-service">Digital Service Package</label>
            <select
              id="pay-service"
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
            <div className="chapa-plan-grid" role="radiogroup" aria-label="Payment option">
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
              <label htmlFor="pay-custom-amount">
                Invoice / Milestone Amount (ETB) <span className="req">*</span>
              </label>
              <input
                id="pay-custom-amount"
                type="number"
                min={50}
                max={5000000}
                step="1"
                placeholder="e.g. 15000"
                value={customAmount}
                onChange={(e) => {
                  setCustomAmount(e.target.value);
                  setErrors((prev) => ({ ...prev, amount: undefined }));
                }}
                aria-invalid={Boolean(errors.amount)}
                aria-describedby={errors.amount ? 'pay-amount-error' : undefined}
                className={errors.amount ? 'input-error' : ''}
              />
              {errors.amount && (
                <span id="pay-amount-error" className="field-error" role="alert">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {errors.amount}
                </span>
              )}
            </div>
          )}

          <div className="form-row">
            <div className={`form-group ${errors.fullName ? 'has-error' : ''}`}>
              <label htmlFor="pay-full-name">
                Full Name <span className="req">*</span>
              </label>
              <input
                id="pay-full-name"
                type="text"
                placeholder="Abebe Bikila"
                value={fullName}
                onChange={(e) => {
                  setFullName(e.target.value);
                  setErrors((prev) => ({ ...prev, fullName: undefined }));
                }}
                aria-invalid={Boolean(errors.fullName)}
                aria-describedby={errors.fullName ? 'pay-name-error' : undefined}
                className={errors.fullName ? 'input-error' : ''}
              />
              {errors.fullName && (
                <span id="pay-name-error" className="field-error" role="alert">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {errors.fullName}
                </span>
              )}
            </div>

            <div className={`form-group ${errors.email ? 'has-error' : ''}`}>
              <label htmlFor="pay-email">
                Receipt Email <span className="req">*</span>
              </label>
              <input
                id="pay-email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setErrors((prev) => ({ ...prev, email: undefined }));
                }}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'pay-email-error' : undefined}
                className={errors.email ? 'input-error' : ''}
              />
              {errors.email && (
                <span id="pay-email-error" className="field-error" role="alert">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {errors.email}
                </span>
              )}
            </div>
          </div>

          <PaymentGatewaySwitcher
            provider={provider}
            onSelectProvider={(nextProvider) => {
              setProvider(nextProvider);
              setErrors((prev) => ({ ...prev, phone: undefined }));
              setServerError(null);
              const maxLen = GATEWAY_REQUIREMENTS[nextProvider].referenceMaxLen;
              if (notes.length > maxLen) {
                setNotes((prev) => prev.slice(0, maxLen));
              }
            }}
            serviceId={serviceId}
            paymentPlan={paymentPlan}
            customAmount={customAmount}
            fullName={fullName}
            email={email}
            phone={phone}
            notes={notes}
            errors={errors}
            onPhoneChange={(val) => {
              setPhone(val);
              setErrors((prev) => ({ ...prev, phone: undefined }));
            }}
            onNotesChange={setNotes}
          />

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
            data-testid="chapa-pay-submit"
          >
            <i className="fa-solid fa-shield-halved" aria-hidden="true" />{' '}
            {submitting
              ? `Connecting to ${activeProvider.label}…`
              : provider === 'mpesa'
                ? `Send M-Pesa Prompt · ${formatEtb(payableAmount)}`
                : `Pay ${formatEtb(payableAmount)} via ${activeProvider.label}`}
          </button>
        </form>
      )}
        </>
      )}
    </div>
  );
}
