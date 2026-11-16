import crypto from 'node:crypto';
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

export const PROVIDER_DISPLAY_NAMES = {
  chapa: 'Chapa Multi-Rail',
  telebirr: 'TeleBirr SuperApp',
  mpesa: 'Safaricom M-Pesa Ethiopia',
  cbe_bank: 'Commercial Bank of Ethiopia',
  stripe: 'Stripe Global Cards',
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(email) {
  return EMAIL_REGEX.test(String(email || '').trim());
}

export function buildInvoiceNumber(txRef, issuedAt = new Date().toISOString()) {
  const datePart = String(issuedAt).slice(0, 10).replace(/-/g, '') || '20260101';
  const cleanRef = String(txRef || 'TXN')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(-8) || '00000000';
  return `INV-${datePart}-${cleanRef}`;
}

export function formatInvoiceMoney(amount, currency = 'ETB') {
  const num = Number(amount || 0);
  const formatted = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(num) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(num);
  return `${formatted} ${currency}`;
}

export function buildInvoiceData(orderOrIntent, merchantInfo = {}, options = {}) {
  const txRef = String(orderOrIntent?.tx_ref || 'TXN-UNKNOWN').trim();
  const provider = String(orderOrIntent?.provider || 'chapa').trim().toLowerCase();
  const providerLabel = PROVIDER_DISPLAY_NAMES[provider] || provider.toUpperCase();
  const issuedAt = options.issuedAt || orderOrIntent?.settled_at || new Date().toISOString();
  const invoiceNumber = options.invoiceNumber || buildInvoiceNumber(txRef, issuedAt);
  const currency = String(orderOrIntent?.currency || 'ETB').trim().toUpperCase();
  const grossAmount = Math.round(Number(orderOrIntent?.amount || 0) * 100) / 100;
  const feeAmount = Math.round(Number(orderOrIntent?.fee_amount || 0) * 100) / 100;
  const netAmount =
    orderOrIntent?.net_amount !== undefined && orderOrIntent?.net_amount !== null
      ? Math.round(Number(orderOrIntent.net_amount) * 100) / 100
      : Math.round(Math.max(0, grossAmount - feeAmount) * 100) / 100;

  const customerName = String(
    orderOrIntent?.customer_name || orderOrIntent?.party_name || 'Valued Customer',
  ).trim();
  const customerEmailRaw = String(
    options.overrideEmail ?? orderOrIntent?.customer_email ?? orderOrIntent?.payer_email ?? '',
  ).trim();
  const customerEmail = isValidEmail(customerEmailRaw) ? customerEmailRaw : '';
  const customerPhone = String(orderOrIntent?.customer_phone || '').trim();

  const description = String(
    orderOrIntent?.description || orderOrIntent?.service_name || 'Digital Service Payment',
  ).trim();
  const payerReference = String(
    orderOrIntent?.payer_reference || orderOrIntent?.chapa_reference || txRef,
  ).trim();
  const mode = String(orderOrIntent?.mode || 'sandbox').toLowerCase() === 'live' ? 'live' : 'sandbox';

  const merchantName = String(merchantInfo?.name || 'AFRO-TECH Digital Services').trim();
  const merchantAddress = String(merchantInfo?.address || 'Bole Sub-City, Addis Ababa, Ethiopia').trim();
  const merchantPhone = String(merchantInfo?.phone || '+251 910 011 818').trim();
  const merchantTin = merchantInfo?.tin_number ? String(merchantInfo.tin_number).trim() : null;
  const merchantEmail = String(
    merchantInfo?.email || process.env.CONTACT_EMAIL || process.env.EMAIL || 'billing@afrotech.et',
  ).trim();

  const verificationDigest = crypto
    .createHmac('sha256', options.signingSecret || process.env.INVOICE_SIGNING_SECRET || 'afro-invoice-verify')
    .update(`${invoiceNumber}:${txRef}:${grossAmount}:${currency}:${issuedAt}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();

  return {
    invoiceNumber,
    txRef,
    provider,
    providerLabel,
    mode,
    status: 'PAID',
    issuedAt,
    settledAt: orderOrIntent?.settled_at || issuedAt,
    currency,
    subtotal: grossAmount,
    feeAmount,
    netAmount,
    totalPaid: grossAmount,
    payerReference,
    glVoucherNo: orderOrIntent?.gl_voucher_no || null,
    verificationDigest,
    merchant: {
      name: merchantName,
      address: merchantAddress,
      phone: merchantPhone,
      email: merchantEmail,
      tinNumber: merchantTin,
    },
    customer: {
      name: customerName,
      email: customerEmail,
      phone: customerPhone,
    },
    lineItems: [
      {
        description,
        quantity: 1,
        unitPrice: grossAmount,
        total: grossAmount,
      },
    ],
  };
}

export function generateInvoicePdfBuffer(invoiceData) {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 48 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      const startX = doc.page.margins.left;

      // Top dark banner header
      doc.rect(startX, 42, pageWidth, 84).fill('#121318');
      doc
        .fillColor('#D4A64A')
        .font('Helvetica-Bold')
        .fontSize(18)
        .text(invoiceData.merchant.name, startX + 20, 58, { width: 300 });
      doc
        .fillColor('#C7C9D1')
        .font('Helvetica')
        .fontSize(9)
        .text(invoiceData.merchant.address, startX + 20, 82, { width: 300 })
        .text(
          `Tel: ${invoiceData.merchant.phone}${invoiceData.merchant.tinNumber ? `  |  TIN: ${invoiceData.merchant.tinNumber}` : ''}`,
          startX + 20,
          96,
          { width: 300 },
        );

      // Right side PAID badge & Invoice #
      doc
        .roundedRect(startX + pageWidth - 135, 56, 115, 22, 4)
        .fill('#0F5132');
      doc
        .fillColor('#D1FAE5')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text('PAID INVOICE', startX + pageWidth - 135, 62, { width: 115, align: 'center' });
      doc
        .fillColor('#FFFFFF')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(invoiceData.invoiceNumber, startX + pageWidth - 190, 86, { width: 170, align: 'right' });
      doc
        .fillColor('#A7ABB8')
        .font('Helvetica')
        .fontSize(8.5)
        .text(`Issued: ${String(invoiceData.issuedAt).slice(0, 19).replace('T', ' ')} UTC`, startX + pageWidth - 190, 100, {
          width: 170,
          align: 'right',
        });

      // Customer & Transaction Details Grid
      let y = 148;
      doc
        .fillColor('#6B7280')
        .font('Helvetica-Bold')
        .fontSize(8.5)
        .text('BILLED TO', startX, y)
        .text('PAYMENT SETTLEMENT', startX + pageWidth / 2 + 12, y);

      y += 14;
      doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(11)
        .text(invoiceData.customer.name, startX, y, { width: pageWidth / 2 - 12 });
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#374151')
        .text(invoiceData.customer.email || 'Receipt email not supplied', startX, y + 16, { width: pageWidth / 2 - 12 });
      if (invoiceData.customer.phone) {
        doc.text(`Phone: ${invoiceData.customer.phone}`, startX, y + 30, { width: pageWidth / 2 - 12 });
      }

      const rightColX = startX + pageWidth / 2 + 12;
      doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(10)
        .text(`Gateway: ${invoiceData.providerLabel}`, rightColX, y, { width: pageWidth / 2 - 12 })
        .font('Helvetica')
        .fontSize(9)
        .fillColor('#374151')
        .text(`Tx Ref: ${invoiceData.txRef}`, rightColX, y + 16, { width: pageWidth / 2 - 12 })
        .text(`Confirmation Ref: ${invoiceData.payerReference}`, rightColX, y + 30, { width: pageWidth / 2 - 12 })
        .text(
          `Channel Mode: ${invoiceData.mode.toUpperCase()}${invoiceData.glVoucherNo ? `  |  GL: ${invoiceData.glVoucherNo}` : ''}`,
          rightColX,
          y + 44,
          { width: pageWidth / 2 - 12 },
        );

      // Line Items Table
      y = 236;
      doc.rect(startX, y, pageWidth, 26).fill('#F3F4F6');
      doc
        .fillColor('#111827')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('DESCRIPTION', startX + 10, y + 8, { width: 250 })
        .text('QTY', startX + 270, y + 8, { width: 45, align: 'right' })
        .text('UNIT PRICE', startX + 325, y + 8, { width: 85, align: 'right' })
        .text('AMOUNT', startX + 415, y + 8, { width: pageWidth - 425, align: 'right' });

      y += 26;
      for (const item of invoiceData.lineItems) {
        doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor('#E5E7EB').stroke();
        doc
          .fillColor('#1F2937')
          .font('Helvetica')
          .fontSize(10)
          .text(item.description, startX + 10, y + 12, { width: 250 })
          .text(String(item.quantity), startX + 270, y + 12, { width: 45, align: 'right' })
          .text(formatInvoiceMoney(item.unitPrice, invoiceData.currency), startX + 325, y + 12, {
            width: 85,
            align: 'right',
          })
          .font('Helvetica-Bold')
          .text(formatInvoiceMoney(item.total, invoiceData.currency), startX + 415, y + 12, {
            width: pageWidth - 425,
            align: 'right',
          });
        y += 42;
      }
      doc.moveTo(startX, y).lineTo(startX + pageWidth, y).strokeColor('#D1D5DB').stroke();

      // Totals Summary Block
      y += 18;
      const totalsLabelX = startX + pageWidth - 220;
      const totalsValX = startX + pageWidth - 110;
      doc
        .font('Helvetica')
        .fontSize(9.5)
        .fillColor('#4B5563')
        .text('Subtotal', totalsLabelX, y, { width: 100 })
        .fillColor('#111827')
        .text(formatInvoiceMoney(invoiceData.subtotal, invoiceData.currency), totalsValX, y, {
          width: 110,
          align: 'right',
        });

      if (invoiceData.feeAmount > 0) {
        y += 18;
        doc
          .fillColor('#4B5563')
          .text('Gateway Fee (included)', totalsLabelX, y, { width: 115 })
          .fillColor('#111827')
          .text(formatInvoiceMoney(invoiceData.feeAmount, invoiceData.currency), totalsValX, y, {
            width: 110,
            align: 'right',
          });
      }

      y += 22;
      doc.rect(totalsLabelX - 10, y - 6, 230, 30).fill('#121318');
      doc
        .fillColor('#D4A64A')
        .font('Helvetica-Bold')
        .fontSize(10.5)
        .text('TOTAL PAID', totalsLabelX, y + 3, { width: 105 })
        .fillColor('#FFFFFF')
        .text(formatInvoiceMoney(invoiceData.totalPaid, invoiceData.currency), totalsValX, y + 3, {
          width: 110,
          align: 'right',
        });

      // Digital Verification Footer
      const footerY = 710;
      doc.moveTo(startX, footerY).lineTo(startX + pageWidth, footerY).strokeColor('#E5E7EB').stroke();
      doc
        .fillColor('#374151')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('Automated Payment Receipt & Tax Invoice Verification', startX, footerY + 12)
        .font('Helvetica')
        .fontSize(8.5)
        .fillColor('#6B7280')
        .text(
          `Settled via ${invoiceData.providerLabel} · Verification Stamp: ${invoiceData.verificationDigest} · Support: ${invoiceData.merchant.email}`,
          startX,
          footerY + 26,
          { width: pageWidth },
        )
        .text(
          'Thank you for your business. This PDF invoice was automatically generated upon verified payment confirmation.',
          startX,
          footerY + 42,
          { width: pageWidth },
        );

      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

export function buildInvoiceEmailText(invoiceData) {
  return [
    `Hello ${invoiceData.customer.name},`,
    '',
    `Your payment of ${formatInvoiceMoney(invoiceData.totalPaid, invoiceData.currency)} via ${invoiceData.providerLabel} has been verified.`,
    '',
    `Invoice Number: ${invoiceData.invoiceNumber}`,
    `Transaction Ref: ${invoiceData.txRef}`,
    `Gateway Confirmation Ref: ${invoiceData.payerReference}`,
    `Item: ${invoiceData.lineItems[0]?.description || 'Digital Service Payment'}`,
    `Status: PAID (${invoiceData.mode.toUpperCase()})`,
    '',
    `Your official PDF invoice (${invoiceData.invoiceNumber}.pdf) is attached to this email.`,
    '',
    `Issued by ${invoiceData.merchant.name}`,
    `${invoiceData.merchant.address} · ${invoiceData.merchant.phone}`,
  ].join('\n');
}

export function buildInvoiceEmailHtml(invoiceData) {
  const esc = (s) =>
    String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  return `<!doctype html>
<html>
<body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#111827;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;">
    <div style="background:#121318;padding:20px 24px;color:#ffffff;">
      <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#d4a64a;font-weight:700;">Payment Confirmed · Paid Invoice</div>
      <h1 style="margin:6px 0 0;font-size:20px;color:#ffffff;">${esc(invoiceData.merchant.name)}</h1>
    </div>
    <div style="padding:24px;">
      <p style="margin:0 0 14px;font-size:15px;">Hello <strong>${esc(invoiceData.customer.name)}</strong>,</p>
      <p style="margin:0 0 18px;font-size:14px;color:#374151;line-height:1.5;">
        Thank you for your payment. Your transaction via <strong>${esc(invoiceData.providerLabel)}</strong> has been confirmed, and your PDF invoice is attached to this message.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:13px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;">
        <tr><td style="padding:10px 12px;color:#6b7280;">Invoice Number</td><td style="padding:10px 12px;text-align:right;font-weight:700;">${esc(invoiceData.invoiceNumber)}</td></tr>
        <tr><td style="padding:10px 12px;color:#6b7280;border-top:1px solid #e5e7eb;">Transaction Ref</td><td style="padding:10px 12px;text-align:right;border-top:1px solid #e5e7eb;"><code>${esc(invoiceData.txRef)}</code></td></tr>
        <tr><td style="padding:10px 12px;color:#6b7280;border-top:1px solid #e5e7eb;">Service / Purpose</td><td style="padding:10px 12px;text-align:right;border-top:1px solid #e5e7eb;">${esc(invoiceData.lineItems[0]?.description || 'Payment')}</td></tr>
        <tr><td style="padding:10px 12px;color:#6b7280;border-top:1px solid #e5e7eb;">Amount Paid</td><td style="padding:10px 12px;text-align:right;font-weight:700;color:#059669;border-top:1px solid #e5e7eb;">${esc(formatInvoiceMoney(invoiceData.totalPaid, invoiceData.currency))}</td></tr>
      </table>
      <p style="margin:18px 0 0;font-size:12px;color:#6b7280;">
        Verification Stamp: <code>${esc(invoiceData.verificationDigest)}</code> · Attached: <strong>${esc(invoiceData.invoiceNumber)}.pdf</strong>
      </p>
    </div>
  </div>
</body>
</html>`;
}

export function resolveEmailTransportConfig(env = typeof process !== 'undefined' ? process.env : {}) {
  const resendApiKey = String(env.RESEND_API_KEY || '').trim();
  const resendFrom = String(env.RESEND_FROM_EMAIL || env.EMAIL || env.CONTACT_EMAIL || 'invoices@afrotech.et').trim();
  if (resendApiKey) {
    return {
      mode: 'resend',
      apiKey: resendApiKey,
      from: resendFrom,
    };
  }

  const smtpHost = String(env.SMTP_HOST || '').trim();
  const smtpUser = String(env.SMTP_USER || '').trim();
  const smtpPass = String(env.SMTP_PASS || '').replace(/\s+/g, '');
  const smtpPort = Number(env.SMTP_PORT || 587);
  if (smtpHost && smtpUser && smtpPass) {
    return {
      mode: 'smtp_custom',
      host: smtpHost,
      port: Number.isFinite(smtpPort) ? smtpPort : 587,
      secure: String(env.SMTP_SECURE || '').toLowerCase() === 'true' || smtpPort === 465,
      user: smtpUser,
      pass: smtpPass,
      from: String(env.SMTP_FROM || `"${env.COMPANY_NAME || 'AFRO-TECH'}" <${smtpUser}>`).trim(),
    };
  }

  const gmailUser = String(env.EMAIL || env.CONTACT_USER || '').trim();
  const gmailPass = String(env.EMAIL_PASS || env.CONTACT_PASS || '').replace(/\s+/g, '');
  if (gmailUser && gmailPass) {
    return {
      mode: 'smtp_gmail',
      user: gmailUser,
      pass: gmailPass,
      from: `"AFRO-TECH Billing" <${gmailUser}>`,
    };
  }

  return {
    mode: 'sandbox_outbox',
    from: 'billing@afrotech.et',
  };
}

export async function sendInvoiceEmail(invoiceData, pdfBuffer, options = {}) {
  const recipientEmail = String(options.recipientEmail ?? invoiceData?.customer?.email ?? '').trim();
  const sentAt = new Date().toISOString();
  const filename = `${invoiceData.invoiceNumber}.pdf`;

  if (!isValidEmail(recipientEmail)) {
    return {
      sent: false,
      deliveryStatus: 'skipped_no_email',
      transport: 'none',
      recipientEmail: null,
      messageId: null,
      sentAt: null,
      reason: 'Customer email address was not provided for this transaction.',
    };
  }

  const transportCfg = options.transportConfig || resolveEmailTransportConfig(options.env);
  const subject = `Invoice ${invoiceData.invoiceNumber} · Paid ${formatInvoiceMoney(invoiceData.totalPaid, invoiceData.currency)} (${invoiceData.providerLabel})`;
  const text = buildInvoiceEmailText(invoiceData);
  const html = buildInvoiceEmailHtml(invoiceData);

  if (transportCfg.mode === 'resend') {
    const fetchFn = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchFn !== 'function') {
      return {
        sent: false,
        deliveryStatus: 'failed',
        transport: 'resend',
        recipientEmail,
        messageId: null,
        sentAt: null,
        reason: 'Fetch API unavailable for Resend email dispatch.',
      };
    }
    try {
      const response = await fetchFn('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${transportCfg.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: transportCfg.from,
          to: [recipientEmail],
          subject,
          text,
          html,
          attachments: [
            {
              filename,
              content: Buffer.from(pdfBuffer).toString('base64'),
            },
          ],
        }),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        return {
          sent: false,
          deliveryStatus: 'failed',
          transport: 'resend',
          recipientEmail,
          messageId: null,
          sentAt: null,
          reason: json?.message || `Resend returned HTTP ${response.status}`,
        };
      }
      return {
        sent: true,
        deliveryStatus: 'sent',
        transport: 'resend',
        recipientEmail,
        messageId: json?.id || `resend-${crypto.randomUUID().slice(0, 8)}`,
        sentAt,
        reason: `Emailed PDF invoice via Resend to ${recipientEmail}`,
      };
    } catch (err) {
      return {
        sent: false,
        deliveryStatus: 'failed',
        transport: 'resend',
        recipientEmail,
        messageId: null,
        sentAt: null,
        reason: err instanceof Error ? err.message : 'Resend network error',
      };
    }
  }

  if (transportCfg.mode === 'smtp_custom' || transportCfg.mode === 'smtp_gmail') {
    const mailLib = options.nodemailerImpl ?? nodemailer;
    try {
      const transporter =
        transportCfg.mode === 'smtp_custom'
          ? mailLib.createTransport({
              host: transportCfg.host,
              port: transportCfg.port,
              secure: transportCfg.secure,
              auth: { user: transportCfg.user, pass: transportCfg.pass },
            })
          : mailLib.createTransport({
              service: 'gmail',
              auth: { user: transportCfg.user, pass: transportCfg.pass },
            });

      const info = await transporter.sendMail({
        from: transportCfg.from,
        to: recipientEmail,
        subject,
        text,
        html,
        attachments: [
          {
            filename,
            content: pdfBuffer,
            contentType: 'application/pdf',
          },
        ],
      });

      return {
        sent: true,
        deliveryStatus: 'sent',
        transport: 'smtp',
        recipientEmail,
        messageId: info?.messageId || `smtp-${crypto.randomUUID().slice(0, 8)}`,
        sentAt,
        reason: `Emailed PDF invoice via SMTP to ${recipientEmail}`,
      };
    } catch (err) {
      return {
        sent: false,
        deliveryStatus: 'failed',
        transport: 'smtp',
        recipientEmail,
        messageId: null,
        sentAt: null,
        reason: err instanceof Error ? err.message : 'SMTP delivery failed',
      };
    }
  }

  return {
    sent: false,
    deliveryStatus: 'sandbox_outbox',
    transport: 'sandbox_outbox',
    recipientEmail,
    messageId: `outbox-${crypto.randomUUID().slice(0, 8)}`,
    sentAt,
    reason: `PDF invoice queued in sandbox outbox for ${recipientEmail} (configure SMTP or RESEND_API_KEY for live email delivery).`,
  };
}

export async function ensureAndDispatchInvoice({
  txRef,
  orderOrIntent,
  merchantInfo = {},
  invoiceStore,
  forceResend = false,
  overrideEmail,
  sendOptions = {},
}) {
  if (!orderOrIntent || !txRef) {
    return null;
  }

  const existing = invoiceStore?.get(txRef);
  if (existing && !forceResend) {
    orderOrIntent.invoice = existing.meta;
    return {
      invoice: existing.meta,
      pdfBuffer: existing.pdfBuffer,
      skippedDuplicate: true,
    };
  }

  const normalizedEmail = isValidEmail(overrideEmail)
    ? String(overrideEmail).trim()
    : existing?.meta?.recipient_email || orderOrIntent.customer_email || orderOrIntent.payer_email || '';

  if (isValidEmail(overrideEmail) && !orderOrIntent.customer_email) {
    orderOrIntent.customer_email = String(overrideEmail).trim();
  }

  const invoiceData = buildInvoiceData(orderOrIntent, merchantInfo, {
    invoiceNumber: existing?.meta?.invoice_number,
    issuedAt: existing?.meta?.issued_at,
    overrideEmail: normalizedEmail,
  });

  const pdfBuffer = existing?.pdfBuffer && !isValidEmail(overrideEmail)
    ? existing.pdfBuffer
    : await generateInvoicePdfBuffer(invoiceData);

  const dispatchResult = await sendInvoiceEmail(invoiceData, pdfBuffer, {
    ...sendOptions,
    recipientEmail: normalizedEmail,
  });

  const previousSendCount = existing?.meta?.send_count || 0;
  const filename = `${invoiceData.invoiceNumber}.pdf`;
  const meta = {
    invoice_number: invoiceData.invoiceNumber,
    tx_ref: invoiceData.txRef,
    provider: invoiceData.provider,
    provider_label: invoiceData.providerLabel,
    amount: invoiceData.totalPaid,
    currency: invoiceData.currency,
    recipient_email: dispatchResult.recipientEmail || normalizedEmail || null,
    delivery_status: dispatchResult.deliveryStatus,
    delivery_transport: dispatchResult.transport,
    delivery_reason: dispatchResult.reason,
    message_id: dispatchResult.messageId,
    verification_digest: invoiceData.verificationDigest,
    issued_at: existing?.meta?.issued_at || invoiceData.issuedAt,
    last_sent_at: dispatchResult.sentAt || existing?.meta?.last_sent_at || null,
    send_count: dispatchResult.sent || dispatchResult.deliveryStatus === 'sandbox_outbox'
      ? previousSendCount + 1
      : previousSendCount,
    filename,
    size_bytes: pdfBuffer.length,
    pdf_url: `/api/invoices/${encodeURIComponent(invoiceData.txRef)}/pdf`,
  };

  if (invoiceStore) {
    invoiceStore.set(txRef, { meta, pdfBuffer, invoiceData });
  }
  orderOrIntent.invoice = meta;

  return {
    invoice: meta,
    pdfBuffer,
    skippedDuplicate: false,
  };
}
