import { useState } from 'react'
import { fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { exportCsv } from '../utils/csv'
import { Card, DataTable, EmptyState, PageHeader, Spinner, StatCard } from '../ui'

interface HospitalReports {
  period: { from: string; to: string }
  appointments: { total: number; completed: number; cancelled: number; no_show: number }
  billing: { billed: number; collected: number; outstanding: number; invoices: number }
  new_patients: number
  top_diagnoses: { diagnosis: string; count: number }[]
  labs: { ordered: number; resulted: number; revenue: number }
  doctor_load: { doctor: string; seen: number }[]
}

const DEFAULT_FROM = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
const DEFAULT_TO = new Date().toISOString().slice(0, 10)

export default function Reports(): JSX.Element {
  const [from, setFrom] = useState(DEFAULT_FROM)
  const [to, setTo] = useState(DEFAULT_TO)
  const { data, loading } = useApiData<HospitalReports>(`/hospital/reports?from=${from}&to=${to}`)

  const completionRate = data && data.appointments.total > 0 ? Math.round((data.appointments.completed / data.appointments.total) * 100) : 0

  return (
    <div>
      <PageHeader
        title="Reports"
        subtitle="Facility performance for the selected period"
        action={
          data && (
            <button
              type="button"
              className="pl-btn pl-btn-ghost"
              onClick={() =>
                exportCsv(
                  `top-diagnoses-${from}-to-${to}`,
                  ['Diagnosis', 'Cases'],
                  data.top_diagnoses.map((d) => [d.diagnosis, d.count])
                )
              }
            >
              <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export diagnoses
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
        <Spinner />
      ) : !data ? (
        <EmptyState title="No data" />
      ) : (
        <>
          <div className="pl-stats">
            <StatCard icon="fa-solid fa-user-plus" label="New patients" value={data.new_patients} />
            <StatCard icon="fa-solid fa-calendar-check" label="Appointments" value={`${data.appointments.completed}/${data.appointments.total} (${completionRate}%)`} />
            <StatCard icon="fa-solid fa-money-bill-trend-up" label="Collected" value={`${fmtMoney(data.billing.collected)} ETB`} tone="#34d399" />
            <StatCard icon="fa-solid fa-file-invoice" label="Outstanding" value={`${fmtMoney(data.billing.outstanding)} ETB`} tone="#e07a7a" />
            <StatCard icon="fa-solid fa-flask-vial" label="Lab revenue" value={`${fmtMoney(data.labs.revenue)} ETB`} />
          </div>

          <div className="pl-cols-2">
            <Card>
              <h2>Top diagnoses</h2>
              {data.top_diagnoses.length === 0 ? (
                <EmptyState title="No diagnoses recorded in this period" />
              ) : (
                <DataTable
                  rows={data.top_diagnoses}
                  columns={[
                    { key: 'd', header: 'Diagnosis', render: (r) => r.diagnosis },
                    { key: 'c', header: 'Cases', render: (r) => r.count, width: '80px' },
                  ]}
                />
              )}
            </Card>
            <div>
              <Card>
                <h2>Doctor workload (completed visits)</h2>
                {data.doctor_load.length === 0 ? (
                  <EmptyState title="No completed visits in this period" />
                ) : (
                  <DataTable
                    rows={data.doctor_load}
                    columns={[
                      { key: 'd', header: 'Doctor', render: (r) => r.doctor },
                      { key: 's', header: 'Seen', render: (r) => r.seen, width: '80px' },
                    ]}
                  />
                )}
              </Card>
              <Card>
                <h2>Billing summary</h2>
                <table className="pl-table" style={{ minWidth: 0 }}>
                  <tbody>
                    <tr><td>Invoices issued</td><td className="num">{data.billing.invoices}</td></tr>
                    <tr><td>Billed</td><td className="num">{fmtMoney(data.billing.billed)} ETB</td></tr>
                    <tr><td>Collected</td><td className="num" style={{ color: '#34d399' }}>{fmtMoney(data.billing.collected)} ETB</td></tr>
                    <tr><td>Outstanding</td><td className="num" style={{ color: '#e07a7a' }}>{fmtMoney(data.billing.outstanding)} ETB</td></tr>
                    <tr><td>Lab tests ordered / resulted</td><td className="num">{data.labs.ordered} / {data.labs.resulted}</td></tr>
                  </tbody>
                </table>
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
