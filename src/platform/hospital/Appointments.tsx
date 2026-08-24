import { useState, type FormEvent } from 'react'
import { api, fmtDateTime } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Appointment {
  id: string
  scheduled_at: string
  reason: string | null
  status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
  notes: string | null
  patient_name: string
  patient_code: string
  doctor_name: string | null
}
interface PatientOpt {
  id: string
  first_name: string
  last_name: string
  code: string
}
interface DoctorOpt {
  id: string
  full_name: string
}

const tone = (s: Appointment['status']): 'good' | 'warn' | 'bad' | 'neutral' =>
  s === 'completed' ? 'good' : s === 'scheduled' ? 'warn' : s === 'no_show' ? 'bad' : 'neutral'

export default function Appointments(): JSX.Element {
  const [scope, setScope] = useState<'upcoming' | 'today'>('upcoming')
  const appts = useApiData<{ appointments: Appointment[] }>(`/hospital/appointments?scope=${scope}`)
  const patientsQ = useApiData<{ patients: PatientOpt[] }>('/hospital/patients')
  const doctorsQ = useApiData<{ doctors: DoctorOpt[] }>('/hospital/doctors')

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ patient_id: '', doctor_id: '', scheduled_at: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // default datetime = next full hour
  const defaultWhen = new Date()
  defaultWhen.setHours(defaultWhen.getHours() + 1, 0, 0, 0)
  const whenValue = form.scheduled_at || defaultWhen.toISOString().slice(0, 16)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/hospital/appointments', {
        patient_id: form.patient_id,
        doctor_id: form.doctor_id || null,
        scheduled_at: new Date(form.scheduled_at || whenValue).toISOString(),
        reason: form.reason.trim() || null,
      })
      setOpen(false)
      setForm({ patient_id: '', doctor_id: '', scheduled_at: '', reason: '' })
      appts.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const setStatus = async (id: string, status: Appointment['status']): Promise<void> => {
    await api.patch(`/hospital/appointments/${id}`, { status }).catch(() => undefined)
    appts.reload()
  }

  return (
    <div>
      <PageHeader
        title="Appointments"
        subtitle="Schedule and track patient visits"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-calendar-plus" aria-hidden="true" /> New appointment
          </button>
        }
      />
      <div className="pl-toolbar">
        <div className="pl-seg" role="tablist" aria-label="Filter">
          {(['upcoming', 'today'] as const).map((s) => (
            <button key={s} type="button" className={scope === s ? 'on' : ''} onClick={() => setScope(s)}>
              {s === 'upcoming' ? 'Upcoming' : 'Today'}
            </button>
          ))}
        </div>
      </div>

      {appts.loading ? (
        <Spinner />
      ) : !appts.data?.appointments.length ? (
        <EmptyState icon="fa-solid fa-calendar-days" title="No appointments here" hint="Create one with the button above." />
      ) : (
        <DataTable
          rows={appts.data.appointments}
          columns={[
            { key: 'when', header: 'Scheduled', render: (a) => fmtDateTime(a.scheduled_at), width: '150px' },
            {
              key: 'pat',
              header: 'Patient',
              render: (a) => (
                <div>
                  <strong>{a.patient_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{a.patient_code}</small>
                </div>
              ),
            },
            { key: 'doc', header: 'Doctor', render: (a) => a.doctor_name ?? 'Unassigned' },
            { key: 'reason', header: 'Reason', render: (a) => a.reason ?? '—' },
            { key: 'st', header: 'Status', width: '120px', render: (a) => <Badge tone={tone(a.status)}>{a.status.replace('_', ' ')}</Badge> },
            {
              key: 'act',
              header: '',
              width: '140px',
              render: (a) =>
                a.status === 'scheduled' ? (
                  <div className="pl-row-actions">
                    <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => setStatus(a.id, 'completed')}>
                      Complete
                    </button>
                    <button type="button" className="pl-icon-btn danger" aria-label="Cancel appointment" onClick={() => setStatus(a.id, 'cancelled')}>
                      <i className="fa-solid fa-ban" aria-hidden="true" />
                    </button>
                  </div>
                ) : null,
            },
          ]}
        />
      )}

      <Modal open={open} title="New appointment" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
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
          <Field label="Doctor">
            <select className="pl-select" value={form.doctor_id} onChange={(e) => setForm((f) => ({ ...f, doctor_id: e.target.value }))}>
              <option value="">— any / unassigned —</option>
              {(doctorsQ.data?.doctors ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date & time">
            <input className="pl-input" type="datetime-local" required value={whenValue} onChange={(e) => setForm((f) => ({ ...f, scheduled_at: e.target.value }))} />
          </Field>
          <Field label="Reason for visit">
            <input className="pl-input" maxLength={300} placeholder="Fever, follow-up, checkup…" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Book appointment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
