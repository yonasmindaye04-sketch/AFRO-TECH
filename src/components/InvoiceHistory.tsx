import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { loadAuth } from '../platform/api';
import {
  computeInvoiceHistoryStats,
  fetchAndDownloadVerifiedPdfReceipt,
  filterLocalInvoices,
  formatDeliveryStatusLabel,
  formatInvoiceHistoryDate,
  formatInvoiceHistoryMoney,
  loadRecentInvoiceContext,
  normalizeInvoiceHistoryQuery,
  saveRecentInvoiceContext,
  type InvoiceHistoryItem,
  type InvoiceProviderFilter,
} from '../utils/invoiceHistory';

interface InvoiceHistoryProps {
  scope?: 'public' | 'tenant';
  defaultEmail?: string;
  extraTxRefs?: string[];
  onStatusToast?: (type: 'success' | 'error', message: string) => void;
}

const PROVIDER_TABS: Array<{ id: InvoiceProviderFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'chapa', label: 'Chapa' },
  { id: 'telebirr', label: 'TeleBirr' },
  { id: 'mpesa', label: 'M-Pesa' },
  { id: 'cbe_bank', label: 'CBE Bank' },
];

export function InvoiceHistory({
  scope = 'public',
  defaultEmail = '',
  extraTxRefs = [],
  onStatusToast,
}: InvoiceHistoryProps): JSX.Element {
  const initialCtx = useMemo(() => loadRecentInvoiceContext(), []);
  const auth = useMemo(() => loadAuth(), []);
  const initialLookup = normalizeInvoiceHistoryQuery(
    defaultEmail || initialCtx.email || (scope === 'public' ? auth?.me?.email || '' : ''),
  );

  const [lookupInput, setLookupInput] = useState<string>(initialLookup);
  const [requestState, setRequestState] = useState<{ query: string; nonce: number }>({
    query: initialLookup,
    nonce: 0,
  });
  const [providerFilter, setProviderFilter] = useState<InvoiceProviderFilter>('all');
  const [items, setItems] = useState<InvoiceHistoryItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [requiresLookup, setRequiresLookup] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [resendingRef, setResendingRef] = useState<string | null>(null);
  const [downloadingRef, setDownloadingRef] = useState<string | null>(null);
  const [rowFeedback, setRowFeedback] = useState<Record<string, string>>({});

  const mergedRefsKey = useMemo(() => {
    const refs = Array.from(new Set([...extraTxRefs, ...initialCtx.txRefs].filter(Boolean)));
    return refs.join(',');
  }, [extraTxRefs, initialCtx.txRefs]);

  const loadInvoicesFromServer = useCallback(
    async (queryText: string) => {
      const params = new URLSearchParams();
      params.set('scope', scope);
      const cleanQ = normalizeInvoiceHistoryQuery(queryText);
      if (cleanQ) {
        if (cleanQ.includes('@')) {
          params.set('email', cleanQ);
          saveRecentInvoiceContext({ email: cleanQ });
        } else {
          params.set('q', cleanQ);
        }
      }
      if (mergedRefsKey) {
        params.set('tx_refs', mergedRefsKey);
      }

      const currentAuth = loadAuth();
      const res = await fetch(`/api/invoices?${params.toString()}`, {
        headers: {
          ...(currentAuth?.token ? { Authorization: `Bearer ${currentAuth.token}` } : {}),
        },
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || 'Unable to load invoice history.');
      }

      return {
        invoices: Array.isArray(data.invoices) ? (data.invoices as InvoiceHistoryItem[]) : [],
        requires_lookup: Boolean(data.requires_lookup),
      };
    },
    [scope, mergedRefsKey],
  );

  useEffect(() => {
    let cancelled = false;
    void loadInvoicesFromServer(requestState.query)
      .then((data) => {
        if (cancelled) return;
        setItems(data.invoices);
        setRequiresLookup(data.requires_lookup);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Could not fetch past invoices.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadInvoicesFromServer, requestState]);

  const triggerReload = (queryText: string): void => {
    setLoading(true);
    setError(null);
    setRequestState((prev) => ({ query: queryText, nonce: prev.nonce + 1 }));
  };

  const handleLookupSubmit = (e: FormEvent): void => {
    e.preventDefault();
    triggerReload(normalizeInvoiceHistoryQuery(lookupInput));
  };

  const handleClearLookup = (): void => {
    setLookupInput('');
    setProviderFilter('all');
    triggerReload('');
  };

  const handleResend = async (item: InvoiceHistoryItem): Promise<void> => {
    const targetEmail =
      item.recipient_email ||
      item.customer_email ||
      (requestState.query.includes('@') ? requestState.query : '');
    if (!targetEmail) {
      const msg = 'No recipient email on file for this invoice.';
      setRowFeedback((prev) => ({ ...prev, [item.tx_ref]: msg }));
      onStatusToast?.('error', msg);
      return;
    }

    setResendingRef(item.tx_ref);
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(item.tx_ref)}/resend`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: targetEmail }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        throw new Error(data?.message || 'Could not resend PDF invoice.');
      }
      setItems((prev) =>
        prev.map((row) =>
          row.tx_ref === item.tx_ref
            ? {
                ...row,
                delivery_status: data.invoice.delivery_status,
                delivery_transport: data.invoice.delivery_transport,
                recipient_email: data.invoice.recipient_email,
                send_count: data.invoice.send_count,
                last_sent_at: data.invoice.last_sent_at,
              }
            : row,
        ),
      );
      const okMsg =
        data.invoice?.delivery_status === 'sent'
          ? `Invoice ${item.invoice_number} emailed to ${data.invoice.recipient_email}.`
          : `Invoice ${item.invoice_number} queued in outbox (${data.invoice.recipient_email}).`;
      setRowFeedback((prev) => ({ ...prev, [item.tx_ref]: okMsg }));
      onStatusToast?.('success', okMsg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to resend invoice email.';
      setRowFeedback((prev) => ({ ...prev, [item.tx_ref]: msg }));
      onStatusToast?.('error', msg);
    } finally {
      setResendingRef(null);
    }
  };

  const handleDownloadPdf = async (item: InvoiceHistoryItem): Promise<void> => {
    setDownloadingRef(item.tx_ref);
    try {
      const res = await fetchAndDownloadVerifiedPdfReceipt(item.tx_ref, {
        fallbackFilename: item.filename,
        pdfUrl: item.pdf_url,
      });
      const okMsg = `Downloaded ${res.filename} (${Math.max(1, Math.round(res.sizeBytes / 1024))} KB).`;
      setRowFeedback((prev) => ({ ...prev, [item.tx_ref]: okMsg }));
      onStatusToast?.('success', okMsg);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to download PDF receipt.';
      setRowFeedback((prev) => ({ ...prev, [item.tx_ref]: msg }));
      onStatusToast?.('error', msg);
    } finally {
      setDownloadingRef(null);
    }
  };

  const filteredItems = useMemo(
    () =>
      filterLocalInvoices(items, {
        query: scope === 'tenant' ? lookupInput : requestState.query.includes('@') ? '' : lookupInput,
        provider: providerFilter,
      }),
    [items, scope, lookupInput, requestState.query, providerFilter],
  );

  const stats = useMemo(() => computeInvoiceHistoryStats(filteredItems), [filteredItems]);

  const visibleTabs = useMemo(() => {
    if (scope === 'tenant') return PROVIDER_TABS;
    const hasCbe = items.some((i) => i.provider === 'cbe_bank');
    return hasCbe ? PROVIDER_TABS : PROVIDER_TABS.filter((t) => t.id !== 'cbe_bank');
  }, [scope, items]);

  return (
    <section className="inv-hist-root" aria-label="Previous invoice history" data-testid="invoice-history-panel">
      <div className="inv-hist-header">
        <div>
          <h4 className="inv-hist-title">Previous Invoices &amp; PDF Receipts</h4>
          <p className="inv-hist-sub">
            {scope === 'tenant'
              ? 'View settled gateway invoices and download or email official PDF receipts.'
              : 'Look up your past payments by receipt email or transaction reference and download PDF invoices.'}
          </p>
        </div>
        <div className="inv-hist-summary" aria-live="polite">
          <span>
            <strong>{stats.count}</strong> {stats.count === 1 ? 'invoice' : 'invoices'}
          </span>
          <span aria-hidden="true">·</span>
          <span className="inv-hist-num">{formatInvoiceHistoryMoney(stats.totalPaidEtb)}</span>
        </div>
      </div>

      <form className="inv-hist-toolbar" onSubmit={handleLookupSubmit}>
        <div className="inv-hist-search-wrap">
          <label htmlFor={`inv-history-input-${scope}`} className="sr-only">
            {scope === 'tenant' ? 'Filter invoices by number, customer, or reference' : 'Lookup by email or transaction reference'}
          </label>
          <input
            id={`inv-history-input-${scope}`}
            type="text"
            className="inv-hist-input"
            placeholder={
              scope === 'tenant'
                ? 'Search invoice #, ref, customer, or email…'
                : 'Receipt email (e.g. you@company.com) or tx_ref…'
            }
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            data-testid="invoice-history-search"
          />
          {lookupInput && (
            <button
              type="button"
              className="inv-hist-clear-btn"
              onClick={handleClearLookup}
              aria-label="Clear invoice search"
            >
              Clear
            </button>
          )}
        </div>
        <button
          type="submit"
          className="inv-hist-fetch-btn"
          disabled={loading}
          data-testid="invoice-history-fetch"
        >
          <i className={`fa-solid ${loading ? 'fa-spinner fa-spin' : 'fa-magnifying-glass'}`} aria-hidden="true" />{' '}
          {scope === 'tenant' ? 'Refresh' : 'Find Invoices'}
        </button>
      </form>

      <div className="inv-hist-filters" role="tablist" aria-label="Filter invoices by payment gateway">
        {visibleTabs.map((tab) => {
          const active = providerFilter === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`inv-hist-filter-btn ${active ? 'active' : ''}`}
              onClick={() => setProviderFilter(tab.id)}
              data-testid={`invoice-filter-${tab.id}`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {error && (
        <div className="chapa-alert chapa-alert-error" role="alert">
          <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
          <span>{error}</span>
          <button
            type="button"
            className="inv-hist-retry-btn"
            onClick={() => triggerReload(requestState.query)}
          >
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="inv-hist-loading" role="status" aria-label="Loading invoice history">
          <div className="inv-hist-skeleton" />
          <div className="inv-hist-skeleton" />
        </div>
      ) : filteredItems.length === 0 ? (
        <div className="inv-hist-empty" data-testid="invoice-history-empty">
          <i className="fa-solid fa-file-invoice" aria-hidden="true" />
          <strong>
            {requiresLookup
              ? 'Enter your receipt email or transaction reference above'
              : 'No matching past invoices found'}
          </strong>
          <p>
            {requiresLookup
              ? 'Any Chapa, TeleBirr, or M-Pesa payment you complete in this browser or settle using your email will appear here for instant PDF download.'
              : 'Check your email spelling, switch the gateway filter back to All, or complete a payment to generate a new invoice.'}
          </p>
          {(providerFilter !== 'all' || lookupInput) && (
            <button type="button" className="inv-hist-reset-btn" onClick={handleClearLookup}>
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <div className="inv-hist-list" data-testid="invoice-history-list">
          {filteredItems.map((item) => {
            const busy = resendingRef === item.tx_ref;
            const feedback = rowFeedback[item.tx_ref];
            const deliveryText = formatDeliveryStatusLabel(item);
            return (
              <article
                key={item.tx_ref}
                className="inv-hist-row"
                data-testid={`invoice-history-item-${item.tx_ref}`}
              >
                <div className="inv-hist-row-main">
                  <div className="inv-hist-row-top">
                    <span className="inv-hist-code">{item.invoice_number}</span>
                    <span className="inv-hist-date">{formatInvoiceHistoryDate(item.settled_at || item.issued_at)}</span>
                    <span className="inv-hist-gateway">{item.provider_label}</span>
                  </div>
                  <div className="inv-hist-desc">{item.description}</div>
                  <div className="inv-hist-meta">
                    <span>{item.customer_name}</span>
                    <code>{item.tx_ref}</code>
                    <span className={`inv-hist-delivery ${item.delivery_status === 'sent' ? 'is-sent' : ''}`}>
                      {deliveryText}
                    </span>
                  </div>
                  {feedback && <p className="inv-hist-row-feedback">{feedback}</p>}
                </div>

                <div className="inv-hist-row-side">
                  <div className="inv-hist-amount">
                    {formatInvoiceHistoryMoney(item.amount, item.currency)}
                  </div>
                  <div className="inv-hist-actions">
                    <button
                      type="button"
                      className="invoice-pdf-btn"
                      disabled={downloadingRef === item.tx_ref}
                      onClick={() => void handleDownloadPdf(item)}
                      data-testid={`history-download-${item.tx_ref}`}
                    >
                      <i
                        className={`fa-solid ${downloadingRef === item.tx_ref ? 'fa-spinner fa-spin' : 'fa-download'}`}
                        aria-hidden="true"
                      />{' '}
                      {downloadingRef === item.tx_ref ? 'Preparing…' : 'Download PDF'}
                    </button>
                    {(item.recipient_email || item.customer_email) && (
                      <button
                        type="button"
                        className="invoice-resend-btn"
                        disabled={busy}
                        onClick={() => void handleResend(item)}
                        data-testid={`history-resend-${item.tx_ref}`}
                      >
                        <i className="fa-solid fa-paper-plane" aria-hidden="true" />{' '}
                        {busy ? 'Sending…' : 'Resend'}
                      </button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
