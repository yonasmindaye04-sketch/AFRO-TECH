import { useEffect, useState, type CSSProperties, type FormEvent } from 'react'
import { api, fmtDateTime } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, EmptyState, ErrorBox, Field, FormRow, Modal, PageHeader, Spinner } from '../ui'

interface SessionRow {
  id: string
  subject: string
  session_date: string
  scheduled_start: string
  scheduled_end: string
  actual_start: string | null
  actual_end: string | null
  is_completed: boolean
  status: 'scheduled' | 'present' | 'late' | 'absent' | 'excused' | 'cancelled' | 'substituted'
  minutes_late: number
  status_reason: string | null
  teacher_name: string
  class_name: string
  substitute_name: string | null
}

interface ActivityRow {
  id: string
  subject: string
  type: string
  title: string
  description: string | null
  status: 'draft' | 'assigned' | 'completed' | 'overdue' | 'cancelled'
  due_at: string | null
  max_score: number | null
  created_at: string
  class_name: string
  teacher_name: string
  submission_count: number
  submitted_count: number
}

interface SubmissionRow {
  id: string
  student_id: string
  student_name: string
  student_code: string
  status: 'pending' | 'submitted' | 'graded' | 'missing' | 'excused'
  score: number | null
  feedback: string | null
}

const SESSION_TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad' | 'info'> = {
  scheduled: 'info',
  present: 'good',
  late: 'warn',
  absent: 'bad',
  excused: 'neutral',
  cancelled: 'neutral',
  substituted: 'info',
}
const ACTIVITY_TONE: Record<string, 'neutral' | 'good' | 'warn' | 'bad' | 'info'> = {
  draft: 'neutral',
  assigned: 'info',
  completed: 'good',
  overdue: 'bad',
  cancelled: 'neutral',
}
const ACT_TYPES = ['classwork', 'homework', 'quiz', 'exercise', 'assignment', 'project', 'reading', 'practical', 'exam', 'other']
const SUB_STATUSES = ['pending', 'submitted', 'graded', 'missing', 'excused'] as const

const fmtTime = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'

const dim: CSSProperties = { color: 'var(--text-dim)' }

