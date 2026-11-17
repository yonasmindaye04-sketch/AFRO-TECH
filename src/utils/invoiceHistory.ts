export type InvoiceProviderFilter = 'all' | 'chapa' | 'telebirr' | 'mpesa' | 'cbe_bank' | 'stripe';

export interface InvoiceHistoryItem {
  invoice_number: string;
  tx_ref: string;
  provider: string;
  provider_label: string;
  customer_name: string;
  customer_email: string | null;
  description: string;
  amount: number;
  fee_amount?: number;
  net_amount?: number;
  currency: string;
  status: string;
  mode?: string;
  payer_reference?: string | null;
  gl_voucher_no?: string | null;
  delivery_status: 'sent' | 'sandbox_outbox' | 'failed' | 'skipped_no_email' | string;
  delivery_transport: string;
  recipient_email: string | null;
  send_count: number;
  last_sent_at: string | null;
  issued_at: string;
  settled_at: string | null;
  filename: string;
  pdf_url: string;
}

const RECENT_EMAIL_KEY = 'afro_invoice_history_email';
const RECENT_REFS_KEY = 'afro_invoice_history_refs';
const MAX_STORED_REFS = 25;

export function normalizeInvoiceHistoryQuery(input: string): string {
  return String(input || '').trim();
}

export function filterLocalInvoices(
  items: InvoiceHistoryItem[],
  { query = '', provider = 'all' }: { query?: string; provider?: InvoiceProviderFilter } = {},
): InvoiceHistoryItem[] {
  const q = normalizeInvoiceHistoryQuery(query).toLowerCase();
  const prov = String(provider || 'all').toLowerCase();

  return [...items]
    .filter((item) => {
      if (prov !== 'all' && String(item.provider || '').toLowerCase() !== prov) {
        return false;
      }
      if (!q) return true;
      const haystack = [
        item.invoice_number,
        item.tx_ref,
        item.customer_name,
        item.customer_email,
        item.recipient_email,
        item.description,
        item.provider_label,
        item.payer_reference,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    })
    .sort((a, b) => {
      const ta = new Date(a.settled_at || a.issued_at || 0).getTime();
      const tb = new Date(b.settled_at || b.issued_at || 0).getTime();
      return tb - ta;
    });
}

export function computeInvoiceHistoryStats(items: InvoiceHistoryItem[]): {
  count: number;
  totalPaidEtb: number;
  emailedCount: number;
} {
  return items.reduce(
    (acc, item) => {
      acc.count += 1;
      acc.totalPaidEtb += Number(item.amount || 0);
      if (item.delivery_status === 'sent' || item.send_count > 0) {
        acc.emailedCount += 1;
      }
      return acc;
    },
    { count: 0, totalPaidEtb: 0, emailedCount: 0 },
  );
}

export function formatDeliveryStatusLabel(item: Pick<InvoiceHistoryItem, 'delivery_status' | 'recipient_email' | 'send_count'>): string {
  if (item.delivery_status === 'sent' && item.recipient_email) {
    return `Emailed to ${item.recipient_email}`;
  }
  if (item.delivery_status === 'sandbox_outbox' && item.recipient_email) {
    return `Outbox queued · ${item.recipient_email}`;
  }
  if (item.delivery_status === 'failed') {
    return 'Email retry available';
  }
  if (item.send_count > 0 && item.recipient_email) {
    return `Dispatched · ${item.recipient_email}`;
  }
  return 'PDF ready';
}

export function formatInvoiceHistoryMoney(amount: number, currency = 'ETB'): string {
  const num = Number(amount || 0);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `${formatted} ${currency}`;
}

export function formatInvoiceHistoryDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return String(iso);
  return dt.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function getSafeStorage(storage?: SimpleStorage | null): SimpleStorage | null {
  if (storage) return storage;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    return null;
  }
  return null;
}

export function saveRecentInvoiceContext(
  { email, txRef }: { email?: string | null; txRef?: string | null },
  storage?: SimpleStorage | null,
): void {
  const store = getSafeStorage(storage);
  if (!store) return;

  const cleanEmail = String(email || '').trim();
  if (cleanEmail && cleanEmail.includes('@')) {
    try {
      store.setItem(RECENT_EMAIL_KEY, cleanEmail);
    } catch {
      /* ignore storage quota */
    }
  }

  const cleanRef = String(txRef || '').trim();
  if (cleanRef) {
    try {
      const existingRaw = store.getItem(RECENT_REFS_KEY);
      const existing: string[] = existingRaw ? (JSON.parse(existingRaw) as string[]) : [];
      const next = [cleanRef, ...existing.filter((r) => r !== cleanRef)].slice(0, MAX_STORED_REFS);
      store.setItem(RECENT_REFS_KEY, JSON.stringify(next));
    } catch {
      /* ignore malformed JSON */
    }
  }
}

