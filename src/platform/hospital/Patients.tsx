import { useState, type FormEvent } from 'react'
import { api, fmtDate } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Patient {
  id: string
  code: string
  first_name: string
  last_name: string
  gender: 'male' | 'female'
  dob: string | null
  phone: string | null
  address: string | null
  blood_type: string | null
  allergies: string | null
  created_at: string
}

const empty = { first_name: '', last_name: '', gender: 'male', dob: '', phone: '', address: '', blood_type: '', allergies: '' }

export default function Patients(): JSX.Element {
  const { data, loading, reload } = useApiData<{ patients: Patient[] }>('/hospital/patients')
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/hospital/patients', {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        gender: form.gender,
        dob: form.dob || null,
        phone: form.phone.trim() || null,
        address: form.address.trim() || null,
        blood_type: form.blood_type.trim() || null,
        allergies: form.allergies.trim() || null,
      })
      setOpen(false)
      setForm(empty)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const rows = (data?.patients ?? []).filter(
    (p) => !search || `${p.first_name} ${p.last_name} ${p.code} ${p.phone ?? ''}`.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <PageHeader
        title="Patients"
        subtitle="Every patient gets a unique file number automatically"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-user-plus" aria-hidden="true" /> Register patient
          </button>
        }
      />
      <div className="pl-toolbar">
        <input className="pl-input" placeholder="Search name, file # or phone…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search patients" />
        <span style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>{rows.length} patients</span>
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="fa-solid fa-hospital-user" title="No patients found" hint="Register your first patient to get started." />
      ) : (
        <DataTable
          rows={rows}
          columns={[
            { key: 'code', header: 'File #', render: (p) => <strong>{p.code}</strong>, width: '110px' },
            {
              key: 'name',
              header: 'Patient',
              render: (p) => (
                <div>
                  <strong>{p.first_name} {p.last_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)', textTransform: 'capitalize' }}>{p.gender}{p.dob ? ` · ${fmtDate(p.dob)}` : ''}</small>
                </div>
              ),
            },
            { key: 'phone', header: 'Phone', render: (p) => p.phone ?? '—' },
            { key: 'blood', header: 'Blood', render: (p) => p.blood_type ?? '—' },
            {
              key: 'allergy',
              header: 'Allergies',
              render: (p) => (p.allergies ? <Badge tone="bad">{p.allergies}</Badge> : '—'),
            },
            { key: 'since', header: 'Registered', render: (p) => fmtDate(p.created_at), width: '110px' },
          ]}
        />
      )}

      <Modal open={open} title="Register new patient" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="pl-grid-2">
            <Field label="First name">
              <input className="pl-input" required maxLength={80} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
            </Field>
            <Field label="Last name">
              <input className="pl-input" required maxLength={80} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Gender">
              <select className="pl-select" value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </Field>
            <Field label="Date of birth">
              <input className="pl-input" type="date" value={form.dob} onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Phone">
              <input className="pl-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Blood type">
              <input className="pl-input" placeholder="O+, AB-…" value={form.blood_type} onChange={(e) => setForm((f) => ({ ...f, blood_type: e.target.value }))} />
            </Field>
          </div>
          <Field label="Address">
            <input className="pl-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>
          <Field label="Known allergies" hint="Shown in red on the patient list">
            <input className="pl-input" value={form.allergies} onChange={(e) => setForm((f) => ({ ...f, allergies: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Register patient'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
