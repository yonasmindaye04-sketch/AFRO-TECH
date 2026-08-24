import { useState } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { exportCsv } from '../utils/csv'
import { Badge, DataTable, EmptyState, PageHeader, Spinner } from '../ui'

interface BatchRow {
  id: string
  batch_no: string
  expiry_date: string
  quantity: number
  cost_price: string
  product_id: string
  product_name: string
  category: string
  expired: boolean
  expiring_soon: boolean
}

export default function Expiry(): JSX.Element {
  const [days, setDays] = useState(90)
  const { data, loading, reload } = useApiData<{ batches: BatchRow[] }>(`/retail/expiry?days=${days}`)

  const writeOff = async (b: BatchRow): Promise<void> => {
    if (!window.confirm(`Write off ${b.quantity} × ${b.product_name} (batch ${b.batch_no})? Stock becomes 0 and the loss is recorded.`)) return
    try {
      await api.post(`/retail/expiry/${b.id}/write-off`, { reason: 'Expired — written off' })
      reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Write-off failed')
    }
  }

  const rows = data?.batches ?? []
  const expiredValue = rows.filter((b) => b.expired).reduce((s, b) => s + b.quantity * Number(b.cost_price), 0)
  const soonValue = rows.filter((b) => !b.expired).reduce((s, b) => s + b.quantity * Number(b.cost_price), 0)

  return (
    <div>
      <PageHeader
        title="Expiry Management"
        subtitle="Catch stock before it dies on the shelf — write off what you can't return"
        action={
          <button
            type="button"
            className="pl-btn pl-btn-ghost"
            onClick={() => exportCsv('expiry-report', ['Product', 'Batch', 'Expiry', 'Qty', 'Value at cost', 'Status'], rows.map((b) => [b.product_name, b.batch_no, fmtDate(b.expiry_date), b.quantity, (b.quantity * Number(b.cost_price)).toFixed(2), b.expired ? 'EXPIRED' : 'Expiring soon']))}
          >
            <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export
          </button>
        }
      />

      <div className="pl-toolbar">
        <div className="pl-seg" role="tablist" aria-label="Time window">
          {[30, 60, 90, 180].map((d) => (
            <button key={d} type="button" className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>
        <span style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>
          Expired value: <strong style={{ color: '#e07a7a' }}>{fmtMoney(expiredValue)} ETB</strong> · At-risk value: <strong style={{ color: 'var(--accent)' }}>{fmtMoney(soonValue)} ETB</strong>
        </span>
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="fa-solid fa-shield-heart" title={`Nothing expiring within ${days} days`} hint="Batches with expiry dates appear here ahead of time." />
      ) : (
        <DataTable
          rows={rows}
          columns={[
            { key: 'prod', header: 'Product', render: (b) => <strong>{b.product_name}</strong> },
            { key: 'batch', header: 'Batch', render: (b) => b.batch_no },
            { key: 'exp', header: 'Expiry', render: (b) => fmtDate(b.expiry_date), width: '110px' },
            { key: 'qty', header: 'Qty', render: (b) => b.quantity },
            { key: 'val', header: 'Value', render: (b) => `${fmtMoney(b.quantity * Number(b.cost_price))} ETB` },
            {
              key: 'st',
              header: 'Status',
              width: '120px',
              render: (b) => (b.expired ? <Badge tone="bad">Expired</Badge> : <Badge tone="warn">Expiring</Badge>),
            },
            {
              key: 'act',
              header: '',
              width: '110px',
              render: (b) =>
                b.expired ? (
                  <button type="button" className="pl-btn pl-btn-danger pl-btn-sm" onClick={() => writeOff(b)}>
                    Write off
                  </button>
                ) : null,
            },
          ]}
        />
      )}
    </div>
  )
}
