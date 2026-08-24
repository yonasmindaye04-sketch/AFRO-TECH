import { useState } from 'react'
import { api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface QueueItem {
  id: string
  status: 'scheduled' | 'in_service' | 'completed' | 'cancelled' | 'no_show'
  scheduled_at: string
  reason: string | null
  patient_id: string
  patient_name: string
  patient_code: string
  phone: string | null
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

const STATUS_META: Record<QueueItem['status'], { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  in_service: { label: 'In service', tone: 'info' },
  scheduled: { label: 'Waiting', tone: 'warn' },
  completed: { label: 'Done', tone: 'good' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
  no_show: { label: 'No show', tone: 'bad' },
}

export default function Queue(): JSX.Element {
  const { data, loading, reload } = useApiData<{ queue: QueueItem[] }>('/hospital/queue')
  const patientsQ = useApiData<{ patients: PatientOpt[] }>('/hospital/patients')
  const doctorsQ = useApiData<{ doctors: DoctorOpt[] }>('/hospital/doctors')

  const [walkIn, setWalkIn] = useState(false)
  const [form, setForm] = useState({ patient_id: '', doctor_id: '', reason: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const setStatus = async (id: string, status: QueueItem['status']): Promise<void> => {
    await api.patch(`/hospital/appointments/${id}`, { status }).catch(() => undefined)
    reload()
  }

  const submitWalkIn = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.post('/hospital/queue/walk-in', {
        patient_id: form.patient_id,
        doctor_id: form.doctor_id || null,
        reason: form.reason.trim() || null,
      })
      setWalkIn(false)
      setForm({ patient_id: '', doctor_id: '', reason: '' })
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add walk-in')
    } finally {
      setBusy(false)
    }
  }

  const queue = data?.queue ?? []
  const active = queue.filter((q) => q.status === 'in_service')
  const waiting = queue.filter((q) => q.status === 'scheduled')
  const done = queue.filter((q) => ['completed', 'cancelled', 'no_show'].includes(q.status))

  return (
    <div>
      <PageHeader
        title="Patient Queue"
        subtitle="Today's live patient flow"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setWalkIn(true)}>
            <i className="fa-solid fa-person-walking" aria-hidden="true" /> Walk-in
          </button>
        }
      />

      {loading ? (
        <Spinner />
      ) : queue.length === 0 ? (
        <EmptyState icon="fa-solid fa-timeline" title="Queue is empty today" hint="Scheduled appointments and walk-ins appear here." />
      ) : (
        <>
          {active.length > 0 && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1rem', margin: '4px 0 10px', color: 'var(--accent)' }}>
                <i className="fa-solid fa-stethoscope" aria-hidden="true" /> In service now ({active.length})
              </h2>
              {active.map((q) => (
                <QueueRow key={q.id} item={q} onStatus={setStatus} />
              ))}
            </>
          )}
          {waiting.length > 0 && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1rem', margin: '18px 0 10px' }}>Waiting ({waiting.length})</h2>
              {waiting.map((q) => (
                <QueueRow key={q.id} item={q} onStatus={setStatus} />
              ))}
            </>
          )}
          {done.length > 0 && (
            <>
              <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1rem', margin: '18px 0 10px', color: 'var(--text-dim)' }}>Finished ({done.length})</h2>
              {done.map((q) => (
                <QueueRow key={q.id} item={q} onStatus={setStatus} />
              ))}
            </>
          )}
        </>
      )}

      <Modal open={walkIn} title="Add walk-in patient" onClose={() => setWalkIn(false)}>
        <form onSubmit={(e) => { e.preventDefault(); void submitWalkIn() }}>
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
              <option value="">— any —</option>
              {(doctorsQ.data?.doctors ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.full_name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reason">
            <input className="pl-input" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Walk-in consultation" />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Adding…' : 'Add to queue'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

function QueueRow({ item, onStatus }: { item: QueueItem; onStatus: (id: string, s: QueueItem['status']) => void }): JSX.Element {
  const meta = STATUS_META[item.status]
  return (
    <div className={`pl-queue-item ${item.status === 'in_service' ? 'in_service' : ''} ${['completed', 'cancelled', 'no_show'].includes(item.status) ? 'done' : ''}`}>
      <span className="pl-queue-time">{new Date(item.scheduled_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>
          {item.patient_name} <small style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{item.patient_code}{item.doctor_name ? ` · ${item.doctor_name}` : ''}</small>
        </strong>
        <small style={{ display: 'block', color: 'var(--text-dim)' }}>
          {item.reason ?? 'Consultation'}{item.phone ? ` · ${item.phone}` : ''}
        </small>
      </div>
      <Badge tone={meta.tone}>{meta.label}</Badge>
      <div className="pl-row-actions">
        {item.status === 'scheduled' && (
          <>
            <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => onStatus(item.id, 'in_service')}>
              Call in
            </button>
            <button type="button" className="pl-icon-btn danger" aria-label={`Mark ${item.patient_name} as no-show`} onClick={() => onStatus(item.id, 'no_show')}>
              <i className="fa-solid fa-user-slash" aria-hidden="true" />
            </button>
          </>
        )}
        {item.status === 'in_service' && (
          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => onStatus(item.id, 'completed')}>
            Complete
          </button>
        )}
      </div>
    </div>
  )
}