export function loadRecentInvoiceContext(storage?: SimpleStorage | null): {
  email: string;
  txRefs: string[];
} {
  const store = getSafeStorage(storage);
  if (!store) return { email: '', txRefs: [] };

  let email = '';
  let txRefs: string[] = [];
  try {
    email = String(store.getItem(RECENT_EMAIL_KEY) || '').trim();
  } catch {
    email = '';
  }
  try {
    const raw = store.getItem(RECENT_REFS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      txRefs = parsed.map((v) => String(v || '').trim()).filter(Boolean);
    }
  } catch {
    txRefs = [];
  }
  return { email, txRefs };
}

export interface VerifiedPdfReceiptResult {
  filename: string;
  sizeBytes: number;
  invoice: Record<string, unknown> | null;
  transaction: Record<string, unknown> | null;
}

export class PdfReceiptDownloadError extends Error {
  code: string;
  statusCode: number | null;

  constructor(message: string, code = 'PDF_RECEIPT_ERROR', statusCode: number | null = null) {
    super(message);
    this.name = 'PdfReceiptDownloadError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

export function parseContentDispositionFilename(
  headerValue: string | null | undefined,
  fallback: string,
): string {
  const cleanHeader = String(headerValue || '');
  const utfMatch = cleanHeader.match(/filename\*=UTF-8''([^;\r\n]+)/i);
  if (utfMatch?.[1]) {
    try {
      const decoded = decodeURIComponent(utfMatch[1].trim().replace(/^["']|["']$/g, ''));
      if (decoded) return decoded;
    } catch {
      /* fallback below */
    }
  }
  const plainMatch = cleanHeader.match(/filename="?([^";\r\n]+)"?/i);
  if (plainMatch?.[1]?.trim()) {
    return plainMatch[1].trim();
  }
  return fallback;
}

/**
 * Fetches verified backend transaction/invoice details for `txRef`, retrieves the PDF receipt
 * generated by the backend from those verified records, and triggers a browser file download.
 */
export async function fetchAndDownloadVerifiedPdfReceipt(
  txRef: string,
  options?: { fallbackFilename?: string; pdfUrl?: string },
): Promise<VerifiedPdfReceiptResult> {
  const cleanRef = String(txRef || '').trim();
  if (!cleanRef) {
    throw new PdfReceiptDownloadError('Transaction reference is required to download a PDF receipt.', 'INVALID_TX_REF', 400);
  }

  const metaRes = await fetch(`/api/invoices/${encodeURIComponent(cleanRef)}`);
  const metaJson = await metaRes.json().catch(() => null);
  if (!metaRes.ok || !metaJson?.ok) {
    throw new PdfReceiptDownloadError(
      typeof metaJson?.message === 'string' && metaJson.message.trim()
        ? metaJson.message
        : `Unable to load verified transaction details for ${cleanRef} (HTTP ${metaRes.status}).`,
      typeof metaJson?.code === 'string' && metaJson.code.trim()
        ? metaJson.code
        : `HTTP_${metaRes.status || 500}`,
      metaRes.status || null,
    );
  }

  const invoiceMeta = (metaJson.invoice && typeof metaJson.invoice === 'object' ? metaJson.invoice : null) as Record<string, unknown> | null;
  const transactionMeta = (metaJson.transaction && typeof metaJson.transaction === 'object' ? metaJson.transaction : null) as Record<string, unknown> | null;
  const pdfEndpoint =
    (typeof invoiceMeta?.pdf_url === 'string' && invoiceMeta.pdf_url) ||
    options?.pdfUrl ||
    `/api/invoices/${encodeURIComponent(cleanRef)}/pdf`;

  const pdfRes = await fetch(pdfEndpoint, {
    headers: { Accept: 'application/pdf' },
  });
  if (!pdfRes.ok) {
    const errJson = await pdfRes.json().catch(() => null);
    throw new PdfReceiptDownloadError(
      typeof errJson?.message === 'string' && errJson.message.trim()
        ? errJson.message
        : `Backend PDF generation failed for ${cleanRef} (HTTP ${pdfRes.status}).`,
      typeof errJson?.code === 'string' && errJson.code.trim()
        ? errJson.code
        : `HTTP_${pdfRes.status || 500}`,
      pdfRes.status || null,
    );
  }

  const blob = await pdfRes.blob();
  if (blob.size === 0) {
    throw new PdfReceiptDownloadError('Received an empty PDF receipt from backend.', 'EMPTY_PDF_RESPONSE', 502);
  }

  const metaFilename =
    typeof invoiceMeta?.filename === 'string' && invoiceMeta.filename.trim()
      ? invoiceMeta.filename.trim()
      : options?.fallbackFilename || `${cleanRef}.pdf`;
  const filename = parseContentDispositionFilename(pdfRes.headers.get('Content-Disposition'), metaFilename);

  if (typeof window !== 'undefined' && typeof document !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  }

  return {
    filename,
    sizeBytes: blob.size,
    invoice: invoiceMeta,
    transaction: transactionMeta,
  };
}

