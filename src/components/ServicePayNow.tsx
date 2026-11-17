import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { ChapaQrContainer } from './ChapaQrContainer';
import { fetchAndDownloadVerifiedPdfReceipt, saveRecentInvoiceContext } from '../utils/invoiceHistory';
import { celebrateVerifiedPayment } from '../utils/paymentCelebration';
import {
  classifyTelebirrVerifyOutcome,
  evaluateTelebirrPollCycle,
  evaluateTelebirrSessionCountdown,
  extractTelebirrBackendError,
  normalizeTelebirrMerchantConfig,
  resolveTelebirrGatewayIndicator,
  TELEBIRR_GATEWAY_HEARTBEAT_MS,
  TELEBIRR_MAX_POLL_ATTEMPTS,
  TELEBIRR_POLL_INTERVAL_MS,
  TELEBIRR_SESSION_TTL_MS,
  type TelebirrErrorLogEntry,
  type TelebirrMerchantConfig,
} from '../utils/telebirrCheckout';
import {
  buildTelebirrQrRequestSignature,
  normalizeTelebirrQrSession,
  type TelebirrQrSession,
} from '../utils/telebirrQr';

interface CheckoutSession {
  provider: ServicePaymentProvider;
  tx_ref: string;
  amount: number;
  currency: string;
  mode: 'live' | 'sandbox';
  checkout_url: string;
  service_name: string;
  customer_message?: string;
  expires_at?: string;
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

function resolveInitialPayView(): 'checkout' | 'telebirr' | 'qr' | 'history' {
  const params = new URLSearchParams(window.location.search);
  const tab = (params.get('tab') || '').toLowerCase();
  if (tab === 'qr') return 'qr';
  if (tab === 'history') return 'history';
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
  const [tbNowMs, setTbNowMs] = useState(() => Date.now());
  const [verifiedReceipt, setVerifiedReceipt] = useState<VerifiedOrderReceipt | null>(null);
  const [resendingInvoice, setResendingInvoice] = useState(false);
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [invoiceNotice, setInvoiceNotice] = useState<string | null>(null);
  const [payView, setPayView] = useState<'checkout' | 'telebirr' | 'qr' | 'history'>(resolveInitialPayView);
  const [trackedRefs, setTrackedRefs] = useState<string[]>([]);
  const [tbPollPaused, setTbPollPaused] = useState(false);
  const [tbPollAttempts, setTbPollAttempts] = useState(0);
  const [tbPollTerminalFailure, setTbPollTerminalFailure] = useState(false);
  const [tbPollCountdownSec, setTbPollCountdownSec] = useState(TELEBIRR_POLL_INTERVAL_MS / 1000);
  const inFlightTbPollRef = useRef(false);
  const [qrSession, setQrSession] = useState<TelebirrQrSession | null>(null);
  const [qrLoading, setQrLoading] = useState(() => resolveInitialPayView() === 'qr');
  const [qrError, setQrError] = useState<TelebirrErrorLogEntry | null>(null);
  const [qrVerifyingNow, setQrVerifyingNow] = useState(false);
  const [qrSignature, setQrSignature] = useState<string | null>(null);
  const qrAbortRef = useRef<AbortController | null>(null);
  const [tbGatewayConfig, setTbGatewayConfig] = useState<TelebirrMerchantConfig>(() =>
    normalizeTelebirrMerchantConfig(null),
  );
  const [probingTbGateway, setProbingTbGateway] = useState(true);
  const [tbGatewayNetErr, setTbGatewayNetErr] = useState(false);
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

  useEffect(() => {
    if (payView !== 'qr') return;
    let cancelled = false;
    const probeConfig = (): void => {
      fetch('/api/telebirr/config')
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (cancelled) return;
          if (res.ok && data?.ok) {
            setTbGatewayNetErr(false);
            setTbGatewayConfig(normalizeTelebirrMerchantConfig(data));
          } else {
            setTbGatewayNetErr(true);
          }
        })
        .catch(() => {
          if (!cancelled) setTbGatewayNetErr(true);
        })
        .finally(() => {
          if (!cancelled) setProbingTbGateway(false);
        });
    };

    probeConfig();
    const timer = window.setInterval(probeConfig, TELEBIRR_GATEWAY_HEARTBEAT_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [payView]);

  const qrGatewayIndicator = useMemo(
    () =>
      resolveTelebirrGatewayIndicator({
        probing: probingTbGateway,
        config: tbGatewayConfig,
        networkError: tbGatewayNetErr,
      }),
    [probingTbGateway, tbGatewayConfig, tbGatewayNetErr],
  );

  const hasActiveTelebirrCountdown =
    !verifiedReceipt &&
    (session?.provider === 'telebirr' || (payView === 'qr' && Boolean(qrSession?.expiresAt)));

  useEffect(() => {
    if (!hasActiveTelebirrCountdown) return;
    const tick = window.setInterval(() => {
      setTbNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearInterval(tick);
    };
  }, [hasActiveTelebirrCountdown]);

  const serviceTbCountdown = useMemo(
    () =>
      session?.provider === 'telebirr'
        ? evaluateTelebirrSessionCountdown(session.expires_at ?? null, tbNowMs)
        : null,
    [session, tbNowMs],
  );

  const qrCountdown = useMemo(
    () => (qrSession ? evaluateTelebirrSessionCountdown(qrSession.expiresAt, tbNowMs) : null),
    [qrSession, tbNowMs],
  );

  const activeTbSessionExpired =
    payView === 'qr' ? Boolean(qrCountdown?.expired) : Boolean(serviceTbCountdown?.expired);

  const activeTbSessionTxRef =
    payView === 'qr'
      ? (qrSession?.txRef ?? null)
      : session?.provider === 'telebirr'
        ? session.tx_ref
        : null;
  const tbPollDecision = useMemo(
    () =>
      evaluateTelebirrPollCycle({
        activeTxRef: activeTbSessionTxRef,
        verified: Boolean(verifiedReceipt),
        terminalFailure: tbPollTerminalFailure,
        expired: activeTbSessionExpired,
        paused: tbPollPaused,
        attempts: tbPollAttempts,
        maxAttempts: TELEBIRR_MAX_POLL_ATTEMPTS,
      }),
    [
      activeTbSessionTxRef,
      verifiedReceipt,
      tbPollTerminalFailure,
      activeTbSessionExpired,
      tbPollPaused,
      tbPollAttempts,
    ],
  );

  useEffect(() => {
    if (!tbPollDecision.shouldPoll || !activeTbSessionTxRef) return;

    let cancelled = false;
    const intervalSeconds = Math.max(1, Math.round(TELEBIRR_POLL_INTERVAL_MS / 1000));
    let secondsRemaining = intervalSeconds;

    const timer = window.setInterval(() => {
      if (cancelled) return;
      secondsRemaining -= 1;
      if (secondsRemaining > 0) {
        setTbPollCountdownSec(secondsRemaining);
        return;
      }

      secondsRemaining = intervalSeconds;
      setTbPollCountdownSec(intervalSeconds);
      if (inFlightTbPollRef.current) return;

      inFlightTbPollRef.current = true;
      setTbPollAttempts((prev) => prev + 1);
      fetch(`/api/telebirr/verify/${encodeURIComponent(activeTbSessionTxRef)}`)
        .then(async (res) => {
          const data = await res.json().catch(() => null);
          if (cancelled) return;
          const outcome = classifyTelebirrVerifyOutcome(res.ok, data);
          if (outcome === 'error') {
            const errEntry = extractTelebirrBackendError({
              resStatus: res.status,
              payload: data,
              defaultStage: 'query_order',
              fallbackMessage: `Telebirr verification failed (HTTP ${res.status}).`,
              txRef: activeTbSessionTxRef,
            });
            setServerError(`[${errEntry.code}] ${errEntry.message}`);
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
              setTbNowMs(Date.now());
              setSession((prev) =>
                prev && prev.provider === 'telebirr' ? { ...prev, expires_at: expiredIso } : prev,
              );
              setQrSession((prev) => (prev ? { ...prev, expiresAt: expiredIso } : prev));
            }
            setTbPollTerminalFailure(true);
            setServerError(
              isExpired
                ? 'Session Expired. Please start a new Telebirr payment session.'
                : `Telebirr reported order ${activeTbSessionTxRef} as ${statusText}. Please try again.`,
            );
            return;
          }
          if (outcome === 'verified' && data) {
            const order = (data.order && typeof data.order === 'object' ? data.order : {}) as Record<string, unknown>;
            const resolvedRef =
              typeof order.tx_ref === 'string' && order.tx_ref ? order.tx_ref : activeTbSessionTxRef;
            const resolvedEmail =
              (typeof order.customer_email === 'string' && order.customer_email) || email.trim() || undefined;
            const invoiceMeta: InvoiceReceiptMeta | null = data.invoice || order.invoice || null;

            saveRecentInvoiceContext({ email: resolvedEmail, txRef: resolvedRef });
            setTrackedRefs((prev) => (prev.includes(resolvedRef) ? prev : [resolvedRef, ...prev]));
            setSession(null);
            setQrSession(null);
            setVerifiedReceipt({
              provider: 'telebirr',
              tx_ref: resolvedRef,
              status: 'settled',
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
            onStatusToast?.('success', `TeleBirr payment ${resolvedRef} verified & PDF invoice ready.`);
          }
        })
        .catch(() => {
          // Keep polling quietly on transient errors
        })
        .finally(() => {
          inFlightTbPollRef.current = false;
        });
    }, 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [tbPollDecision.shouldPoll, activeTbSessionTxRef, email, onStatusToast]);

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

  const qrPayableAmount = useMemo(
    () => Math.round(resolvePayableAmount(serviceId, paymentPlan, customAmount)),
    [serviceId, paymentPlan, customAmount],
  );

  const executeQrFetch = async (params: {
    targetServiceId: number;
    targetPlan: PaymentPlanMode;
    targetCustomAmount: string;
    targetFullName: string;
    targetEmail: string;
    targetNotes: string;
  }): Promise<void> => {
    const pkg = PAYABLE_SERVICES.find((s) => s.id === params.targetServiceId) ?? PAYABLE_SERVICES[0];
    const computedAmount = Math.round(
      resolvePayableAmount(pkg.id, params.targetPlan, params.targetCustomAmount),
    );
    const sig = buildTelebirrQrRequestSignature({
      serviceId: pkg.id,
      paymentPlan: params.targetPlan,
      amount: computedAmount,
      fullName: params.targetFullName,
      email: params.targetEmail,
      notes: params.targetNotes,
    });

    if (qrAbortRef.current) {
      qrAbortRef.current.abort();
    }
    const controller = new AbortController();
    qrAbortRef.current = controller;

    if (!Number.isFinite(computedAmount) || computedAmount < 50 || computedAmount > 5_000_000) {
      setQrLoading(false);
      setQrSession(null);
      setQrError(
        extractTelebirrBackendError({
          resStatus: 400,
          payload: {
            code: 'INVALID_AMOUNT',
            stage: 'validation',
            message: 'Enter an ETB amount between 50 and 5,000,000 to generate a QR code.',
          },
          defaultStage: 'validation',
          fallbackMessage: 'Invalid Telebirr QR amount.',
        }),
      );
      return;
    }

    const trimmedEmail = params.targetEmail.trim();
    if (trimmedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setQrLoading(false);
      setQrSession(null);
      setQrError(
        extractTelebirrBackendError({
          resStatus: 400,
          payload: {
            code: 'INVALID_EMAIL',
            stage: 'validation',
            message: 'Please enter a valid receipt email address or leave it blank.',
          },
          defaultStage: 'validation',
          fallbackMessage: 'Invalid receipt email.',
        }),
      );
      return;
    }

    setQrError(null);
    setQrSignature(sig);
    setTbPollAttempts(0);
    setTbPollPaused(false);
    setTbPollTerminalFailure(false);
    setTbPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);

    try {
      const res = await fetch('/api/telebirr/qr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          serviceId: pkg.id,
          serviceName: pkg.name,
          paymentPlan: params.targetPlan,
          amount: computedAmount,
          fullName: params.targetFullName.trim(),
          email: trimmedEmail,
          phone: phone.trim(),
          notes: params.targetNotes.trim(),
          returnPath,
        }),
      });
      const data = await res.json().catch(() => null);
      if (controller.signal.aborted) return;

      const normalized = res.ok && data?.ok ? normalizeTelebirrQrSession(data) : null;
      if (!normalized) {
        setQrSession(null);
        setQrError(
          extractTelebirrBackendError({
            resStatus: res.status,
            payload: data,
            defaultStage: 'pre_order',
            fallbackMessage: `Unable to generate Telebirr QR code (HTTP ${res.status}).`,
          }),
        );
        return;
      }

      if (trimmedEmail) {
        saveRecentInvoiceContext({ email: trimmedEmail, txRef: normalized.txRef });
      }
      setTrackedRefs((prev) =>
        prev.includes(normalized.txRef) ? prev : [normalized.txRef, ...prev],
      );
      setTbNowMs(Date.now());
      setQrSession(normalized);
      setVerifiedReceipt(null);
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (controller.signal.aborted) return;
      setQrSession(null);
      setQrError(
        extractTelebirrBackendError({
          resStatus: null,
          payload: {
            code: 'QR_NETWORK_ERROR',
            stage: 'network',
            message:
              err instanceof Error && err.message
                ? err.message
                : 'Unable to reach /api/telebirr/qr.',
          },
          defaultStage: 'network',
          fallbackMessage: 'Unable to reach Telebirr QR generation endpoint.',
        }),
      );
    } finally {
      if (!controller.signal.aborted) {
        setQrLoading(false);
      }
    }
  };

  const triggerGenerateTelebirrQr = (overrides?: {
    serviceId?: number;
    paymentPlan?: PaymentPlanMode;
    customAmount?: string;
    fullName?: string;
    email?: string;
    notes?: string;
  }): void => {
    setQrLoading(true);
    void executeQrFetch({
      targetServiceId: overrides?.serviceId ?? serviceId,
      targetPlan: overrides?.paymentPlan ?? paymentPlan,
      targetCustomAmount: overrides?.customAmount ?? customAmount,
      targetFullName: overrides?.fullName ?? fullName,
      targetEmail: overrides?.email ?? email,
      targetNotes: overrides?.notes ?? notes,
    });
  };

  const verifyQrPaymentNow = async (): Promise<void> => {
    if (!qrSession || qrVerifyingNow) return;
    setQrVerifyingNow(true);
    setTbPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
    try {
      const res = await fetch(`/api/telebirr/verify/${encodeURIComponent(qrSession.txRef)}`);
      const data = await res.json().catch(() => null);
      const outcome = classifyTelebirrVerifyOutcome(res.ok, data);
      if (outcome === 'error') {
        const errEntry = extractTelebirrBackendError({
          resStatus: res.status,
          payload: data,
          defaultStage: 'query_order',
          fallbackMessage: `Telebirr verification failed (HTTP ${res.status}).`,
          txRef: qrSession.txRef,
        });
        setQrError(errEntry);
        onStatusToast?.('error', errEntry.message);
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
          setTbNowMs(Date.now());
          setQrSession((prev) => (prev ? { ...prev, expiresAt: expiredIso } : prev));
        }
        setTbPollTerminalFailure(true);
        const msg = isExpired
          ? 'Session Expired. Generate a new QR code to continue.'
          : `Telebirr reported order ${qrSession.txRef} as ${statusText}.`;
        onStatusToast?.('error', msg);
        return;
      }
      if (outcome === 'verified' && data) {
        const order = (data.order && typeof data.order === 'object' ? data.order : {}) as Record<string, unknown>;
        const resolvedRef = typeof order.tx_ref === 'string' && order.tx_ref ? order.tx_ref : qrSession.txRef;
        const resolvedEmail =
          (typeof order.customer_email === 'string' && order.customer_email) || email.trim() || undefined;
        const invoiceMeta: InvoiceReceiptMeta | null = data.invoice || order.invoice || null;

        saveRecentInvoiceContext({ email: resolvedEmail, txRef: resolvedRef });
        setTrackedRefs((prev) => (prev.includes(resolvedRef) ? prev : [resolvedRef, ...prev]));
        setQrSession(null);
        setVerifiedReceipt({
          provider: 'telebirr',
          tx_ref: resolvedRef,
          status: 'settled',
          amount: Number(order.amount ?? data.amount ?? qrSession.amount),
          currency: typeof order.currency === 'string' ? order.currency : 'ETB',
          description: typeof order.description === 'string' ? order.description : qrSession.serviceName,
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
        onStatusToast?.('success', `TeleBirr QR payment ${resolvedRef} verified & PDF invoice ready.`);
      } else {
        onStatusToast?.('error', 'Payment still pending in Telebirr. Scan the QR code to complete payment.');
      }
    } finally {
      setQrVerifyingNow(false);
    }
  };

  useEffect(() => {
    if (payView !== 'qr') return;
    if (qrSession || qrError) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (!controller.signal.aborted) {
        void executeQrFetch({
          targetServiceId: serviceId,
          targetPlan: paymentPlan,
          targetCustomAmount: customAmount,
          targetFullName: fullName,
          targetEmail: email,
          targetNotes: notes,
        });
      }
    }, 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
    // Initial auto-load only when mounted directly on ?tab=qr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        const errEntry = extractTelebirrBackendError({
          resStatus: res.status,
          payload: data,
          defaultStage: 'pre_order',
          fallbackMessage: `Unable to start ${activeProvider.label} checkout (HTTP ${res.status}).`,
        });
        const formatted = provider === 'telebirr' ? `[${errEntry.code}] ${errEntry.message}` : errEntry.message;
        setServerError(formatted);
        onStatusToast?.('error', errEntry.message);
        return;
      }

