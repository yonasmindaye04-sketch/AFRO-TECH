import { useState, type FormEvent } from 'react'
import { api, fmtDate } from '../api'
import { useApiData } from '../hooks/useApiData'
import { DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface RecordRow {
  id: string
  visit_date: string
  doctor_name: string | null
  diagnosis: string | null
  prescription: string | null
  notes: string | null
  vitals: { bp?: string; temperature?: string; pulse?: string; weight?: string; height?: string; spo2?: string } | null
  patient_name: string
  patient_code: string
}
interface PatientOpt {
  id: string
  first_name: string
  last_name: string
  code: string
}

export default function Records(): JSX.Element {
  const [patientFilter, setPatientFilter] = useState('')
  const recordsQ = useApiData<{ records: RecordRow[] }>(`/hospital/records${patientFilter ? `?patient_id=${patientFilter}` : ''}`)
  const patientsQ = useApiData<{ patients: PatientOpt[] }>('/hospital/patients')

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ patient_id: '', doctor_name: '', visit_date: new Date().toISOString().slice(0, 10), diagnosis: '', prescription: '', notes: '' })
  const [vitals, setVitals] = useState({ bp: '', temperature: '', pulse: '', weight: '', height: '', spo2: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/hospital/records', {
        patient_id: form.patient_id,
        doctor_name: form.doctor_name.trim() || null,
        visit_date: form.visit_date || undefined,
        diagnosis: form.diagnosis.trim() || null,
        prescription: form.prescription.trim() || null,
        notes: form.notes.trim() || null,
        vitals: Object.values(vitals).some((v) => v.trim())
          ? {
              bp: vitals.bp.trim() || undefined,
              temperature: vitals.temperature.trim() || undefined,
              pulse: vitals.pulse.trim() || undefined,
              weight: vitals.weight.trim() || undefined,
              height: vitals.height.trim() || undefined,
              spo2: vitals.spo2.trim() || undefined,
            }
          : null,
      })
      setOpen(false)
      setForm({ patient_id: '', doctor_name: '', visit_date: new Date().toISOString().slice(0, 10), diagnosis: '', prescription: '', notes: '' })
      setVitals({ bp: '', temperature: '', pulse: '', weight: '', height: '', spo2: '' })
      recordsQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Medical Records"
        subtitle="Diagnoses and prescriptions per patient visit"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-file-medical" aria-hidden="true" /> Add record
          </button>
        }
      />
      <div className="pl-toolbar">
        <select className="pl-select" value={patientFilter} onChange={(e) => setPatientFilter(e.target.value)} aria-label="Filter by patient">
          <option value="">All patients</option>
          {(patientsQ.data?.patients ?? []).map((p) => (
            <option key={p.id} value={p.id}>
              {p.first_name} {p.last_name} ({p.code})
            </option>
          ))}
        </select>
      </div>

      {recordsQ.loading ? (
        <Spinner />
      ) : !recordsQ.data?.records.length ? (
        <EmptyState icon="fa-solid fa-folder-open" title="No medical records yet" hint="Records are created after each consultation." />
      ) : (
        <DataTable
          rows={recordsQ.data.records}
          columns={[
            { key: 'date', header: 'Visit', render: (r) => fmtDate(r.visit_date), width: '110px' },
            {
              key: 'pat',
              header: 'Patient',
              render: (r) => (
                <div>
                  <strong>{r.patient_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{r.patient_code}</small>
                </div>
              ),
            },
            { key: 'doc', header: 'Seen by', render: (r) => r.doctor_name ?? '—' },
            {
              key: 'vitals',
              header: 'Vitals',
              render: (r) => {
                if (!r.vitals) return '—'
                const parts = [r.vitals.bp && `BP ${r.vitals.bp}`, r.vitals.temperature && `${r.vitals.temperature}°C`, r.vitals.pulse && `P ${r.vitals.pulse}`, r.vitals.weight && `${r.vitals.weight}kg`, r.vitals.spo2 && `${r.vitals.spo2}%`].filter(Boolean)
                return parts.length ? <small>{parts.join(' · ')}</small> : '—'
              },
            },
            { key: 'diag', header: 'Diagnosis', render: (r) => r.diagnosis ?? '—' },
            { key: 'rx', header: 'Prescription', render: (r) => r.prescription ?? '—' },
            { key: 'notes', header: 'Notes', render: (r) => r.notes ?? '—' },
          ]}
        />
      )}

      <Modal open={open} title="Add medical record" wide onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="pl-grid-2">
            <Field label="Patient">
              <select className="pl-select" required value={form.patient_id} onChange={(e) => setForm((f) => ({ ...f, patient_id: e.target.value }))}>
                <option value="">Select patient…</option>
                {(patientsQ.data?.patients ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.first_name} {p.last_name} ({p.code})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Visit date">
              <input className="pl-input" type="date" value={form.visit_date} onChange={(e) => setForm((f) => ({ ...f, visit_date: e.target.value }))} />
            </Field>
          </div>
          <Field label="Seen by (doctor)">
            <input className="pl-input" maxLength={120} placeholder="Dr. name or leave blank" value={form.doctor_name} onChange={(e) => setForm((f) => ({ ...f, doctor_name: e.target.value }))} />
          </Field>
          <Field label="Vitals" hint="Fill what was measured — stored with this visit">
            <div className="pl-grid-2">
              {([['bp', 'BP (e.g. 120/80)'], ['temperature', 'Temp (°C)'], ['pulse', 'Pulse'], ['weight', 'Weight (kg)'], ['height', 'Height (cm)'], ['spo2', 'SpO₂ (%)']] as const).map(([key, label]) => (
                <input
                  key={key}
                  className="pl-input"
                  style={{ marginBottom: 8 }}
                  placeholder={label}
                  aria-label={label}
                  value={vitals[key]}
                  onChange={(e) => setVitals((v) => ({ ...v, [key]: e.target.value }))}
                />
              ))}
            </div>
          </Field>
          <Field label="Diagnosis">
            <textarea className="pl-textarea" value={form.diagnosis} onChange={(e) => setForm((f) => ({ ...f, diagnosis: e.target.value }))} />
          </Field>
          <Field label="Prescription / treatment">
            <textarea className="pl-textarea" value={form.prescription} onChange={(e) => setForm((f) => ({ ...f, prescription: e.target.value }))} />
          </Field>
          <Field label="Additional notes">
            <textarea className="pl-textarea" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save record'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
