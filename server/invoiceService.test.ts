import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvoiceData,
  buildInvoiceListItem,
  buildInvoiceNumber,
  ensureAndDispatchInvoice,
  filterInvoiceHistoryItems,
  generateInvoicePdfBuffer,
  resolveEmailTransportConfig,
  sendInvoiceEmail,
} from './invoiceService.js';

test('buildInvoiceNumber formats deterministic invoice IDs from txRef and timestamp', () => {
  const num = buildInvoiceNumber('CHAPA-SVC-73616148', '2026-11-15T12:00:00.000Z');
  assert.equal(num, 'INV-20261115-73616148');
});

test('buildInvoiceData normalizes Chapa, TeleBirr, and M-Pesa settled transactions', () => {
  const chapa = buildInvoiceData(
    {
      tx_ref: 'CHAPA-SVC-1001',
      provider: 'chapa',
      amount: 4000,
      currency: 'ETB',
      customer_name: 'Abebe Bikila',
      customer_email: 'abebe@asella.et',
      description: 'Landing Page (40% Deposit)',
      mode: 'sandbox',
      settled_at: '2026-11-15T12:00:00.000Z',
    },
    { name: 'AFRO-TECH Digital Services', tin_number: '0049182711' },
  );
  assert.equal(chapa.providerLabel, 'Chapa Multi-Rail');
  assert.equal(chapa.totalPaid, 4000);
  assert.equal(chapa.merchant.tinNumber, '0049182711');

  const telebirr = buildInvoiceData({
    tx_ref: 'TB-SVC-2002',
    provider: 'telebirr',
    amount: 10000,
    customer_name: 'Sara Tadesse',
    customer_email: 'sara@ethio.et',
    description: 'ERP Deployment',
    payer_reference: 'TB-PAY-991',
  });
  assert.equal(telebirr.providerLabel, 'TeleBirr SuperApp');
  assert.equal(telebirr.payerReference, 'TB-PAY-991');

  const mpesa = buildInvoiceData({
    tx_ref: 'MPESA-SVC-3003',
    provider: 'mpesa',
    amount: 6500,
    customer_name: 'Dawit Mekonnen',
    customer_email: 'dawit@safaricom.et',
    customer_phone: '+251711223344',
    description: 'POS Terminal Setup',
    fee_amount: 162.5,
  });
  assert.equal(mpesa.providerLabel, 'Safaricom M-Pesa Ethiopia');
  assert.equal(mpesa.netAmount, 6337.5);
});

test('generateInvoicePdfBuffer emits a valid non-empty PDF document', async () => {
  const invoiceData = buildInvoiceData({
    tx_ref: 'MPESA-SVC-99887766',
    provider: 'mpesa',
    amount: 4000,
    currency: 'ETB',
    customer_name: 'Abebe Bikila',
    customer_email: 'abebe@asella.et',
    customer_phone: '+251711223344',
    description: 'Landing Page (40% Deposit)',
    payer_reference: 'QJK412MPESA',
    mode: 'live',
    settled_at: '2026-11-15T12:15:00.000Z',
  });

  const pdfBuffer = await generateInvoicePdfBuffer(invoiceData);
  assert.ok(Buffer.isBuffer(pdfBuffer));
  assert.ok(pdfBuffer.length > 1200);
  assert.equal(pdfBuffer.subarray(0, 5).toString('utf8'), '%PDF-');
});

