import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Card, StatCard, Badge, Spinner, ErrorBox } from '../ui'
import { campaignTone, type MarketingOverview } from './types'

export default function MarketingDashboard(): JSX.Element {
  const [data, setData] = useState<MarketingOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const d = await api.get<MarketingOverview>('/marketing/analytics/overview')
        if (!cancelled) setData(d)
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

  if (loading) return <Spinner label="Loading marketing overview…" />
  if (error) return <ErrorBox message={error} />

  const d = data!

  return (
    <div className="pl-page">
      <PageHeader title="Marketing" subtitle="Campaigns, contacts, audiences, and delivery analytics." />

      <div className="pl-stats">
        <StatCard icon="fa-solid fa-users" label="Contacts" value={d.contacts.total} />
        <StatCard icon="fa-solid fa-bullhorn" label="Campaigns" value={d.campaigns.total} />
        <StatCard icon="fa-solid fa-envelope" label="Messages sent" value={d.messages.sent} />
        <StatCard icon="fa-solid fa-circle-check" label="Delivered" value={d.messages.delivered} />
      </div>

      <Card>
        <h2 style={{ marginTop: 0 }}>Recent campaigns</h2>
        {d.recent.length === 0 ? (
          <p style={{ color: 'var(--text-dim)' }}>No campaigns yet.</p>
        ) : (
          <div className="pl-table-wrap">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Recipients</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {d.recent.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.recipients}</td>
                    <td>
                      <Badge tone={campaignTone(c.status)}>{c.status}</Badge>
                    </td>
                    <td>{new Date(c.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}