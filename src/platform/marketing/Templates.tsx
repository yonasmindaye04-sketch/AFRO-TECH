import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Card, Badge, ErrorBox, OkBox, Field, Modal, FormRow, DataTable } from '../ui'
import type { MarketingTemplate } from './types'

export default function Templates(): JSX.Element {
  const [templates, setTemplates] = useState<MarketingTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)

  const [form, setForm] = useState({ name: '', channel: 'sms', subject: '', content: '' })
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      const r = await api.get<{ templates: MarketingTemplate[] }>('/marketing/templates')
      setTemplates(r.templates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/marketing/templates', form)
      setOk('Template saved.')
      setShowAdd(false)
      setForm({ name: '', channel: 'sms', subject: '', content: '' })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const channelIcon: Record<string, string> = {
    sms: 'fa-solid fa-message',
    email: 'fa-solid fa-envelope',
    whatsapp: 'fa-brands fa-whatsapp',
    push: 'fa-solid fa-bell',
  }

  const cols = [
    { key: 'name', header: 'Name', render: (t: MarketingTemplate) => <strong>{t.name}</strong> },
    {
      key: 'channel',
      header: 'Channel',
      render: (t: MarketingTemplate) => (
        <span>
          <i className={channelIcon[t.channel]} style={{ marginRight: 6 }} /> {t.channel}
        </span>
      ),
    },
    { key: 'content', header: 'Preview', render: (t: MarketingTemplate) => <span style={{ color: 'var(--text-dim)' }}>{t.content.slice(0, 60)}{t.content.length > 60 ? '…' : ''}</span> },
    {
      key: 'status',
      header: 'Status',
      render: (t: MarketingTemplate) => (
        <Badge tone={t.status === 'published' ? 'good' : t.status === 'archived' ? 'neutral' : 'warn'}>{t.status}</Badge>
      ),
    },
  ]

  return (
    <div className="pl-page">
      <PageHeader
        title="Templates"
        subtitle="Reusable messages with variables like {{first_name}}."
        action={
          <button className="pl-btn pl-btn-primary" onClick={() => setShowAdd(true)}>
            <i className="fa-solid fa-plus" /> New template
          </button>
        }
      />
      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}
      <Card>{loading ? <p>Loading…</p> : <DataTable columns={cols} rows={templates} empty="No templates yet." />}</Card>

      <Modal open={showAdd} title="New template" onClose={() => setShowAdd(false)} wide>
        <FormRow onSubmit={submit} submitLabel={busy ? 'Saving…' : 'Save template'} busy={busy} error={error}>
          <Field label="Name">
            <input className="pl-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Channel">
            <select className="pl-input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
              <option value="sms">SMS</option>
              <option value="email">Email</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="push">Push</option>
            </select>
          </Field>
          {form.channel === 'email' && (
            <Field label="Subject">
              <input className="pl-input" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            </Field>
          )}
          <Field label="Content" hint="Use {{first_name}}, {{last_name}}, {{city}}, etc.">
            <textarea className="pl-textarea" rows={6} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} required />
          </Field>
        </FormRow>
      </Modal>
    </div>
  )
}