import { fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Card, DataTable, EmptyState, PageHeader } from '../ui'

interface SchoolDashboard {
  stats: { students: number; classes: number; teachers: number; attendance_today: number; unpaid_fees: number; collected_this_month: number }
  attendance_trend: { day: string; pct: number }[]
  class_overview: { name: string; students: number }[]
  recent_students: { id: string; code: string; first_name: string; last_name: string; gender: string; class_name: string | null; created_at: string }[]
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

export default function SchoolDashboard(): JSX.Element {
  const { data } = useApiData<SchoolDashboard>('/school/dashboard')
  const trend = data?.attendance_trend ?? []
  const latestAttendance = trend.length ? Math.round(trend[trend.length - 1]?.pct ?? 0) : null

  return (
    <div>
      <PageHeader title="School Dashboard" subtitle="Overview of your academy" />

      {/* Primary hero tile */}
      <div className="pl-dash-primary">
        <SpiralSvg />
        <div className="pl-dash-primary-icon">
          <i className="fa-solid fa-user-graduate" aria-hidden="true" />
        </div>
        <div className="pl-dash-primary-body">
          <div className="pl-dash-primary-value" style={{ fontVariantNumeric: 'tabular-nums' }}>{data?.stats.students ?? '—'}</div>
          <div className="pl-dash-primary-label">Active students</div>
          <div className="pl-dash-primary-sub">
            Fees collected this month: {fmtMoney(data?.stats.collected_this_month)} ETB
          </div>
        </div>
      </div>

      {/* 3 secondary tiles */}
      <div className="pl-dash-secondary">
        <div className="pl-dash-sec-tile">
          <div className="pl-dash-sec-icon"><i className="fa-solid fa-chalkboard" aria-hidden="true" /></div>
          <div className="pl-dash-sec-value">{data?.stats.classes ?? '—'}</div>
          <div className="pl-dash-sec-label">Classes</div>
        </div>
        <div className="pl-dash-sec-tile">
          <div className="pl-dash-sec-icon"><i className="fa-solid fa-person-chalkboard" aria-hidden="true" /></div>
          <div className="pl-dash-sec-value">{data?.stats.teachers ?? '—'}</div>
          <div className="pl-dash-sec-label">Teachers</div>
        </div>
        <div className="pl-dash-sec-tile">
          <div className="pl-dash-sec-icon"><i className="fa-solid fa-clipboard-check" aria-hidden="true" /></div>
          <div className="pl-dash-sec-value" style={{ color: '#059669' }}>{latestAttendance !== null ? `${latestAttendance}%` : '—'}</div>
          <div className="pl-dash-sec-label">Attendance today</div>
        </div>
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
                      background: t.pct >= 80 ? '#059669' : t.pct >= 60 ? '#d97706' : t.pct > 0 ? '#dc2626' : 'var(--border2)',
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
