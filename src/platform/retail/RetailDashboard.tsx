import { fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { EmptyState, PageHeader, StatCard } from '../ui'

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

function AreaChart({ trend }: { trend: { day: string; revenue: number }[] }) {
  const W = 560
  const H = 140
  const PAD = { top: 16, right: 8, bottom: 28, left: 48 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const maxVal = Math.max(1, ...trend.map((t) => t.revenue))
  const pts = trend.map((t, i) => ({
    x: PAD.left + (i / Math.max(1, trend.length - 1)) * innerW,
    y: PAD.top + innerH - (t.revenue / maxVal) * innerH,
    ...t,
  }))
  const linePath = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const areaPath = pts.length > 1
    ? `${linePath} L${pts[pts.length - 1].x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} L${pts[0].x.toFixed(1)},${(PAD.top + innerH).toFixed(1)} Z`
    : ''
  const guides = [0, 0.5, 1].map((pct) => ({
    y: PAD.top + innerH - pct * innerH,
    label: pct === 0 ? '0' : `${((pct * maxVal) / 1000).toFixed(0)}k`,
  }))
  const step = Math.ceil(trend.length / 7)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: H, overflow: 'visible' }}>
      <defs>
        <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.18" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {guides.map((g) => (
        <g key={g.y}>
          <line x1={PAD.left} y1={g.y} x2={PAD.left + innerW} y2={g.y} stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
          <text x={PAD.left - 6} y={g.y + 4} textAnchor="end" fill="var(--text-dim)" fontSize="10">{g.label}</text>
        </g>
      ))}
      {pts.length > 1 && <path d={areaPath} fill="url(#areaGrad)" />}
      {pts.length > 1 && <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />}
      {pts.map((p) => (
        <circle key={p.day} cx={p.x} cy={p.y} r="3.5" fill="var(--accent)" />
      ))}
      {pts.filter((_, i) => i % step === 0 || i === pts.length - 1).map((p) => (
        <text key={p.day} x={p.x} y={H - 4} textAnchor="middle" fill="var(--text-dim)" fontSize="10">{p.day}</text>
      ))}
    </svg>
  )
}

export default function RetailDashboard(): JSX.Element {
  const { data } = useApiData<RetailDashboard>('/retail/dashboard')
  const changePct = data?.comparison.change_pct ?? 0
  const changeUp = changePct >= 0

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Today at a glance" />

      <div className="pl-stats">
        <StatCard icon="fa-solid fa-chart-line" label="Revenue this month" value={`${fmtMoney(data?.month.revenue)} ETB`} />
        <StatCard icon="fa-solid fa-sack-dollar" label="Today's sales" value={`${fmtMoney(data?.today.sales)} ETB`} />
        <StatCard icon="fa-solid fa-receipt" label="Transactions today" value={data?.today.transactions ?? '—'} />
        <StatCard icon="fa-solid fa-arrow-trend-up" label="Profit this month" value={`${fmtMoney(data?.month.profit)} ETB`} tone="#34d399" />
        <StatCard icon="fa-solid fa-receipt" label="Expenses this month" value={`${fmtMoney(data?.month.expenses)} ETB`} tone="#e07a7a" />
      </div>

      {/* Chart + Top Products */}
      <div className="pl-dash-grid">
        <div className="pl-dash-card pl-dash-card--wide">
          <div className="pl-dash-card-head">
            <span className="pl-dash-card-title">Last 14 days revenue</span>
            {data && changePct !== 0 && (
              <span className={`pl-dash-trend ${changeUp ? 'pl-dash-trend--up' : 'pl-dash-trend--down'}`}>
                <i className={`fa-solid fa-arrow-trend-${changeUp ? 'up' : 'down'}`} />
                {' '}{Math.abs(changePct).toFixed(1)}% vs last month
              </span>
            )}
          </div>
          {data ? (data.trend.length > 0 ? <AreaChart trend={data.trend} /> : <EmptyState title="No revenue data yet" />) : <EmptyState title="Loading…" />}
        </div>

        <div className="pl-dash-card">
          <div className="pl-dash-card-head">
            <span className="pl-dash-card-title">Top products this month</span>
          </div>
          {data && data.top_products.length > 0 ? (
            <div className="pl-dash-table-wrap">
              <table className="pl-dash-table">
                <thead><tr><th>Product</th><th className="num">Sold</th><th className="num">Revenue</th></tr></thead>
                <tbody>
                  {data.top_products.map((r, i) => (
                    <tr key={i}><td>{r.name}</td><td className="num">{r.qty}</td><td className="num"><strong>{fmtMoney(r.revenue)} ETB</strong></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="No sales yet" hint="Make your first sale from the New Sale page." />
          )}
        </div>
      </div>

      {/* Low Stock + Expiring */}
      <div className="pl-dash-grid pl-dash-grid--half">
        <div className="pl-dash-card">
          <div className="pl-dash-card-head">
            <span className="pl-dash-card-title">Low stock alerts</span>
            {data && data.low_stock.length > 0 && <span className="pl-badge" style={{ color: '#e07a7a' }}>{data.low_stock.length} items</span>}
          </div>
          {data && data.low_stock.length > 0 ? (
            <div className="pl-dash-table-wrap">
              <table className="pl-dash-table">
                <thead><tr><th>Product</th><th className="num">In stock</th><th className="num">Threshold</th></tr></thead>
                <tbody>
                  {data.low_stock.map((r, i) => (
                    <tr key={i}><td>{r.name}</td><td className="num"><strong style={{ color: '#e07a7a' }}>{r.stock}</strong></td><td className="num">{r.threshold}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Stock levels look healthy" icon="fa-solid fa-circle-check" />
          )}
        </div>

        <div className="pl-dash-card">
          <div className="pl-dash-card-head">
            <span className="pl-dash-card-title">Expiring within 60 days</span>
            {data && data.expiring_soon.length > 0 && <span className="pl-badge" style={{ color: '#e07a7a' }}>{data.expiring_soon.length} items</span>}
          </div>
          {data && data.expiring_soon.length > 0 ? (
            <div className="pl-dash-table-wrap">
              <table className="pl-dash-table">
                <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Expiry</th></tr></thead>
                <tbody>
                  {data.expiring_soon.map((r, i) => (
                    <tr key={i}><td>{r.name}</td><td className="num">{r.quantity}</td><td className="num">{fmtDate(r.expiry_date)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState title="Nothing expiring soon" icon="fa-solid fa-shield-heart" hint="Batches with expiry dates appear here 60 days ahead." />
          )}
        </div>
      </div>

      {/* Recent sales */}
      <div className="pl-dash-card">
        <div className="pl-dash-card-head">
          <span className="pl-dash-card-title">Recent sales</span>
        </div>
        {data && data.recent_sales.length > 0 ? (
          <div className="pl-dash-table-wrap">
            <table className="pl-dash-table">
              <thead><tr><th>When</th><th>Customer</th><th>Payment</th><th className="num">Total</th></tr></thead>
              <tbody>
                {data.recent_sales.map((r) => (
                  <tr key={r.id}>
                    <td style={{ color: 'var(--text-dim)', fontSize: '.88rem' }}>{new Date(r.created_at).toLocaleString()}</td>
                    <td>{r.customer_name ?? 'Walk-in'}</td>
                    <td><span style={{ textTransform: 'capitalize' }}>{r.payment_method}</span></td>
                    <td className="num"><strong>{fmtMoney(r.total)} ETB</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No sales recorded yet" />
        )}
      </div>
    </div>
  )
}
