import { useState } from 'react'
import { api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, EmptyState, Field, Modal, PageHeader, Spinner, OkBox, ErrorBox } from '../ui'

interface Appointment {
  id: string
  scheduled_at: string
  reason: string | null
  status: string
  patient_id: string
  patient_name: string
  patient_code: string
  phone: string | null
  doctor_name: string | null
}
interface Patient {
  id: string
  first_name: string
  last_name: string
  code: string
}
interface Department {
  id: string
  name: string
  type: string
  waiting: number
  pending_orders: number
}
interface Visit {
  id: string
  patient_name: string
  patient_code: string
  department_name: string | null
  status: string
  priority: string
  visit_type: string
  chief_complaint: string | null
  opened_at: string
}

export default function Reception(): JSX.Element {
  const appts = useApiData<{ appointments: Appointment[] }>('/hospital/appointments?scope=today')
  const patients = useApiData<{ patients: Patient[] }>('/hospital/patients')
  const depts = useApiData<{ departments: Department[] }>('/flow/departments')
  const visits = useApiData<{ visits: Visit[] }>('/flow/visits')

  const [checkIn, setCheckIn] = useState<Appointment | null>(null)
  const [walkIn, setWalkIn] = useState(false)
  const [form, setForm] = useState({ patient_id: '', chief_complaint: '', priority: 'normal' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const reloadAll = (): void => {
    appts.reload()
    visits.reload()
    depts.reload()
  }

  const doCheckIn = async (appointmentId: string | null, patientId: string, complaint?: string, priority?: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await api.post('/flow/visits', {
        patient_id: patientId,
        appointment_id: appointmentId,
        chief_complaint: complaint || null,
        priority: priority || 'normal',
      })
      setOk('Patient checked in.')
      setCheckIn(null)
      setWalkIn(false)
      setForm({ patient_id: '', chief_complaint: '', priority: 'normal' })
      reloadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check-in failed')
    } finally {
      setBusy(false)
    }
  }

  const today = appts.data?.appointments ?? []
  const scheduled = today.filter((a) => a.status === 'scheduled')
  const queue = visits.data?.visits ?? []

  return (
    <div>
      <PageHeader title="Reception" subtitle="Check patients in and open their visit." />
      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      <div className="pl-cols-2">
        <div>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1rem', margin: '4px 0 10px' }}>
            <i className="fa-solid fa-calendar-check" aria-hidden="true" /> Today's appointments ({scheduled.length})
          </h2>
          {appts.loading ? (
            <Spinner />
          ) : scheduled.length === 0 ? (
            <EmptyState icon="fa-solid fa-calendar" title="No scheduled appointments today" />
          ) : (
            scheduled.map((a) => (
              <div key={a.id} className="pl-queue-item">
                <span className="pl-queue-time">{new Date(a.scheduled_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {a.patient_name} <small style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{a.patient_code}{a.doctor_name ? ` · ${a.doctor_name}` : ''}</small>
                  </strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{a.reason ?? 'Consultation'}</small>
                </div>
                <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => setCheckIn(a)}>
                  Check in
                </button>
              </div>
            ))
          )}
        </div>

        <div>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1rem', margin: '4px 0 10px' }}>
            <i className="fa-solid fa-timeline" aria-hidden="true" /> Queue now ({queue.length})
          </h2>
          {visits.loading ? (
            <Spinner />
          ) : queue.length === 0 ? (
            <EmptyState icon="fa-solid fa-timeline" title="No patients in queue" />
          ) : (
            queue.map((v) => (
              <div key={v.id} className="pl-queue-item">
                <span className="pl-queue-time">{new Date(v.opened_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {v.patient_name} <small style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{v.patient_code}</small>
                  </strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{v.department_name ?? '—'}</small>
                </div>
                <Badge tone={v.priority === 'urgent' ? 'bad' : 'neutral'}>{v.priority}</Badge>
                <Badge tone={v.status === 'waiting' ? 'warn' : v.status === 'in_service' ? 'info' : 'good'}>{v.status}</Badge>
              </div>
            ))
          )}
          <div style={{ marginTop: 12 }}>
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => setWalkIn(true)}>
              <i className="fa-solid fa-person-walking" aria-hidden="true" /> Walk-in patient
            </button>
          </div>
        </div>
      </div>

      {/* Check-in confirmation (from appointment) */}
      <Modal open={checkIn !== null} title={`Check in — ${checkIn?.patient_name ?? ''}`} onClose={() => setCheckIn(null)}>
        <p style={{ color: 'var(--text-dim)' }}>
          {checkIn?.doctor_name ? `Doctor: ${checkIn.doctor_name}. ` : ''}This opens the patient's visit and moves them to the consultation queue.
        </p>
        <Field label="Chief complaint (optional)">
          <input className="pl-input" value={form.chief_complaint} onChange={(e) => setForm((f) => ({ ...f, chief_complaint: e.target.value }))} />
        </Field>
        <div className="pl-form-actions">
          <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setCheckIn(null)}>
            Cancel
          </button>
          <button
            type="button"
            className="pl-btn pl-btn-primary"
            disabled={busy}
            onClick={() => void doCheckIn(checkIn!.id, checkIn!.patient_id, form.chief_complaint, form.priority)}
          >
            {busy ? 'Checking in…' : 'Confirm check-in'}
          </button>
        </div>
      </Modal>

      {/* Walk-in */}
      <Modal open={walkIn} title="Walk-in patient" onClose={() => setWalkIn(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void doCheckIn(null, form.patient_id, form.chief_complaint, form.priority)
          }}
        >
          <Field label="Patient">
            <select className="pl-select" required value={form.patient_id} onChange={(e) => setForm((f) => ({ ...f, patient_id: e.target.value }))}>
              <option value="">Select patient…</option>
              {(patients.data?.patients ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name} ({p.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Chief complaint">
            <input className="pl-input" value={form.chief_complaint} onChange={(e) => setForm((f) => ({ ...f, chief_complaint: e.target.value }))} />
          </Field>
          <Field label="Priority">
            <select className="pl-select" value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </Field>
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy || !form.patient_id}>
              {busy ? 'Checking in…' : 'Check in'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}