import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Card, Badge, ErrorBox, DataTable } from '../ui'
import type { MarketingAudience } from './types'

export default function Audiences(): JSX.Element {
  const [audiences, setAudiences] = useState<MarketingAudience[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const r = await api.get<{ audiences: MarketingAudience[] }>('/marketing/audiences')
        if (!cancelled) setAudiences(r.audiences)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [])

  const cols = [
    { key: 'name', header: 'Name', render: (a: MarketingAudience) => <strong>{a.name}</strong> },
    {
      key: 'type',
      header: 'Type',
      render: (a: MarketingAudience) => <Badge tone={a.type === 'dynamic' ? 'info' : 'neutral'}>{a.type}</Badge>,
    },
    { key: 'members', header: 'Members', render: (a: MarketingAudience) => a.member_count },
    { key: 'desc', header: 'Description', render: (a: MarketingAudience) => a.description ?? '—' },
    { key: 'date', header: 'Created', render: (a: MarketingAudience) => new Date(a.created_at).toLocaleDateString() },
  ]

  return (
    <div className="pl-page">
      <PageHeader title="Audiences" subtitle="Segment your contacts for targeted campaigns." />
      {error && <ErrorBox message={error} />}
      <Card>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <DataTable columns={cols} rows={audiences} empty="No audiences yet." />
        )}
      </Card>
    </div>
  )
}