import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Card, Badge, ErrorBox, OkBox, Field, Modal, FormRow, DataTable } from '../ui'
import type { MarketingContact } from './types'

export default function Contacts(): JSX.Element {
  const [contacts, setContacts] = useState<MarketingContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [showAdd, setShowAdd] = useState(false)

  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    country: '',
    city: '',
    customer_type: '',
  })
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      const q = search ? `?search=${encodeURIComponent(search)}` : ''
      const r = await api.get<{ contacts: MarketingContact[] }>(`/marketing/contacts${q}`)
      setContacts(r.contacts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/marketing/contacts', form)
      setOk('Contact added.')
      setShowAdd(false)
      setForm({ first_name: '', last_name: '', email: '', phone: '', country: '', city: '', customer_type: '' })
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add contact')
    } finally {
      setBusy(false)
    }
  }

  const cols = [
    { key: 'name', header: 'Name', render: (c: MarketingContact) => <strong>{`${c.first_name} ${c.last_name}`}</strong> },
    { key: 'email', header: 'Email', render: (c: MarketingContact) => c.email ?? '—' },
    { key: 'phone', header: 'Phone', render: (c: MarketingContact) => c.phone ?? '—' },
    { key: 'city', header: 'City', render: (c: MarketingContact) => c.city ?? '—' },
    {
      key: 'status',
      header: 'Status',
      render: (c: MarketingContact) => (
        <Badge tone={c.status === 'active' ? 'good' : c.status === 'bounced' || c.status === 'complained' ? 'bad' : 'warn'}>
          {c.status}
        </Badge>
      ),
    },
  ]

  return (
    <div className="pl-page">
      <PageHeader
        title="Marketing Contacts"
        subtitle={`${contacts.length} contact${contacts.length === 1 ? '' : 's'}`}
        action={
          <button className="pl-btn pl-btn-primary" onClick={() => setShowAdd(true)}>
            <i className="fa-solid fa-plus" /> Add contact
          </button>
        }
      />

      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      <Card>
        <Field label="Search">
          <input
            className="pl-input"
            placeholder="Name, email, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setLoading(true)
                void reload()
              }
            }}
          />
        </Field>
        {loading ? (
          <p>Loading…</p>
        ) : (
          <DataTable columns={cols} rows={contacts} empty="No contacts yet. Add your first one." />
        )}
      </Card>

      <Modal open={showAdd} title="Add contact" onClose={() => setShowAdd(false)}>
        <FormRow onSubmit={submit} submitLabel={busy ? 'Saving…' : 'Save contact'} busy={busy} error={error}>
          <div className="pl-cols-2">
            <Field label="First name">
              <input className="pl-input" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} required />
            </Field>
            <Field label="Last name">
              <input className="pl-input" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} required />
            </Field>
          </div>
          <Field label="Email">
            <input className="pl-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <Field label="Phone">
            <input className="pl-input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <div className="pl-cols-3">
            <Field label="Country">
              <input className="pl-input" value={form.country} onChange={(e) => setForm({ ...form, country: e.target.value })} />
            </Field>
            <Field label="City">
              <input className="pl-input" value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
            </Field>
            <Field label="Type">
              <input className="pl-input" value={form.customer_type} onChange={(e) => setForm({ ...form, customer_type: e.target.value })} placeholder="business, freelancer…" />
            </Field>
          </div>
        </FormRow>
      </Modal>
    </div>
  )
}