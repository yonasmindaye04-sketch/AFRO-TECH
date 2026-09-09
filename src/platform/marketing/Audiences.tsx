import { useEffect, useState } from 'react'
import { api } from '../api'
import { PageHeader, Card, Badge, ErrorBox, OkBox, Field, Modal, FormRow, DataTable, EmptyState } from '../ui'
import type { MarketingAudience, MarketingContact } from './types'

interface Rule {
  field: string
  operator: string
  value: string
  logicalOp: 'AND' | 'OR'
}

const CONTACT_FIELDS = [
  { value: 'first_name', label: 'First name' },
  { value: 'last_name', label: 'Last name' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'country', label: 'Country' },
  { value: 'city', label: 'City' },
  { value: 'customer_type', label: 'Customer type' },
  { value: 'status', label: 'Status' },
]

const OPERATORS = [
  { value: '=', label: 'equals' },
  { value: '!=', label: 'does not equal' },
  { value: 'IN', label: 'is one of' },
  { value: 'NOT IN', label: 'is not one of' },
  { value: 'LIKE', label: 'contains' },
  { value: 'IS NULL', label: 'is empty' },
  { value: 'IS NOT NULL', label: 'is not empty' },
]

export default function Audiences(): JSX.Element {
  const [audiences, setAudiences] = useState<MarketingAudience[]>([])
  const [contacts, setContacts] = useState<MarketingContact[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [editor, setEditor] = useState<MarketingAudience | null | 'new'>(null)

  const [form, setForm] = useState({ name: '', description: '', type: 'dynamic' as 'dynamic' | 'static' | 'imported' })
  const [rules, setRules] = useState<Rule[]>([{ field: 'city', operator: '=', value: '', logicalOp: 'AND' }])
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)

  const reload = async (): Promise<void> => {
    try {
      const [a, c] = await Promise.all([
        api.get<{ audiences: MarketingAudience[] }>('/marketing/audiences'),
        api.get<{ contacts: MarketingContact[] }>('/marketing/contacts?limit=200'),
      ])
      setAudiences(a.audiences)
      setContacts(c.contacts)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void reload()
  }, [])

  const openNew = (): void => {
    setForm({ name: '', description: '', type: 'dynamic' })
    setRules([{ field: 'city', operator: '=', value: '', logicalOp: 'AND' }])
    setMemberIds([])
    setError(null)
    setOk(null)
    setEditor('new')
  }

  const openEdit = async (id: string): Promise<void> => {
    setError(null)
    setOk(null)
    try {
      const a = await api.get<MarketingAudience>(`/marketing/audiences/${id}`)
      setForm({ name: a.name, description: a.description ?? '', type: a.type })
      if (a.type === 'dynamic' && a.rules) {
        setRules(a.rules.map((r) => ({ field: r.field, operator: r.operator, value: Array.isArray(r.value) ? (r.value as string[]).join(',') : String(r.value ?? ''), logicalOp: 'AND' })))
      } else {
        setRules([{ field: 'city', operator: '=', value: '', logicalOp: 'AND' }])
      }
      setMemberIds(a.members ? a.members.map((m) => m.id) : [])
      setEditor(a)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load audience')
    }
  }

  const submit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const payload: Record<string, unknown> = { name: form.name, description: form.description, type: form.type }
      if (form.type === 'dynamic') {
        payload.rules = rules
          .filter((r) => r.field)
          .map((r) => ({
            field: r.field,
            operator: r.operator,
            value: ['IN', 'NOT IN'].includes(r.operator) ? r.value.split(',').map((s) => s.trim()).filter(Boolean) : r.value,
            logicalOp: r.logicalOp,
          }))
      } else {
        payload.members = memberIds
      }

      if (editor === 'new') {
        await api.post('/marketing/audiences', payload)
        setOk('Audience created.')
      } else if (editor) {
        await api.put(`/marketing/audiences/${editor.id}`, payload)
        setOk('Audience saved.')
      }
      setEditor(null)
      await reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  const updateRule = (i: number, patch: Partial<Rule>): void => {
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))
  }

  const cols = [
    { key: 'name', header: 'Name', render: (a: MarketingAudience) => <strong>{a.name}</strong> },
    {
      key: 'type',
      header: 'Type',
      render: (a: MarketingAudience) => <Badge tone={a.type === 'dynamic' ? 'info' : 'neutral'}>{a.type}</Badge>,
    },
    { key: 'members', header: 'Members', render: (a: MarketingAudience) => a.member_count },
    { key: 'desc', header: 'Description', render: (a: MarketingAudience) => a.description ?? '—' },
    {
      key: 'actions',
      header: '',
      render: (a: MarketingAudience) => (
        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
          <button className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => void openEdit(a.id)}>
            <i className="fa-solid fa-pen" /> Edit
          </button>
        </div>
      ),
    },
  ]

  return (
    <div className="pl-page">
      <PageHeader
        title="Audiences"
        subtitle="Segment your contacts for targeted campaigns."
        action={
          <button className="pl-btn pl-btn-primary" onClick={openNew}>
            <i className="fa-solid fa-plus" /> New audience
          </button>
        }
      />
      {error && !editor && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}
      <Card>
        {loading ? <p>Loading…</p> : <DataTable columns={cols} rows={audiences} empty="No audiences yet." />}
      </Card>

      <Modal open={editor !== null} title={editor === 'new' ? 'New audience' : 'Edit audience'} onClose={() => setEditor(null)} wide>
        <FormRow onSubmit={submit} submitLabel={busy ? 'Saving…' : 'Save audience'} busy={busy} error={error}>
          <Field label="Name">
            <input className="pl-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field label="Description">
            <input className="pl-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field label="Type">
            <select className="pl-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as 'dynamic' | 'static' })}>
              <option value="dynamic">Dynamic (rules auto-update members)</option>
              <option value="static">Static (manually chosen contacts)</option>
            </select>
          </Field>

          {form.type === 'dynamic' ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: '.9rem' }}>Rules</strong>
                <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => setRules((rs) => [...rs, { field: 'city', operator: '=', value: '', logicalOp: 'AND' }])}>
                  <i className="fa-solid fa-plus" /> Add rule
                </button>
              </div>
              {rules.map((r, i) => (
                <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.4fr auto', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <select className="pl-input" value={r.field} onChange={(e) => updateRule(i, { field: e.target.value })}>
                    {CONTACT_FIELDS.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                  <select className="pl-input" value={r.operator} onChange={(e) => updateRule(i, { operator: e.target.value, value: ['IS NULL', 'IS NOT NULL'].includes(e.target.value) ? '' : r.value })}>
                    {OPERATORS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  {['IS NULL', 'IS NOT NULL'].includes(r.operator) ? (
                    <span style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>—</span>
                  ) : (
                    <input className="pl-input" placeholder={['IN', 'NOT IN'].includes(r.operator) ? 'value1, value2, …' : 'value'} value={r.value} onChange={(e) => updateRule(i, { value: e.target.value })} />
                  )}
                  <button type="button" className="pl-icon-btn danger" onClick={() => setRules((rs) => rs.filter((_, idx) => idx !== i))} aria-label="Remove rule">
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              ))}
              {rules.length === 0 && (
                <EmptyState icon="fa-solid fa-filter" title="No rules" hint="An audience with no rules includes all active contacts." />
              )}
            </div>
          ) : (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: '.9rem' }}>Members ({memberIds.length} selected)</strong>
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
                {contacts.length === 0 ? (
                  <EmptyState icon="fa-solid fa-users" title="No contacts yet" hint="Add contacts first, then pick them here." />
                ) : (
                  contacts.map((c) => {
                    const checked = memberIds.includes(c.id)
                    return (
                      <label key={c.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 4px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => setMemberIds((ids) => (checked ? ids.filter((x) => x !== c.id) : [...ids, c.id]))}
                        />
                        <span>
                          {c.first_name} {c.last_name} <small style={{ color: 'var(--text-dim)' }}>{c.email ?? c.phone ?? ''}</small>
                        </span>
                      </label>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </FormRow>
      </Modal>
    </div>
  )
}