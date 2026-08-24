import { useState } from 'react'
import { fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { exportCsv } from '../utils/csv'
import { Card, DataTable, EmptyState, PageHeader, Spinner, StatCard } from '../ui'

interface RetailReports {
  period: { from: string; to: string }
  pnl: {
    revenue: number
    cogs: number
    gross_profit: number
    discounts: number
    expenses: number
    expenses_by_category: { category: string; total: number }[]
    net_profit: number
    transactions: number
  }
  by_category: { category: string; revenue: number; qty: number }[]
  by_payment: { method: string; total: number; count: number }[]
  top_products: { name: string; qty: number; revenue: number; profit: number }[]
  stock: {
    stock_value: number
    retail_value: number
    units: number
    dead_stock: { name: string; stock: number; last_sold: string | null }[]
    reorder: { name: string; stock: number; threshold: number; suggested: number }[]
  }
}

const DEFAULT_FROM = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
const DEFAULT_TO = new Date().toISOString().slice(0, 10)

export default function Reports(): JSX.Element {
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const { data, loading } = useApiData<RetailReports>(`/retail/reports?from=${from}&to=${to}`)

  const money = (n: number): string => `${fmtMoney(n)} ETB`

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Profit & loss, sales mix, and stock health"
        action={
          data && (
            <button
              type="button"
              className="pl-btn pl-btn-ghost"
              onClick={() =>
                exportCsv(
                  `pnl-${from}-to-${to}`,
                  ['Metric', 'Amount (ETB)'],
                  [
                    ['Revenue', data.pnl.revenue.toFixed(2)],
                    ['Cost of goods sold', data.pnl.cogs.toFixed(2)],
                    ['Gross profit', data.pnl.gross_profit.toFixed(2)],
                    ['Discounts given', data.pnl.discounts.toFixed(2)],
                    ['Expenses', data.pnl.expenses.toFixed(2)],
                    ['Net profit', data.pnl.net_profit.toFixed(2)],
                    ['Transactions', data.pnl.transactions],
                  ]
                )
              }
            >
              <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export P&L
            </button>
          )
        }
      />

      <div className="pl-toolbar">
        <input className="pl-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <span style={{ color: 'var(--text-dim)' }}>to</span>
        <input className="pl-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>

      {loading && !data ? (
        <Spinner label="Crunching numbers…" />
      ) : !data ? (
        <EmptyState title="No data" />
      ) : (
        <>
          <div className="pl-stats">
            <StatCard icon="fa-solid fa-sack-dollar" label="Revenue" value={money(data.pnl.revenue)} />
            <StatCard icon="fa-solid fa-arrow-trend-up" label="Gross profit" value={money(data.pnl.gross_profit)} tone="#34d399" />
            <StatCard icon="fa-solid fa-receipt" label="Expenses" value={money(data.pnl.expenses)} tone="#e07a7a" />
            <StatCard
              icon="fa-solid fa-scale-balanced"
              label="Net profit"
              value={money(data.pnl.net_profit)}
              tone={data.pnl.net_profit >= 0 ? '#34d399' : '#e07a7a'}
            />
            <StatCard icon="fa-solid fa-cart-shopping" label="Transactions" value={data.pnl.transactions} />
          </div>

          <div className="pl-cols-2">
            <Card>
              <h2>Profit &amp; loss statement</h2>
              <table className="pl-table" style={{ minWidth: 0 }}>
                <tbody>
                  <tr><td>Revenue</td><td className="num">{money(data.pnl.revenue)}</td></tr>
                  <tr><td>Cost of goods sold</td><td className="num">−{money(data.pnl.cogs)}</td></tr>
                  <tr><td><strong>Gross profit</strong></td><td className="num"><strong>{money(data.pnl.gross_profit)}</strong></td></tr>
                  <tr><td>Discounts given</td><td className="num">−{money(data.pnl.discounts)}</td></tr>
                  {data.pnl.expenses_by_category.map((e) => (
                    <tr key={e.category}><td style={{ paddingLeft: 22, color: 'var(--text-dim)' }}>{e.category}</td><td className="num">−{money(e.total)}</td></tr>
                  ))}
                  <tr><td><strong>Net profit</strong></td><td className="num"><strong style={{ color: data.pnl.net_profit >= 0 ? '#34d399' : '#e07a7a' }}>{money(data.pnl.net_profit)}</strong></td></tr>
                </tbody>
              </table>
            </Card>

            <div>
              <Card>
                <h2>Sales by payment method</h2>
                <DataTable
                  rows={data.by_payment}
                  empty="No sales in this period"
                  columns={[
                    { key: 'm', header: 'Method', render: (r) => <span style={{ textTransform: 'capitalize' }}>{r.method}</span> },
                    { key: 'c', header: 'Count', render: (r) => r.count },
                    { key: 't', header: 'Total', render: (r) => money(r.total) },
                  ]}
                />
              </Card>
              <Card>
                <h2>Sales by category</h2>
                <DataTable
                  rows={data.by_category}
                  empty="No sales in this period"
                  columns={[
                    { key: 'c', header: 'Category', render: (r) => r.category },
                    { key: 'q', header: 'Units', render: (r) => r.qty },
                    { key: 'r', header: 'Revenue', render: (r) => money(r.revenue) },
                  ]}
                />
              </Card>
            </div>
          </div>

          <div className="pl-cols-2">
            <Card>
              <h2>Top products by revenue</h2>
              <DataTable
                rows={data.top_products}
                empty="No sales in this period"
                columns={[
                  { key: 'n', header: 'Product', render: (r) => r.name },
                  { key: 'q', header: 'Sold', render: (r) => r.qty },
                  { key: 'r', header: 'Revenue', render: (r) => money(r.revenue) },
                  { key: 'p', header: 'Profit', render: (r) => <span style={{ color: '#34d399' }}>{money(r.profit)}</span> },
                ]}
              />
            </Card>

            <Card>
              <h2>Stock health</h2>
              <p style={{ fontSize: '.88rem', color: 'var(--text-dim)', marginBottom: 10 }}>
                {data.stock.units} units on hand · cost value <strong style={{ color: 'var(--text)' }}>{money(data.stock.stock_value)}</strong> · retail value <strong style={{ color: 'var(--text)' }}>{money(data.stock.retail_value)}</strong>
              </p>
              <h4 style={{ margin: '10px 0 6px', fontSize: '.85rem' }}>Reorder now (below threshold)</h4>
              {data.stock.reorder.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>Nothing needs reordering.</p>
              ) : (
                <div className="pl-table-wrap">
                  <table className="pl-table" style={{ minWidth: 0 }}>
                    <thead>
                      <tr><th>Product</th><th>Stock</th><th>Suggested order</th></tr>
                    </thead>
                    <tbody>
                      {data.stock.reorder.map((r) => (
                        <tr key={r.name}>
                          <td>{r.name}</td>
                          <td style={{ color: '#e07a7a' }}>{r.stock}</td>
                          <td><strong>{r.suggested}</strong></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <h4 style={{ margin: '14px 0 6px', fontSize: '.85rem' }}>Dead stock (no sale in 30+ days)</h4>
              {data.stock.dead_stock.length === 0 ? (
                <p style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>Everything is moving.</p>
              ) : (
                <div className="pl-table-wrap">
                  <table className="pl-table" style={{ minWidth: 0 }}>
                    <thead>
                      <tr><th>Product</th><th>Stock</th><th>Last sold</th></tr>
                    </thead>
                    <tbody>
                      {data.stock.dead_stock.map((r) => (
                        <tr key={r.name}>
                          <td>{r.name}</td>
                          <td>{r.stock}</td>
                          <td>{r.last_sold ? new Date(r.last_sold).toLocaleDateString() : 'Never'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
