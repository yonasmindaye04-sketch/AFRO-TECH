import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Student {
  id: string
  code: string
  first_name: string
  last_name: string
  gender: 'male' | 'female'
  dob: string | null
  class_id: string | null
  class_name: string | null
  guardian_name: string | null
  guardian_phone: string | null
  guardian_email: string | null
  guardian_telegram_chat_id: string | null
  guardian_telegram_username: string | null
  address: string | null
  status: 'active' | 'graduated' | 'withdrawn'
}

interface ClassOpt {
  id: string
  name: string
}

const empty = {
  first_name: '',
  last_name: '',
  gender: 'male',
  dob: '',
  class_id: '',
  guardian_name: '',
  guardian_phone: '',
  guardian_email: '',
  guardian_telegram_chat_id: '',
  guardian_telegram_username: '',
  address: '',
}

export default function Students(): JSX.Element {
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const qs = new URLSearchParams()
  if (search) qs.set('search', search)
  if (classFilter) qs.set('class_id', classFilter)
  const { data, loading, reload } = useApiData<{ students: Student[] }>(`/school/students?${qs.toString()}`)
  const classesQ = useApiData<{ classes: ClassOpt[] }>('/school/classes')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Student | null>(null)
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Direct 1-on-1 Guardian Notice Modal state
  const [noticeTarget, setNoticeTarget] = useState<Student | null>(null)
  const [noticeForm, setNoticeForm] = useState({
    title: '',
    message: '',
    channel: 'both' as 'email' | 'telegram' | 'both',
  })
  const [noticeBusy, setNoticeBusy] = useState(false)
  const [noticeError, setNoticeError] = useState<string | null>(null)
  const [noticeSuccess, setNoticeSuccess] = useState<string | null>(null)

  const openNew = (): void => {
    setForm(empty)
    setEditing(null)
    setError(null)
    setOpen(true)
  }

  const openEdit = (s: Student): void => {
    setForm({
      first_name: s.first_name,
      last_name: s.last_name,
      gender: s.gender,
      dob: s.dob ?? '',
      class_id: s.class_id ?? '',
      guardian_name: s.guardian_name ?? '',
      guardian_phone: s.guardian_phone ?? '',
      guardian_email: s.guardian_email ?? '',
      guardian_telegram_chat_id: s.guardian_telegram_chat_id ?? '',
      guardian_telegram_username: s.guardian_telegram_username ?? '',
      address: s.address ?? '',
    })
    setEditing(s)
    setError(null)
    setOpen(true)
  }

  const openNoticeModal = (s: Student): void => {
    setNoticeTarget(s)
    setNoticeForm({
      title: `Notice regarding ${s.first_name} ${s.last_name}`,
      message: '',
      channel: s.guardian_email && s.guardian_telegram_chat_id ? 'both' : s.guardian_telegram_chat_id ? 'telegram' : 'email',
    })
    setNoticeError(null)
    setNoticeSuccess(null)
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      gender: form.gender,
      dob: form.dob || null,
      class_id: form.class_id || null,
      guardian_name: form.guardian_name.trim() || null,
      guardian_phone: form.guardian_phone.trim() || null,
      guardian_email: form.guardian_email.trim() || null,
      guardian_telegram_chat_id: form.guardian_telegram_chat_id.trim() || null,
      guardian_telegram_username: form.guardian_telegram_username.trim() || null,
      address: form.address.trim() || null,
    }
    try {
      if (editing) await api.patch(`/school/students/${editing.id}`, body)
      else await api.post('/school/students', body)
      setOpen(false)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const sendNotice = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!noticeTarget) return
    setNoticeBusy(true)
    setNoticeError(null)
    setNoticeSuccess(null)
    try {
      const res = await api.post<{
        ok: boolean
        emailStatus?: string
        telegramStatus?: string
      }>(`/school/students/${noticeTarget.id}/notify`, {
        title: noticeForm.title.trim(),
        message: noticeForm.message.trim(),
        channel: noticeForm.channel,
      })

      const channelsSent: string[] = []
      if (res.emailStatus && res.emailStatus !== 'not_configured' && res.emailStatus !== 'failed') {
        channelsSent.push('Email')
      }
      if (res.telegramStatus && res.telegramStatus !== 'not_configured' && res.telegramStatus !== 'failed') {
        channelsSent.push('Telegram')
      }

      setNoticeSuccess(`Notice successfully sent via ${channelsSent.length ? channelsSent.join(' & ') : 'selected channel'}!`)
      setTimeout(() => {
        setNoticeTarget(null)
      }, 1500)
    } catch (err) {
      setNoticeError(err instanceof Error ? err.message : 'Failed to send notice')
    } finally {
      setNoticeBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle="Manage student directory and guardian communication channels"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={openNew}>
            <i className="fa-solid fa-user-plus" aria-hidden="true" /> Add student
          </button>
        }
      />
      <div className="pl-toolbar">
        <input
          className="pl-input"
          placeholder="Search by name or ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search students"
        />
        <select className="pl-select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="Filter by class">
          <option value="">All classes</option>
          {(classesQ.data?.classes ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Spinner />
      ) : !data?.students.length ? (
        <EmptyState icon="fa-solid fa-user-graduate" title="No students found" hint="Register your first student." />
      ) : (
        <DataTable
          rows={data.students}
          columns={[
            { key: 'code', header: 'ID', render: (s) => <strong>{s.code}</strong>, width: '100px' },
            {
              key: 'name',
              header: 'Name',
              render: (s) => (
                <div>
                  <strong>{s.first_name} {s.last_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)', textTransform: 'capitalize' }}>{s.gender}</small>
                </div>
              ),
            },
            { key: 'class', header: 'Class', render: (s) => s.class_name ?? 'Unassigned' },
            {
              key: 'guardian',
              header: 'Guardian & Channels',
              render: (s) => (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span>{s.guardian_name || 'No guardian name'}</span>
                    {s.guardian_email && (
                      <span title={`Email: ${s.guardian_email}`} style={{ color: 'var(--accent)', fontSize: '.85rem' }}>
                        <i className="fa-solid fa-envelope" />
                      </span>
                    )}
                    {s.guardian_telegram_chat_id && (
                      <span
                        title={`Telegram Chat: ${s.guardian_telegram_username ? `@${s.guardian_telegram_username}` : s.guardian_telegram_chat_id}`}
                        style={{ color: '#229ED9', fontSize: '.85rem' }}
                      >
                        <i className="fa-brands fa-telegram" />
                      </span>
                    )}
                  </div>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>
                    {s.guardian_phone || (s.guardian_email ? s.guardian_email : 'No contact saved')}
                  </small>
                </div>
              ),
            },
            {
              key: 'status',
              header: 'Status',
              width: '100px',
              render: (s) => <Badge tone={s.status === 'active' ? 'good' : 'neutral'}>{s.status}</Badge>,
            },
            {
              key: 'act',
              header: '',
              width: '90px',
              render: (s) => (
                <div className="pl-row-actions">
                  <button
                    type="button"
                    className="pl-icon-btn"
                    title={`Send notice to ${s.first_name}'s guardian`}
                    aria-label={`Send notice to ${s.first_name}'s guardian`}
                    onClick={() => openNoticeModal(s)}
                  >
                    <i className="fa-solid fa-paper-plane" aria-hidden="true" style={{ color: 'var(--accent)' }} />
                  </button>
                  <button type="button" className="pl-icon-btn" aria-label={`Edit ${s.first_name}`} onClick={() => openEdit(s)}>
                    <i className="fa-solid fa-pen" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Add / Edit Student Modal */}
      <Modal open={open} title={editing ? `Edit ${editing.first_name}` : 'Add student'} onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="pl-grid-2">
            <Field label="First name">
              <input className="pl-input" required maxLength={80} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
            </Field>
            <Field label="Last name">
              <input className="pl-input" required maxLength={80} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Gender">
              <select className="pl-select" value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </Field>
            <Field label="Date of birth">
              <input className="pl-input" type="date" value={form.dob} onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))} />
            </Field>
          </div>
          <Field label="Class">
            <select className="pl-select" value={form.class_id} onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value }))}>
              <option value="">— unassigned —</option>
              {(classesQ.data?.classes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>

          <div style={{ margin: '14px 0 8px 0', borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <span style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.05em' }}>
              Guardian Contact & Notification Details
            </span>
          </div>

          <div className="pl-grid-2">
            <Field label="Guardian name">
              <input className="pl-input" value={form.guardian_name} onChange={(e) => setForm((f) => ({ ...f, guardian_name: e.target.value }))} placeholder="Parent / Guardian full name" />
            </Field>
            <Field label="Guardian phone">
              <input className="pl-input" value={form.guardian_phone} onChange={(e) => setForm((f) => ({ ...f, guardian_phone: e.target.value }))} placeholder="+251..." />
            </Field>
          </div>

          <div className="pl-grid-2">
            <Field label="Guardian Email (for notices)">
              <input
                className="pl-input"
                type="email"
                value={form.guardian_email}
                onChange={(e) => setForm((f) => ({ ...f, guardian_email: e.target.value }))}
                placeholder="parent@example.com"
              />
            </Field>
            <Field label="Guardian Telegram Chat ID">
              <input
                className="pl-input"
                value={form.guardian_telegram_chat_id}
                onChange={(e) => setForm((f) => ({ ...f, guardian_telegram_chat_id: e.target.value }))}
                placeholder="e.g. 123456789 (or link via /parent)"
              />
            </Field>
          </div>
          <small style={{ display: 'block', color: 'var(--text-dim)', fontSize: '.78rem', marginTop: -6, marginBottom: 12 }}>
            <i className="fa-solid fa-circle-info" style={{ marginRight: 5, color: 'var(--accent)' }} />Parents can also link automatically by sending <code>/parent {editing?.code || 'STUDENT_CODE'}</code> to the Telegram bot.
          </small>

          <Field label="Address">
            <input className="pl-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>

          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add student'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 1-on-1 Notice Modal */}
      <Modal
        open={Boolean(noticeTarget)}
        title={noticeTarget ? `Send Notice to Guardian of ${noticeTarget.first_name}` : 'Send Notice'}
        onClose={() => setNoticeTarget(null)}
      >
        <form onSubmit={sendNotice}>
          <p style={{ fontSize: '.88rem', color: 'var(--text-dim)', marginBottom: 14 }}>
            Direct communication to <b>{noticeTarget?.guardian_name || `${noticeTarget?.first_name}'s guardian`}</b>.
          </p>

          <Field label="Notice Title">
            <input
              className="pl-input"
              required
              minLength={2}
              maxLength={160}
              value={noticeForm.title}
              onChange={(e) => setNoticeForm((f) => ({ ...f, title: e.target.value }))}
            />
          </Field>

          <Field label="Notice Message">
            <textarea
              className="pl-textarea"
              required
              rows={4}
              minLength={2}
              maxLength={3000}
              value={noticeForm.message}
              onChange={(e) => setNoticeForm((f) => ({ ...f, message: e.target.value }))}
              placeholder="Write the message or update for the guardian here…"
            />
          </Field>

          <Field label="Send Channel">
            <select
              className="pl-select"
              value={noticeForm.channel}
              onChange={(e) => setNoticeForm((f) => ({ ...f, channel: e.target.value as 'email' | 'telegram' | 'both' }))}
            >
              <option value="both">Both Email & Telegram</option>
              <option value="email">Email Only</option>
              <option value="telegram">Telegram Only</option>
            </select>
          </Field>

          <div style={{ background: 'var(--card-subtle, rgba(255,255,255,0.03))', padding: '10px 12px', borderRadius: 6, fontSize: '.82rem', marginBottom: 14 }}>
            <div>
              <i className="fa-solid fa-envelope" style={{ marginRight: 5 }} /><b>Email:</b> {noticeTarget?.guardian_email || <span style={{ color: 'var(--text-dim)' }}>Not configured</span>}
            </div>
            <div style={{ marginTop: 4 }}>
              <i className="fa-brands fa-telegram" style={{ marginRight: 5 }} /><b>Telegram:</b> {noticeTarget?.guardian_telegram_chat_id ? (
                <span>Connected ({noticeTarget.guardian_telegram_username ? `@${noticeTarget.guardian_telegram_username}` : noticeTarget.guardian_telegram_chat_id})</span>
              ) : (
                <span style={{ color: 'var(--text-dim)' }}>Not linked yet</span>
              )}
            </div>
          </div>

          {noticeSuccess && (
            <p style={{ color: '#4ade80', fontSize: '.87rem', background: 'rgba(74,222,128,0.1)', padding: '6px 10px', borderRadius: 6, marginBottom: 12 }}>
              <i className="fa-solid fa-circle-check" style={{ marginRight: 6 }} />
              {noticeSuccess}
            </p>
          )}

          {noticeError && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{noticeError}</p>}

          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={noticeBusy}>
              {noticeBusy ? 'Sending Notice…' : 'Send to Guardian'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
