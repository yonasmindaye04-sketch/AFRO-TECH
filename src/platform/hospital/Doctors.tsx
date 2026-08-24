import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Doctor {
  id: string
  full_name: string
  specialty: string
  phone: string | null
  fee: string
}

export default function Doctors(): JSX.Element {
  const { data, loading, reload } = useApiData<{ doctors: Doctor[] }>('/hospital/doctors')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ full_name: '', specialty: 'General Medicine', phone: '', fee: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/hospital/doctors', {
        full_name: form.full_name.trim(),
        specialty: form.specialty.trim() || 'General',
        phone: form.phone.trim() || null,
        fee: Number(form.fee) || 0,
      })
      setOpen(false)
      setForm({ full_name: '', specialty: 'General Medicine', phone: '', fee: '' })
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Doctors"
        subtitle="Your medical staff available for appointments"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-user-doctor" aria-hidden="true" /> Add doctor
          </button>
        }
      />
      {loading ? (
        <Spinner />
      ) : !data?.doctors.length ? (
        <EmptyState icon="fa-solid fa-user-doctor" title="No doctors added" hint="Add doctors so they can be assigned to appointments." />
      ) : (
        <DataTable
          rows={data.doctors}
          columns={[
            { key: 'name', header: 'Doctor', render: (d) => <strong>{d.full_name}</strong> },
            { key: 'spec', header: 'Specialty', render: (d) => d.specialty },
            { key: 'phone', header: 'Phone', render: (d) => d.phone ?? '—' },
            { key: 'fee', header: 'Consultation fee', render: (d) => `${Number(d.fee).toFixed(2)} ETB` },
          ]}
        />
      )}

      <Modal open={open} title="Add doctor" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <Field label="Full name">
            <input className="pl-input" required maxLength={120} placeholder="Dr. Hanna Girma" value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          </Field>
          <div className="pl-grid-2">
            <Field label="Specialty">
              <input className="pl-input" value={form.specialty} onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))} />
            </Field>
            <Field label="Phone">
              <input className="pl-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
          </div>
          <Field label="Consultation fee (ETB)">
            <input className="pl-input" type="number" min="0" step="0.01" value={form.fee} onChange={(e) => setForm((f) => ({ ...f, fee: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save doctor'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
