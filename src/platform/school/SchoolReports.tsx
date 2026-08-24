import { useState } from 'react'
import { fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { exportCsv } from '../utils/csv'
import { Card, DataTable, EmptyState, PageHeader, Spinner, StatCard } from '../ui'

interface SchoolReports {
  period: { from: string; to: string }
  totals: { billed: number; collected: number; outstanding: number }
  collection_by_class: { class: string; billed: number; collected: number }[]
  defaulters: { name: string; code: string; class: string | null; due: number }[]
  monthly_collection: { month: string; collected: number }[]
  attendance_by_class: { class: string; pct: number }[]
  subject_averages: { subject: string; avg: number; entries: number }[]
}

const DEFAULT_FROM = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
const DEFAULT_TO = new Date().toISOString().slice(0, 10)

export default function SchoolReports(): JSX.Element {
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const { data, loading } = useApiData<SchoolReports>(`/school/reports?from=${from}&to=${to}`)

  const maxMonthly = Math.max(1, ...(data?.monthly_collection.map((m) => m.collected) ?? [1]))

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Fees, attendance and academic performance"
        action={
          data && data.defaulters.length > 0 ? (
            <button
              type="button"
              className="pl-btn pl-btn-ghost"
              onClick={() =>
                exportCsv(
                  'fee-defaulters',
                  ['Student', 'ID', 'Class', 'Balance due (ETB)'],
                  data.defaulters.map((d) => [d.name, d.code, d.class, d.due.toFixed(2)])
                )
              }
            >
              <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export defaulters
            </button>
          ) : undefined
        }
      />
      <div className="pl-toolbar">
        <input className="pl-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
        <span style={{ color: 'var(--text-dim)' }}>to</span>
        <input className="pl-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
      </div>

      {loading && !data ? (
        <Spinner />
      ) : !data ? (
        <EmptyState title="No data" />
      ) : (
        <>
          <div className="pl-stats">
            <StatCard icon="fa-solid fa-file-invoice-dollar" label="Fees billed" value={`${fmtMoney(data.totals.billed)} ETB`} />
            <StatCard icon="fa-solid fa-hand-holding-dollar" label="Collected" value={`${fmtMoney(data.totals.collected)} ETB`} tone="#34d399" />
            <StatCard icon="fa-solid fa-triangle-exclamation" label="Outstanding" value={`${fmtMoney(data.totals.outstanding)} ETB`} tone="#e07a7a" />
            <StatCard icon="fa-solid fa-user-clock" label="Defaulters" value={data.defaulters.length} />
          </div>

          <div className="pl-cols-2">
            <Card>
              <h2>Fee collection — last 6 months</h2>
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 150, padding: '0 4px' }}>
                {data.monthly_collection.map((m) => (
                  <div key={m.month} style={{ flex: 1, textAlign: 'center' }} title={`${m.month}: ${fmtMoney(m.collected)} ETB`}>
                    <div
                      style={{
                        height: `${Math.max(3, (m.collected / maxMonthly) * 120)}px`,
                        background: 'var(--accent)',
                        borderRadius: 4,
                      }}
                    />
                    <small style={{ fontSize: '.6rem', color: 'var(--text-dim)' }}>{m.month.split(' ')[0]}</small>
                  </div>
                ))}
              </div>
            </Card>
            <Card>
              <h2>Collection by class</h2>
              {data.collection_by_class.length === 0 ? (
                <EmptyState title="No fees assigned in this period" />
              ) : (
                <DataTable
                  rows={data.collection_by_class}
                  columns={[
                    { key: 'c', header: 'Class', render: (r) => r.class },
                    { key: 'b', header: 'Billed', render: (r) => fmtMoney(r.billed) },
                    { key: 'col', header: 'Collected', render: (r) => <span style={{ color: '#34d399' }}>{fmtMoney(r.collected)}</span> },
                  ]}
                />
              )}
            </Card>
          </div>

          <div className="pl-cols-2">
            <Card>
              <h2>Fee defaulters (all time)</h2>
              {data.defaulters.length === 0 ? (
                <EmptyState icon="fa-solid fa-circle-check" title="No outstanding fees" />
              ) : (
                <DataTable
                  rows={data.defaulters.slice(0, 12)}
                  columns={[
                    {
                      key: 'n',
                      header: 'Student',
                      render: (r) => (
                        <div>
                          <strong>{r.name}</strong>
                          <small style={{ display: 'block', color: 'var(--text-dim)' }}>{r.class ?? r.code}</small>
                        </div>
                      ),
                    },
                    { key: 'd', header: 'Due', render: (r) => <strong style={{ color: '#e07a7a' }}>{fmtMoney(r.due)} ETB</strong> },
                  ]}
                />
              )}
            </Card>
            <div>
              <Card>
                <h2>Attendance by class (period)</h2>
                {data.attendance_by_class.length === 0 ? (
                  <EmptyState title="No attendance in this period" />
                ) : (
                  <DataTable
                    rows={data.attendance_by_class}
                    columns={[
                      { key: 'c', header: 'Class', render: (r) => r.class },
                      {
                        key: 'p',
                        header: 'Present',
                        render: (r) => (
                          <span style={{ color: r.pct >= 80 ? '#34d399' : r.pct >= 60 ? 'var(--accent)' : '#e07a7a' }}>{r.pct}%</span>
                        ),
                      },
                    ]}
                  />
                )}
              </Card>
              <Card>
                <h2>Subject averages (period)</h2>
                {data.subject_averages.length === 0 ? (
                  <EmptyState title="No grades in this period" />
                ) : (
                  <DataTable
                    rows={data.subject_averages}
                    columns={[
                      { key: 's', header: 'Subject', render: (r) => r.subject },
                      { key: 'a', header: 'Average', render: (r) => `${r.avg}%` },
                      { key: 'e', header: 'Entries', render: (r) => r.entries },
                    ]}
                  />
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
