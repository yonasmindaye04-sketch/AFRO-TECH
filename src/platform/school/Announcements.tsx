import { useState, type FormEvent } from 'react'
import { api, fmtDateTime } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, EmptyState, Field, PageHeader, Spinner } from '../ui'

interface Announcement {
  id: string
  title: string
  body: string
  pinned: boolean
  target_type?: 'all' | 'class' | 'staff'
  class_id?: string | null
  class_name?: string | null
  sent_email?: boolean
  sent_telegram?: boolean
  delivery_stats?: {
    totalTargeted?: number
    emailSent?: number
    emailFailed?: number
    telegramSent?: number
    telegramFailed?: number
    completedAt?: string
  } | null
  posted_by: string | null
  created_at: string
}

interface ClassOpt {
  id: string
  name: string
}

export default function Announcements(): JSX.Element {
  const { data, loading, reload } = useApiData<{ announcements: Announcement[] }>('/school/announcements')
  const classesQ = useApiData<{ classes: ClassOpt[] }>('/school/classes')
  const [form, setForm] = useState({
    title: '',
    body: '',
    pinned: false,
    target_type: 'all' as 'all' | 'class' | 'staff',
    class_id: '',
    send_email: false,
    send_telegram: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deliveryResult, setDeliveryResult] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setDeliveryResult(null)
    try {
      const res = await api.post<{ announcement: Announcement; delivery?: { emailSent: number; telegramSent: number; totalTargeted: number } }>('/school/announcements', {
        title: form.title.trim(),
        body: form.body.trim(),
        pinned: form.pinned,
        target_type: form.target_type,
        class_id: form.target_type === 'class' && form.class_id ? form.class_id : null,
        send_email: form.send_email,
        send_telegram: form.send_telegram,
      })
      if (res.delivery) {
        setDeliveryResult(`Delivered: ${res.delivery.emailSent} email(s), ${res.delivery.telegramSent} telegram message(s)`)
      }
      setForm({
        title: '',
        body: '',
        pinned: false,
        target_type: 'all',
        class_id: '',
        send_email: false,
        send_telegram: false,
      })
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Post failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this announcement?')) return
    await api.del(`/school/announcements/${id}`).catch(() => undefined)
    reload()
  }

  const rows = data?.announcements ?? []

  return (
    <div>
      <PageHeader title="Announcements & Notices" subtitle="Broadcast school updates, notices, and alerts to guardians via Email & Telegram" />

      <div className="pl-cols-2">
        <Card>
          <h2>Post an announcement</h2>
          <form onSubmit={submit}>
            <Field label="Title">
              <input
                className="pl-input"
                required
                minLength={2}
                maxLength={160}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Mid-term exams, Parents' day…"
              />
            </Field>

            <div className="pl-grid-2">
              <Field label="Audience">
                <select
                  className="pl-select"
                  value={form.target_type}
                  onChange={(e) => setForm((f) => ({ ...f, target_type: e.target.value as 'all' | 'class' | 'staff' }))}
                >
                  <option value="all">All Guardians & School</option>
                  <option value="class">Specific Class Guardians</option>
                  <option value="staff">Staff Only (Internal)</option>
                </select>
              </Field>

              {form.target_type === 'class' ? (
                <Field label="Select Class">
                  <select
                    className="pl-select"
                    required
                    value={form.class_id}
                    onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value }))}
                  >
                    <option value="">— Select class —</option>
                    {(classesQ.data?.classes ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <div />
              )}
            </div>

            <Field label="Message">
              <textarea
                className="pl-textarea"
                required
                minLength={2}
                maxLength={3000}
                rows={4}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Write notice details here…"
              />
            </Field>

            {form.target_type !== 'staff' && (
              <div style={{ background: 'var(--card-subtle, rgba(255,255,255,0.03))', padding: '12px 14px', borderRadius: 8, marginBottom: 14, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: '.82rem', fontWeight: 600, color: 'var(--text)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <i className="fa-solid fa-paper-plane" style={{ color: 'var(--accent)' }} />
                  Direct Guardian Notification Channels
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label className="pl-checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.send_email}
                      onChange={(e) => setForm((f) => ({ ...f, send_email: e.target.checked }))}
                    />
                    <span><i className="fa-solid fa-envelope" style={{ marginRight: 5 }} />Send to Guardian Email</span>
                  </label>
                  <label className="pl-checkbox-label">
                    <input
                      type="checkbox"
                      checked={form.send_telegram}
                      onChange={(e) => setForm((f) => ({ ...f, send_telegram: e.target.checked }))}
                    />
                    <span><i className="fa-brands fa-telegram" style={{ marginRight: 5 }} />Send to Guardian Telegram Chat</span>
                  </label>
                </div>
              </div>
            )}

            <div style={{ marginBottom: 14 }}>
              <label className="pl-checkbox-label">
                <input
                  type="checkbox"
                  checked={form.pinned}
                  onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))}
                />
                <span>Pin notice to top</span>
              </label>
            </div>

            {deliveryResult && (
              <p style={{ color: '#4ade80', fontSize: '.87rem', background: 'rgba(74,222,128,0.1)', padding: '6px 10px', borderRadius: 6, marginBottom: 12 }}>
                <i className="fa-solid fa-circle-check" style={{ marginRight: 6 }} />
                {deliveryResult}
              </p>
            )}

            {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
            <div className="pl-form-actions">
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
                {busy ? 'Posting & Delivering…' : 'Post announcement'}
              </button>
            </div>
          </form>
        </Card>

        <div>
          {loading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState icon="fa-solid fa-bullhorn" title="No announcements yet" hint="Create your first notice to broadcast to guardians." />
          ) : (
            rows.map((a) => (
              <Card key={a.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                  <h2 style={{ marginBottom: 4 }}>
                    {a.pinned && <i className="fa-solid fa-thumbtack" aria-hidden="true" style={{ color: 'var(--accent)', marginRight: 8 }} />}
                    {a.title}
                  </h2>
                  <button type="button" className="pl-icon-btn danger" aria-label={`Delete ${a.title}`} onClick={() => remove(a.id)}>
                    <i className="fa-solid fa-trash-can" aria-hidden="true" />
                  </button>
                </div>
                <p style={{ fontSize: '.92rem', whiteSpace: 'pre-wrap' }}>{a.body}</p>

                <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  {a.pinned && <Badge tone="warn">Pinned</Badge>}

                  {a.target_type === 'staff' ? (
                    <Badge tone="neutral">Staff Only</Badge>
                  ) : a.target_type === 'class' ? (
                    <Badge tone="good">Class: {a.class_name || 'Class'}</Badge>
                  ) : (
                    <Badge tone="good">All School</Badge>
                  )}

                  {a.sent_email && (
                    <span style={{ fontSize: '.78rem', color: 'var(--accent)', background: 'rgba(59,130,246,0.1)', padding: '2px 7px', borderRadius: 4 }}>
                      <i className="fa-solid fa-envelope" style={{ marginRight: 4 }} />{a.delivery_stats?.emailSent ?? 1} email{((a.delivery_stats?.emailSent ?? 1) > 1) ? 's' : ''} sent
                    </span>
                  )}

                  {a.sent_telegram && (
                    <span style={{ fontSize: '.78rem', color: '#229ED9', background: 'rgba(34,158,217,0.1)', padding: '2px 7px', borderRadius: 4 }}>
                      <i className="fa-brands fa-telegram" style={{ marginRight: 4 }} />{a.delivery_stats?.telegramSent ?? 1} telegram sent
                    </span>
                  )}

                  <small style={{ color: 'var(--text-dim)', marginLeft: 'auto' }}>
                    {a.posted_by ?? 'Staff'} · {fmtDateTime(a.created_at)}
                  </small>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