export default function Teaching(): JSX.Element {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const sessionsQ = useApiData<{ sessions: SessionRow[] }>(`/teaching/sessions?date=${date}`)
  const activitiesQ = useApiData<{ activities: ActivityRow[] }>('/teaching/activities')
  const classesQ = useApiData<{ classes: { id: string; name: string }[] }>('/school/classes')

  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (id: string, fn: () => Promise<unknown>): Promise<void> => {
    setBusyId(id)
    setError(null)
    try {
      await fn()
      sessionsQ.reload()
      activitiesQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusyId(null)
    }
  }
  // ── create activity modal ──
  const [openAct, setOpenAct] = useState(false)
  const [actForm, setActForm] = useState({ class_id: '', subject: '', type: 'homework', title: '', description: '', due_at: '', max_score: '' })
  const [actBusy, setActBusy] = useState(false)
  const [actError, setActError] = useState<string | null>(null)

  const createActivity = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setActBusy(true)
    setActError(null)
    try {
      await api.post('/teaching/activities', {
        class_id: actForm.class_id,
        subject: actForm.subject.trim(),
        type: actForm.type,
        title: actForm.title.trim(),
        description: actForm.description.trim() || null,
        due_at: actForm.due_at ? new Date(actForm.due_at).toISOString() : null,
        max_score: actForm.max_score ? Number(actForm.max_score) : null,
      })
      setOpenAct(false)
      setActForm({ class_id: '', subject: '', type: 'homework', title: '', description: '', due_at: '', max_score: '' })
      activitiesQ.reload()
    } catch (err) {
      setActError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setActBusy(false)
    }
  }

  // ── submissions modal ──
  const [subActivity, setSubActivity] = useState<ActivityRow | null>(null)
  const subsQ = useApiData<{ submissions: SubmissionRow[] }>(subActivity ? `/teaching/activities/${subActivity.id}/submissions` : null)
  const [marks, setMarks] = useState<Record<string, { status: string; score: string }>>({})
  const [subsBusy, setSubsBusy] = useState(false)
  const [subsError, setSubsError] = useState<string | null>(null)

  useEffect(() => {
    if (subsQ.data) {
      setMarks(Object.fromEntries(subsQ.data.submissions.map((s) => [s.student_id, { status: s.status, score: s.score?.toString() ?? '' }])))
    }
  }, [subsQ.data])

  const saveSubs = async (): Promise<void> => {
    if (!subActivity || !subsQ.data) return
    setSubsBusy(true)
    setSubsError(null)
    try {
      await api.post(`/teaching/activities/${subActivity.id}/submissions/bulk`, {
        entries: subsQ.data.submissions.map((s) => ({
          student_id: s.student_id,
          status: marks[s.student_id]?.status ?? s.status,
          score: marks[s.student_id]?.score ? Number(marks[s.student_id].score) : null,
        })),
      })
      subsQ.reload()
      activitiesQ.reload()
    } catch (err) {
      setSubsError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSubsBusy(false)
    }
  }

  const sessions = sessionsQ.data?.sessions ?? []
  const activities = activitiesQ.data?.activities ?? []
  return (
    <div>
      <PageHeader
        title="My Teaching"
        subtitle="Check in to your class sessions and track classwork, homework and submissions"
        action={
          <div className="pl-toolbar">
            <input type="date" className="pl-input" value={date} onChange={(e) => setDate(e.target.value)} aria-label="Session date" />
            <button type="button" onClick={() => setOpenAct(true)} className="pl-btn pl-btn-primary">
              <i className="fa-solid fa-plus" aria-hidden="true" /> New activity
            </button>
          </div>
        }
      />
      {error ? <ErrorBox message={error} /> : null}

      <Card>
        <div className="pl-toolbar">
          <strong>Class sessions</strong>
          <span style={dim}>{sessions.length} session(s) on {date}</span>
        </div>
        {sessionsQ.loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : sessions.length === 0 ? (
          <EmptyState icon="fa-solid fa-chalkboard-user" title="No sessions" hint="No scheduled class sessions found for this date." />
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="pl-att-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div style={{ minWidth: 110 }}><strong>{fmtTime(s.scheduled_start)} – {fmtTime(s.scheduled_end)}</strong></div>
              <div style={{ minWidth: 140 }}>
                <strong>{s.class_name}</strong>
                <small style={{ display: 'block', ...dim }}>{s.subject}</small>
              </div>
              <Badge tone={SESSION_TONE[s.status] ?? 'neutral'}>
                {s.status}{s.status === 'late' && s.minutes_late ? ` (+${s.minutes_late}m)` : ''}
              </Badge>
              {s.is_completed ? <Badge tone="good">completed</Badge> : null}
              {s.substitute_name ? <Badge tone="info">sub: {s.substitute_name}</Badge> : null}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {!s.actual_start && (s.status === 'scheduled' || s.status === 'late') ? (
                  <button type="button" disabled={busyId === s.id} onClick={() => void run(s.id, () => api.post(`/teaching/sessions/${s.id}/start`))} className="pl-btn pl-btn-primary pl-btn-sm">
                    <i className="fa-solid fa-play" aria-hidden="true" /> {busyId === s.id ? 'Starting…' : 'Check in'}
                  </button>
                ) : null}
                {s.actual_start && !s.is_completed ? (
                  <button type="button" disabled={busyId === s.id} onClick={() => void run(s.id, () => api.post(`/teaching/sessions/${s.id}/complete`))} className="pl-btn pl-btn-ghost pl-btn-sm">
                    <i className="fa-solid fa-check" aria-hidden="true" /> {busyId === s.id ? 'Completing…' : 'Complete'}
                  </button>
                ) : null}
                {s.actual_start ? (
                  <small style={dim}>in {fmtTime(s.actual_start)}{s.actual_end ? ` · out ${fmtTime(s.actual_end)}` : ''}</small>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Card>

      <div style={{ height: 16 }} />
      <Card>
        <div className="pl-toolbar">
          <strong>Teaching activities</strong>
          <span style={dim}>Classwork, homework, quizzes and more</span>
        </div>
        {activitiesQ.loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : activities.length === 0 ? (
          <EmptyState icon="fa-solid fa-list-check" title="No activities" hint="Create your first activity to start tracking submissions." />
        ) : (
          activities.map((a) => (
            <div key={a.id} className="pl-att-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div style={{ minWidth: 200 }}>
                <strong>{a.title}</strong>
                <small style={{ display: 'block', ...dim }}>
                  {a.class_name} · {a.subject}{a.due_at ? ` · due ${fmtDateTime(a.due_at)}` : ''}
                </small>
              </div>
              <Badge tone="neutral">{a.type}</Badge>
              <Badge tone={ACTIVITY_TONE[a.status] ?? 'neutral'}>{a.status}</Badge>
              <small style={dim}>{a.submitted_count}/{a.submission_count} submitted</small>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                {a.status === 'draft' ? (
                  <button type="button" disabled={busyId === a.id} onClick={() => void run(a.id, () => api.post(`/teaching/activities/${a.id}/assign`, { due_at: a.due_at }))} className="pl-btn pl-btn-primary pl-btn-sm">
                    <i className="fa-solid fa-paper-plane" aria-hidden="true" /> Assign
                  </button>
                ) : null}
                {a.status === 'assigned' || a.status === 'overdue' ? (
                  <button type="button" onClick={() => setSubActivity(a)} className="pl-btn pl-btn-secondary pl-btn-sm">
                    <i className="fa-solid fa-clipboard-check" aria-hidden="true" /> Submissions
                  </button>
                ) : null}
                {a.status === 'assigned' || a.status === 'overdue' ? (
                  <button type="button" disabled={busyId === a.id} onClick={() => void run(a.id, () => api.patch(`/teaching/activities/${a.id}`, { status: 'completed' }))} className="pl-btn pl-btn-ghost pl-btn-sm">
                    Mark done
                  </button>
                ) : null}
              </div>
            </div>
          ))
        )}
      </Card>
      <Modal open={openAct} title="New teaching activity" onClose={() => setOpenAct(false)}>
        <FormRow onSubmit={(e) => void createActivity(e)} submitLabel="Create activity" busy={actBusy} error={actError}>
          <Field label="Class">
            <select className="pl-select" required value={actForm.class_id} onChange={(e) => setActForm({ ...actForm, class_id: e.target.value })}>
              <option value="">Select class…</option>
              {(classesQ.data?.classes ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Subject">
            <input className="pl-input" required value={actForm.subject} onChange={(e) => setActForm({ ...actForm, subject: e.target.value })} placeholder="e.g. Mathematics" />
          </Field>
          <Field label="Type">
            <select className="pl-select" value={actForm.type} onChange={(e) => setActForm({ ...actForm, type: e.target.value })}>
              {ACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </Field>
          <Field label="Title">
            <input className="pl-input" required value={actForm.title} onChange={(e) => setActForm({ ...actForm, title: e.target.value })} placeholder="e.g. Chapter 5 exercises" />
          </Field>
          <Field label="Description">
            <input className="pl-input" value={actForm.description} onChange={(e) => setActForm({ ...actForm, description: e.target.value })} placeholder="Optional instructions" />
          </Field>
          <Field label="Due date" hint="Optional — set when assigning">
            <input className="pl-input" type="datetime-local" value={actForm.due_at} onChange={(e) => setActForm({ ...actForm, due_at: e.target.value })} />
          </Field>
          <Field label="Max score">
            <input className="pl-input" type="number" min="0" step="0.5" value={actForm.max_score} onChange={(e) => setActForm({ ...actForm, max_score: e.target.value })} placeholder="Optional" />
          </Field>
        </FormRow>
      </Modal>

      <Modal open={subActivity !== null} title={`Submissions — ${subActivity?.title ?? ''}`} onClose={() => setSubActivity(null)} wide>
        {subsQ.loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: 24 }}><Spinner /></div>
        ) : (subsQ.data?.submissions ?? []).length === 0 ? (
          <EmptyState icon="fa-solid fa-user-graduate" title="No students" hint="No enrolled students found for this class." />
        ) : (
          <>
            {subsError ? <ErrorBox message={subsError} /> : null}
            {(subsQ.data?.submissions ?? []).map((s) => (
              <div key={s.student_id} className="pl-att-row" style={{ flexWrap: 'wrap', gap: 8 }}>
                <div style={{ minWidth: 180 }}>
                  <strong>{s.student_name}</strong>
                  <small style={{ display: 'block', ...dim }}>{s.student_code}</small>
                </div>
                <div className="pl-seg" role="radiogroup" aria-label={`Status for ${s.student_name}`}>
                  {SUB_STATUSES.map((st) => (
                    <button
                      key={st}
                      type="button"
                      className={(marks[s.student_id]?.status ?? s.status) === st ? 'on' : ''}
                      onClick={() => setMarks({ ...marks, [s.student_id]: { status: st, score: marks[s.student_id]?.score ?? '' } })}
                    >
                      {st}
                    </button>
                  ))}
                </div>
                <input
                  className="pl-input"
                  type="number"
                  min="0"
                  step="0.5"
                  style={{ width: 90 }}
                  placeholder="Score"
                  value={marks[s.student_id]?.score ?? ''}
                  onChange={(e) => setMarks({ ...marks, [s.student_id]: { status: marks[s.student_id]?.status ?? s.status, score: e.target.value } })}
                  aria-label={`Score for ${s.student_name}`}
                />
              </div>
            ))}
            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-primary" disabled={subsBusy} onClick={() => void saveSubs()}>
                <i className="fa-solid fa-floppy-disk" aria-hidden="true" /> {subsBusy ? 'Saving…' : 'Save submissions'}
              </button>
            </div>
          </>
        )}
      </Modal>
    </div>
  )
}