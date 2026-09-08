export interface MarketingContact {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  country: string | null
  city: string | null
  customer_type: string | null
  status: 'active' | 'unsubscribed' | 'bounced' | 'complained'
  metadata: Record<string, unknown>
  channels: Array<{ channel: string; address: string; subscribed: boolean; verified: boolean }>
  created_at: string
}

export interface MarketingAudience {
  id: string
  name: string
  description: string | null
  type: 'dynamic' | 'static' | 'imported'
  member_count: number
  created_at: string
  rules?: Array<{ field: string; operator: string; value: unknown }>
  members?: MarketingContact[]
}

export interface MarketingTemplate {
  id: string
  name: string
  channel: 'sms' | 'email' | 'whatsapp' | 'push'
  subject: string | null
  content: string
  variables: string[]
  status: 'draft' | 'published' | 'archived'
  version: number
  updated_at: string
}

export interface MarketingCampaign {
  id: string
  name: string
  description: string | null
  audience_id: string
  audience_name?: string
  status: 'draft' | 'scheduled' | 'queued' | 'sending' | 'completed' | 'paused' | 'cancelled' | 'failed'
  scheduled_at: string | null
  created_at: string
  channel_count?: number
  channels?: Array<{ channel: string; template_id: string; template_name?: string; provider?: string }>
  stats?: {
    pending: string
    queued: string
    sent: string
    delivered: string
    failed: string
    bounced: string
    unsubscribed: string
    total: string
  }
}

export interface MarketingOverview {
  contacts: { total: string; active: string }
  campaigns: { total: string; completed: string; sending: string; failed: string }
  messages: { total: string; sent: string; delivered: string; failed: string; bounced: string; unsubscribed: string }
  recent: Array<{ id: string; name: string; status: string; recipients: string; created_at: string }>
}

export const campaignTone = (status: string): 'good' | 'warn' | 'bad' | 'neutral' | 'info' => {
  switch (status) {
    case 'completed':
      return 'good'
    case 'sending':
    case 'scheduled':
    case 'queued':
      return 'info'
    case 'paused':
      return 'warn'
    case 'failed':
    case 'cancelled':
      return 'bad'
    default:
      return 'neutral'
  }
}