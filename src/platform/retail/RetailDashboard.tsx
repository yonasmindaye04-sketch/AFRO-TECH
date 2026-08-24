import { fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Card, DataTable, EmptyState, PageHeader, StatCard } from '../ui'

interface RetailDashboard {
  today: { sales: number; transactions: number }
  month: { revenue: number; profit: number; expenses: number }
  low_stock: { name: string; stock: number; threshold: number }[]
  expiring_soon: { name: string; expiry_date: string; quantity: number }[]
  trend: { day: string; revenue: number }[]
  top_products: { name: string; qty: number; revenue: number }[]
  recent_sales: { id: string; total: string; created_at: string; payment_method: string; customer_name: string | null }[]
}

export default function RetailDashboard(): JSX.Element {
  const { data } = useApiData<RetailDashboard>('/retail/dashboard')
  const maxTrend = Math.max(1, ...(data?.trend.map((t) => t.revenue) ?? [1]))

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Today at a glance" />
      <div className="pl-stats">
        <StatCard icon="fa-solid fa-sack-dollar" label="Today's sales" value={`${fmtMoney(data?.today.sales)} ETB`} />
        <StatCard icon="fa-solid fa-receipt" label="Transactions today" value={data?.today.transactions ?? '—'} />
        <StatCard icon="fa-solid fa-chart-line" label="Revenue this month" value={`${fmtMoney(data?.month.revenue)} ETB`} />
        <StatCard
          icon="fa-solid fa-arrow-trend-up"
          label="Profit this month"
          value={`${fmtMoney(data?.month.profit)} ETB`}
          tone="#34d399"
        />
        <StatCard icon="fa-solid fa-receipt" label="Expenses this month" value={`${fmtMoney(data?.month.expenses)} ETB`} tone="#e07a7a" />
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
            <EmptyState title="Loading chart…" />
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
              { key: 'total', header: 'Total', render: (r) => <strong>{fmtMoney(r.total)} ETB</strong> },
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
