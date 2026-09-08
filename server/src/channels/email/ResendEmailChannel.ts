import { MarketingChannel, SendResult } from '../MarketingChannel.js'

interface ResendConfig {
  apiKey: string
  fromEmail: string
  fromName?: string
}

export class ResendEmailChannel implements MarketingChannel {
  readonly channel = 'email' as const
  readonly provider = 'resend'
  private config: ResendConfig

  constructor(config: ResendConfig) {
    this.config = config
  }

  async verifyConfig(): Promise<boolean> {
    try {
      const res = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
      })
      return res.ok
    } catch {
      return false
    }
  }

  async send(to: string, subject: string | undefined, content: string, _metadata?: Record<string, unknown>): Promise<SendResult> {
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.config.fromName ? `${this.config.fromName} <${this.config.fromEmail}>` : this.config.fromEmail,
          to: [to],
          subject: subject || 'AFRO-TECH Notification',
          html: content,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.message || 'Resend API error' }
      }

      return { success: true, providerMessageId: data.id }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
    }
  }
}