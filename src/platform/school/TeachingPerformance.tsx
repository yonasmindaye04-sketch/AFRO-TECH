import { useState, type CSSProperties, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, fmtDateTime } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, DataTable, EmptyState, ErrorBox, Field, FormRow, Modal, OkBox, PageHeader, Spinner, StatCard, type Column } from '../ui'

interface Overview {
  period: { from: string; to: string }
  sessions: { total: number; present: number; late: number; absent: number; excused: number; scheduled: number; avg_minutes_late: number; completed: number }
  activities: { total: number; assigned: number; completed: number; overdue: number }
  submissions: { total: number; done: number }
  on_time_pct: number | null
}

interface TeacherRow {
  teacher_id: string
  teacher_name: string
  sessions: number
  present: number
  late: number
  absent: number
  excused: number
  avg_minutes_late: number
  activities: number
  overdue_activities: number
}

interface AttentionRow {
  teacher_id: string
  teacher_name: string
  late_sessions: number
  absent_sessions: number
  overdue_activities: number
  last_incident_at: string | null
}

interface ExpectationRow {
  id: string
  class_id: string | null
  class_name: string | null
  subject: string | null
  activity_type: string
  per_class_count: number
  per_week_count: number
  created_by_name: string | null
}

const ACT_TYPES = ['any', 'classwork', 'homework', 'quiz', 'exercise', 'assignment', 'project', 'reading', 'practical', 'exam', 'other']
const dim: CSSProperties = { color: 'var(--text-dim)' }
const isoDay = (d: Date): string => d.toISOString().slice(0, 10)