test('sendInvoiceEmail sends PDF attachment via nodemailer SMTP when configured', async () => {
  const invoiceData = buildInvoiceData({
    tx_ref: 'CHAPA-SVC-554433',
    provider: 'chapa',
    amount: 12000,
    customer_name: 'Hanna Tesfaye',
    customer_email: 'hanna@company.et',
    description: 'Business Website',
  });
  const pdfBuffer = await generateInvoicePdfBuffer(invoiceData);

  const sentPayloads = [];
  const fakeNodemailer = {
    createTransport(cfg) {
      assert.equal(cfg.service, 'gmail');
      assert.equal(cfg.auth.user, 'billing@afrotech.et');
      return {
        async sendMail(mail) {
          sentPayloads.push(mail);
          return { messageId: '<msg-smtp-123@afrotech.et>' };
        },
      };
    },
  };

  const res = await sendInvoiceEmail(invoiceData, pdfBuffer, {
    env: { EMAIL: 'billing@afrotech.et', EMAIL_PASS: 'app-secret-pass' },
    nodemailerImpl: fakeNodemailer,
  });

  assert.equal(res.sent, true);
  assert.equal(res.deliveryStatus, 'sent');
  assert.equal(res.transport, 'smtp');
  assert.equal(res.messageId, '<msg-smtp-123@afrotech.et>');
  assert.equal(sentPayloads.length, 1);
  assert.equal(sentPayloads[0].to, 'hanna@company.et');
  assert.equal(sentPayloads[0].attachments.length, 1);
  assert.equal(sentPayloads[0].attachments[0].contentType, 'application/pdf');
  assert.ok(Buffer.isBuffer(sentPayloads[0].attachments[0].content));
});

