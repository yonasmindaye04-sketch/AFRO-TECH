import { fmtDateTime, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, DataTable, EmptyState, PageHeader } from '../ui'

interface HospitalDashboard {
  stats: { patients: number; today_appointments: number; upcoming_appointments: number; unpaid_total: number; month_revenue: number }
  todays_appointments: { id: string; scheduled_at: string; patient_name: string; patient_code: string; doctor_name: string | null; reason: string | null; status: string }[]
  recent_patients: { id: string; code: string; first_name: string; last_name: string; gender: string; phone: string | null; created_at: string }[]
}

const statusTone = (s: string): 'good' | 'warn' | 'bad' | 'neutral' => (s === 'completed' ? 'good' : s === 'scheduled' ? 'warn' : s === 'no_show' ? 'bad' : 'neutral')

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

export default function HospitalDashboard(): JSX.Element {
  const { data } = useApiData<HospitalDashboard>('/hospital/dashboard')

  return (
    <div>
      <PageHeader title="Clinic Dashboard" subtitle="Today at your facility" />

      {/* Primary hero tile */}
      <div className="pl-dash-primary">
        <SpiralSvg />
        <div className="pl-dash-primary-icon">
          <i className="fa-solid fa-hospital-user" aria-hidden="true" />
        </div>
        <div className="pl-dash-primary-body">
          <div className="pl-dash-primary-value" style={{ fontVariantNumeric: 'tabular-nums' }}>{data?.stats.patients ?? '—'}</div>
          <div className="pl-dash-primary-label">Total patients</div>
          <div className="pl-dash-primary-sub">
            Collected this month: {fmtMoney(data?.stats.month_revenue)} ETB
          </div>
        </div>
      </div>

      {/* 3 secondary tiles */}
      <div className="pl-dash-secondary">
        <div className="pl-dash-sec-tile">
          <div className="pl-dash-sec-icon"><i className="fa-solid fa-calendar-check" aria-hidden="true" /></div>
          <div className="pl-dash-sec-value">{data?.stats.today_appointments ?? '—'}</div>
          <div className="pl-dash-sec-label">Appointments today</div>
        </div>
        <div className="pl-dash-sec-tile">
          <div className="pl-dash-sec-icon"><i className="fa-solid fa-clock" aria-hidden="true" /></div>
          <div className="pl-dash-sec-value">{data?.stats.upcoming_appointments ?? '—'}</div>
          <div className="pl-dash-sec-label">Upcoming</div>
        </div>
        <div className="pl-dash-sec-tile">
          <div className="pl-dash-sec-icon"><i className="fa-solid fa-file-invoice" aria-hidden="true" /></div>
          <div className="pl-dash-sec-value" style={{ color: '#e07a7a', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(data?.stats.unpaid_total)} ETB</div>
          <div className="pl-dash-sec-label">Outstanding balances</div>
        </div>
      </div>

      <div className="pl-cols-2">
        <Card>
          <h2>Today&apos;s schedule</h2>
          {data && data.todays_appointments.length > 0 ? (
            <DataTable
              rows={data.todays_appointments}
              columns={[
                { key: 'time', header: 'Time', render: (a) => new Date(a.scheduled_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }), width: '80px' },
                {
                  key: 'pat',
                  header: 'Patient',
                  render: (a) => (
                    <div>
                      <strong>{a.patient_name}</strong>
                      <small style={{ display: 'block', color: 'var(--text-dim)' }}>{a.patient_code}</small>
                    </div>
                  ),
                },
                { key: 'doc', header: 'Doctor', render: (a) => a.doctor_name ?? 'Any' },
                { key: 'st', header: 'Status', render: (a) => <Badge tone={statusTone(a.status)}>{a.status.replace('_', ' ')}</Badge> },
              ]}
            />
          ) : (
            <EmptyState icon="fa-solid fa-mug-hot" title="No appointments today" />
          )}
        </Card>

        <Card>
          <h2>Newest patients</h2>
          {data && data.recent_patients.length > 0 ? (
            <DataTable
              rows={data.recent_patients}
              columns={[
                { key: 'code', header: 'File #', render: (p) => p.code, width: '100px' },
                { key: 'name', header: 'Name', render: (p) => `${p.first_name} ${p.last_name}` },
                { key: 'phone', header: 'Phone', render: (p) => p.phone ?? '—' },
                { key: 'since', header: 'Registered', render: (p) => fmtDateTime(p.created_at), width: '130px' },
              ]}
            />
          ) : (
            <EmptyState icon="fa-solid fa-user-plus" title="No patients registered yet" hint="Add patients from the Patients page." />
          )}
        </Card>
      </div>
    </div>
  )
}
