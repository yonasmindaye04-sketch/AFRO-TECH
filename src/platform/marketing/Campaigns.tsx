import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Card, Badge, ErrorBox, OkBox, Field, Modal, FormRow, DataTable } from '../ui'
import { campaignTone, type MarketingCampaign, type MarketingAudience, type MarketingTemplate } from './types'

interface ChannelRow {
  channel: 'sms' | 'email' | 'whatsapp' | 'push'
  template_id: string
  provider?: string
}

const CHANNELS = [
  { value: 'sms', label: 'SMS' },
  { value: 'email', label: 'Email' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'push', label: 'Push' },
]

export default function Campaigns(): JSX.Element {
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [audiences, setAudiences] = useState<MarketingAudience[]>([])
  const [templates, setTemplates] = useState<MarketingTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [editor, setEditor] = useState(false)

  const [form, setForm] = useState({ name: '', description: '', audience_id: '', scheduled_at: '' })
  const [channels, setChannels] = useState<ChannelRow[]>([])
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      const [c, a, t] = await Promise.all([
        api.get<{ campaigns: MarketingCampaign[] }>('/marketing/campaigns'),
        api.get<{ audiences: MarketingAudience[] }>('/marketing/audiences'),
        api.get<{ templates: MarketingTemplate[] }>('/marketing/templates'),
      ])
      setCampaigns(c.campaigns)
      setAudiences(a.audiences)
      setTemplates(t.templates)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const openNew = (): void => {
    setForm({ name: '', description: '', audience_id: '', scheduled_at: '' })
    setChannels([])
    setError(null)
    setOk(null)
    setEditor(true)
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/marketing/campaigns', {
        name: form.name,
        description: form.description,
        audience_id: form.audience_id,
        scheduled_at: form.scheduled_at || null,
        channels: channels.map((c) => ({ channel: c.channel, template_id: c.template_id, provider: c.provider })),
      })
      setOk('Campaign created as draft.')
      setEditor(false)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create campaign')
    } finally {
      setBusy(false)
    }
  }

  const addChannel = (): void => {
    const used = new Set(channels.map((c) => c.channel))
    const next = CHANNELS.find((c) => !used.has(c.value as ChannelRow['channel']))
    const channel = (next?.value ?? 'sms') as ChannelRow['channel']
    setChannels((cs) => [...cs, { channel, template_id: '', provider: channel === 'email' ? 'resend' : channel === 'sms' ? 'ethiotelecom' : undefined }])
  }

  const updateChannel = (i: number, patch: Partial<ChannelRow>): void => {
    setChannels((cs) => cs.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }

  const templatesFor = (channel: string): MarketingTemplate[] => templates.filter((t) => t.channel === channel)

  const send = async (id: string): Promise<void> => {
    setError(null)
    setOk(null)
    try {
      const r = await api.post<{ queued: number }>(`/marketing/campaigns/${id}/send`)
      setOk(`Campaign started — ${r.queued} message${r.queued === 1 ? '' : 's'} queued.`)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
    }
  }

  const cols = [
    { key: 'name', header: 'Name', render: (c: MarketingCampaign) => <strong>{c.name}</strong> },
    { key: 'audience', header: 'Audience', render: (c: MarketingCampaign) => c.audience_name ?? '—' },
    { key: 'channels', header: 'Channels', render: (c: MarketingCampaign) => c.channel_count ?? 0 },
    {
      key: 'status',
      header: 'Status',
      render: (c: MarketingCampaign) => <Badge tone={campaignTone(c.status)}>{c.status}</Badge>,
    },
    {
      key: 'actions',
      header: '',
      render: (c: MarketingCampaign) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          {['draft', 'scheduled', 'failed', 'cancelled'].includes(c.status) && (
            <button className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => void send(c.id)}>
              <i className="fa-solid fa-paper-plane" /> Send
            </button>
          )}
          {c.status === 'sending' && (
            <button className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => void api.post(`/marketing/campaigns/${c.id}/pause`).then(reload)}>
              Pause
            </button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="pl-page">
      <PageHeader
        title="Campaigns"
        subtitle="Create and send SMS, email, WhatsApp, and push campaigns."
        action={
          <button className="pl-btn pl-btn-primary" onClick={openNew}>
            <i className="fa-solid fa-plus" /> New campaign
          </button>
        }
      />
      {error && !editor && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}
      <Card>{loading ? <p>Loading…</p> : <DataTable columns={cols} rows={campaigns} empty="No campaigns yet." />}</Card>

      <Modal open={editor} title="New campaign" onClose={() => setEditor(false)} wide>
        <FormRow onSubmit={submit} submitLabel={busy ? 'Creating…' : 'Create campaign'} busy={busy} error={error}>
          <Field label="Campaign name">
            <input className="pl-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Description">
            <input className="pl-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>

          <Field label="Audience" hint={audiences.length === 0 ? 'Create an audience first (Audiences tab).' : undefined}>
            <select className="pl-input" value={form.audience_id} onChange={(e) => setForm({ ...form, audience_id: e.target.value })} required>
              <option value="">Select audience…</option>
              {audiences.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} ({a.member_count} members)
                </option>
              ))}
            </select>
          </Field>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '12px 0 8px' }}>
            <strong style={{ fontSize: '.9rem' }}>Channels</strong>
            <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={addChannel} disabled={channels.length >= CHANNELS.length}>
              <i className="fa-solid fa-plus" /> Add channel
            </button>
          </div>

          {channels.map((c, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
              <select
                className="pl-input"
                value={c.channel}
                onChange={(e) => updateChannel(i, { channel: e.target.value as ChannelRow['channel'], provider: e.target.value === 'email' ? 'resend' : e.target.value === 'sms' ? 'ethiotelecom' : undefined, template_id: '' })}
              >
                {CHANNELS.map((ch) => (
                  <option key={ch.value} value={ch.value} disabled={channels.some((x, idx) => idx !== i && x.channel === ch.value)}>
                    {ch.label}
                  </option>
                ))}
              </select>
              <select className="pl-input" value={c.template_id} onChange={(e) => updateChannel(i, { template_id: e.target.value })} required>
                <option value="">Select template…</option>
                {templatesFor(c.channel).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="button" className="pl-icon-btn danger" onClick={() => setChannels((cs) => cs.filter((_, idx) => idx !== i))} aria-label="Remove channel">
                <i className="fa-solid fa-trash" />
              </button>
            </div>
          ))}
          {channels.length === 0 && <p style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>Add at least one channel to send on.</p>}

          <Field label="Schedule (optional)" hint="Leave blank to send manually, or pick a date/time.">
            <input className="pl-input" type="datetime-local" value={form.scheduled_at} onChange={(e) => setForm({ ...form, scheduled_at: e.target.value })} />
          </Field>
        </FormRow>
      </Modal>
    </div>
  )
}