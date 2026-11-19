import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  formatEtb,
  PAYABLE_SERVICES,
  type PaymentPlanMode,
  type ServicePaymentErrors,
} from '../utils/serviceCheckout';
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
  TELEBIRR_GATEWAY_HEARTBEAT_MS,
  TELEBIRR_MAX_POLL_ATTEMPTS,
  TELEBIRR_NOTE_MAX_LEN,
  TELEBIRR_POLL_INTERVAL_MS,
  TELEBIRR_SESSION_TTL_MS,
  validateOptionalReceiptEmail,
  validateTelebirrDirectForm,
  type TelebirrErrorLogEntry,
  type TelebirrMerchantConfig,
} from '../utils/telebirrCheckout';
import {
  fetchAndDownloadVerifiedPdfReceipt,
  PdfReceiptDownloadError,
  saveRecentInvoiceContext,
} from '../utils/invoiceHistory';
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
  expires_at: string;
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
  const [pendingReturnTxRef, setPendingReturnTxRef] = useState<string | null>(null);
  const [pollPaused, setPollPaused] = useState(false);
  const [pollAttempts, setPollAttempts] = useState(0);
  const [pollTerminalFailure, setPollTerminalFailure] = useState(false);
  const [pollCountdownSec, setPollCountdownSec] = useState(TELEBIRR_POLL_INTERVAL_MS / 1000);
  const [resendingInvoice, setResendingInvoice] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [invoiceNotice, setInvoiceNotice] = useState<string | null>(null);
  const [config, setConfig] = useState<TelebirrMerchantConfig>(() => normalizeTelebirrMerchantConfig(null));
  const [probingGateway, setProbingGateway] = useState(true);
  const [gatewayNetworkError, setGatewayNetworkError] = useState(false);
  const [session, setSession] = useState<TelebirrH5Session | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [verifiedReceipt, setVerifiedReceipt] = useState<TelebirrVerifiedReceipt | null>(null);
  const [errorLogs, setErrorLogs] = useState<TelebirrErrorLogEntry[]>([]);
  const inFlightVerifyRef = useRef(false);

  const recordBackendError = (entry: TelebirrErrorLogEntry): void => {
    setErrorLogs((prev) => appendTelebirrErrorLog(prev, entry));
  };

  useEffect(() => {
    let cancelled = false;
    const probeGatewayConfig = (): void => {
      fetch('/api/telebirr/config')
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (cancelled) return;
          if (res.ok && data?.ok) {
            setGatewayNetworkError(false);
            setConfig(normalizeTelebirrMerchantConfig(data));
          } else {
            setGatewayNetworkError(true);
            setErrorLogs((prev) =>
              appendTelebirrErrorLog(
                prev,
                extractTelebirrBackendError({
                  resStatus: res.status,
                  payload: data,
                  defaultStage: 'config',
                  fallbackMessage: `Unable to load Telebirr merchant configuration (HTTP ${res.status}).`,
                }),
              ),
            );
          }
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setGatewayNetworkError(true);
          const msg = err instanceof Error && err.message ? err.message : 'Unable to reach /api/telebirr/config.';
          setErrorLogs((prev) =>
            appendTelebirrErrorLog(
              prev,
              extractTelebirrBackendError({
                resStatus: null,
                payload: { code: 'CONFIG_NETWORK_ERROR', message: msg },
                defaultStage: 'config',
                fallbackMessage: msg,
              }),
            ),
          );
        })
        .finally(() => {
          if (!cancelled) setProbingGateway(false);
        });
    };

    probeGatewayConfig();
    const heartbeatTimer = window.setInterval(probeGatewayConfig, TELEBIRR_GATEWAY_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(heartbeatTimer);
    };
  }, []);

  const gatewayIndicator = useMemo(
    () =>
      resolveTelebirrGatewayIndicator({
        probing: probingGateway,
        config,
        networkError: gatewayNetworkError,
      }),
    [probingGateway, config, gatewayNetworkError],
  );

  const applyVerificationPayload = (
    txRef: string,
    resOk: boolean,
    resStatus: number,
    data: Record<string, unknown> | null,
    silentPending: boolean,
  ): void => {
    const outcome = classifyTelebirrVerifyOutcome(resOk, data);

    if (outcome === 'error') {
      const errEntry = extractTelebirrBackendError({
        resStatus,
        payload: data,
        defaultStage: 'query_order',
        fallbackMessage: `Telebirr verification failed (HTTP ${resStatus || 502}).`,
        txRef,
      });
      recordBackendError(errEntry);
      if (!silentPending) {
        setServerError(`[${errEntry.code}] ${errEntry.message}`);
      }
      return;
    }

    if (outcome === 'failed') {
      const statusText = String(data?.status || 'FAILED').toUpperCase();
      const isExpired = Boolean(data?.expired) || statusText === 'EXPIRED';
      if (isExpired) {
        const expiredIso =
          typeof data?.expires_at === 'string' && data.expires_at
            ? data.expires_at
            : new Date(Date.now() - 1000).toISOString();
        setNowMs(Date.now());
        setSession((prev) => (prev ? { ...prev, expires_at: expiredIso } : prev));
      }
      const errEntry = extractTelebirrBackendError({
        resStatus,
        payload: {
          code: isExpired ? 'SESSION_EXPIRED' : `ORDER_${statusText}`,
          stage: 'query_order',
          status_code: resStatus,
          message:
            typeof data?.message === 'string' && data.message.trim()
              ? data.message
              : isExpired
                ? 'Session Expired. Please start a new Telebirr payment session.'
                : `Telebirr reported order ${txRef} as ${statusText}. Please start a fresh payment.`,
        },
        defaultStage: 'query_order',
        fallbackMessage: isExpired
          ? 'Session Expired. Please start a new Telebirr payment session.'
          : `Telebirr reported order ${txRef} as ${statusText}.`,
        txRef,
      });
      recordBackendError(errEntry);
      setPollTerminalFailure(true);
      setPendingNotice(null);
      setServerError(isExpired ? 'Session Expired. Start a new Telebirr payment session to continue.' : `[${errEntry.code}] ${errEntry.message}`);
      return;
    }

    if (outcome === 'verified' && data) {
      const order = (data.order && typeof data.order === 'object' ? data.order : {}) as Record<string, unknown>;
      const invoiceMeta = (data.invoice || order.invoice || null) as TelebirrInvoiceMeta | null;
      const resolvedRef = typeof order.tx_ref === 'string' && order.tx_ref ? order.tx_ref : txRef;
      const resolvedEmail =
        (typeof order.customer_email === 'string' && order.customer_email) || email.trim() || undefined;

      saveRecentInvoiceContext({ email: resolvedEmail, txRef: resolvedRef });
      onTransactionTracked?.(resolvedRef, resolvedEmail);
      setSession(null);
      setPendingReturnTxRef(null);
      setPendingNotice(null);
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
      return;
    }

    if (data && data.query_ok === false && typeof data.query_error === 'string' && data.query_error.trim()) {
      const queryErrEntry = extractTelebirrBackendError({
        resStatus,
        payload: data,
        defaultStage: 'query_order',
        fallbackMessage: data.query_error,
        txRef,
      });
      recordBackendError(queryErrEntry);
      if (!silentPending) {
        setServerError(`[${queryErrEntry.code}] ${queryErrEntry.message}`);
      }
      return;
    }

    if (!silentPending && data) {
      setPendingNotice(
        `Order ${txRef} status is ${String(data.status || 'PENDING').toUpperCase()}. Authorize payment on Telebirr H5 checkout, then verify again.`,
      );
    }
  };

  const verifyTelebirrTransaction = async (txRef: string, silentPending = false): Promise<void> => {
    if (!txRef || inFlightVerifyRef.current) return;
    inFlightVerifyRef.current = true;
    setVerifying(true);
    if (!silentPending) {
      setPendingNotice(null);
      setServerError(null);
    }
    try {
      const res = await fetch(`/api/telebirr/verify/${encodeURIComponent(txRef)}`);
      const data = await res.json().catch(() => null);
      applyVerificationPayload(txRef, res.ok, res.status, data, silentPending);
    } catch (err: unknown) {
      const msg =
        err instanceof Error && err.message
          ? err.message
          : 'Network failure reaching Telebirr verification endpoint.';
      const errEntry = extractTelebirrBackendError({
        resStatus: null,
        payload: { code: 'VERIFY_NETWORK_ERROR', message: msg },
        defaultStage: 'query_order',
        fallbackMessage: msg,
        txRef,
      });
      recordBackendError(errEntry);
      if (!silentPending) {
        setServerError(`[${errEntry.code}] ${errEntry.message}`);
      }
    } finally {
      inFlightVerifyRef.current = false;
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
          applyVerificationPayload(initialReturnTxRef, res.ok, res.status, data, true);
          if (classifyTelebirrVerifyOutcome(res.ok, data) === 'pending') {
            setPendingReturnTxRef(initialReturnTxRef);
            setPollAttempts(0);
            setPollPaused(false);
            setPollTerminalFailure(false);
            setPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
          }
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const msg =
            err instanceof Error && err.message
              ? err.message
              : 'Network failure verifying returned Telebirr order.';
          setErrorLogs((prev) =>
            appendTelebirrErrorLog(
              prev,
              extractTelebirrBackendError({
                resStatus: null,
                payload: { code: 'VERIFY_NETWORK_ERROR', message: msg },
                defaultStage: 'query_order',
                fallbackMessage: msg,
                txRef: initialReturnTxRef,
              }),
            ),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialReturnTxRef]);

  useEffect(() => {
    if (!session || verifiedReceipt) return;
    const tick = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(tick);
    };
  }, [session, verifiedReceipt]);

  const sessionCountdown = useMemo(
    () => (session ? evaluateTelebirrSessionCountdown(session.expires_at, nowMs) : null),
    [session, nowMs],
  );

  const activePollTxRef = session?.tx_ref ?? pendingReturnTxRef;
  const pollDecision = useMemo(
    () =>
      evaluateTelebirrPollCycle({
        activeTxRef: activePollTxRef,
        verified: Boolean(verifiedReceipt),
        terminalFailure: pollTerminalFailure,
        expired: Boolean(sessionCountdown?.expired),
        paused: pollPaused,
        attempts: pollAttempts,
        maxAttempts: TELEBIRR_MAX_POLL_ATTEMPTS,
      }),
    [activePollTxRef, verifiedReceipt, pollTerminalFailure, sessionCountdown?.expired, pollPaused, pollAttempts],
  );

  useEffect(() => {
    if (!pollDecision.shouldPoll || !activePollTxRef) return;

    let cancelled = false;
    const intervalSeconds = Math.max(1, Math.round(TELEBIRR_POLL_INTERVAL_MS / 1000));
    let secondsRemaining = intervalSeconds;

    const timer = window.setInterval(() => {
      if (cancelled) return;
      secondsRemaining -= 1;
      if (secondsRemaining > 0) {
        setPollCountdownSec(secondsRemaining);
        return;
      }

      secondsRemaining = intervalSeconds;
      setPollCountdownSec(intervalSeconds);
      if (inFlightVerifyRef.current) return;

      inFlightVerifyRef.current = true;
      setPollAttempts((prev) => prev + 1);
      fetch(`/api/telebirr/verify/${encodeURIComponent(activePollTxRef)}`)
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (!cancelled) {
            applyVerificationPayload(activePollTxRef, res.ok, res.status, data, true);
          }
        })
        .catch((err: unknown) => {
          if (!cancelled) {
            const msg =
              err instanceof Error && err.message
                ? err.message
                : 'Network error polling Telebirr verification endpoint.';
            recordBackendError(
              extractTelebirrBackendError({
                resStatus: null,
                payload: { code: 'POLL_NETWORK_ERROR', message: msg },
                defaultStage: 'query_order',
                fallbackMessage: msg,
                txRef: activePollTxRef,
              }),
            );
          }
        })
        .finally(() => {
          inFlightVerifyRef.current = false;
        });
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollDecision.shouldPoll, activePollTxRef]);

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
          email: validation.receiptEmail ?? '',
          ...(validation.receiptEmail ? { receiptEmail: validation.receiptEmail } : {}),
          phone: phone.trim(),
          notes: validation.sanitizedNote,
          returnPath,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok || !data?.checkout_url) {
        const errEntry = extractTelebirrBackendError({
          resStatus: res.status,
          payload: data,
          defaultStage: 'pre_order',
          fallbackMessage: `Telebirr H5 pre-order initialization declined (HTTP ${res.status}).`,
        });
        recordBackendError(errEntry);
        const formatted = `[${errEntry.code}] ${errEntry.message}`;
        setServerError(formatted);
        onStatusToast?.('error', errEntry.message);
        return;
      }

      if (validation.receiptEmail) {
        saveRecentInvoiceContext({ email: validation.receiptEmail, txRef: data.tx_ref });
      }
      onTransactionTracked?.(data.tx_ref, validation.receiptEmail ?? undefined);
      setVerifiedReceipt(null);
      setPendingReturnTxRef(null);
      setPollAttempts(0);
      setPollPaused(false);
      setPollTerminalFailure(false);
      setPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
      const createdAtMs = Date.now();
      setNowMs(createdAtMs);
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
        expires_at:
          typeof data.expires_at === 'string' && data.expires_at
            ? data.expires_at
            : new Date(createdAtMs + TELEBIRR_SESSION_TTL_MS).toISOString(),
      });
      onStatusToast?.('success', `Telebirr H5 pre-order ${data.tx_ref} ready. Auto-verifying every 5s.`);
    } catch (err: unknown) {
      const rawMsg =
        err instanceof Error && err.message
          ? err.message
          : 'Network connection failed reaching Telebirr initialization API.';
      const errEntry = extractTelebirrBackendError({
        resStatus: null,
        payload: { code: 'INIT_NETWORK_ERROR', message: rawMsg },
        defaultStage: 'pre_order',
        fallbackMessage: rawMsg,
      });
      recordBackendError(errEntry);
      setServerError(`[${errEntry.code}] ${errEntry.message}`);
      onStatusToast?.('error', errEntry.message);
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
        const errEntry = extractTelebirrBackendError({
          resStatus: res.status,
          payload: data,
          defaultStage: 'invoice',
          fallbackMessage: `Unable to resend PDF invoice email (HTTP ${res.status}).`,
          txRef: verifiedReceipt.tx_ref,
        });
        recordBackendError(errEntry);
        setInvoiceNotice(`[${errEntry.code}] ${errEntry.message}`);
        onStatusToast?.('error', errEntry.message);
        return;
      }
      setVerifiedReceipt((prev) => (prev ? { ...prev, invoice: data.invoice } : prev));
      const msg =
        data.invoice?.delivery_status === 'sent'
          ? `PDF invoice emailed to ${data.invoice.recipient_email}.`
          : `PDF invoice queued in outbox (${data.invoice.recipient_email}).`;
      setInvoiceNotice(msg);
      onStatusToast?.('success', msg);
    } catch (err: unknown) {
      const rawMsg = err instanceof Error && err.message ? err.message : 'Could not reach invoice dispatch service.';
      recordBackendError(
        extractTelebirrBackendError({
          resStatus: null,
          payload: { code: 'INVOICE_NETWORK_ERROR', message: rawMsg },
          defaultStage: 'invoice',
          fallbackMessage: rawMsg,
          txRef: verifiedReceipt.tx_ref,
        }),
      );
      setInvoiceNotice(rawMsg);
    } finally {
      setResendingInvoice(false);
    }
  };

  const handleDownloadVerifiedPdf = async (): Promise<void> => {
    if (!verifiedReceipt || downloadingReceipt) return;
    setDownloadingReceipt(true);
    setInvoiceNotice(null);
    try {
      const result = await fetchAndDownloadVerifiedPdfReceipt(verifiedReceipt.tx_ref, {
        fallbackFilename: verifiedReceipt.invoice?.filename || `${verifiedReceipt.tx_ref}.pdf`,
        pdfUrl: verifiedReceipt.invoice?.pdf_url,
      });
      if (result.invoice) {
        setVerifiedReceipt((prev) =>
          prev
            ? {
                ...prev,
                invoice: result.invoice as unknown as TelebirrInvoiceMeta,
              }
            : prev,
        );
      }
      const msg = `Downloaded ${result.filename} (${Math.max(1, Math.round(result.sizeBytes / 1024))} KB).`;
      setInvoiceNotice(msg);
      onStatusToast?.('success', msg);
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? err.message : 'Unable to download PDF receipt from backend.';
      const code = err instanceof PdfReceiptDownloadError ? err.code : 'PDF_DOWNLOAD_ERROR';
      const statusCode = err instanceof PdfReceiptDownloadError ? err.statusCode : null;
      recordBackendError(
        extractTelebirrBackendError({
          resStatus: statusCode,
          payload: { code, stage: 'invoice', message: msg },
          defaultStage: 'invoice',
          fallbackMessage: msg,
          txRef: verifiedReceipt.tx_ref,
        }),
      );
      setInvoiceNotice(`[${code}] ${msg}`);
      onStatusToast?.('error', msg);
    } finally {
      setDownloadingReceipt(false);
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
          <div
            className={`tb-gateway-status is-${gatewayIndicator.status}`}
            role="status"
            aria-live="polite"
            title={gatewayIndicator.detail}
            data-testid="telebirr-gateway-status"
            data-status={gatewayIndicator.status}
          >
            <span className={`tb-status-dot is-${gatewayIndicator.status}`} aria-hidden="true" />
            <strong>{gatewayIndicator.label}</strong>
            <span className="tb-status-sub">
              {gatewayIndicator.status === 'live' ? 'Merchant Gateway' : 'Gateway Pending'}
            </span>
          </div>
        </div>
        <div className="tb-meta-line">
          <span>{gatewayIndicator.detail}</span>
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

      {!session &&
        pendingReturnTxRef &&
        (pollDecision.reason === 'active' ||
          pollDecision.reason === 'paused' ||
          pollDecision.reason === 'max_attempts') && (
          <div className="tb-poll-bar" role="status" aria-live="polite" data-testid="telebirr-poll-status">
            <div className="tb-poll-info">
              <i
                className={
                  pollDecision.shouldPoll
                    ? 'fa-solid fa-arrows-rotate'
                    : pollDecision.reason === 'paused'
                      ? 'fa-solid fa-pause'
                      : 'fa-solid fa-circle-info'
                }
                aria-hidden="true"
              />
              <span className="tb-tabular">
                {pollDecision.shouldPoll
                  ? `Checking ${pendingReturnTxRef} every 5s · Next check in ${pollCountdownSec}s${pollAttempts > 0 ? ` · Checks: ${pollAttempts}` : ''}`
                  : pollDecision.reason === 'paused'
                    ? `Automatic 5s status check paused for ${pendingReturnTxRef}.`
                    : `Automatic status polling timed out for ${pendingReturnTxRef}.`}
              </span>
            </div>
            {(pollDecision.reason === 'active' || pollDecision.reason === 'paused') && (
              <button
                type="button"
                className="tb-poll-toggle"
                onClick={() => {
                  setPollPaused((prev) => !prev);
                  setPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
                }}
                data-testid="telebirr-poll-toggle"
              >
                {pollPaused ? 'Resume 5s check' : 'Pause'}
              </button>
            )}
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
              <button
                type="button"
                className="invoice-pdf-btn"
                disabled={downloadingReceipt}
                onClick={() => void handleDownloadVerifiedPdf()}
                data-testid="telebirr-invoice-download"
              >
                <i
                  className={`fa-solid ${downloadingReceipt ? 'fa-spinner fa-spin' : 'fa-download'}`}
                  aria-hidden="true"
                />{' '}
                {downloadingReceipt ? 'Preparing PDF Receipt…' : 'Download PDF Receipt'}
              </button>
              {(verifiedReceipt.invoice?.recipient_email || verifiedReceipt.customer_email) && (
                <button
                  type="button"
                  className="invoice-resend-btn"
                  disabled={resendingInvoice}
                  onClick={() => void handleResendInvoice()}
                >
                  <i className="fa-solid fa-paper-plane" aria-hidden="true" />{' '}
                  {resendingInvoice ? 'Sending…' : 'Resend Email'}
                </button>
              )}
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

          {sessionCountdown && (
            <div
              className={`tb-session-timer ${sessionCountdown.expired ? 'is-expired' : sessionCountdown.isUrgent ? 'is-urgent' : ''}`}
              data-testid="telebirr-session-timer"
              data-expired={sessionCountdown.expired ? 'true' : 'false'}
            >
              <div className="tb-session-timer-row">
                <span className="tb-session-timer-label">
                  <i
                    className={`fa-solid ${sessionCountdown.expired ? 'fa-hourglass-end' : 'fa-hourglass-half'}`}
                    aria-hidden="true"
                  />{' '}
                  {sessionCountdown.expired ? 'Session Expired' : 'Active Session Window (10 min)'}
                </span>
                <strong className="tb-session-timer-clock tb-tabular" data-testid="telebirr-session-clock">
                  {sessionCountdown.label}
                </strong>
              </div>
              <div className="tb-session-progress" aria-hidden="true">
                <div
                  className="tb-session-progress-bar"
                  style={{ width: `${sessionCountdown.progressPct}%` }}
                />
              </div>
            </div>
          )}

          {sessionCountdown?.expired && (
            <div
              className="chapa-alert chapa-alert-error tb-session-expired-alert"
              role="alert"
              data-testid="telebirr-session-expired"
            >
              <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
              <span>
                <strong>Session Expired</strong> — Your 10-minute Telebirr payment window has ended. Start a new session to generate a fresh checkout link.
              </span>
            </div>
          )}

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
            {sessionCountdown?.expired
              ? 'This pre-order reference can no longer be authorized. Create a new payment session below.'
              : session.mode === 'live'
                ? 'Your RSA-PSS signed Telebirr H5 checkout URL is ready. Continue to authorize in the Telebirr SuperApp or web paygate, then return for automatic verification.'
                : 'Open the Telebirr H5 checkout below to authorize wallet payment within 10 minutes, or verify payment status directly.'}
          </p>

          <div className="tb-poll-bar" role="status" aria-live="polite" data-testid="telebirr-poll-status">
            <div className="tb-poll-info">
              <i
                className={
                  pollDecision.shouldPoll
                    ? 'fa-solid fa-arrows-rotate'
                    : pollDecision.reason === 'paused'
                      ? 'fa-solid fa-pause'
                      : 'fa-solid fa-circle-info'
                }
                aria-hidden="true"
              />
              <span className="tb-tabular">
                {pollDecision.shouldPoll
                  ? `Auto-checking verification every 5s · Next check in ${pollCountdownSec}s${pollAttempts > 0 ? ` · Checks: ${pollAttempts}` : ''}`
                  : pollDecision.reason === 'expired'
                    ? 'Session Expired · Automatic status checks stopped.'
                    : pollDecision.reason === 'paused'
                      ? 'Automatic 5s status check paused.'
                      : pollDecision.reason === 'max_attempts'
                        ? 'Automatic status polling timed out. Use Check Payment Status to verify manually.'
                        : 'Polling stopped.'}
              </span>
            </div>
            {(pollDecision.reason === 'active' || pollDecision.reason === 'paused') && (
              <button
                type="button"
                className="tb-poll-toggle"
                onClick={() => {
                  setPollPaused((prev) => !prev);
                  setPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
                }}
                data-testid="telebirr-poll-toggle"
              >
                {pollPaused ? 'Resume 5s check' : 'Pause'}
              </button>
            )}
          </div>

          {serverError && !sessionCountdown?.expired && (
            <div className="chapa-alert chapa-alert-error" role="alert">
              <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
              <span>{serverError}</span>
            </div>
          )}

          <div className="chapa-session-actions">
            <button
              type="button"
              className="btn-primary chapa-proceed-btn"
              disabled={Boolean(sessionCountdown?.expired)}
              data-testid="telebirr-h5-launch"
              onClick={() => {
                if (sessionCountdown?.expired) return;
                setPollPaused(false);
                setPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
                window.location.assign(session.checkout_url);
              }}
            >
              <i className="fa-solid fa-lock" aria-hidden="true" />{' '}
              {sessionCountdown?.expired
                ? 'Session Expired — Pay Disabled'
                : `Pay ${formatEtb(session.amount)} via Telebirr H5`}
            </button>
            <div className="tb-secondary-row">
              <button
                type="button"
                className="chapa-secondary-btn"
                disabled={verifying || Boolean(sessionCountdown?.expired)}
                onClick={() => {
                  setPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
                  void verifyTelebirrTransaction(session.tx_ref, false);
                }}
                data-testid="telebirr-verify-btn"
              >
                {verifying ? 'Checking…' : 'Check Payment Status'}
              </button>
              <button
                type="button"
                className="chapa-secondary-btn"
                onClick={() => {
                  setSession(null);
                  setPendingReturnTxRef(null);
                  setPendingNotice(null);
                  setServerError(null);
                  setPollAttempts(0);
                  setPollPaused(false);
                  setPollTerminalFailure(false);
                }}
                data-testid="telebirr-edit-order-btn"
              >
                {sessionCountdown?.expired ? 'Start New Session' : 'Edit Order'}
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
                Send Receipt to Email <span className="chapa-optional">(optional)</span>
              </label>
              <input
                id="tb-email"
                type="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => {
                  const nextVal = e.target.value;
                  setEmail(nextVal);
                  setErrors((prev) => ({ ...prev, email: undefined }));
                }}
                onBlur={() => {
                  const check = validateOptionalReceiptEmail(email);
                  if (!check.valid && check.error) {
                    setErrors((prev) => ({ ...prev, email: check.error }));
                  }
                }}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? 'tb-email-error' : 'tb-email-hint'}
                className={errors.email ? 'input-error' : ''}
                data-testid="telebirr-receipt-email-input"
              />
              {errors.email ? (
                <span id="tb-email-error" className="field-error" role="alert">
                  <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {errors.email}
                </span>
              ) : (
                <span id="tb-email-hint" className="pgs-field-hint">
                  Optional — PDF invoice &amp; confirmation receipt are sent here once payment settles.
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

      {errorLogs.length > 0 && (
        <section
          className="tb-error-log"
          aria-label="Telebirr backend error log"
          data-testid="telebirr-error-log"
        >
          <div className="tb-error-log-head">
            <div className="tb-error-log-title">
              <i className="fa-solid fa-bug" aria-hidden="true" />
              <span>Telebirr Backend Error Log</span>
              <span className="tb-error-count tb-tabular">{errorLogs.length}</span>
            </div>
            <button
              type="button"
              className="tb-poll-toggle"
              onClick={() => setErrorLogs([])}
              data-testid="telebirr-error-log-clear"
            >
              Clear Log
            </button>
          </div>
          <ul className="tb-error-log-list">
            {errorLogs.map((entry) => {
              const formattedTime = (() => {
                const d = new Date(entry.timestamp);
                return Number.isNaN(d.getTime())
                  ? entry.timestamp
                  : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
              })();
              return (
                <li
                  key={entry.id}
                  className="tb-error-log-item"
                  data-testid="telebirr-error-log-entry"
                >
                  <div className="tb-error-log-meta">
                    <span className="tb-error-stage">{formatTelebirrStageLabel(entry.stage)}</span>
                    <code className="tb-error-code">{entry.code}</code>
                    {entry.statusCode ? (
                      <span className="tb-error-http tb-tabular">HTTP {entry.statusCode}</span>
                    ) : null}
                    {entry.txRef ? <code className="tb-error-ref">{entry.txRef}</code> : null}
                    {entry.repeatCount > 1 ? (
                      <span className="tb-error-repeat tb-tabular">×{entry.repeatCount}</span>
                    ) : null}
                    <time className="tb-error-time tb-tabular" dateTime={entry.timestamp}>
                      {formattedTime}
                    </time>
                  </div>
                  <p className="tb-error-log-msg">{entry.message}</p>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
