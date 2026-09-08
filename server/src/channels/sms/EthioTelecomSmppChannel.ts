import { MarketingChannel, SendResult } from '../MarketingChannel.js'

interface SmppConfig {
  host: string
  port: number
  systemId: string
  password: string
  senderId: string
  mock?: boolean
}

export class EthioTelecomSmppChannel implements MarketingChannel {
  readonly channel = 'sms' as const
  readonly provider = 'ethiotelecom'
  private config: SmppConfig
  private session: unknown = null
  private connected = false

  constructor(config: SmppConfig) {
    this.config = { ...config, mock: config.mock ?? process.env.ETHIOTELECOM_MOCK === 'true' }
  }

  async verifyConfig(): Promise<boolean> {
    if (this.config.mock) return true
    try {
      const smpp: any = await import('smpp' as any)
      const session = new smpp.Session({ host: this.config.host, port: this.config.port })
      await new Promise<void>((resolve, reject) => {
        session.bind_transceiver(
          { system_id: this.config.systemId, password: this.config.password },
          (pdu: any) => (pdu.command_status === 0 ? resolve() : reject(new Error(`SMPP bind failed: ${pdu.command_status}`)))
        )
        setTimeout(() => reject(new Error('SMPP bind timeout')), 10000)
      })
      session.close()
      return true
    } catch {
      return false
    }
  }

  private async ensureConnection(): Promise<void> {
    if (this.config.mock) return
    if (this.connected && this.session) return

    const smpp: any = await import('smpp' as any)
    const session = new smpp.Session({ host: this.config.host, port: this.config.port })

    await new Promise<void>((resolve, reject) => {
      session.bind_transceiver(
        { system_id: this.config.systemId, password: this.config.password },
        (pdu: any) => (pdu.command_status === 0 ? resolve() : reject(new Error(`SMPP bind failed: ${pdu.command_status}`)))
      )
      setTimeout(() => reject(new Error('SMPP bind timeout')), 10000)
    })

    this.session = session
    this.connected = true
  }

  async send(to: string, _subject: string | undefined, content: string, _metadata?: Record<string, unknown>): Promise<SendResult> {
    if (this.config.mock) {
      console.log(`[ETHIOTELECOM MOCK] SMS to ${to}: ${content}`)
      return { success: true, providerMessageId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 9)}` }
    }

    try {
      await this.ensureConnection()
      const session = this.session as { submit_sm: (pdu: Record<string, unknown>, cb: (pdu: Record<string, unknown>) => void) => void }

      const messageId = `ethio-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

      await new Promise<void>((resolve, reject) => {
        session.submit_sm(
          {
            source_addr: this.config.senderId,
            destination_addr: to,
            short_message: content,
            registered_delivery: 1,
            data_coding: 0,
          },
          (pdu) => {
            if (pdu.command_status === 0) {
              resolve()
            } else {
              reject(new Error(`SMPP submit failed: ${pdu.command_status}`))
            }
          }
        )
        setTimeout(() => reject(new Error('SMPP submit timeout')), 15000)
      })

      return { success: true, providerMessageId: messageId }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'Unknown SMPP error' }
    }
  }

  async close(): Promise<void> {
    if (this.session && typeof (this.session as { close: () => void }).close === 'function') {
      ;(this.session as { close: () => void }).close()
      this.connected = false
    }
  }
}