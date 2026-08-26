import { useState } from 'react'
import { api, fmtDateTime, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface SaleRow {
  id: string
  invoice_no: string | null
  subtotal: string
  discount: string
  total: string
  payment_method: string
  status: 'completed' | 'refunded'
  created_at: string
  customer_name: string | null
  cashier: string | null
  items: { product_id: string; name: string; quantity: number; unit_price: number; sold_as_pills?: boolean }[] | null
}
interface ReturnRow {
  id: string
  sale_id: string
  quantity: number
  sold_as_pills: boolean
  reason: string
  refund_amount: string
  is_resalable: boolean
  created_at: string
  product_name: string | null
  processed_by: string | null
  invoice_no: string | null
}

const REASONS = ['CustomerReturn', 'WrongItem', 'Damaged', 'Expired', 'Other'] as const

export default function SalesHistory(): JSX.Element {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const salesQ = useApiData<{ sales: SaleRow[]; total: number }>(`/retail/sales?${qs.toString()}`)
  const returnsQ = useApiData<{ returns: ReturnRow[] }>('/retail/returns')

  const [returnFor, setReturnFor] = useState<SaleRow | null>(null)
  const [returnQtys, setReturnQtys] = useState<Record<string, number>>({})
  const [reason, setReason] = useState<(typeof REASONS)[number]>('CustomerReturn')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showReturns, setShowReturns] = useState(false)

  const openReturn = (s: SaleRow): void => {
    setReturnFor(s)
    setReturnQtys({})
    setReason('CustomerReturn')
    setError(null)
  }

  const submitReturn = async (): Promise<void> => {
    if (!returnFor) return
    const entries = Object.entries(returnQtys).filter(([, q]) => q > 0)
    if (!entries.length) {
      setError('Enter a quantity for at least one item')
      return
    }
    setBusy(true)
    setError(null)
    try {
      for (const [idxStr, qty] of entries) {
        const item = returnFor.items?.[Number(idxStr)]
        if (!item) continue
        await api.post(`/retail/sales/${returnFor.id}/returns`, {
          product_id: item.product_id,
          quantity: qty,
          reason,
          sold_as_pills: Boolean(item.sold_as_pills),
        })
      }
      setReturnFor(null)
      salesQ.reload()
      returnsQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Return failed')
    } finally {
      setBusy(false)
    }
  }

  const refundLegacy = async (id: string): Promise<void> => {
    if (!window.confirm('Refund this ENTIRE sale? Stock will be returned to inventory.')) return
    try {
      await api.post(`/retail/sales/${id}/refund`)
      salesQ.reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Refund failed')
    }
  }

  return (
    <div>
      <PageHeader title="Sales History" subtitle={`${salesQ.data?.total ?? 0} transactions`} />
      <div className="pl-toolbar">
        <input className="pl-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <span style={{ color: 'var(--text-dim)' }}>to</span>
        <input className="pl-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        {(from || to) && (
          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => { setFrom(''); setTo('') }}>
            Clear dates
          </button>
        )}
        <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowReturns((v) => !v)}>
          <i className="fa-solid fa-rotate-left" aria-hidden="true" /> {showReturns ? 'Hide' : 'Show'} returns log ({returnsQ.data?.returns.length ?? 0})
        </button>
      </div>

      {salesQ.loading ? (
        <Spinner />
      ) : !salesQ.data?.sales.length ? (
        <EmptyState icon="fa-solid fa-receipt" title="No sales in this period" hint="Completed sales from the POS appear here." />
      ) : (
        <DataTable
          rows={salesQ.data.sales}
          columns={[
            { key: 'when', header: 'Date', render: (s) => fmtDateTime(s.created_at), width: '150px' },
            { key: 'inv', header: 'Invoice #', render: (s) => s.invoice_no ?? '—', width: '100px' },
            { key: 'items', header: 'Items', render: (s) => (s.items ?? []).map((i) => `${i.name} ×${i.quantity}${i.sold_as_pills ? 'p' : ''}`).join(', ') || '—' },
            { key: 'cust', header: 'Customer', render: (s) => s.customer_name ?? 'Walk-in' },
            { key: 'cashier', header: 'Cashier', render: (s) => s.cashier ?? '—' },
            { key: 'total', header: 'Total', render: (s) => <strong>{fmtMoney(s.total)} ETB</strong> },
            {
              key: 'status',
              header: 'Status',
              width: '110px',
              render: (s) => (s.status === 'refunded' ? <Badge tone="bad">Refunded</Badge> : <Badge tone="good">Completed</Badge>),
            },
            {
              key: 'act',
              header: '',
              width: '130px',
              render: (s) =>
                s.status === 'completed' ? (
                  <div className="pl-row-actions">
                    <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => openReturn(s)}>
                      Return…
                    </button>
                    <button type="button" className="pl-icon-btn danger" aria-label="Refund entire sale" title="Refund entire sale" onClick={() => refundLegacy(s.id)}>
                      <i className="fa-solid fa-rotate-left" aria-hidden="true" />
                    </button>
                  </div>
                ) : null,
            },
          ]}
        />
      )}

      {/* Returns log */}
      {showReturns && (
        <div style={{ marginTop: 22 }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1.05rem', marginBottom: 12 }}>Returns log</h2>
          {!returnsQ.data?.returns.length ? (
            <EmptyState icon="fa-solid fa-rotate-left" title="No returns recorded" />
          ) : (
            <DataTable
              rows={returnsQ.data.returns}
              columns={[
                { key: 'when', header: 'When', render: (r) => fmtDateTime(r.created_at), width: '145px' },
                { key: 'inv', header: 'Invoice', render: (r) => r.invoice_no ?? r.sale_id.slice(0, 8), width: '95px' },
                { key: 'prod', header: 'Product', render: (r) => r.product_name ?? '—' },
                { key: 'qty', header: 'Qty', render: (r) => `${r.quantity}${r.sold_as_pills ? ' pills' : ''}` },
                {
                  key: 'reason',
                  header: 'Reason',
                  render: (r) => (
                    <>
                      <Badge tone={r.is_resalable ? 'good' : 'bad'}>{r.reason}</Badge>
                      {!r.is_resalable && <small style={{ color: 'var(--text-dim)', marginLeft: 6 }}>not resalable</small>}
                    </>
                  ),
                },
                { key: 'refund', header: 'Refund', render: (r) => `${fmtMoney(r.refund_amount)} ETB` },
                { key: 'by', header: 'By', render: (r) => r.processed_by ?? '—' },
              ]}
            />
          )}
        </div>
      )}

      {/* Structured return modal — per PPR: per-item qty + reason + resalable logic */}
      <Modal open={returnFor !== null} title={returnFor ? `Return items — ${returnFor.invoice_no ?? 'sale'}` : ''} onClose={() => setReturnFor(null)}>
        {returnFor && (
          <>
            {(returnFor.items ?? []).map((it, idx) => (
              <div key={idx} className="pl-att-row">
                <span>
                  {it.name}{' '}
                  <small style={{ color: 'var(--text-dim)' }}>
                    sold {it.quantity}
                    {it.sold_as_pills ? ' pills' : ''} × {fmtMoney(it.unit_price)}
                  </small>
                </span>
                <input
                  className="pl-input"
                  style={{ width: 90, textAlign: 'right' }}
                  type="number"
                  min="0"
                  max={it.quantity}
                  value={returnQtys[idx] ?? ''}
                  placeholder="0"
                  aria-label={`Return quantity for ${it.name}`}
                  onChange={(e) => setReturnQtys((q) => ({ ...q, [idx]: Math.min(it.quantity, Number(e.target.value) || 0) }))}
                />
              </div>
            ))}
            <Field label="Reason">
              <select className="pl-select" value={reason} onChange={(e) => setReason(e.target.value as (typeof REASONS)[number])}>
                {REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r === 'CustomerReturn' ? 'Customer return' : r === 'WrongItem' ? 'Wrong item' : r}
                  </option>
                ))}
              </select>
            </Field>
            <p style={{ color: 'var(--text-dim)', fontSize: '.82rem', margin: '-6px 0 10px' }}>
              Damaged and Expired items are written off (not resalable). Everything else goes back into stock.
            </p>
            {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-primary" disabled={busy} onClick={() => submitReturn()}>
                {busy ? 'Processing…' : 'Process return'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}
