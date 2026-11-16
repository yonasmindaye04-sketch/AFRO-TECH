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