export default function TeachingPerformance(): JSX.Element {
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 864e5)))
  const [to, setTo] = useState(isoDay(new Date()))
  const qs = `from=${from}&to=${to}`
  const overviewQ = useApiData<Overview>(`/teaching/reports/overview?${qs}`)
  const teachersQ = useApiData<{ teachers: TeacherRow[] }>(`/teaching/reports/teachers?${qs}`)
  const attentionQ = useApiData<{ attention: AttentionRow[] }>(`/teaching/reports/attention?${qs}`)
  const expectationsQ = useApiData<{ expectations: ExpectationRow[] }>('/teaching/expectations')
  const classesQ = useApiData<{ classes: { id: string; name: string }[] }>('/school/classes')

  const [genBusy, setGenBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const generate = async (): Promise<void> => {
    setGenBusy(true)
    setNotice(null)
    setError(null)
    try {
      const r = await api.post<{ created: number }>('/teaching/sessions/generate', { date: isoDay(new Date()) })
      setNotice(`Generated ${r.created} session(s) for today.`)
      overviewQ.reload()
      teachersQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setGenBusy(false)
    }
  }
  // ── expectation modal ──
  const [openExp, setOpenExp] = useState(false)
  const [expForm, setExpForm] = useState({ class_id: '', subject: '', activity_type: 'any', per_class_count: '0', per_week_count: '1' })
  const [expBusy, setExpBusy] = useState(false)
  const [expError, setExpError] = useState<string | null>(null)

  const saveExpectation = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setExpBusy(true)
    setExpError(null)
    try {
      await api.post('/teaching/expectations', {
        class_id: expForm.class_id || null,
        subject: expForm.subject.trim() || null,
        activity_type: expForm.activity_type,
        per_class_count: Number(expForm.per_class_count) || 0,
        per_week_count: Number(expForm.per_week_count) || 0,
      })
      setOpenExp(false)
      setExpForm({ class_id: '', subject: '', activity_type: 'any', per_class_count: '0', per_week_count: '1' })
      expectationsQ.reload()
    } catch (err) {
      setExpError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setExpBusy(false)
    }
  }

  const deleteExpectation = async (id: string): Promise<void> => {
    setError(null)
    try {
      await api.del(`/teaching/expectations/${id}`)
      expectationsQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  const ov = overviewQ.data
  const teachers = teachersQ.data?.teachers ?? []
  const attention = attentionQ.data?.attention ?? []
  const expectations = expectationsQ.data?.expectations ?? []

  const teacherCols: Column<TeacherRow>[] = [
    {
      key: 'teacher_name',
      header: 'Teacher',
      render: (r) => <Link to={`/app/teaching/teachers/${r.teacher_id}`}>{r.teacher_name}</Link>,
    },
    { key: 'sessions', header: 'Sessions', render: (r) => r.sessions },
    { key: 'present', header: 'Present', render: (r) => r.present },
    { key: 'late', header: 'Late', render: (r) => (r.late > 0 ? <Badge tone="warn">{r.late}</Badge> : r.late) },
    { key: 'absent', header: 'Absent', render: (r) => (r.absent > 0 ? <Badge tone="bad">{r.absent}</Badge> : r.absent) },
    {
      key: 'on_time',
      header: 'On-time %',
      render: (r) => {
        const held = r.present + r.late + r.absent
        return held > 0 ? `${Math.round((r.present / held) * 100)}%` : '—'
      },
    },
    { key: 'avg_minutes_late', header: 'Avg late', render: (r) => (r.late > 0 ? `${r.avg_minutes_late.toFixed(1)}m` : '—') },
    { key: 'activities', header: 'Activities', render: (r) => r.activities },
    { key: 'overdue_activities', header: 'Overdue', render: (r) => (r.overdue_activities > 0 ? <Badge tone="bad">{r.overdue_activities}</Badge> : r.overdue_activities) },
  ]
  return (
    <div>
      <PageHeader
        title="Teaching Activity"
        subtitle="Teacher punctuality, attendance and activity performance"
        action={
          <div className="pl-toolbar">
            <input type="date" className="pl-input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span style={dim}>to</span>
            <input type="date" className="pl-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            <button type="button" className="pl-btn pl-btn-secondary" disabled={genBusy} onClick={() => void generate()}>
              <i className="fa-solid fa-rotate" aria-hidden="true" /> {genBusy ? 'Generating…' : "Generate today's sessions"}
            </button>
          </div>
        }
      />
      {notice ? <OkBox message={notice} /> : null}
      {error ? <ErrorBox message={error} /> : null}

      {overviewQ.loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
      ) : ov ? (
        <div className="pl-stats">
          <StatCard icon="fa-solid fa-chalkboard-user" label="Sessions held" value={ov.sessions.present + ov.sessions.late + ov.sessions.absent} />
          <StatCard icon="fa-solid fa-clock" label="On-time rate" value={ov.on_time_pct !== null ? `${ov.on_time_pct}%` : '—'} tone="good" />
          <StatCard icon="fa-solid fa-user-clock" label="Late arrivals" value={ov.sessions.late} tone="warn" />
          <StatCard icon="fa-solid fa-user-xmark" label="Absences" value={ov.sessions.absent} tone="bad" />
          <StatCard icon="fa-solid fa-list-check" label="Activities logged" value={ov.activities.total} />
          <StatCard icon="fa-solid fa-triangle-exclamation" label="Overdue activities" value={ov.activities.overdue} tone="bad" />
        </div>
      ) : (
        <ErrorBox message={overviewQ.error ?? 'Failed to load overview'} />
      )}

      <div style={{ height: 16 }} />
      <Card>
        <div className="pl-toolbar">
          <strong>Needs attention</strong>
          <span style={dim}>Teachers with late/absent sessions or overdue activities in the period</span>
        </div>
        {attentionQ.loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : attention.length === 0 ? (
          <EmptyState icon="fa-solid fa-circle-check" title="All clear" hint="No teacher attention items in this period." />
        ) : (
          attention.map((a) => (
            <div key={a.teacher_id} className="pl-att-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div style={{ minWidth: 180 }}>
                <Link to={`/app/teaching/teachers/${a.teacher_id}`}><strong>{a.teacher_name}</strong></Link>
                <small style={{ display: 'block', ...dim }}>
                  {a.last_incident_at ? `Last incident ${fmtDateTime(a.last_incident_at)}` : 'No incidents recorded'}
                </small>
              </div>
              {a.late_sessions > 0 ? <Badge tone="warn">{a.late_sessions} late</Badge> : null}
              {a.absent_sessions > 0 ? <Badge tone="bad">{a.absent_sessions} absent</Badge> : null}
              {a.overdue_activities > 0 ? <Badge tone="bad">{a.overdue_activities} overdue activity(ies)</Badge> : null}
            </div>
          ))
        )}
      </Card>

      <div style={{ height: 16 }} />
      <Card>
        <div className="pl-toolbar">
          <strong>Per-teacher performance</strong>
          <span style={dim}>{teachers.length} teacher(s)</span>
        </div>
        {teachersQ.loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : (
          <DataTable columns={teacherCols} rows={teachers} empty="No teachers found" searchPlaceholder="Search teachers…" />
        )}
      </Card>
      <div style={{ height: 16 }} />
      <Card>
        <div className="pl-toolbar">
          <strong>Activity expectations</strong>
          <span style={dim}>Minimum activities expected per class / per week — used for under-activity detection</span>
          <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpenExp(true)}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add expectation
          </button>
        </div>
        {expectationsQ.loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : expectations.length === 0 ? (
          <EmptyState icon="fa-solid fa-bullseye" title="No expectations configured" hint="Add an expectation to track under-activity per class or subject." />
        ) : (
          expectations.map((x) => (
            <div key={x.id} className="pl-att-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div style={{ minWidth: 220 }}>
                <strong>{x.class_name ?? 'All classes'}{x.subject ? ` · ${x.subject}` : ''}</strong>
                <small style={{ display: 'block', ...dim }}>
                  type: {x.activity_type}{x.created_by_name ? ` · by ${x.created_by_name}` : ''}
                </small>
              </div>
              <Badge tone="info">{x.per_class_count}/class</Badge>
              <Badge tone="info">{x.per_week_count}/week</Badge>
              <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => void deleteExpectation(x.id)}>
                <i className="fa-solid fa-trash" aria-hidden="true" /> Delete
              </button>
            </div>
          ))
        )}
      </Card>

      <Modal open={openExp} title="Add activity expectation" onClose={() => setOpenExp(false)}>
        <FormRow onSubmit={(e) => void saveExpectation(e)} submitLabel="Save expectation" busy={expBusy} error={expError}>
          <Field label="Class" hint="Leave empty for a school-wide default">
            <select className="pl-select" value={expForm.class_id} onChange={(e) => setExpForm({ ...expForm, class_id: e.target.value })}>
              <option value="">All classes</option>
              {(classesQ.data?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Subject" hint="Leave empty to cover all subjects in scope">
            <input className="pl-input" value={expForm.subject} onChange={(e) => setExpForm({ ...expForm, subject: e.target.value })} placeholder="e.g. Mathematics" />
          </Field>
          <Field label="Activity type">
            <select className="pl-select" value={expForm.activity_type} onChange={(e) => setExpForm({ ...expForm, activity_type: e.target.value })}>
              {ACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Per class session">
            <input className="pl-input" type="number" min="0" max="100" value={expForm.per_class_count} onChange={(e) => setExpForm({ ...expForm, per_class_count: e.target.value })} />
          </Field>
          <Field label="Per week">
            <input className="pl-input" type="number" min="0" max="500" value={expForm.per_week_count} onChange={(e) => setExpForm({ ...expForm, per_week_count: e.target.value })} />
          </Field>
        </FormRow>
      </Modal>
    </div>
  )
}