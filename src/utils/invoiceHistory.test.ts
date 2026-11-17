import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeInvoiceHistoryStats,
  filterLocalInvoices,
  formatDeliveryStatusLabel,
  formatInvoiceHistoryMoney,
  loadRecentInvoiceContext,
  normalizeInvoiceHistoryQuery,
  parseContentDispositionFilename,
  saveRecentInvoiceContext,
  type InvoiceHistoryItem,
} from './invoiceHistory';

const SAMPLE_INVOICES: InvoiceHistoryItem[] = [
  {
    invoice_number: 'INV-20261115-7E304C85',
    tx_ref: 'TB-SVC-7E304C85',
    provider: 'telebirr',
    provider_label: 'TeleBirr SuperApp',
    customer_name: 'Abebe Bikila',
    customer_email: 'abebe@asella.et',
    description: 'Landing Page (40% Deposit)',
    amount: 4000,
    currency: 'ETB',
    status: 'PAID',
    delivery_status: 'sent',
    delivery_transport: 'smtp',
    recipient_email: 'abebe@asella.et',
    send_count: 1,
    last_sent_at: '2026-11-15T18:00:00.000Z',
    issued_at: '2026-11-15T18:00:00.000Z',
    settled_at: '2026-11-15T18:00:00.000Z',
    filename: 'INV-20261115-7E304C85.pdf',
    pdf_url: '/api/invoices/TB-SVC-7E304C85/pdf',
  },
  {
    invoice_number: 'INV-20261116-84CC6FBE',
    tx_ref: 'MPESA-SVC-84CC6FBE',
    provider: 'mpesa',
    provider_label: 'Safaricom M-Pesa Ethiopia',
    customer_name: 'Dawit Tesfaye',
    customer_email: 'dawit@afro.et',
    description: 'POS Suite Setup',
    amount: 6500,
    currency: 'ETB',
    status: 'PAID',
    delivery_status: 'sandbox_outbox',
    delivery_transport: 'sandbox_outbox',
    recipient_email: 'dawit@afro.et',
    send_count: 1,
    last_sent_at: '2026-11-16T01:00:00.000Z',
    issued_at: '2026-11-16T01:00:00.000Z',
    settled_at: '2026-11-16T01:00:00.000Z',
    filename: 'INV-20261116-84CC6FBE.pdf',
    pdf_url: '/api/invoices/MPESA-SVC-84CC6FBE/pdf',
  },
];

test('normalizeInvoiceHistoryQuery trims whitespace', () => {
  assert.equal(normalizeInvoiceHistoryQuery('  INV-20261115  '), 'INV-20261115');
});

test('filterLocalInvoices filters by provider, query string, and sorts newest first', () => {
  const sortedAll = filterLocalInvoices(SAMPLE_INVOICES);
  assert.equal(sortedAll[0].tx_ref, 'MPESA-SVC-84CC6FBE');
  assert.equal(sortedAll[1].tx_ref, 'TB-SVC-7E304C85');

  const telebirrOnly = filterLocalInvoices(SAMPLE_INVOICES, { provider: 'telebirr' });
  assert.equal(telebirrOnly.length, 1);
  assert.equal(telebirrOnly[0].invoice_number, 'INV-20261115-7E304C85');

  const byRef = filterLocalInvoices(SAMPLE_INVOICES, { query: '84CC6FBE' });
  assert.equal(byRef.length, 1);
  assert.equal(byRef[0].customer_name, 'Dawit Tesfaye');
});

test('computeInvoiceHistoryStats and formatters calculate totals and status strings accurately', () => {
  const stats = computeInvoiceHistoryStats(SAMPLE_INVOICES);
  assert.deepEqual(stats, { count: 2, totalPaidEtb: 10500, emailedCount: 2 });

  assert.equal(formatDeliveryStatusLabel(SAMPLE_INVOICES[0]), 'Emailed to abebe@asella.et');
  assert.equal(formatDeliveryStatusLabel(SAMPLE_INVOICES[1]), 'Outbox queued · dawit@afro.et');
  assert.equal(formatInvoiceHistoryMoney(10500, 'ETB'), '10,500 ETB');
});

test('saveRecentInvoiceContext and loadRecentInvoiceContext persist deduplicated refs and email cleanly', () => {
  const mem = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => {
      mem.set(k, v);
    },
  };

  saveRecentInvoiceContext({ email: 'abebe@asella.et', txRef: 'CHAPA-SVC-101' }, mockStorage);
  saveRecentInvoiceContext({ email: 'abebe@asella.et', txRef: 'MPESA-SVC-202' }, mockStorage);
  saveRecentInvoiceContext({ txRef: 'CHAPA-SVC-101' }, mockStorage);

  const loaded = loadRecentInvoiceContext(mockStorage);
  assert.equal(loaded.email, 'abebe@asella.et');
  assert.deepEqual(loaded.txRefs, ['CHAPA-SVC-101', 'MPESA-SVC-202']);
});

test('parseContentDispositionFilename extracts quoted and UTF-8 filenames safely', () => {
  assert.equal(
    parseContentDispositionFilename('attachment; filename="INV-20261116-TB123.pdf"', 'fallback.pdf'),
    'INV-20261116-TB123.pdf',
  );
  assert.equal(
    parseContentDispositionFilename("attachment; filename*=UTF-8''INV-UTF8-99.pdf", 'fallback.pdf'),
    'INV-UTF8-99.pdf',
  );
  assert.equal(parseContentDispositionFilename(null, 'fallback.pdf'), 'fallback.pdf');
});

