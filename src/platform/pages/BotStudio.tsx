import { useEffect, useMemo, useState } from 'react'
import { api, fmtDate, fmtDateTime } from '../api'
import { Card, Field, PageHeader, EmptyState, ErrorBox, OkBox, Badge } from '../ui'

interface TenantBot {
  id: string
  bot_username: string
  bot_id: number
  display_name: string | null
  description: string | null
  welcome_message: string
  commands: Array<{ trigger: string; response: string }>
  auto_reply: boolean
  is_active: boolean
  broadcast_limit_per_day: number
  total_subscribers: number
  total_subscribers_ever: number
  last_broadcast_at: string | null
  share_url: string
  total_broadcasts: number
}

interface Subscriber {
  id: string
  chat_id: number
  username: string | null
  first_name: string | null
  last_name: string | null
  is_active: boolean
  subscribed_at: string
  last_seen_at: string | null
}

interface Broadcast {
  id: string
  message: string
  recipients: number
  delivered: number
  failed: number
  status: 'queued' | 'sending' | 'sent' | 'failed'
  error: string | null
  sent_at: string | null
  created_at: string
}

interface Cmd {
  trigger: string
  response: string
}

export default function BotStudio(): JSX.Element {
  const [bot, setBot] = useState<TenantBot | null | undefined>(undefined)
  const [subscribers, setSubscribers] = useState<Subscriber[]>([])
  const [broadcasts, setBroadcasts] = useState<Broadcast[]>([])
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const [token, setToken] = useState('')
  const [registering, setRegistering] = useState(false)

  const [welcomeMessage, setWelcomeMessage] = useState('')
  const [autoReply, setAutoReply] = useState(true)
  const [limitPerDay, setLimitPerDay] = useState(3)
  const [commands, setCommands] = useState<Cmd[]>([])

  const [broadcastMessage, setBroadcastMessage] = useState('')
  const [broadcasting, setBroadcasting] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      const r = await api.get<{ bot: TenantBot | null }>('/tenant-bot')
      setBot(r.bot ?? null)
      if (r.bot) {
        setWelcomeMessage(r.bot.welcome_message)
        setAutoReply(r.bot.auto_reply)
        setLimitPerDay(r.bot.broadcast_limit_per_day)
        setCommands(r.bot.commands || [])
        const [s, h] = await Promise.all([
          api.get<{ subscribers: Subscriber[] }>('/tenant-bot/subscribers'),
          api.get<{ broadcasts: Broadcast[] }>('/tenant-bot/broadcasts'),
        ])
        setSubscribers(s.subscribers)
        setBroadcasts(h.broadcasts)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const shareUrl = bot?.share_url ?? (bot?.bot_username ? `https://t.me/${bot.bot_username}` : '')
  const todayBroadcasts = useMemo(() => {
    const d = new Date()
    return broadcasts.filter(
      (b) => b.status === 'sent' && new Date(b.created_at).toDateString() === d.toDateString()
    ).length
  }, [broadcasts])

  const handleRegister = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    setRegistering(true)
    try {
      await api.post<{ id: string }>('/tenant-bot/register', { token })
      setOk('Bot connected! Tell customers to message you on Telegram.')
      setToken('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not register')
    } finally {
      setRegistering(false)
    }
  }

  const handlePause = async (): Promise<void> => {
    try {
      await api.post('/tenant-bot/pause')
      await reload()
      setOk('Bot paused.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
  }
  const handleResume = async (): Promise<void> => {
    try {
      await api.post('/tenant-bot/resume')
      await reload()
      setOk('Bot resumed.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
  }

  const addCommand = (): void => {
    setCommands((c) => [...c, { trigger: '/', response: '' }])
  }
  const removeCommand = (i: number): void => {
    setCommands((c) => c.filter((_, idx) => idx !== i))
  }
  const updateCommand = (i: number, patch: Partial<Cmd>): void => {
    setCommands((c) => c.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  }

  const saveConfig = async (): Promise<void> => {
    try {
      await api.patch('/tenant-bot', {
        welcome_message: welcomeMessage,
        auto_reply: autoReply,
        broadcast_limit_per_day: limitPerDay,
        commands: commands.filter((c) => c.trigger.startsWith('/') && c.response.trim()),
      })
      setOk('Saved.')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    }
  }

  const sendBroadcast = async (): Promise<void> => {
    if (!broadcastMessage.trim()) return
    setBroadcasting(true)
    setConfirming(false)
    try {
      const r = await api.post<{ delivered: number; failed: number }>('/tenant-bot/broadcast', {
        message: broadcastMessage,
      })
      setOk(`Broadcast sent — ${r.delivered} delivered${r.failed ? `, ${r.failed} failed` : ''}.`)
      setBroadcastMessage('')
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send')
    } finally {
      setBroadcasting(false)
    }
  }

  if (bot === undefined) {
    return (
      <div className="pl-page">
        <PageHeader
          title="Telegram Bot Studio"
          subtitle="Connect your own Telegram bot to message customers and broadcast offers."
        />
        <p>Loading…</p>
     </div>
    )
  }

  if (bot === null) {
    return (
      <div className="pl-page">
        <PageHeader
          title="Company Telegram Bot Studio"
          subtitle="Connect your company's own Telegram bot. Each company has its own bot and Mini App."
        />
        {error && <ErrorBox message={error} />}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
            <h3 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8, fontSize: '1rem', color: '#2AABEE' }}>
              <i className="fa-solid fa-users-gear" /> 1. Staff Assistant & Reports
            </h3>
            <p style={{ margin: 0, fontSize: '.88rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
              Your staff can link to your bot via <code>/link CODE</code> to check daily sales (<code>/today</code>), low-stock alerts (<code>/lowstock</code>), expiring items, and active shifts.
            </p>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
            <h3 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8, fontSize: '1rem', color: '#2ECC71' }}>
              <i className="fa-solid fa-mobile-screen" /> 2. Company Mini App
            </h3>
            <p style={{ margin: 0, fontSize: '.88rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
              The bot automatically attaches a menu button to launch your company's workspace directly inside Telegram without asking for password logins.
            </p>
          </div>

          <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 12, padding: 18 }}>
            <h3 style={{ margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8, fontSize: '1rem', color: '#F39C12' }}>
              <i className="fa-solid fa-bullhorn" /> 3. Customer Broadcasts
            </h3>
            <p style={{ margin: 0, fontSize: '.88rem', color: 'var(--text-dim)', lineHeight: 1.6 }}>
              Customers who message your bot subscribe to your updates. Send promotional broadcasts and auto-replies for your hours, menu, or services.
            </p>
          </div>
        </div>

        <Card>
          <h2 style={{ marginTop: 0 }}>How to create your bot (takes 2 minutes)</h2>
          <ol style={{ lineHeight: 1.8, fontSize: '.92rem' }}>
            <li>
              Open Telegram on your phone or desktop and search for <strong>@BotFather</strong>.
            </li>
            <li>
              Send <code>/newbot</code> and follow the prompts:
              <ul style={{ margin: '4px 0 8px', color: 'var(--text-dim)' }}>
                <li>Enter a display name (e.g. <em>Bole Pharmacy Assistant</em>).</li>
                <li>Enter a username ending in <code>bot</code> (e.g. <code>bole_pharmacy_bot</code>).</li>
              </ul>
            </li>
            <li>
              BotFather will reply with your API token (e.g. <code>123456789:AAHx_your_token_here</code>).
            </li>
            <li>
              Paste the token below. AFRO Suite will configure your bot, attach your company Mini App, and start handling commands!
            </li>
          </ol>
          <p style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>
            🔒 Your token is securely stored and exclusively used for your company workspace. You can pause or replace it at any time.
          </p>
          <form onSubmit={handleRegister}>
            <Field label="BotFather API token">
              <input
                className="pl-input"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="123456789:AAHx_your_long_token_here"
                spellCheck={false}
                autoComplete="off"
                required
              />
            </Field>
            <div className="pl-form-actions">
              <button
                className="pl-btn pl-btn-primary"
                disabled={registering || token.length < 20}
              >
                {registering ? 'Connecting & setting up Mini App…' : 'Connect My Company Bot'}
              </button>
            </div>
          </form>
        </Card>
      </div>
    )
  }

  return (
    <div className="pl-page">
      <PageHeader
        title="Telegram Bot Studio"
        subtitle={`Bot @${bot.bot_username} · ${bot.total_subscribers} subscriber${bot.total_subscribers === 1 ? '' : 's'}`}
        action={
          <div style={{ display: 'flex', gap: 8 }}>
            {bot.is_active ? (
              <button className="pl-btn pl-btn-ghost" onClick={handlePause}>
                <i className="fa-solid fa-pause" /> Pause
             </button>
            ) : (
              <button className="pl-btn pl-btn-primary" onClick={handleResume}>
                <i className="fa-solid fa-play" /> Resume
             </button>
            )}
         </div>
        }
      />

      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      <div className="pl-cols-2">
        <Card>
          <h2 style={{ marginTop: 0 }}>Status</h2>
          <table className="pl-table">
            <tbody>
              <tr>
                <td>Status</td>
                <td>
                  {bot.is_active ? (
                    <Badge tone="good">live</Badge>
                  ) : (
                    <Badge tone="warn">paused</Badge>
                  )}
               </td>
             </tr>
              <tr>
                <td>Username</td>
                <td>
                  <strong>@{bot.bot_username}</strong>
                </td>
              </tr>
              <tr>
                <td>Subscribers (active)</td>
                <td>{bot.total_subscribers}</td>
              </tr>
              <tr>
                <td>Total chats ever</td>
                <td>{bot.total_subscribers_ever}</td>
              </tr>
              <tr>
                <td>Broadcasts today</td>
                <td>
                  {todayBroadcasts} / {bot.broadcast_limit_per_day}
               </td>
             </tr>
              <tr>
                <td>Last broadcast</td>
                <td>{bot.last_broadcast_at ? fmtDateTime(bot.last_broadcast_at) : '—'}</td>
             </tr>
           </tbody>
         </table>
       </Card>

        <Card>
          <h2 style={{ marginTop: 0 }}>Share your bot</h2>
          <p style={{ color: 'var(--text-dim)' }}>
            Customers send any message — they'll auto-subscribe and you can broadcast to them.
         </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="pl-input"
              readOnly
              value={shareUrl}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              className="pl-btn pl-btn-ghost"
              onClick={() => {
                void navigator.clipboard.writeText(shareUrl)
                setOk('Copied!')
              }}
            >
              <i className="fa-regular fa-copy" /> Copy
           </button>
         </div>
          <div style={{ marginTop: 16 }}>
            <button
              className="pl-btn pl-btn-primary"
              onClick={() =>
                window.open(
                  `https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent('Message our business on Telegram!')}`,
                  '_blank'
                )
              }
            >
              <i className="fa-brands fa-telegram" /> Share on Telegram
           </button>
         </div>
       </Card>
     </div>

      <Card>
        <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <i className="fa-solid fa-mobile-screen-button" style={{ color: '#2AABEE' }} />
          Company Mini App & Staff Hub
        </h2>
        <p style={{ color: 'var(--text-dim)', fontSize: '.9rem', lineHeight: 1.6 }}>
          Your Telegram bot is deeply integrated with your company workspace. It serves two key roles:
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, margin: '14px 0' }}>
          <div style={{ background: 'var(--input)', border: '1px solid var(--border2)', borderRadius: 10, padding: 14 }}>
            <h4 style={{ margin: '0 0 6px', color: 'var(--text)', fontSize: '.95rem' }}>
              <i className="fa-solid fa-id-card-clip" style={{ color: 'var(--accent)', marginRight: 6 }} />
              Staff Linking & Commands
            </h4>
            <p style={{ fontSize: '.84rem', color: 'var(--text-dim)', margin: '0 0 8px', lineHeight: 1.5 }}>
              Staff members can generate a link code in <strong>Settings → Telegram</strong> and send it to <strong>@{bot.bot_username}</strong> as:
            </p>
            <code style={{ fontSize: '.88rem', color: 'var(--accent)' }}>/link CODE</code>
            <ul style={{ fontSize: '.82rem', color: 'var(--text-dim)', margin: '8px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
              <li><code>/today</code> — Daily sales & operational summary</li>
              <li><code>/lowstock</code> — Items below reorder threshold</li>
              <li><code>/expiring</code> — Batches expiring in 60 days</li>
              <li><code>/shift</code> — Open cash drawer balance</li>
            </ul>
          </div>

          <div style={{ background: 'var(--input)', border: '1px solid var(--border2)', borderRadius: 10, padding: 14 }}>
            <h4 style={{ margin: '0 0 6px', color: 'var(--text)', fontSize: '.95rem' }}>
              <i className="fa-solid fa-arrow-pointer" style={{ color: '#2ECC71', marginRight: 6 }} />
              Telegram Menu Button (Mini App)
            </h4>
            <p style={{ fontSize: '.84rem', color: 'var(--text-dim)', margin: '0 0 8px', lineHeight: 1.5 }}>
              When users open a chat with <strong>@{bot.bot_username}</strong>, they see a menu button at the bottom:
            </p>
            <div style={{ padding: '6px 12px', background: 'var(--card)', borderRadius: 6, display: 'inline-block', fontSize: '.88rem', fontWeight: 600, border: '1px solid var(--border)' }}>
              📱 Open {bot.display_name || 'Workspace'}
            </div>
            <p style={{ fontSize: '.8rem', color: 'var(--text-dim)', marginTop: 8 }}>
              Tapping it launches your company's full web application inside Telegram, auto-authenticating linked users.
            </p>
          </div>
        </div>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Customer welcome message</h2>
        <p style={{ color: 'var(--text-dim)' }}>
          Sent automatically when someone messages your bot. Use <code>{'{name}'}</code> for the
          customer's first name.
       </p>
        <textarea
          className="pl-textarea"
          rows={4}
          value={welcomeMessage}
          onChange={(e) => setWelcomeMessage(e.target.value)}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={autoReply}
              onChange={(e) => setAutoReply(e.target.checked)}
            />
            <span>Always reply (otherwise unknown messages are ignored</span>
         </label>
       </div>
        <Field label="Daily broadcast limit" hint="Max broadcasts per day to your subscribers">
          <input
            className="pl-input"
            type="number"
            min={0}
            max={50}
            value={limitPerDay}
            onChange={(e) => setLimitPerDay(Math.max(0, Math.min(50, Number(e.target.value))))}
          />
       </Field>
        <div className="pl-form-actions">
          <button className="pl-btn pl-btn-primary" onClick={saveConfig}>
            Save settings
         </button>
       </div>
     </Card>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Custom commands</h2>
          <button className="pl-btn pl-btn-ghost" onClick={addCommand}>
            <i className="fa-solid fa-plus" /> Add command
         </button>
       </div>
        <p style={{ color: 'var(--text-dim)' }}>
          When a customer sends one of these triggers, the bot auto-replies. Useful for menus, hours,
          prices.
       </p>
        {!commands.length && (
          <EmptyState
            icon="fa-solid fa-terminal"
            title="No custom commands yet"
            hint="Add /menu, /hours, /price, /location — anything that helps customers find answers fast."
          />
        )}
        {commands.map((c, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '160px 1fr auto',
              gap: 8,
              marginBottom: 8,
            }}
          >
            <input
              className="pl-input"
              placeholder="/trigger"
              value={c.trigger}
              onChange={(e) => updateCommand(i, { trigger: e.target.value })}
            />
            <input
              className="pl-input"
              placeholder="Auto-reply text"
              value={c.response}
              onChange={(e) => updateCommand(i, { response: e.target.value })}
            />
            <button
              className="pl-icon-btn danger"
              onClick={() => removeCommand(i)}
              aria-label="Remove"
            >
              <i className="fa-solid fa-trash" />
           </button>
         </div>
        ))}
        {commands.length > 0 && (
          <div className="pl-form-actions">
            <button className="pl-btn pl-btn-primary" onClick={saveConfig}>
              Save commands
           </button>
         </div>
        )}
     </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Send a broadcast</h2>
        <p style={{ color: 'var(--text-dim)' }}>
          Sends your message to all {bot.total_subscribers} active subscribers via Telegram.
          {bot.total_subscribers === 0 ? ' Share your bot link to grow your audience.' : ''}
       </p>
        <textarea
          className="pl-textarea"
          rows={4}
          maxLength={4000}
          placeholder="Type your message — offers, announcements, new arrivals…"
          value={broadcastMessage}
          onChange={(e) => setBroadcastMessage(e.target.value)}
        />
        <small style={{ color: 'var(--text-dim)' }}>
          {broadcastMessage.length} / 4000
       </small>
        <div className="pl-form-actions">
          <button
            className="pl-btn pl-btn-primary"
            disabled={!broadcastMessage.trim() || broadcasting || bot.total_subscribers === 0}
            onClick={() => setConfirming(true)}
          >
            {broadcasting ? (
              'Sending…'
            ) : (
              <>
                <i className="fa-solid fa-bullhorn" /> Broadcast to {bot.total_subscribers}{' '}
                subscriber{bot.total_subscribers === 1 ? '' : 's'}
              </>
            )}
         </button>
       </div>
     </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Broadcast history</h2>
        {!broadcasts.length && (
          <EmptyState
            title="No broadcasts yet"
            hint="Use the form above to send your first one."
          />
        )}
        {broadcasts.length > 0 && (
          <div className="pl-table-wrap">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>Sent</th>
                  <th>Message</th>
                  <th>Recipients</th>
                  <th>Delivered</th>
                  <th>Status</th>
               </tr>
             </thead>
              <tbody>
                {broadcasts.map((b) => (
                  <tr key={b.id}>
                    <td>{fmtDateTime(b.sent_at ?? b.created_at)}</td>
                    <td style={{ maxWidth: 480 }}>
                      <div
                        style={{
                          whiteSpace: 'pre-wrap',
                          maxHeight: 60,
                          overflow: 'hidden',
                        }}
                      >
                        {b.message}
                     </div>
                   </td>
                    <td>{b.recipients}</td>
                    <td>
                      {b.delivered}
                      {b.failed ? ` / ${b.failed} failed` : ''}
                   </td>
                    <td>
                      <Badge
                        tone={
                          b.status === 'sent'
                            ? 'good'
                            : b.status === 'failed'
                              ? 'bad'
                              : b.status === 'sending'
                                ? 'warn'
                                : 'neutral'
                        }
                      >
                        {b.status}
                     </Badge>
                   </td>
                 </tr>
                ))}
             </tbody>
           </table>
         </div>
        )}
     </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Subscribers ({subscribers.length})</h2>
        {!subscribers.length ? (
          <EmptyState
            icon="fa-solid fa-users"
            title="No subscribers yet"
            hint="Share t.me/@bot_username and ask customers to message the bot."
          />
        ) : (
          <div className="pl-table-wrap">
            <table className="pl-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Chat ID</th>
                  <th>Subscribed</th>
                  <th>Status</th>
               </tr>
             </thead>
              <tbody>
                {subscribers.map((s) => (
                  <tr key={s.id}>
                    <td>
                      {s.first_name ?? '—'} {s.last_name ?? ''}
                   </td>
                    <td>{s.username ? `@${s.username}` : '—'}</td>
                    <td>
                      <code>{s.chat_id}</code>
                   </td>
                    <td>{fmtDate(s.subscribed_at)}</td>
                    <td>
                      <Badge tone={s.is_active ? 'good' : 'neutral'}>
                        {s.is_active ? 'active' : 'inactive'}
                     </Badge>
                   </td>
                 </tr>
                ))}
             </tbody>
           </table>
         </div>
        )}
     </Card>

      {confirming && (
        <div
          className="pl-modal-backdrop"
          onMouseDown={(e) => e.target === e.currentTarget && setConfirming(false)}
        >
          <div className="pl-modal" role="dialog" aria-modal="true">
            <div className="pl-modal-head">
              <h2>Send to {bot.total_subscribers} subscribers</h2>
              <button
                className="pl-icon-btn"
                onClick={() => setConfirming(false)}
                aria-label="Close"
              >
                <i className="fa-solid fa-xmark" />
             </button>
           </div>
            <div className="pl-modal-body">
              <p>
                This will deliver your message via Telegram. Spamming is a violation of Telegram's
                terms — send only relevant, opted-in content.
             </p>
              <div
                style={{
                  background: 'var(--surface)',
                  padding: 12,
                  borderRadius: 10,
                  margin: '10px 0',
                }}
              >
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{broadcastMessage}</pre>
             </div>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <button className="pl-btn pl-btn-ghost" onClick={() => setConfirming(false)}>
                  Cancel
               </button>
                <button
                  className="pl-btn pl-btn-primary"
                  onClick={sendBroadcast}
                  disabled={broadcasting}
                >
                  {broadcasting ? 'Sending…' : 'Yes, send now'}
               </button>
             </div>
           </div>
         </div>
       </div>
      )}
   </div>
  )
}
