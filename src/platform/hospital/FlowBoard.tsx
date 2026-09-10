import { useState } from 'react'
import { api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, EmptyState, Field, Modal, PageHeader, Spinner, OkBox, ErrorBox } from '../ui'
import JourneyModal from './JourneyModal'

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
  status: string
  priority: string
  chief_complaint: string | null
  department_name: string | null
  opened_at: string
  order_count: number
}
interface Order {
  id: string
  order_type: string
  status: string
  priority: string
  details: Record<string, unknown>
  doctor_name: string | null
  patient_name: string
  patient_code: string
  created_at: string
}

export default function FlowBoard(): JSX.Element {
  const depts = useApiData<{ departments: Department[] }>('/flow/departments')
  const [deptId, setDeptId] = useState<string>('')
  const [orderStatus, setOrderStatus] = useState<string>('pending')

  const visitsQ = useApiData<{ visits: Visit[] }>(deptId ? `/flow/visits?department_id=${deptId}` : '/flow/visits')
  const ordersQ = useApiData<{ orders: Order[] }>(deptId ? `/flow/orders?department_id=${deptId}&status=${orderStatus}` : null)

  const [journeyId, setJourneyId] = useState<string | null>(null)
  const [completing, setCompleting] = useState<Order | null>(null)
  const [result, setResult] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)

  const departments = depts.data?.departments ?? []
  const currentDept = departments.find((d) => d.id === deptId)
  const deptType = currentDept?.type ?? 'consultation'

  const reloadAll = (): void => {
    visitsQ.reload()
    ordersQ.reload()
    depts.reload()
  }

  const act = async (fn: () => Promise<unknown>, okMsg: string): Promise<void> => {
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await fn()
      setOk(okMsg)
      reloadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  const completeOrder = async (): Promise<void> => {
    if (!completing) return
    await act(
      () => api.post(`/flow/orders/${completing.id}/complete`, { result }),
      'Order completed.'
    ).then(() => setCompleting(null))
  }

  const visits = visitsQ.data?.visits ?? []
  const waiting = visits.filter((v) => v.status === 'waiting')
  const inService = visits.filter((v) => v.status === 'in_service')
  const orders = ordersQ.data?.orders ?? []

  const isServiceDept = ['laboratory', 'injection', 'procedure'].includes(deptType)

  return (
    <div>
      <PageHeader
        title="Patient Flow"
        subtitle="Live queue per department"
        action={
          <select className="pl-select" value={deptId} onChange={(e) => setDeptId(e.target.value)} style={{ minWidth: 220 }}>
            <option value="">All departments…</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.waiting} waiting, {d.pending_orders} orders)
              </option>
            ))}
          </select>
        }
      />
      {error && <ErrorBox message={error} />}
      {ok && <OkBox message={ok} />}

      {!deptId ? (
        <EmptyState icon="fa-solid fa-building" title="Select a department" hint="Choose a department above to see its queue and orders." />
      ) : (
        <>
          {/* Patients */}
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1rem', margin: '4px 0 10px' }}>
            <i className="fa-solid fa-hospital-user" aria-hidden="true" /> Patients — {currentDept?.name ?? ''}
          </h2>
          {visitsQ.loading ? (
            <Spinner />
          ) : waiting.length + inService.length === 0 ? (
            <EmptyState icon="fa-solid fa-timeline" title="No patients here" hint="Walk-ins and transferred patients appear in this queue." />
          ) : (
            <>
              {inService.map((v) => (
                <div key={v.id} className="pl-queue-item in_service">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>
                      {v.patient_name} <small style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{v.patient_code}</small>
                    </strong>
                    <small style={{ display: 'block', color: 'var(--text-dim)' }}>{v.chief_complaint ?? '—'}</small>
                  </div>
                  <Badge tone="info">in service</Badge>
                  <button type="button" className="pl-btn pl-btn-sm pl-btn-ghost" onClick={() => setJourneyId(v.id)}>
                    Journey
                  </button>
                  <button
                    type="button"
                    className="pl-btn pl-btn-sm pl-btn-primary"
                    onClick={() => void act(() => api.post(`/flow/visits/${v.id}/complete`), 'Visit completed.')}
                  >
                    Finish visit
                  </button>
                </div>
              ))}
              {waiting.map((v) => (
                <div key={v.id} className="pl-queue-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong>
                      {v.patient_name} <small style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{v.patient_code}</small>
                    </strong>
                    <small style={{ display: 'block', color: 'var(--text-dim)' }}>{v.chief_complaint ?? '—'}</small>
                  </div>
                  {v.priority === 'urgent' && <Badge tone="bad">urgent</Badge>}
                  <Badge tone="warn">waiting</Badge>
                  <button type="button" className="pl-btn pl-btn-sm pl-btn-ghost" onClick={() => setJourneyId(v.id)}>
                    Journey
                  </button>
                  <button type="button" className="pl-btn pl-btn-sm pl-btn-primary" onClick={() => void act(() => api.post(`/flow/visits/${v.id}/call`), 'Patient called in.')}>
                    Call in
                  </button>
                </div>
              ))}
            </>
          )}

          {/* Orders */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 24 }}>
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1rem', margin: 0 }}>
              <i className="fa-solid fa-clipboard-list" aria-hidden="true" /> Orders
            </h2>
            <select className="pl-select" value={orderStatus} onChange={(e) => setOrderStatus(e.target.value)} style={{ minWidth: 160 }}>
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          {ordersQ.loading ? (
            <Spinner />
          ) : orders.length === 0 ? (
            <EmptyState icon="fa-solid fa-clipboard" title="No orders here" hint={isServiceDept ? 'Lab tests / injections ordered by doctors show up here.' : 'No pending service orders for this department.'} />
          ) : (
            orders.map((o) => (
              <div key={o.id} className="pl-queue-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong>
                    {o.patient_name} <small style={{ color: 'var(--text-dim)', fontWeight: 400 }}>{o.patient_code}</small>
                  </strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>
                    {o.order_type.replace('_', ' ')}
                    {o.doctor_name ? ` · ${o.doctor_name}` : ''} · {new Date(o.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                  </small>
                  {o.order_type === 'injection' && o.details?.drug ? (
                    <small style={{ display: 'block', color: 'var(--accent)' }}>
                      {String(o.details.drug)}
                      {o.details.dose ? ` ${String(o.details.dose)}` : ''}
                      {o.details.route ? ` · ${String(o.details.route)}` : ''}
                    </small>
                  ) : o.order_type === 'lab_test' && o.details?.test_name ? (
                    <small style={{ display: 'block', color: 'var(--accent)' }}>{String(o.details.test_name)}</small>
                  ) : null}
                </div>
                <Badge tone={o.status === 'pending' ? 'warn' : o.status === 'in_progress' ? 'info' : 'good'}>{o.status}</Badge>
                <div className="pl-row-actions">
                  {o.status === 'pending' && (
                    <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => void act(() => api.post(`/flow/orders/${o.id}/start`), 'Order started.')}>
                      Start
                    </button>
                  )}
                  {(o.status === 'pending' || o.status === 'in_progress') && (
                    <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => { setCompleting(o); setResult({}) }}>
                      Complete
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </>
      )}

      <JourneyModal visitId={journeyId} onClose={() => setJourneyId(null)} onChanged={reloadAll} />

      {/* Complete order modal */}
      <Modal open={completing !== null} title={`Complete order — ${completing?.order_type.replace('_', ' ') ?? ''}`} onClose={() => setCompleting(null)}>
        {completing && (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              void completeOrder()
            }}
          >
            {completing.order_type === 'lab_test' && (
              <Field label="Result value">
                <input className="pl-input" value={result.value ?? ''} onChange={(e) => setResult((r) => ({ ...r, value: e.target.value }))} placeholder="e.g. Negative, 12.5 g/dL…" />
              </Field>
            )}
            {completing.order_type === 'injection' && (
              <>
                <Field label="Administered?">
                  <select className="pl-select" value={result.administered ?? 'yes'} onChange={(e) => setResult((r) => ({ ...r, administered: e.target.value }))}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </Field>
                <Field label="Adverse reaction (optional)">
                  <input className="pl-input" value={result.adverse_reaction ?? ''} onChange={(e) => setResult((r) => ({ ...r, adverse_reaction: e.target.value }))} placeholder="Any reaction observed…" />
                </Field>
              </>
            )}
            <Field label="Note (optional)">
              <input className="pl-input" value={result.note ?? ''} onChange={(e) => setResult((r) => ({ ...r, note: e.target.value }))} />
            </Field>
            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setCompleting(null)}>
                Cancel
              </button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Mark complete'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}