      saveRecentInvoiceContext({ email: email.trim(), txRef: data.tx_ref });
      setTrackedRefs((prev) => (prev.includes(data.tx_ref) ? prev : [data.tx_ref, ...prev]));
      setTbPollAttempts(0);
      setTbPollPaused(false);
      setTbPollTerminalFailure(false);
      setTbPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
      const createdAtMs = Date.now();
      setTbNowMs(createdAtMs);
      setSession({
        provider,
        tx_ref: data.tx_ref,
        amount: data.amount,
        currency: data.currency || 'ETB',
        mode: data.mode,
        checkout_url: data.checkout_url,
        service_name: activePackage.name,
        customer_message: data.customer_message,
        expires_at:
          provider === 'telebirr'
            ? typeof data.expires_at === 'string' && data.expires_at
              ? data.expires_at
              : new Date(createdAtMs + TELEBIRR_SESSION_TTL_MS).toISOString()
            : undefined,
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
          prev ? { ...prev, invoice: result.invoice as unknown as InvoiceReceiptMeta } : prev,
        );
      }
      const msg = `Downloaded ${result.filename} (${Math.max(1, Math.round(result.sizeBytes / 1024))} KB).`;
      setInvoiceNotice(msg);
      onStatusToast?.('success', msg);
    } catch (err: unknown) {
      const msg = err instanceof Error && err.message ? err.message : 'Unable to download PDF receipt from backend.';
      setInvoiceNotice(msg);
      onStatusToast?.('error', msg);
    } finally {
      setDownloadingReceipt(false);
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
        {payView === 'checkout' || payView === 'qr' ? (
          <div className="chapa-amount-readout" aria-live="polite">
            <span>Payable Total</span>
            <strong>{formatEtb(payView === 'qr' ? qrPayableAmount : payableAmount)}</strong>
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
          aria-selected={payView === 'qr'}
          className={`pay-subview-tab ${payView === 'qr' ? 'active' : ''}`}
          onClick={() => {
            setPayView('qr');
            const currentSig = buildTelebirrQrRequestSignature({
              serviceId,
              paymentPlan,
              amount: qrPayableAmount,
              fullName,
              email,
              notes,
            });
            if (!qrSession || qrSignature !== currentSig) {
              triggerGenerateTelebirrQr();
            }
          }}
          data-testid="pay-tab-qr"
        >
          <i className="fa-solid fa-qrcode" aria-hidden="true" /> QR Code
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
      ) : payView === 'qr' ? (
        <div className="chapa-qr-view" data-testid="qr-code-panel">
          {verifiedReceipt && (
            <div className="chapa-receipt-box" role="status" data-testid="qr-verified-receipt">
              <div className="chapa-receipt-top">
                <i className="fa-solid fa-circle-check" aria-hidden="true" />
                <div>
                  <strong>Telebirr QR Payment Confirmed</strong>
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
              <div className="invoice-status-card" data-testid="qr-invoice-card">
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
                </div>
                <div className="invoice-status-actions">
                  <button
                    type="button"
                    className="invoice-pdf-btn"
                    disabled={downloadingReceipt}
                    onClick={() => void handleDownloadVerifiedPdf()}
                    data-testid="qr-invoice-download"
                  >
                    <i
                      className={`fa-solid ${downloadingReceipt ? 'fa-spinner fa-spin' : 'fa-download'}`}
                      aria-hidden="true"
                    />{' '}
                    {downloadingReceipt ? 'Preparing PDF Receipt…' : 'Download PDF Receipt'}
                  </button>
                  <button
                    type="button"
                    className="chapa-secondary-btn"
                    onClick={() => {
                      setVerifiedReceipt(null);
                      triggerGenerateTelebirrQr();
                    }}
                  >
                    New QR Transaction
                  </button>
                </div>
                {invoiceNotice && <p className="invoice-feedback">{invoiceNotice}</p>}
              </div>
            </div>
          )}

          {!verifiedReceipt && (
            <>
              <div className="chapa-qr-controls">
                <div className="form-group">
                  <label htmlFor="qr-pay-service">Digital Service Package</label>
                  <select
                    id="qr-pay-service"
                    className="chapa-select"
                    value={serviceId}
                    onChange={(e) => {
                      const nextId = Number(e.target.value);
                      setLocalServiceId(nextId);
                      onSelectService?.(nextId);
                      triggerGenerateTelebirrQr({ serviceId: nextId });
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
                  <div className="chapa-plan-grid" role="radiogroup" aria-label="Telebirr QR payment option">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={paymentPlan === 'deposit'}
                      className={`chapa-plan-btn ${paymentPlan === 'deposit' ? 'active' : ''}`}
                      onClick={() => {
                        setPaymentPlan('deposit');
                        triggerGenerateTelebirrQr({ paymentPlan: 'deposit' });
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
                        triggerGenerateTelebirrQr({ paymentPlan: 'full' });
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
                      onClick={() => {
                        setPaymentPlan('custom');
                        if (customAmount.trim()) {
                          triggerGenerateTelebirrQr({ paymentPlan: 'custom' });
                        }
                      }}
                    >
                      <span className="chapa-plan-name">Custom Quote</span>
                      <span className="chapa-plan-price">Enter ETB</span>
                    </button>
                  </div>
                </div>

                {paymentPlan === 'custom' && (
                  <div className="form-group">
                    <label htmlFor="qr-custom-amount">Invoice / Milestone Amount (ETB)</label>
                    <div className="chapa-qr-inline-row">
                      <input
                        id="qr-custom-amount"
                        type="number"
                        min={50}
                        max={5000000}
                        step="1"
                        placeholder="e.g. 15000"
                        value={customAmount}
                        onChange={(e) => setCustomAmount(e.target.value)}
                      />
                      <button
                        type="button"
                        className="chapa-secondary-btn"
                        onClick={() => triggerGenerateTelebirrQr()}
                      >
                        Apply Amount
                      </button>
                    </div>
                  </div>
                )}

                <div className="form-row">
                  <div className="form-group">
                    <label htmlFor="qr-full-name">
                      Full Name <span className="chapa-optional">(optional)</span>
                    </label>
                    <input
                      id="qr-full-name"
                      type="text"
                      placeholder="Abebe Bikila"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="qr-email">
                      Receipt Email <span className="chapa-optional">(for PDF invoice)</span>
                    </label>
                    <input
                      id="qr-email"
                      type="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <ChapaQrContainer
                loading={qrLoading}
                session={qrSession}
                error={qrError}
                verifying={qrVerifyingNow}
                pollCountdownSec={tbPollCountdownSec}
                pollAttempts={tbPollAttempts}
                pollPaused={tbPollPaused}
                pollReason={tbPollDecision.reason}
                gatewayIndicator={qrGatewayIndicator}
                onRegenerate={() => triggerGenerateTelebirrQr()}
                onVerifyNow={() => void verifyQrPaymentNow()}
                onTogglePollPause={() => {
                  setTbPollPaused((prev) => !prev);
                  setTbPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
                }}
              />
            </>
          )}
        </div>
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
              <button
                type="button"
                className="invoice-pdf-btn"
                disabled={downloadingReceipt}
                onClick={() => void handleDownloadVerifiedPdf()}
                data-testid="invoice-pdf-download"
              >
                <i
                  className={`fa-solid ${downloadingReceipt ? 'fa-spinner fa-spin' : 'fa-download'}`}
                  aria-hidden="true"
                />{' '}
                {downloadingReceipt ? 'Preparing PDF Receipt…' : 'Download PDF Receipt'}
              </button>
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

          {session.provider === 'telebirr' && serviceTbCountdown && (
            <>
              <div
                className={`tb-session-timer ${serviceTbCountdown.expired ? 'is-expired' : serviceTbCountdown.isUrgent ? 'is-urgent' : ''}`}
                data-testid="service-telebirr-session-timer"
                data-expired={serviceTbCountdown.expired ? 'true' : 'false'}
              >
                <div className="tb-session-timer-row">
                  <span className="tb-session-timer-label">
                    <i
                      className={`fa-solid ${serviceTbCountdown.expired ? 'fa-hourglass-end' : 'fa-hourglass-half'}`}
                      aria-hidden="true"
                    />{' '}
                    {serviceTbCountdown.expired ? 'Session Expired' : 'Active Session Window (10 min)'}
                  </span>
                  <strong className="tb-session-timer-clock tb-tabular" data-testid="service-telebirr-session-clock">
                    {serviceTbCountdown.label}
                  </strong>
                </div>
                <div className="tb-session-progress" aria-hidden="true">
                  <div
                    className="tb-session-progress-bar"
                    style={{ width: `${serviceTbCountdown.progressPct}%` }}
                  />
                </div>
              </div>

              {serviceTbCountdown.expired && (
                <div
                  className="chapa-alert chapa-alert-error tb-session-expired-alert"
                  role="alert"
                  data-testid="service-telebirr-session-expired"
                >
                  <i className="fa-solid fa-clock-rotate-left" aria-hidden="true" />
                  <span>
                    <strong>Session Expired</strong> — Your 10-minute Telebirr payment session has timed out. Start a new session to generate a fresh checkout link.
                  </span>
                </div>
              )}
            </>
          )}

          <p className="chapa-session-hint">
            {session.provider === 'telebirr' && serviceTbCountdown?.expired
              ? 'This Telebirr checkout session has expired and can no longer be authorized.'
              : session.customer_message
                ? session.customer_message
                : session.mode === 'live'
                  ? `Your encrypted checkout session has been created with ${sessionProviderLabel}. Continue below to authorize payment.`
                  : 'Continue to the encrypted checkout page below to enter your payment authorization and receive an instant verified receipt.'}
          </p>

          {session.provider === 'telebirr' && (
            <div className="tb-poll-bar" role="status" aria-live="polite" data-testid="service-telebirr-poll-status">
              <div className="tb-poll-info">
                <i
                  className={
                    tbPollDecision.shouldPoll
                      ? 'fa-solid fa-arrows-rotate'
                      : tbPollDecision.reason === 'paused'
                        ? 'fa-solid fa-pause'
                        : 'fa-solid fa-circle-info'
                  }
                  aria-hidden="true"
                />
                <span className="tb-tabular">
                  {tbPollDecision.shouldPoll
                    ? `Auto-checking Telebirr every 5s · Next check in ${tbPollCountdownSec}s${tbPollAttempts > 0 ? ` · Checks: ${tbPollAttempts}` : ''}`
                    : tbPollDecision.reason === 'expired'
                      ? 'Session Expired · Automatic status checks stopped.'
                      : tbPollDecision.reason === 'paused'
                        ? 'Automatic 5s status check paused.'
                        : 'Automatic status polling stopped.'}
                </span>
              </div>
              {(tbPollDecision.reason === 'active' || tbPollDecision.reason === 'paused') && (
                <button
                  type="button"
                  className="tb-poll-toggle"
                  onClick={() => {
                    setTbPollPaused((prev) => !prev);
                    setTbPollCountdownSec(TELEBIRR_POLL_INTERVAL_MS / 1000);
                  }}
                >
                  {tbPollPaused ? 'Resume 5s check' : 'Pause'}
                </button>
              )}
            </div>
          )}

          <div className="chapa-session-actions">
            {session.provider === 'telebirr' ? (
              <button
                type="button"
                className="btn-primary chapa-proceed-btn"
                disabled={Boolean(serviceTbCountdown?.expired)}
                onClick={() => {
                  if (!serviceTbCountdown?.expired) {
                    window.location.assign(session.checkout_url);
                  }
                }}
                data-testid="chapa-proceed-link"
              >
                <i className="fa-solid fa-lock" aria-hidden="true" />{' '}
                {serviceTbCountdown?.expired
                  ? 'Session Expired — Pay Disabled'
                  : `Pay ${formatEtb(session.amount)} via TeleBirr`}
              </button>
            ) : (
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
            )}
            <button
              type="button"
              className="chapa-secondary-btn"
              onClick={() => {
                setSession(null);
                setTbPollAttempts(0);
                setTbPollPaused(false);
                setTbPollTerminalFailure(false);
              }}
            >
              {session.provider === 'telebirr' && serviceTbCountdown?.expired
                ? 'Start New Session'
                : 'Edit Details'}
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
