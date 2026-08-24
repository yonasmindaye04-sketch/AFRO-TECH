import { useState } from 'react'
import { api, fmtDateTime, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, PageHeader, Spinner } from '../ui'

interface SaleRow {
  id: string
  subtotal: string
  discount: string
  total: string
  payment_method: string
  status: 'completed' | 'refunded'
  created_at: string
  customer_name: string | null
  cashier: string | null
  items: { name: string; quantity: number; unit_price: number }[] | null
}

export default function SalesHistory(): JSX.Element {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const qs = new URLSearchParams()
  if (from) qs.set('from', from)
  if (to) qs.set('to', to)
  const { data, loading, reload } = useApiData<{ sales: SaleRow[]; total: number }>(`/retail/sales?${qs.toString()}`)

  const refund = async (id: string): Promise<void> => {
    if (!window.confirm('Refund this sale? Stock will be returned to inventory.')) return
    try {
      await api.post(`/retail/sales/${id}/refund`)
      reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Refund failed')
    }
  }

  return (
    <div>
      <PageHeader title="Sales History" subtitle={`${data?.total ?? 0} transactions`} />
      <div className="pl-toolbar">
        <input className="pl-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <span style={{ color: 'var(--text-dim)' }}>to</span>
        <input className="pl-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
        {(from || to) && (
          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => { setFrom(''); setTo('') }}>
            Clear dates
          </button>
        )}
      </div>

      {loading ? (
        <Spinner />
      ) : !data?.sales.length ? (
        <EmptyState icon="fa-solid fa-receipt" title="No sales in this period" hint="Completed sales from the POS appear here." />
      ) : (
        <DataTable
          rows={data.sales}
          columns={[
            { key: 'when', header: 'Date', render: (s) => fmtDateTime(s.created_at), width: '150px' },
            { key: 'items', header: 'Items', render: (s) => (s.items ?? []).map((i) => `${i.name} ×${i.quantity}`).join(', ') || '—' },
            { key: 'cust', header: 'Customer', render: (s) => s.customer_name ?? 'Walk-in' },
            { key: 'cashier', header: 'Cashier', render: (s) => s.cashier ?? '—' },
            { key: 'pay', header: 'Method', render: (s) => <span style={{ textTransform: 'capitalize' }}>{s.payment_method}</span> },
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
              width: '80px',
              render: (s) =>
                s.status === 'completed' ? (
                  <div className="pl-row-actions">
                    <button type="button" className="pl-icon-btn danger" aria-label="Refund sale" onClick={() => refund(s.id)}>
                      <i className="fa-solid fa-rotate-left" aria-hidden="true" />
                    </button>
                  </div>
                ) : null,
            },
          ]}
        />
      )}
    </div>
  )
}
