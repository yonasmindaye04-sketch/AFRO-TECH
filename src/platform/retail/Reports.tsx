import { useMemo, useState, type FormEvent } from 'react'
import { api, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { exportCsv } from '../utils/csv'
import {
  REPORT_DATASETS,
  defaultConfigForDataset,
  parseReportQuery,
  runCustomReport,
  type CustomReportConfig,
  type DatasetKey,
  type FilterOperator,
} from '../utils/reportBuilderEngine'
import { Badge, Card, DataTable, EmptyState, ErrorBox, OkBox, PageHeader, Spinner, StatCard } from '../ui'

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

interface ReportPreset {
  id: string
  name: string
  config: CustomReportConfig
  created_at: string
}

const DEFAULT_FROM = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
const DEFAULT_TO = new Date().toISOString().slice(0, 10)

const QUICK_QUERIES = [
  'Low stock products',
  'Sales by payment method',
  'Expenses over 1000',
  'Unpaid supplier purchases',
  'Expiring batches',
]

export default function Reports(): JSX.Element {
  const [tab, setTab] = useState<'overview' | 'builder'>('overview')
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)

  const { data, loading } = useApiData<RetailReports>(`/retail/reports?from=${from}&to=${to}`)
  const dsQ = useApiData<{ datasets: Record<DatasetKey, Record<string, unknown>[]> }>('/reports/datasets')
  const presetsQ = useApiData<{ presets: ReportPreset[] }>('/reports/presets')

  const [config, setConfig] = useState<CustomReportConfig>(() => defaultConfigForDataset('products'))
  const [nlQuery, setNlQuery] = useState('')
  const [queryHint, setQueryHint] = useState<string | null>(null)
  const [presetName, setPresetName] = useState('')
  const [presetBusy, setPresetBusy] = useState(false)
  const [presetMsg, setPresetMsg] = useState<string | null>(null)
  const [presetErr, setPresetErr] = useState<string | null>(null)

  const money = (n: number): string => `${fmtMoney(n)} ETB`

  const currentDef = REPORT_DATASETS[config.dataset]
  const reportResult = useMemo(() => {
    const rawDatasetRows = dsQ.data?.datasets?.[config.dataset] ?? []
    return runCustomReport(rawDatasetRows, config)
  }, [dsQ.data, config])

  const handleDatasetChange = (nextDs: DatasetKey): void => {
    setConfig(defaultConfigForDataset(nextDs))
    setQueryHint(null)
  }

  const runPlainEnglishQuery = (text: string): void => {
    const parsed = parseReportQuery(text)
    setConfig(parsed.config)
    setQueryHint(parsed.explanation)
  }

  const handleQuerySubmit = (e: FormEvent): void => {
    e.preventDefault()
    runPlainEnglishQuery(nlQuery)
  }

  const toggleColumn = (key: string): void => {
    setConfig((c) => {
      const exists = c.columns.includes(key)
      const next = exists ? c.columns.filter((k) => k !== key) : [...c.columns, key]
      return { ...c, columns: next.length ? next : c.columns }
    })
  }

  const addFilter = (): void => {
    const firstField = currentDef.fields[0]
    setConfig((c) => ({
      ...c,
      filters: [
        ...c.filters,
        { field: firstField.key, op: firstField.type === 'number' ? 'gte' : 'contains', value: '' },
      ],
    }))
  }

  const savePreset = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!presetName.trim()) return
    setPresetBusy(true)
    setPresetMsg(null)
    setPresetErr(null)
    try {
      await api.post('/reports/presets', { name: presetName.trim(), config })
      setPresetMsg(`Saved custom report "${presetName.trim()}".`)
      setPresetName('')
      presetsQ.reload()
    } catch (err) {
      setPresetErr(err instanceof Error ? err.message : 'Could not save preset')
    } finally {
      setPresetBusy(false)
    }
  }

  const deletePreset = async (id: string): Promise<void> => {
    try {
      await api.del(`/reports/presets/${id}`)
      presetsQ.reload()
    } catch {
      // ignore
    }
  }

  const exportBuilderCsv = (): void => {
    exportCsv(
      `custom-${config.dataset}-${new Date().toISOString().slice(0, 10)}`,
      reportResult.columns.map((c) => c.label),
      reportResult.rows.map((r) =>
        reportResult.columns.map((c) => {
          const v = r[c.key]
          return v === null || v === undefined ? '' : String(v)
        })
      )
    )
  }

  return (
    <div>
      <PageHeader
        title="Reports & Self-Service Builder"
        subtitle="Profit & loss overview, plain-English data query, and zero-code custom report builder"
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="sub-tabs">
              <button
                type="button"
                className={`sub-tab ${tab === 'overview' ? 'sub-tab-active' : ''}`}
                onClick={() => setTab('overview')}
              >
                Overview &amp; P&amp;L
              </button>
              <button
                type="button"
                className={`sub-tab ${tab === 'builder' ? 'sub-tab-active' : ''}`}
                onClick={() => setTab('builder')}
              >
                Custom Report Builder
              </button>
            </div>
            {tab === 'overview' && data && (
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
                <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export P&amp;L
              </button>
            )}
            {tab === 'builder' && (
              <button type="button" className="pl-btn pl-btn-primary" onClick={exportBuilderCsv}>
                <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export Custom CSV
              </button>
            )}
          </div>
        }
      />

      {tab === 'overview' && (
        <>
          <div className="pl-toolbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input className="pl-input" type="date" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>to</span>
              <input className="pl-input" type="date" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            </div>
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
        </>
      )}

      {tab === 'builder' && (
        <>
          <Card>
            <h2 style={{ marginBottom: 8 }}>Ask Data in Plain English</h2>
            <p style={{ color: 'var(--text-dim)', fontSize: '.85rem', marginBottom: 12 }}>
              Query any module instantly without SQL, spreadsheets, or waiting on IT.
            </p>
            <form onSubmit={handleQuerySubmit} style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
              <input
                className="pl-input"
                style={{ flex: '1 1 280px' }}
                placeholder='Try "low stock products", "expenses over 1000 by category", or "unpaid supplier purchases"…'
                aria-label="Plain-English report query"
                value={nlQuery}
                onChange={(e) => setNlQuery(e.target.value)}
              />
              <button type="submit" className="pl-btn pl-btn-primary">
                <i className="fa-solid fa-magnifying-glass-chart" aria-hidden="true" /> Run Query
              </button>
            </form>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span style={{ fontSize: '.78rem', color: 'var(--text-dim)' }}>Quick questions:</span>
              {QUICK_QUERIES.map((q) => (
                <button
                  key={q}
                  type="button"
                  className="pl-btn pl-btn-ghost pl-btn-sm"
                  onClick={() => {
                    setNlQuery(q)
                    runPlainEnglishQuery(q)
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
            {queryHint && (
              <p style={{ marginTop: 10, fontSize: '.84rem', color: 'var(--accent)' }}>
                <i className="fa-solid fa-circle-info" aria-hidden="true" style={{ marginRight: 6 }} />
                {queryHint}
              </p>
            )}
          </Card>

          <div className="pl-cols-2">
            <Card>
              <h2 style={{ marginBottom: 12 }}>Configure Columns, Filters &amp; Grouping</h2>
              <div className="pl-grid-2" style={{ marginBottom: 12 }}>
                <div>
                  <label className="pl-field">
                    <span className="pl-field-label">Dataset</span>
                    <select
                      className="pl-select"
                      value={config.dataset}
                      onChange={(e) => handleDatasetChange(e.target.value as DatasetKey)}
                    >
                      {Object.values(REPORT_DATASETS).map((ds) => (
                        <option key={ds.key} value={ds.key}>
                          {ds.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div>
                  <label className="pl-field">
                    <span className="pl-field-label">Group By</span>
                    <select
                      className="pl-select"
                      value={config.groupBy}
                      onChange={(e) => setConfig((c) => ({ ...c, groupBy: e.target.value }))}
                    >
                      <option value="">No grouping (flat rows)</option>
                      {currentDef.fields
                        .filter((f) => f.type === 'string')
                        .map((f) => (
                          <option key={f.key} value={f.key}>
                            {f.label}
                          </option>
                        ))}
                    </select>
                  </label>
                </div>
              </div>

              <div className="pl-grid-2" style={{ marginBottom: 14 }}>
                <div>
                  <label className="pl-field">
                    <span className="pl-field-label">Sort By</span>
                    <select
                      className="pl-select"
                      value={config.sortBy}
                      onChange={(e) => setConfig((c) => ({ ...c, sortBy: e.target.value }))}
                    >
                      {currentDef.fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div>
                  <label className="pl-field">
                    <span className="pl-field-label">Sort Direction</span>
                    <select
                      className="pl-select"
                      value={config.sortDir}
                      onChange={(e) => setConfig((c) => ({ ...c, sortDir: e.target.value as 'asc' | 'desc' }))}
                    >
                      <option value="desc">Descending (High → Low)</option>
                      <option value="asc">Ascending (Low → High)</option>
                    </select>
                  </label>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <span className="pl-field-label" style={{ display: 'block', marginBottom: 8 }}>Visible Columns</span>
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  {currentDef.fields.map((f) => (
                    <label key={f.key} className="pl-checkbox-label">
                      <input
                        type="checkbox"
                        checked={config.columns.includes(f.key)}
                        onChange={() => toggleColumn(f.key)}
                      />
                      <span>{f.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span className="pl-field-label">Filters ({config.filters.length})</span>
                  <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={addFilter}>
                    <i className="fa-solid fa-plus" aria-hidden="true" /> Add Filter
                  </button>
                </div>
                {config.filters.map((flt, idx) => (
                  <div key={idx} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 1fr auto', gap: 8, marginBottom: 8 }}>
                    <select
                      className="pl-select"
                      aria-label={`Filter ${idx + 1} field`}
                      value={flt.field}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          filters: c.filters.map((x, i) => (i === idx ? { ...x, field: e.target.value } : x)),
                        }))
                      }
                    >
                      {currentDef.fields.map((f) => (
                        <option key={f.key} value={f.key}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <select
                      className="pl-select"
                      aria-label={`Filter ${idx + 1} operator`}
                      value={flt.op}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          filters: c.filters.map((x, i) => (i === idx ? { ...x, op: e.target.value as FilterOperator } : x)),
                        }))
                      }
                    >
                      <option value="contains">contains</option>
                      <option value="equals">=</option>
                      <option value="gt">&gt;</option>
                      <option value="gte">&gt;=</option>
                      <option value="lt">&lt;</option>
                      <option value="lte">&lt;=</option>
                    </select>
                    <input
                      className="pl-input"
                      aria-label={`Filter ${idx + 1} value`}
                      placeholder="Value…"
                      value={flt.value}
                      onChange={(e) =>
                        setConfig((c) => ({
                          ...c,
                          filters: c.filters.map((x, i) => (i === idx ? { ...x, value: e.target.value } : x)),
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="pl-icon-btn danger"
                      aria-label={`Remove filter ${idx + 1}`}
                      onClick={() =>
                        setConfig((c) => ({ ...c, filters: c.filters.filter((_, i) => i !== idx) }))
                      }
                    >
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>

            <Card>
              <h2 style={{ marginBottom: 12 }}>Saved Report Views</h2>
              <form onSubmit={savePreset} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <input
                  className="pl-input"
                  placeholder="Name this view (e.g. Monthly Rent & Utilities)…"
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  aria-label="Custom report preset name"
                />
                <button type="submit" className="pl-btn pl-btn-primary" disabled={presetBusy || !presetName.trim()}>
                  Save View
                </button>
              </form>
              {presetMsg && <OkBox message={presetMsg} />}
              {presetErr && <ErrorBox message={presetErr} />}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(presetsQ.data?.presets ?? []).map((p) => (
                  <div
                    key={p.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                      padding: '9px 12px',
                      borderRadius: 10,
                      border: '1px solid var(--border)',
                    }}
                  >
                    <div>
                      <strong style={{ fontSize: '.9rem' }}>{p.name}</strong>
                      <small style={{ display: 'block', color: 'var(--text-dim)' }}>
                        {REPORT_DATASETS[p.config.dataset]?.label ?? p.config.dataset}
                        {p.config.groupBy ? ` · Grouped by ${p.config.groupBy}` : ''}
                      </small>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button
                        type="button"
                        className="pl-btn pl-btn-ghost pl-btn-sm"
                        onClick={() => {
                          setConfig(p.config)
                          setQueryHint(`Loaded saved preset "${p.name}".`)
                        }}
                      >
                        Load
                      </button>
                      <button
                        type="button"
                        className="pl-icon-btn danger"
                        aria-label={`Delete preset ${p.name}`}
                        onClick={() => deletePreset(p.id)}
                      >
                        <i className="fa-solid fa-trash-can" aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
              <h2 style={{ marginBottom: 0 }}>
                Live Results: {currentDef.label} ({reportResult.totalCount} {reportResult.totalCount === 1 ? 'record' : 'records'})
              </h2>
              <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: '.86rem' }}>
                {Object.entries(reportResult.sums).map(([key, val]) => {
                  const lbl = currentDef.fields.find((f) => f.key === key)?.label ?? key
                  return (
                    <span key={key}>
                      <span style={{ color: 'var(--text-dim)' }}>{lbl}: </span>
                      <strong style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(val)}</strong>
                    </span>
                  )
                })}
              </div>
            </div>

            {dsQ.loading ? (
              <Spinner label="Loading live dataset…" />
            ) : reportResult.rows.length === 0 ? (
              <EmptyState icon="fa-solid fa-filter-circle-xmark" title="No matching rows" hint="Adjust or clear filters to inspect records." />
            ) : (
              <div className="pl-table-wrap">
                <table className="pl-table">
                  <thead>
                    <tr>
                      {reportResult.columns.map((c) => (
                        <th key={c.key} className={c.type === 'number' ? 'num' : undefined}>
                          {c.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reportResult.rows.map((row, idx) => (
                      <tr key={String(row.id ?? idx)}>
                        {reportResult.columns.map((c) => {
                          const v = row[c.key]
                          if (c.type === 'number') {
                            return (
                              <td key={c.key} className="num">
                                {fmtMoney(Number(v ?? 0))}
                              </td>
                            )
                          }
                          if (c.key === 'stage' || c.key === 'status') {
                            return (
                              <td key={c.key}>
                                <Badge tone={String(v) === 'completed' || String(v) === 'won' ? 'good' : 'info'}>
                                  {String(v ?? '—').toUpperCase()}
                                </Badge>
                              </td>
                            )
                          }
                          return <td key={c.key}>{String(v ?? '—')}</td>
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

