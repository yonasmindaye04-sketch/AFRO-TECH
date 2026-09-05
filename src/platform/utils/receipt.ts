import { fmtMoney, fmtDateTime } from '../api'

export interface ReceiptItem {
  name: string
  quantity: number
  unit_price: number
  line_total: number
  sold_as_pills?: boolean
}

export interface ReceiptData {
  business_name?: string
  tin_number?: string
  vat_number?: string
  business_phone?: string
  business_address?: string
  receipt_header?: string
  receipt_footer?: string
  currency?: string
  tax_rate?: number

  invoice_no?: string
  created_at?: string
  cashier_name?: string
  customer_name?: string

  items: ReceiptItem[]
  subtotal: number
  discount: number
  tax_amount?: number
  total: number
  payment_method: string
  amount_paid: number
  change_due: number
}

/** Generate clean, thermal-printer friendly HTML for an 80mm receipt */
export function generateThermalReceiptHtml(data: ReceiptData): string {
  const currency = data.currency || 'ETB'
  const title = (data.business_name || 'AFRO SUITE STORE').trim()
  const dateStr = data.created_at ? fmtDateTime(data.created_at) : fmtDateTime(new Date())

  // Calculate tax if tax_rate is present and tax_amount is not explicitly set
  let taxLine = ''
  if (data.tax_amount !== undefined && data.tax_amount > 0) {
    taxLine = `
      <tr>
        <td>Tax / VAT:</td>
        <td class="text-right">${fmtMoney(data.tax_amount)} ${currency}</td>
      </tr>`
  } else if (data.tax_rate !== undefined && data.tax_rate > 0) {
    const computedTax = (data.total * data.tax_rate) / (100 + data.tax_rate)
    taxLine = `
      <tr>
        <td>VAT (${data.tax_rate}% incl.):</td>
        <td class="text-right">${fmtMoney(computedTax)} ${currency}</td>
      </tr>`
  }

  const itemsRows = data.items
    .map((it) => {
      const pillLabel = it.sold_as_pills ? ' (pills)' : ''
      return `
        <tr>
          <td colspan="3" class="bold" style="padding-top: 4px;">${escapeHtml(it.name)}${pillLabel}</td>
        </tr>
        <tr>
          <td style="padding-left: 8px;">${it.quantity} × ${fmtMoney(it.unit_price)}</td>
          <td></td>
          <td class="text-right">${fmtMoney(it.line_total)}</td>
        </tr>`
    })
    .join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Receipt ${data.invoice_no ? '#' + data.invoice_no : ''}</title>
  <style>
    @page {
      size: 80mm auto;
      margin: 0;
    }
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }
    html, body {
      width: 80mm;
      background: #fff;
      color: #000;
      font-family: 'Courier New', Courier, 'Lucida Console', Monaco, monospace;
      font-size: 12px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .receipt {
      width: 72mm;
      margin: 0 auto;
      padding: 6mm 0 10mm 0;
    }
    .text-center { text-align: center; }
    .text-right { text-align: right; }
    .text-left { text-align: left; }
    .bold { font-weight: bold; }
    .header-title {
      font-size: 15px;
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 2px;
    }
    .header-sub {
      font-size: 11px;
      margin-bottom: 2px;
    }
    .tax-box {
      border-top: 1px dashed #000;
      border-bottom: 1px dashed #000;
      padding: 4px 0;
      margin: 5px 0;
      font-size: 11px;
    }
    .divider {
      border: none;
      border-top: 1px dashed #000;
      margin: 5px 0;
    }
    .divider-double {
      border: none;
      border-top: 2px solid #000;
      margin: 6px 0;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .items-table th {
      border-bottom: 1px dashed #000;
      padding-bottom: 3px;
      font-size: 10px;
      text-transform: uppercase;
    }
    .totals-table td {
      padding: 1px 0;
    }
    .total-row {
      font-size: 14px;
      font-weight: 800;
    }
    .footer {
      margin-top: 8px;
      font-size: 10.5px;
      text-align: center;
      line-height: 1.3;
    }
  </style>
</head>
<body>
  <div class="receipt">
    <!-- Header -->
    <div class="text-center">
      <div class="header-title">${escapeHtml(title)}</div>
      ${data.receipt_header ? `<div class="header-sub">${escapeHtml(data.receipt_header)}</div>` : ''}
      ${data.business_address ? `<div class="header-sub">${escapeHtml(data.business_address)}</div>` : ''}
      ${data.business_phone ? `<div class="header-sub">Tel: ${escapeHtml(data.business_phone)}</div>` : ''}
    </div>

    <!-- TIN and VAT Numbers -->
    ${
      data.tin_number || data.vat_number
        ? `<div class="tax-box text-center">
            ${data.tin_number ? `<div><strong>TIN:</strong> ${escapeHtml(data.tin_number)}</div>` : ''}
            ${data.vat_number ? `<div><strong>VAT Reg:</strong> ${escapeHtml(data.vat_number)}</div>` : ''}
          </div>`
        : '<div class="divider"></div>'
    }

    <!-- Transaction Metadata -->
    <table>
      <tbody>
        <tr>
          <td><strong>Invoice #:</strong></td>
          <td class="text-right"><strong>${escapeHtml(data.invoice_no || '—')}</strong></td>
        </tr>
        <tr>
          <td>Date:</td>
          <td class="text-right">${dateStr}</td>
        </tr>
        ${data.cashier_name ? `<tr><td>Cashier:</td><td class="text-right">${escapeHtml(data.cashier_name)}</td></tr>` : ''}
        ${data.customer_name ? `<tr><td>Customer:</td><td class="text-right">${escapeHtml(data.customer_name)}</td></tr>` : ''}
      </tbody>
    </table>

    <div class="divider"></div>

    <!-- Items List -->
    <table class="items-table">
      <thead>
        <tr>
          <th class="text-left" style="width: 55%;">Item / Qty</th>
          <th style="width: 10%;"></th>
          <th class="text-right" style="width: 35%;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${itemsRows}
      </tbody>
    </table>

    <div class="divider"></div>

    <!-- Totals -->
    <table class="totals-table">
      <tbody>
        <tr>
          <td>Subtotal:</td>
          <td class="text-right">${fmtMoney(data.subtotal)} ${currency}</td>
        </tr>
        ${
          data.discount > 0
            ? `<tr>
                <td>Discount:</td>
                <td class="text-right">-${fmtMoney(data.discount)} ${currency}</td>
              </tr>`
            : ''
        }
        ${taxLine}
        <tr class="divider-row"><td colspan="2"><div class="divider-double"></div></td></tr>
        <tr class="total-row">
          <td>TOTAL:</td>
          <td class="text-right">${fmtMoney(data.total)} ${currency}</td>
        </tr>
        <tr class="divider-row"><td colspan="2"><div class="divider"></div></td></tr>
        <tr>
          <td>Paid (${escapeHtml(data.payment_method)}):</td>
          <td class="text-right">${fmtMoney(data.amount_paid)} ${currency}</td>
        </tr>
        <tr>
          <td>Change:</td>
          <td class="text-right">${fmtMoney(data.change_due)} ${currency}</td>
        </tr>
      </tbody>
    </table>

    <div class="divider"></div>

    <!-- Footer -->
    <div class="footer">
      <div>${escapeHtml(data.receipt_footer || 'Thank you for your business!')}</div>
      <div style="margin-top: 5px; color: #555; font-size: 9.5px;">*** Powered by AFRO-TECH ***</div>
    </div>
  </div>
</body>
</html>`
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

/** Print the 80mm thermal receipt through an isolated zero-margin iframe */
export function printThermal80mm(data: ReceiptData): Promise<void> {
  return new Promise((resolve) => {
    const html = generateThermalReceiptHtml(data)
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '100%'
    iframe.style.bottom = '100%'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document || iframe.contentDocument
    if (!doc) {
      document.body.removeChild(iframe)
      resolve()
      return
    }

    doc.open()
    doc.write(html)
    doc.close()

    // Allow browser layout engine to paint before triggering print
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus()
        iframe.contentWindow?.print()
      } catch (err) {
        console.error('Failed to trigger receipt print', err)
      } finally {
        setTimeout(() => {
          if (iframe.parentNode) document.body.removeChild(iframe)
          resolve()
        }, 1000)
      }
    }, 250)
  })
}