test('sendInvoiceEmail supports Resend API with base64 PDF attachment', async () => {
  const invoiceData = buildInvoiceData({
    tx_ref: 'TB-SVC-778899',
    provider: 'telebirr',
    amount: 7500,
    customer_name: 'Yonas Kebede',
    customer_email: 'yonas@example.et',
    description: 'TeleBirr Integration Milestone',
  });
  const pdfBuffer = await generateInvoicePdfBuffer(invoiceData);

  let capturedFetch = null;
  const res = await sendInvoiceEmail(invoiceData, pdfBuffer, {
    env: { RESEND_API_KEY: 're_test_123', RESEND_FROM_EMAIL: 'billing@afrotech.et' },
    fetchImpl: async (url, init) => {
      capturedFetch = { url, init: { ...init, body: JSON.parse(init.body) } };
      return new Response(JSON.stringify({ id: 'resend_email_99' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  assert.equal(res.sent, true);
  assert.equal(res.transport, 'resend');
  assert.equal(res.messageId, 'resend_email_99');
  assert.equal(capturedFetch.url, 'https://api.resend.com/emails');
  assert.equal(capturedFetch.init.body.to[0], 'yonas@example.et');
  assert.equal(capturedFetch.init.body.attachments[0].filename, `${invoiceData.invoiceNumber}.pdf`);
});

test('sendInvoiceEmail falls back cleanly to sandbox_outbox or skipped_no_email without throwing', async () => {
  const withEmail = buildInvoiceData({
    tx_ref: 'MPESA-SVC-1122',
    provider: 'mpesa',
    amount: 4000,
    customer_name: 'Mekdes Alemu',
    customer_email: 'mekdes@example.et',
  });
  const pdfBuffer = await generateInvoicePdfBuffer(withEmail);

  assert.equal(resolveEmailTransportConfig({}).mode, 'sandbox_outbox');
  const outboxRes = await sendInvoiceEmail(withEmail, pdfBuffer, { env: {} });
  assert.equal(outboxRes.sent, false);
  assert.equal(outboxRes.deliveryStatus, 'sandbox_outbox');
  assert.equal(outboxRes.recipientEmail, 'mekdes@example.et');

  const noEmail = buildInvoiceData({
    tx_ref: 'MPESA-SVC-1123',
    provider: 'mpesa',
    amount: 4000,
    customer_name: 'Walk-in Payer',
  });
  const skipRes = await sendInvoiceEmail(noEmail, pdfBuffer, { env: {} });
  assert.equal(skipRes.sent, false);
  assert.equal(skipRes.deliveryStatus, 'skipped_no_email');
});

test('ensureAndDispatchInvoice is idempotent for repeat webhook/verify calls and supports explicit resend', async () => {
  const invoiceStore = new Map();
  let sendCalls = 0;
  const fakeNodemailer = {
    createTransport() {
      return {
        async sendMail() {
          sendCalls += 1;
          return { messageId: `<msg-${sendCalls}@afrotech.et>` };
        },
      };
    },
  };

  const order = {
    tx_ref: 'CHAPA-SVC-IDEMP01',
    provider: 'chapa',
    amount: 8500,
    currency: 'ETB',
    customer_name: 'Bereket Solomon',
    customer_email: 'bereket@company.et',
    description: 'ERP Setup Deposit',
    status: 'settled',
    settled_at: '2026-11-15T12:30:00.000Z',
  };

  const first = await ensureAndDispatchInvoice({
    txRef: order.tx_ref,
    orderOrIntent: order,
    invoiceStore,
    sendOptions: {
      env: { EMAIL: 'billing@afrotech.et', EMAIL_PASS: 'secret' },
      nodemailerImpl: fakeNodemailer,
    },
  });
  assert.equal(first.skippedDuplicate, false);
  assert.equal(first.invoice.send_count, 1);
  assert.equal(sendCalls, 1);

  const duplicate = await ensureAndDispatchInvoice({
    txRef: order.tx_ref,
    orderOrIntent: order,
    invoiceStore,
    sendOptions: {
      env: { EMAIL: 'billing@afrotech.et', EMAIL_PASS: 'secret' },
      nodemailerImpl: fakeNodemailer,
    },
  });
  assert.equal(duplicate.skippedDuplicate, true);
  assert.equal(sendCalls, 1);

  const resent = await ensureAndDispatchInvoice({
    txRef: order.tx_ref,
    orderOrIntent: order,
    invoiceStore,
    forceResend: true,
    overrideEmail: 'finance@company.et',
    sendOptions: {
      env: { EMAIL: 'billing@afrotech.et', EMAIL_PASS: 'secret' },
      nodemailerImpl: fakeNodemailer,
    },
  });
  assert.equal(resent.skippedDuplicate, false);
  assert.equal(sendCalls, 2);
  assert.equal(resent.invoice.send_count, 2);
  assert.equal(resent.invoice.recipient_email, 'finance@company.et');
});

test('buildInvoiceListItem and filterInvoiceHistoryItems summarize, filter, and sort invoices newest first', () => {
  const older = buildInvoiceListItem(
    {
      tx_ref: 'CHAPA-SVC-OLD01',
      provider: 'chapa',
      amount: 4000,
      currency: 'ETB',
      customer_name: 'Abebe Bikila',
      customer_email: 'abebe@asella.et',
      description: 'Landing Page',
      status: 'settled',
      settled_at: '2026-11-10T10:00:00.000Z',
    },
    { name: 'AFRO-TECH Digital Services' },
  );
  const newer = buildInvoiceListItem(
    {
      tx_ref: 'MPESA-SVC-NEW02',
      provider: 'mpesa',
      amount: 6500,
      currency: 'ETB',
      customer_name: 'Sara Tadesse',
      customer_email: 'sara@asella.et',
      description: 'POS Terminal Setup',
      status: 'settled',
      settled_at: '2026-11-15T14:00:00.000Z',
    },
    { name: 'AFRO-TECH Digital Services' },
  );

  assert.equal(older.pdf_url, '/api/invoices/CHAPA-SVC-OLD01/pdf');
  assert.equal(newer.provider_label, 'Safaricom M-Pesa Ethiopia');

  const all = filterInvoiceHistoryItems([older, newer]);
  assert.equal(all.length, 2);
  assert.equal(all[0].tx_ref, 'MPESA-SVC-NEW02');

  const mpesaOnly = filterInvoiceHistoryItems([older, newer], { provider: 'mpesa' });
  assert.equal(mpesaOnly.length, 1);
  assert.equal(mpesaOnly[0].invoice_number, newer.invoice_number);

  const queryMatch = filterInvoiceHistoryItems([older, newer], { query: 'abebe@asella.et' });
  assert.equal(queryMatch.length, 1);
  assert.equal(queryMatch[0].tx_ref, 'CHAPA-SVC-OLD01');
});

