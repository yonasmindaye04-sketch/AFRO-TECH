import { useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useAuth } from '../AuthContext'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, ErrorBox, Field, Modal, OkBox, PageHeader, Spinner, StatCard } from '../ui'

type LeadStage = 'lead' | 'qualified' | 'proposal' | 'won' | 'lost'

interface Lead {
  id: string
  name: string
  organization: string | null
  email: string | null
  phone: string | null
  source: string | null
  stage: LeadStage
  expected_value: number
  follow_up_date: string | null
  notes: string | null
  created_at: string
}

const STAGE_LABEL: Record<LeadStage, string> = {
  lead: 'New Lead',
  qualified: 'Qualified',
  proposal: 'Proposal Sent',
  won: 'Won / Converted',
  lost: 'Lost',
}

const STAGE_TONE: Record<LeadStage, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  lead: 'neutral',
  qualified: 'info',
  proposal: 'warn',
  won: 'good',
  lost: 'bad',
}

export default function Crm(): JSX.Element {
  const { me } = useAuth()
  const isHospital = me?.tenant?.business_type === 'hospital'
  const leadsQ = useApiData<{ leads: Lead[] }>('/erp/leads')

  const [stageFilter, setStageFilter] = useState<string>('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    name: '',
    organization: '',
    email: '',
    phone: '',
    source: 'Referral',
    stage: 'lead' as LeadStage,
    expected_value: '',
    follow_up_date: '',
    notes: '',
  })
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const allLeads = leadsQ.data?.leads ?? []
  const filteredLeads = stageFilter ? allLeads.filter((l) => l.stage === stageFilter) : allLeads

  const qualifiedCount = allLeads.filter((l) => l.stage === 'qualified' || l.stage === 'proposal').length
  const wonCount = allLeads.filter((l) => l.stage === 'won').length
  const pipelineValue = allLeads.filter((l) => l.stage !== 'lost').reduce((s, l) => s + Number(l.expected_value || 0), 0)

  const submitLead = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErrMsg(null)
    try {
      await api.post('/erp/leads', {
        name: form.name.trim(),
        organization: form.organization.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        source: form.source.trim() || null,
        stage: form.stage,
        expected_value: Number(form.expected_value) || 0,
        follow_up_date: form.follow_up_date || null,
        notes: form.notes.trim() || null,
      })
      setOpen(false)
      setForm({ name: '', organization: '', email: '', phone: '', source: 'Referral', stage: 'lead', expected_value: '', follow_up_date: '', notes: '' })
      setNotice('Lead added to CRM pipeline.')
      leadsQ.reload()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to save lead')
    } finally {
      setBusy(false)
    }
  }

  const updateStage = async (lead: Lead, stage: LeadStage): Promise<void> => {
    setErrMsg(null)
    try {
      await api.patch(`/erp/leads/${lead.id}`, { stage })
      leadsQ.reload()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Stage update failed')
    }
  }

  const convertLead = async (lead: Lead): Promise<void> => {
    setErrMsg(null)
    try {
      const res = await api.post<{ converted_type: string }>(`/erp/leads/${lead.id}/convert`, {})
      setNotice(`${lead.name} converted to a ${res.converted_type} record and marked Won.`)
      leadsQ.reload()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Conversion failed')
    }
  }

  const removeLead = async (lead: Lead): Promise<void> => {
    setErrMsg(null)
    try {
      await api.del(`/erp/leads/${lead.id}`)
      leadsQ.reload()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Delete failed')
    }
  }

  return (
    <div>
      <PageHeader
        title="CRM Leads & Pipeline"
        subtitle="Track prospective clients, B2B accounts and inquiries — convert won deals in one click"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-user-plus" aria-hidden="true" /> New Lead
          </button>
        }
      />

      <div className="pl-stats">
        <StatCard icon="fa-solid fa-address-book" label="Total Leads" value={allLeads.length} />
        <StatCard icon="fa-solid fa-filter-circle-dollar" label="Active Opportunities" value={qualifiedCount} />
        <StatCard icon="fa-solid fa-coins" label="Pipeline Value" value={`${fmtMoney(pipelineValue)} ETB`} />
        <StatCard icon="fa-solid fa-trophy" label="Won Deals" value={wonCount} tone="#34d399" />
      </div>

      {notice && <OkBox message={notice} />}
      {errMsg && <ErrorBox message={errMsg} />}

      <div className="pl-toolbar">
        <select className="pl-select" value={stageFilter} onChange={(e) => setStageFilter(e.target.value)} aria-label="Filter by stage">
          <option value="">All stages</option>
          {(Object.keys(STAGE_LABEL) as LeadStage[]).map((st) => (
            <option key={st} value={st}>{STAGE_LABEL[st]}</option>
          ))}
        </select>
      </div>

      {leadsQ.loading ? (
        <Spinner />
      ) : !filteredLeads.length ? (
        <EmptyState icon="fa-solid fa-handshake" title="No CRM leads yet" hint="Capture prospective B2B accounts, clinics, or parents and track follow-ups." />
      ) : (
        <DataTable
          rows={filteredLeads}
          searchPlaceholder="Search leads…"
          columns={[
            {
              key: 'name',
              header: 'Contact',
              render: (l) => (
                <div>
                  <strong>{l.name}</strong>
                  {l.organization && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{l.organization}</small>}
                </div>
              ),
              searchText: (l) => `${l.name} ${l.organization ?? ''} ${l.phone ?? ''} ${l.email ?? ''}`,
            },
            {
              key: 'phone',
              header: 'Reach',
              render: (l) => (
                <div style={{ fontSize: '.85rem' }}>
                  <div>{l.phone ?? '—'}</div>
                  {l.email && <small style={{ color: 'var(--text-dim)' }}>{l.email}</small>}
                </div>
              ),
            },
            { key: 'source', header: 'Source', render: (l) => l.source ?? '—', width: '105px' },
            {
              key: 'expected_value',
              header: 'Est. Value',
              render: (l) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtMoney(l.expected_value)} ETB</span>,
              width: '125px',
            },
            { key: 'follow_up_date', header: 'Follow-up', render: (l) => fmtDate(l.follow_up_date), width: '115px' },
            {
              key: 'stage',
              header: 'Stage',
              render: (l) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Badge tone={STAGE_TONE[l.stage]}>{STAGE_LABEL[l.stage]}</Badge>
                  <select
                    className="pl-select"
                    style={{ width: 'auto', minWidth: 110, padding: '4px 8px', fontSize: '.78rem' }}
                    aria-label={`Change stage for ${l.name}`}
                    value={l.stage}
                    onChange={(e) => updateStage(l, e.target.value as LeadStage)}
                  >
                    {(Object.keys(STAGE_LABEL) as LeadStage[]).map((st) => (
                      <option key={st} value={st}>{STAGE_LABEL[st]}</option>
                    ))}
                  </select>
                </div>
              ),
            },
            {
              key: 'act',
              header: '',
              width: '210px',
              render: (l) => (
                <div className="pl-row-actions">
                  {l.stage !== 'won' && (
                    <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => convertLead(l)}>
                      {isHospital ? 'Convert to Patient' : 'Convert to Customer'}
                    </button>
                  )}
                  <button type="button" className="pl-icon-btn danger" aria-label={`Delete ${l.name}`} onClick={() => removeLead(l)}>
                    <i className="fa-solid fa-trash-can" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={open} title="Add CRM Lead" wide onClose={() => setOpen(false)}>
        <form onSubmit={submitLead}>
          <div className="pl-grid-2">
            <Field label="Contact Name">
              <input className="pl-input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Organization / Company">
              <input className="pl-input" value={form.organization} onChange={(e) => setForm((f) => ({ ...f, organization: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Phone">
              <input className="pl-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Email">
              <input className="pl-input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Source">
              <select className="pl-select" value={form.source} onChange={(e) => setForm((f) => ({ ...f, source: e.target.value }))}>
                <option value="Referral">Referral</option>
                <option value="Walk-in">Walk-in</option>
                <option value="Telegram Bot">Telegram Bot</option>
                <option value="Website">Website</option>
                <option value="Cold Outreach">Cold Outreach</option>
              </select>
            </Field>
            <Field label="Expected Value (ETB)">
              <input className="pl-input" type="number" min="0" step="0.01" value={form.expected_value} onChange={(e) => setForm((f) => ({ ...f, expected_value: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Initial Stage">
              <select className="pl-select" value={form.stage} onChange={(e) => setForm((f) => ({ ...f, stage: e.target.value as LeadStage }))}>
                {(Object.keys(STAGE_LABEL) as LeadStage[]).map((st) => (
                  <option key={st} value={st}>{STAGE_LABEL[st]}</option>
                ))}
              </select>
            </Field>
            <Field label="Next Follow-up">
              <input className="pl-input" type="date" value={form.follow_up_date} onChange={(e) => setForm((f) => ({ ...f, follow_up_date: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className="pl-textarea" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} placeholder="Requirements, interest, follow-up plan…" />
          </Field>
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Lead'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
