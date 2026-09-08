export interface SendResult {
  success: boolean
  providerMessageId?: string
  error?: string
}

export interface MarketingChannel {
  readonly channel: 'sms' | 'email' | 'whatsapp' | 'push'
  readonly provider: string
  send(to: string, subject: string | undefined, content: string, metadata?: Record<string, unknown>): Promise<SendResult>
  verifyConfig(): Promise<boolean>
}