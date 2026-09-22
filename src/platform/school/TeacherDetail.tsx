import { useState, type CSSProperties, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, fmtDateTime } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, EmptyState, ErrorBox, Field, FormRow, Modal, OkBox, PageHeader, Spinner } from '../ui'

interface TeacherInfo {
  id: string
  full_name: string
  subject: string | null
  phone: string | null
  email: string | null
  user_id: string | null
  linked_email: string | null
  linked_user_name: string | null
}

interface SessionRow {
  id: string
  subject: string
  session_date: string
  scheduled_start: string
  scheduled_end: string
  actual_start: string | null
  actual_end: string | null
  is_completed: boolean
  status: string
  minutes_late: number
  status_reason: string | null
  class_name: string
}

interface ActivityRow {
  id: string
  subject: string
  type: string
  title: string
  status: string
  due_at: string | null
  created_at: string
  class_name: string
  submission_count: number
  submitted_count: number
}

interface EventRow {
  id: string
  event_type: string
  actor_name: string | null
  meta: Record<string, unknown>
  created_at: string
}

interface DetailRes {
  teacher: TeacherInfo
  sessions: SessionRow[]
  activities: ActivityRow[]
  events: EventRow[]
  period: { from: string; to: string }
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
const OVERRIDE_STATUSES = ['excused', 'cancelled', 'substituted', 'absent', 'present'] as const
const dim: CSSProperties = { color: 'var(--text-dim)' }
const isoDay = (d: Date): string => d.toISOString().slice(0, 10)
const fmtTime = (d: string | null | undefined): string =>
  d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '—'
export default function TeacherDetail(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const [from, setFrom] = useState(isoDay(new Date(Date.now() - 29 * 864e5)))
  const [to, setTo] = useState(isoDay(new Date()))
  const detailQ = useApiData<DetailRes>(id ? `/teaching/reports/teachers/${id}?from=${from}&to=${to}` : null)
  const usersQ = useApiData<{ users: { id: string; full_name: string; email: string }[] }>('/users')
  const teachersQ = useApiData<{ teachers: { id: string; full_name: string }[] }>('/school/teachers')

  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── link account ──
  const [linkUserId, setLinkUserId] = useState('')
  const [linkBusy, setLinkBusy] = useState(false)

  const linkAccount = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!id || !linkUserId) return
    setLinkBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api.post(`/teaching/teachers/${id}/link-account`, { user_id: linkUserId })
      setNotice('Account linked — the teacher can now check in to their own sessions.')
      setLinkUserId('')
      detailQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Link failed')
    } finally {
      setLinkBusy(false)
    }
  }

  // ── override modal ──
  const [overrideSession, setOverrideSession] = useState<SessionRow | null>(null)
  const [ovForm, setOvForm] = useState<{ status: string; reason: string; substitute_teacher_id: string }>({ status: 'excused', reason: '', substitute_teacher_id: '' })
  const [ovBusy, setOvBusy] = useState(false)
  const [ovError, setOvError] = useState<string | null>(null)

  const openOverride = (s: SessionRow): void => {
    setOverrideSession(s)
    setOvForm({ status: 'excused', reason: '', substitute_teacher_id: '' })
    setOvError(null)
  }

  const saveOverride = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!overrideSession) return
    setOvBusy(true)
    setOvError(null)
    try {
      await api.post(`/teaching/sessions/${overrideSession.id}/override`, {
        status: ovForm.status,
        reason: ovForm.reason.trim(),
        substitute_teacher_id: ovForm.status === 'substituted' ? ovForm.substitute_teacher_id : null,
      })
      setOverrideSession(null)
      detailQ.reload()
    } catch (err) {
      setOvError(err instanceof Error ? err.message : 'Override failed')
    } finally {
      setOvBusy(false)
    }
  }

  const teacher = detailQ.data?.teacher ?? null
  const sessions = detailQ.data?.sessions ?? []
  const activities = detailQ.data?.activities ?? []
  const events = detailQ.data?.events ?? []
  if (detailQ.loading && !detailQ.data) {
    return <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}><Spinner /></div>
  }
  if (!teacher) {
    return <EmptyState icon="fa-solid fa-user-slash" title="Teacher not found" hint={detailQ.error ?? 'The teacher could not be loaded.'} />
  }

  return (
    <div>
      <PageHeader
        title={teacher.full_name}
        subtitle={`${teacher.subject ?? 'General'} · ${detailQ.data?.period.from ?? ''} → ${detailQ.data?.period.to ?? ''}`}
        action={
          <div className="pl-toolbar">
            <input type="date" className="pl-input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
            <span style={dim}>to</span>
            <input type="date" className="pl-input" value={to} min={from} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
            <Link to="/app/teaching-performance" className="pl-btn pl-btn-ghost pl-btn-sm">
              <i className="fa-solid fa-arrow-left" aria-hidden="true" /> Back
            </Link>
          </div>
        }
      />
      {notice ? <OkBox message={notice} /> : null}
      {error ? <ErrorBox message={error} /> : null}

      <Card>
        <div className="pl-toolbar">
          <strong>Login account</strong>
          <span style={dim}>Link a user account so this teacher can check in to their own sessions</span>
        </div>
        {teacher.user_id ? (
          <div className="pl-att-row">
            <Badge tone="good">linked</Badge>
            <div>
              <strong>{teacher.linked_user_name ?? 'Linked user'}</strong>
              <small style={{ display: 'block', ...dim }}>{teacher.linked_email}</small>
            </div>
          </div>
        ) : (
          <form onSubmit={(e) => void linkAccount(e)} className="pl-toolbar" style={{ flexWrap: 'wrap' }}>
            <select className="pl-select" required value={linkUserId} onChange={(e) => setLinkUserId(e.target.value)} aria-label="User account">
              <option value="">Select user account…</option>
              {(usersQ.data?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.full_name} ({u.email})</option>)}
            </select>
            <button type="submit" className="pl-btn pl-btn-primary pl-btn-sm" disabled={linkBusy || !linkUserId}>
              <i className="fa-solid fa-link" aria-hidden="true" /> {linkBusy ? 'Linking…' : 'Link account'}
            </button>
          </form>
        )}
      </Card>

      <div style={{ height: 16 }} />
      <Card>
        <div className="pl-toolbar">
          <strong>Sessions</strong>
          <span style={dim}>{sessions.length} in period</span>
        </div>
        {sessions.length === 0 ? (
          <EmptyState icon="fa-solid fa-calendar-xmark" title="No sessions" hint="No class sessions recorded for this teacher in the selected period." />
        ) : (
          sessions.map((s) => (
            <div key={s.id} className="pl-att-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div style={{ minWidth: 150 }}>
                <strong>{new Date(s.session_date).toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short' })}</strong>
                <small style={{ display: 'block', ...dim }}>{fmtTime(s.scheduled_start)} – {fmtTime(s.scheduled_end)}</small>
              </div>
              <div style={{ minWidth: 140 }}>
                <strong>{s.class_name}</strong>
                <small style={{ display: 'block', ...dim }}>{s.subject}</small>
              </div>
              <Badge tone={SESSION_TONE[s.status] ?? 'neutral'}>
                {s.status}{s.status === 'late' && s.minutes_late ? ` (+${s.minutes_late}m)` : ''}
              </Badge>
              {s.is_completed ? <Badge tone="good">completed</Badge> : null}
              {s.status_reason ? <small style={dim} title={s.status_reason}><i className="fa-solid fa-note-sticky" aria-hidden="true" /></small> : null}
              <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" style={{ marginLeft: 'auto' }} onClick={() => openOverride(s)}>
                <i className="fa-solid fa-pen" aria-hidden="true" /> Override
              </button>
            </div>
          ))
        )}
      </Card>
      <div style={{ height: 16 }} />
      <Card>
        <div className="pl-toolbar">
          <strong>Activities</strong>
          <span style={dim}>{activities.length} logged</span>
        </div>
        {activities.length === 0 ? (
          <EmptyState icon="fa-solid fa-list-check" title="No activities" hint="This teacher has not logged any activities yet." />
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
            </div>
          ))
        )}
      </Card>

      <div style={{ height: 16 }} />
      <Card>
        <div className="pl-toolbar">
          <strong>Event timeline</strong>
          <span style={dim}>Latest 50 events</span>
        </div>
        {events.length === 0 ? (
          <EmptyState icon="fa-solid fa-clock-rotate-left" title="No events" hint="Events will appear here as sessions and activities are processed." />
        ) : (
          events.map((e) => (
            <div key={e.id} className="pl-att-row" style={{ flexWrap: 'wrap', gap: 8 }}>
              <Badge tone={e.event_type.includes('absent') ? 'bad' : e.event_type.includes('late') || e.event_type.includes('overdue') ? 'warn' : 'info'}>
                {e.event_type.replace(/_/g, ' ')}
              </Badge>
              <small style={dim}>{fmtDateTime(e.created_at)}{e.actor_name ? ` · by ${e.actor_name}` : ''}</small>
            </div>
          ))
        )}
      </Card>

      <Modal open={overrideSession !== null} title="Override session status" onClose={() => setOverrideSession(null)}>
        <FormRow onSubmit={(e) => void saveOverride(e)} submitLabel="Apply override" busy={ovBusy} error={ovError}>
          {overrideSession ? (
            <p style={dim}>
              {overrideSession.class_name} · {overrideSession.subject} · {new Date(overrideSession.session_date).toLocaleDateString('en-GB')} ·
              current status: <strong>{overrideSession.status}</strong>
            </p>
          ) : null}
          <Field label="New status">
            <select className="pl-select" value={ovForm.status} onChange={(e) => setOvForm({ ...ovForm, status: e.target.value })}>
              {OVERRIDE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          {ovForm.status === 'substituted' ? (
            <Field label="Substitute teacher">
              <select className="pl-select" required value={ovForm.substitute_teacher_id} onChange={(e) => setOvForm({ ...ovForm, substitute_teacher_id: e.target.value })}>
                <option value="">Select substitute…</option>
                {(teachersQ.data?.teachers ?? []).filter((tr) => tr.id !== id).map((tr) => <option key={tr.id} value={tr.id}>{tr.full_name}</option>)}
              </select>
            </Field>
          ) : null}
          <Field label="Reason" hint="Required — recorded in the audit log">
            <input className="pl-input" required minLength={3} value={ovForm.reason} onChange={(e) => setOvForm({ ...ovForm, reason: e.target.value })} placeholder="e.g. Teacher on sick leave" />
          </Field>
        </FormRow>
      </Modal>
    </div>
  )
}