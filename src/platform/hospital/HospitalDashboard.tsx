import { fmtDateTime, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, DataTable, EmptyState, PageHeader, StatCard } from '../ui'

interface HospitalDashboard {
  stats: { patients: number; today_appointments: number; upcoming_appointments: number; unpaid_total: number; month_revenue: number }
  todays_appointments: { id: string; scheduled_at: string; patient_name: string; patient_code: string; doctor_name: string | null; reason: string | null; status: string }[]
  recent_patients: { id: string; code: string; first_name: string; last_name: string; gender: string; phone: string | null; created_at: string }[]
}

const statusTone = (s: string): 'good' | 'warn' | 'bad' | 'neutral' => (s === 'completed' ? 'good' : s === 'scheduled' ? 'warn' : s === 'no_show' ? 'bad' : 'neutral')

export default function HospitalDashboard(): JSX.Element {
  const { data } = useApiData<HospitalDashboard>('/hospital/dashboard')

  return (
    <div>
      <PageHeader title="Clinic Dashboard" subtitle="Today at your facility" />
      <div className="pl-stats">
        <StatCard icon="fa-solid fa-hospital-user" label="Total patients" value={data?.stats.patients ?? '—'} />
        <StatCard icon="fa-solid fa-calendar-check" label="Appointments today" value={data?.stats.today_appointments ?? '—'} />
        <StatCard icon="fa-solid fa-clock" label="Upcoming" value={data?.stats.upcoming_appointments ?? '—'} />
        <StatCard icon="fa-solid fa-money-bill-trend-up" label="Collected this month" value={`${fmtMoney(data?.stats.month_revenue)} ETB`} tone="#34d399" />
        <StatCard icon="fa-solid fa-file-invoice" label="Outstanding balances" value={`${fmtMoney(data?.stats.unpaid_total)} ETB`} tone="#e07a7a" />
      </div>

      <div className="pl-cols-2">
        <Card>
          <h2>Today's schedule</h2>
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
