import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Card, Badge, ErrorBox, OkBox, DataTable } from '../ui'
import { campaignTone, type MarketingCampaign } from './types'

export default function Campaigns(): JSX.Element {
  const [campaigns, setCampaigns] = useState<MarketingCampaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    try {
      const r = await api.get<{ campaigns: MarketingCampaign[] }>('/marketing/campaigns')
      setCampaigns(r.campaigns)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

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
      <PageHeader title="Campaigns" subtitle="Create and send SMS, email, WhatsApp, and push campaigns." />
      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}
      <Card>{loading ? <p>Loading…</p> : <DataTable columns={cols} rows={campaigns} empty="No campaigns yet." />}</Card>
    </div>
  )
}