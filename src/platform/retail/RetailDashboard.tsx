import { fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Card, DataTable, EmptyState, PageHeader } from '../ui'

interface RetailDashboard {
  today: { sales: number; transactions: number }
  month: { revenue: number; profit: number; expenses: number }
  comparison: { this_month: number; last_month: number; change_pct: number }
  low_stock: { name: string; stock: number; threshold: number }[]
  expiring_soon: { name: string; expiry_date: string; quantity: number }[]
  trend: { day: string; revenue: number }[]
  top_products: { name: string; qty: number; revenue: number }[]
  recent_sales: { id: string; total: string; created_at: string; payment_method: string; customer_name: string | null }[]
}

function SpiralSvg(): JSX.Element {
  return (
    <svg className="pl-dash-primary-spiral" width="220" height="220" viewBox="0 0 220 220" fill="none" aria-hidden="true">
      <path
        d="M110 110 m0,-80 a80,80 0 1,1 -0.1,0 m0,16 a64,64 0 1,1 -0.1,0 m0,16 a48,48 0 1,1 -0.1,0 m0,16 a32,32 0 1,1 -0.1,0 m0,16 a16,16 0 1,1 -0.1,0"
        stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"
      />
    </svg>
  )
}

export default function RetailDashboard(): JSX.Element {
  const { data } = useApiData<RetailDashboard>('/retail/dashboard')
  const maxTrend = Math.max(1, ...(data?.trend.map((t) => t.revenue) ?? [1]))

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Today at a glance" />

      {/* Primary hero tile */}
      <div className="pl-dash-primary">
        <SpiralSvg />
        <div className="pl-dash-primary-icon">
          <i className="fa-solid fa-chart-line" aria-hidden="true" />
        </div>
        <div className="pl-dash-primary-body">
          <div className="pl-dash-primary-value">{fmtMoney(data?.month.revenue)} ETB</div>
          <div className="pl-dash-primary-label">Revenue this month</div>
          <div className="pl-dash-primary-sub">
            Profit: {fmtMoney(data?.month.profit)} ETB &nbsp;·&nbsp; Expenses: {fmtMoney(data?.month.expenses)} ETB
          </div>
        </div>
      </div>

      {/* 3 secondary tiles */}
      <div className="pl-dash-secondary">
        <div className="pl-dash-sec-tile">
          <div className="pl-dash-sec-icon"><i className="fa-solid fa-sack-dollar" aria-hidden="true" /></div>
          <div className="pl-dash-sec-value">{fmtMoney(data?.today.sales)} ETB</div>
          <div className="pl-dash-sec-label">Today&apos;s sales</div>
        </div>
        <div className="pl-dash-sec-tile">
          <div className="pl-dash-sec-icon"><i className="fa-solid fa-receipt" aria-hidden="true" /></div>
          <div className="pl-dash-sec-value">{data?.today.transactions ?? '—'}</div>
          <div className="pl-dash-sec-label">Transactions today</div>
        </div>
        <div className="pl-dash-sec-tile">
          <div className="pl-dash-sec-icon"><i className="fa-solid fa-arrow-trend-up" aria-hidden="true" /></div>
          <div className="pl-dash-sec-value" style={{ color: '#34d399' }}>{fmtMoney(data?.month.profit)} ETB</div>
          <div className="pl-dash-sec-label">Profit this month</div>
        </div>
      </div>

      <div className="pl-cols-2">
        <Card>
          <h2>Last 14 days revenue</h2>
          {data ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160 }}>
              {data.trend.map((t) => (
                <div key={t.day} style={{ flex: 1, textAlign: 'center' }} title={`${t.day}: ${fmtMoney(t.revenue)} ETB`}>
                  <div
                    style={{
                      height: `${Math.max(3, (t.revenue / maxTrend) * 130)}px`,
                      background: t.revenue > 0 ? 'var(--accent)' : 'var(--border2)',
                      borderRadius: 4,
                      transition: 'height .4s',
                    }}
                  />
                  <small style={{ fontSize: '.58rem', color: 'var(--text-dim)' }}>{t.day}</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="Loading chart..." />
          )}
        </Card>
        <Card>
          <h2>Top products this month</h2>
          {data && data.top_products.length > 0 ? (
            <DataTable
              columns={[
                { key: 'name', header: 'Product', render: (r) => r.name },
                { key: 'qty', header: 'Sold', render: (r) => `${r.qty}`, width: '70px' },
                { key: 'rev', header: 'Revenue', render: (r) => `${fmtMoney(r.revenue)} ETB` },
              ]}
              rows={data.top_products}
            />
          ) : (
            <EmptyState title="No sales yet" hint="Make your first sale from the New Sale page." />
          )}
        </Card>
      </div>

      <div className="pl-cols-2">
        <Card>
          <h2>Low stock alerts</h2>
          {data && data.low_stock.length > 0 ? (
            <DataTable
              columns={[
                { key: 'name', header: 'Product', render: (r) => r.name },
                { key: 'stock', header: 'In stock', render: (r) => <strong style={{ color: '#e07a7a' }}>{r.stock}</strong> },
                { key: 'thr', header: 'Threshold', render: (r) => r.threshold },
              ]}
              rows={data.low_stock}
            />
          ) : (
            <EmptyState title="Stock levels look healthy" icon="fa-solid fa-circle-check" />
          )}
        </Card>
        <Card>
          <h2>Expiring within 60 days</h2>
          {data && data.expiring_soon.length > 0 ? (
            <DataTable
              columns={[
                { key: 'name', header: 'Product', render: (r) => r.name },
                { key: 'qty', header: 'Qty', render: (r) => r.quantity },
                { key: 'exp', header: 'Expiry', render: (r) => fmtDate(r.expiry_date) },
              ]}
              rows={data.expiring_soon}
            />
          ) : (
            <EmptyState title="Nothing expiring soon" icon="fa-solid fa-shield-heart" hint="Batches with expiry dates appear here 60 days ahead." />
          )}
        </Card>
      </div>

      <Card>
        <h2>Recent sales</h2>
        {data && data.recent_sales.length > 0 ? (
          <DataTable
            columns={[
              { key: 'when', header: 'When', render: (r) => new Date(r.created_at).toLocaleString() },
              { key: 'cust', header: 'Customer', render: (r) => r.customer_name ?? 'Walk-in' },
              { key: 'pay', header: 'Payment', render: (r) => <span style={{ textTransform: 'capitalize' }}>{r.payment_method}</span> },
              { key: 'total', header: 'Total', render: (r) => <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(r.total)} ETB</strong> },
            ]}
            rows={data.recent_sales}
          />
        ) : (
          <EmptyState title="No sales recorded yet" />
        )}
      </Card>
    </div>
  )
}
