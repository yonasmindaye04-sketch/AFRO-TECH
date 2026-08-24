import { fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Card, DataTable, EmptyState, PageHeader, StatCard } from '../ui'

interface SchoolDashboard {
  stats: { students: number; classes: number; teachers: number; attendance_today: number; unpaid_fees: number; collected_this_month: number }
  attendance_trend: { day: string; pct: number }[]
  class_overview: { name: string; students: number }[]
  recent_students: { id: string; code: string; first_name: string; last_name: string; gender: string; class_name: string | null; created_at: string }[]
}

export default function SchoolDashboard(): JSX.Element {
  const { data } = useApiData<SchoolDashboard>('/school/dashboard')
  const trend = data?.attendance_trend ?? []

  return (
    <div>
      <PageHeader title="School Dashboard" subtitle="Overview of your academy" />
      <div className="pl-stats">
        <StatCard icon="fa-solid fa-user-graduate" label="Active students" value={data?.stats.students ?? '—'} />
        <StatCard icon="fa-solid fa-chalkboard" label="Classes" value={data?.stats.classes ?? '—'} />
        <StatCard icon="fa-solid fa-person-chalkboard" label="Teachers" value={data?.stats.teachers ?? '—'} />
        <StatCard
          icon="fa-solid fa-clipboard-check"
          label="Attendance today"
          value={trend.length ? `${Math.round(trend[trend.length - 1]?.pct ?? 0)}%` : '—'}
          tone="#34d399"
        />
        <StatCard icon="fa-solid fa-money-bill-trend-up" label="Fees collected (month)" value={`${fmtMoney(data?.stats.collected_this_month)} ETB`} />
        <StatCard icon="fa-solid fa-file-invoice" label="Outstanding fees" value={`${fmtMoney(data?.stats.unpaid_fees)} ETB`} tone="#e07a7a" />
      </div>

      <div className="pl-cols-2">
        <Card>
          <h2>Attendance — last 14 days</h2>
          {trend.length > 0 ? (
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 150 }}>
              {trend.map((t) => (
                <div key={t.day} style={{ flex: 1, textAlign: 'center' }} title={`${t.day}: ${t.pct}%`}>
                  <div
                    style={{
                      height: `${Math.max(3, (t.pct / 100) * 120)}px`,
                      background: t.pct >= 80 ? '#34d399' : t.pct > 0 ? 'var(--accent)' : 'var(--border2)',
                      borderRadius: 4,
                    }}
                  />
                  <small style={{ fontSize: '.58rem', color: 'var(--text-dim)' }}>{t.day}</small>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No attendance recorded yet" hint="Take attendance from the Attendance page." />
          )}
        </Card>

        <Card>
          <h2>Class sizes</h2>
          {data && data.class_overview.length > 0 ? (
            <DataTable
              rows={data.class_overview}
              columns={[
                { key: 'name', header: 'Class', render: (c) => c.name },
                { key: 'n', header: 'Students', render: (c) => c.students },
              ]}
            />
          ) : (
            <EmptyState title="No classes yet" hint="Create classes and add students to see the breakdown." />
          )}
        </Card>
      </div>

      <Card>
        <h2>Newest students</h2>
        {data && data.recent_students.length > 0 ? (
          <DataTable
            rows={data.recent_students}
            columns={[
              { key: 'code', header: 'ID', render: (s) => s.code },
              { key: 'name', header: 'Name', render: (s) => `${s.first_name} ${s.last_name}` },
              { key: 'class', header: 'Class', render: (s) => s.class_name ?? 'Unassigned' },
              { key: 'since', header: 'Registered', render: (s) => fmtDate(s.created_at) },
            ]}
          />
        ) : (
          <EmptyState icon="fa-solid fa-user-plus" title="No students registered yet" />
        )}
      </Card>
    </div>
  )
}
