import { useState, type FormEvent } from 'react'
import { api, fmtDateTime } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, EmptyState, Field, PageHeader, Spinner } from '../ui'

interface Announcement {
  id: string
  title: string
  body: string
  pinned: boolean
  posted_by: string | null
  created_at: string
}

export default function Announcements(): JSX.Element {
  const { data, loading, reload } = useApiData<{ announcements: Announcement[] }>('/school/announcements')
  const [form, setForm] = useState({ title: '', body: '', pinned: false })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/school/announcements', form)
      setForm({ title: '', body: '', pinned: false })
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
      <PageHeader title="Announcements" subtitle="Staff notice board — pinned items stay on top" />

      <div className="pl-cols-2">
        <Card>
          <h2>Post an announcement</h2>
          <form onSubmit={submit}>
            <Field label="Title">
              <input className="pl-input" required minLength={2} maxLength={160} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Parents' day on Friday…" />
            </Field>
            <Field label="Message">
              <textarea className="pl-textarea" required minLength={2} maxLength={3000} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.88rem', marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.pinned} onChange={(e) => setForm((f) => ({ ...f, pinned: e.target.checked }))} />
              Pin to top
            </label>
            {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
            <div className="pl-form-actions">
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
                {busy ? 'Posting…' : 'Post announcement'}
              </button>
            </div>
          </form>
        </Card>

        <div>
          {loading ? (
            <Spinner />
          ) : rows.length === 0 ? (
            <EmptyState icon="fa-solid fa-bullhorn" title="No announcements yet" />
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
                <div style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center' }}>
                  {a.pinned && <Badge tone="warn">Pinned</Badge>}
                  <small style={{ color: 'var(--text-dim)' }}>
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
