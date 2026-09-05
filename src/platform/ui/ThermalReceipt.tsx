import { useEffect, useState } from 'react'
import { fmtMoney, fmtDateTime } from '../api'
import { printThermal80mm, type ReceiptData } from '../utils/receipt'

interface ThermalReceiptProps {
  data: ReceiptData
  showActions?: boolean
  autoPrint?: boolean
  onDone?: () => void
}

export default function ThermalReceipt({
  data,
  showActions = true,
  autoPrint = false,
  onDone,
}: ThermalReceiptProps): JSX.Element {
  const [printing, setPrinting] = useState(false)
  const currency = data.currency || 'ETB'
  const title = (data.business_name || 'AFRO SUITE STORE').trim()
  const dateStr = data.created_at ? fmtDateTime(data.created_at) : fmtDateTime(new Date())

  // Computed tax
  const computedTax =
    data.tax_amount !== undefined
      ? data.tax_amount
      : data.tax_rate && data.tax_rate > 0
        ? (data.total * data.tax_rate) / (100 + data.tax_rate)
        : 0

  const handlePrint = async (): Promise<void> => {
    setPrinting(true)
    try {
      await printThermal80mm(data)
    } finally {
      setPrinting(false)
    }
  }

  useEffect(() => {
    if (autoPrint) {
      handlePrint()
    }
  }, [])

  return (
    <div className="pl-thermal-wrapper">
      <div className="pl-thermal-receipt" id="pl-thermal-receipt">
        {/* Paper top jagged cut effect */}
        <div className="pl-thermal-paper-top" />

        {/* Business Header */}
        <div className="pl-thermal-header text-center">
          <h3 className="pl-thermal-title">{title}</h3>
          {data.receipt_header && <p className="pl-thermal-sub">{data.receipt_header}</p>}
          {data.business_address && <p className="pl-thermal-sub">{data.business_address}</p>}
          {data.business_phone && <p className="pl-thermal-sub">Tel: {data.business_phone}</p>}
        </div>

        {/* TIN and VAT Section */}
        {(data.tin_number || data.vat_number) && (
          <div className="pl-thermal-tax-box">
            {data.tin_number && (
              <div>
                <strong>TIN:</strong> {data.tin_number}
              </div>
            )}
            {data.vat_number && (
              <div>
                <strong>VAT Reg:</strong> {data.vat_number}
              </div>
            )}
          </div>
        )}

        <div className="pl-thermal-divider" />

        {/* Transaction Metadata */}
        <table className="pl-thermal-table">
          <tbody>
            <tr>
              <td>Invoice:</td>
              <td className="text-right">
                <strong>{data.invoice_no || '—'}</strong>
              </td>
            </tr>
            <tr>
              <td>Date:</td>
              <td className="text-right">{dateStr}</td>
            </tr>
            {data.cashier_name && (
              <tr>
                <td>Cashier:</td>
                <td className="text-right">{data.cashier_name}</td>
              </tr>
            )}
            {data.customer_name && (
              <tr>
                <td>Customer:</td>
                <td className="text-right">{data.customer_name}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="pl-thermal-divider" />

        {/* Itemized Table */}
        <table className="pl-thermal-items-table">
          <thead>
            <tr>
              <th className="text-left">Item / Qty</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.items.map((it, idx) => (
              <tr key={idx} className="pl-thermal-item-row">
                <td>
                  <div className="pl-thermal-item-name">
                    {it.name}
                    {it.sold_as_pills ? ' (pills)' : ''}
                  </div>
                  <div className="pl-thermal-item-meta">
                    {it.quantity} × {fmtMoney(it.unit_price)} {currency}
                  </div>
                </td>
                <td className="text-right bold" style={{ verticalAlign: 'bottom' }}>
                  {fmtMoney(it.line_total)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="pl-thermal-divider" />

        {/* Totals */}
        <table className="pl-thermal-table pl-thermal-totals">
          <tbody>
            <tr>
              <td>Subtotal</td>
              <td className="text-right">
                {fmtMoney(data.subtotal)} {currency}
              </td>
            </tr>
            {data.discount > 0 && (
              <tr>
                <td>Discount</td>
                <td className="text-right">
                  -{fmtMoney(data.discount)} {currency}
                </td>
              </tr>
            )}
            {computedTax > 0 && (
              <tr>
                <td>VAT {data.tax_rate ? `(${data.tax_rate}% incl.)` : ''}</td>
                <td className="text-right">
                  {fmtMoney(computedTax)} {currency}
                </td>
              </tr>
            )}
            <tr className="pl-thermal-grand-total">
              <td>TOTAL</td>
              <td className="text-right">
                {fmtMoney(data.total)} {currency}
              </td>
            </tr>
            <tr className="pl-thermal-divider-row">
              <td colSpan={2}>
                <div className="pl-thermal-divider" />
              </td>
            </tr>
            <tr>
              <td>Paid ({data.payment_method})</td>
              <td className="text-right">
                {fmtMoney(data.amount_paid)} {currency}
              </td>
            </tr>
            <tr>
              <td>Change</td>
              <td className="text-right">
                {fmtMoney(data.change_due)} {currency}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="pl-thermal-divider" />

        {/* Footer */}
        <div className="pl-thermal-footer text-center">
          <p>{data.receipt_footer || 'Thank you for your business!'}</p>
          <p className="pl-thermal-brand">*** Powered by AFRO-TECH ***</p>
        </div>

        {/* Paper bottom jagged cut effect */}
        <div className="pl-thermal-paper-bottom" />
      </div>

      {showActions && (
        <div className="pl-thermal-actions">
          <button
            type="button"
            className="pl-btn pl-btn-primary"
            onClick={handlePrint}
            disabled={printing}
          >
            <i className="fa-solid fa-print" aria-hidden="true" />
            {printing ? 'Printing…' : 'Print 80mm Receipt'}
          </button>
          {onDone && (
            <button type="button" className="pl-btn pl-btn-ghost" onClick={onDone}>
              Close
            </button>
          )}
        </div>
      )}
    </div>
  )
}
