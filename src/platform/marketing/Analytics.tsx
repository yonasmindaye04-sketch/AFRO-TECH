import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Card, StatCard, Spinner, ErrorBox } from '../ui'

interface ChannelStats {
  sms: { sent: string; delivered: string; failed: string }
  email: { sent: string; delivered: string; failed: string; opened: string; clicked: string }
}

export default function Analytics(): JSX.Element {
  const [data, setData] = useState<ChannelStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async (): Promise<void> => {
      try {
        const d = await api.get<ChannelStats>('/marketing/analytics/channels')
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

  if (loading) return <Spinner label="Loading analytics…" />
  if (error) return <ErrorBox message={error} />

  const d = data!

  return (
    <div className="pl-page">
      <PageHeader title="Analytics" subtitle="Delivery and engagement per channel." />

      <Card>
        <h2 style={{ marginTop: 0 }}>
          <i className="fa-solid fa-message" style={{ marginRight: 8 }} /> SMS
        </h2>
        <div className="pl-stats">
          <StatCard icon="fa-solid fa-paper-plane" label="Sent" value={d.sms.sent} />
          <StatCard icon="fa-solid fa-circle-check" label="Delivered" value={d.sms.delivered} />
          <StatCard icon="fa-solid fa-circle-xmark" label="Failed" value={d.sms.failed} />
        </div>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>
          <i className="fa-solid fa-envelope" style={{ marginRight: 8 }} /> Email
        </h2>
        <div className="pl-stats">
          <StatCard icon="fa-solid fa-paper-plane" label="Sent" value={d.email.sent} />
          <StatCard icon="fa-solid fa-circle-check" label="Delivered" value={d.email.delivered} />
          <StatCard icon="fa-solid fa-envelope-open" label="Opened" value={d.email.opened} />
          <StatCard icon="fa-solid fa-arrow-pointer" label="Clicked" value={d.email.clicked} />
        </div>
      </Card>
    </div>
  )
}