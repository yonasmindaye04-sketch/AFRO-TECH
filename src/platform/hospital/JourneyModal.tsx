import { useEffect, useState } from 'react'
import { api } from '../api'
import { Modal, Spinner, ErrorBox, OkBox, Field, Badge } from '../ui'

interface VisitDetail {
  visit: {
    id: string
    patient_name: string
    patient_code: string
    phone: string | null
    blood_type: string | null
    allergies: string | null
    status: string
    department_name: string | null
    chief_complaint: string | null
  }
  history: Array<{
    id: string
    event: string
    department_name: string | null
    handler_name: string | null
    note: string | null
    created_at: string
  }>
  orders: Array<{
    id: string
    order_type: string
    status: string
    details: Record<string, unknown>
    result: Record<string, unknown>
    fee: number
    department_name: string
    doctor_name: string | null
  }>
}
interface Department {
  id: string
  name: string
  type: string
}

const EVENT_LABEL: Record<string, string> = {
  checked_in: 'Checked in',
  called: 'Called',
  in_service: 'In service',
  transferred: 'Transferred',
  completed: 'Completed',
  no_show: 'No show',
  order_created: 'Order placed',
  order_completed: 'Order done',
}

export default function JourneyModal({ visitId, onClose, onChanged }: { visitId: string | null; onClose: () => void; onChanged: () => void }): JSX.Element | null {
  const [data, setData] = useState<VisitDetail | null>(null)
  const [depts, setDepts] = useState<Department[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [ok, setOk] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // order form
  const [orderType, setOrderType] = useState('lab_test')
  const [targetDept, setTargetDept] = useState('')
  const [fee, setFee] = useState('0')
  const [details, setDetails] = useState<Record<string, string>>({})

  const load = async (): Promise<void> => {
    if (!visitId) return
    setLoading(true)
    setError(null)
    try {
      const [d, dd] = await Promise.all([api.get<VisitDetail>(`/flow/visits/${visitId}`), api.get<{ departments: Department[] }>('/flow/departments')])
      setData(d)
      setDepts(dd.departments)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [visitId])

  const createOrder = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setOk(null)
    try {
      await api.post('/flow/orders', {
        visit_id: visitId,
        order_type: orderType,
        target_department_id: targetDept,
        fee: Number(fee) || 0,
        details,
      })
      setOk('Order placed.')
      onChanged()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not place order')
    } finally {
      setBusy(false)
    }
  }

  const doTransfer = async (departmentId: string): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/flow/visits/${visitId}/transfer`, { department_id: departmentId })
      onChanged()
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Transfer failed')
    } finally {
      setBusy(false)
    }
  }

  const genInvoice = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/flow/visits/${visitId}/invoice`)
      setOk('Invoice generated from completed services.')
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate invoice')
    } finally {
      setBusy(false)
    }
  }

  if (!visitId) return null

  const orderableDepts = depts.filter((d) => ['laboratory', 'injection', 'procedure'].includes(d.type))
  const resultDepts = depts.filter((d) => ['consultation', 'billing'].includes(d.type))

  return (
    <Modal open={visitId !== null} title="Patient journey" onClose={onClose} wide>
      {loading ? (
        <Spinner />
      ) : !data ? (
        error ? <ErrorBox message={error} /> : null
      ) : (
        <div>
          {error && <ErrorBox message={error} />}
          {ok && <OkBox message={ok} />}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginBottom: 16 }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <h3 style={{ margin: 0 }}>{data.visit.patient_name}</h3>
              <small style={{ color: 'var(--text-dim)' }}>
                {data.visit.patient_code} · {data.visit.phone ?? 'no phone'}
              </small>
            </div>
            {data.visit.allergies && <Badge tone="bad">Allergies: {data.visit.allergies}</Badge>}
            {data.visit.blood_type && <Badge tone="neutral">Blood: {data.visit.blood_type}</Badge>}
            <Badge tone="info">{data.visit.status.replace('_', ' ')}</Badge>
          </div>

          {/* Journey timeline */}
          <h4 style={{ margin: '16px 0 8px', fontSize: '.9rem' }}>Journey</h4>
          <div className="pl-journey">
            {data.history.map((h, i) => (
              <div key={h.id} className="pl-journey-step">
                <span className="pl-journey-dot" />
                <div>
                  <strong>{EVENT_LABEL[h.event] ?? h.event}</strong>
                  <small style={{ color: 'var(--text-dim)' }}>
                    {h.department_name ? `${h.department_name} · ` : ''}
                    {new Date(h.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                    {h.handler_name ? ` · ${h.handler_name}` : ''}
                  </small>
                  {h.note && <small style={{ display: 'block', color: 'var(--text-dim)' }}>{h.note}</small>}
                </div>
                {i < data.history.length - 1 && <span className="pl-journey-line" />}
              </div>
            ))}
          </div>

          {/* Orders */}
          <h4 style={{ margin: '16px 0 8px', fontSize: '.9rem' }}>Orders</h4>
          {data.orders.length === 0 ? (
            <p style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>No orders on this visit.</p>
          ) : (
            data.orders.map((o) => (
              <div key={o.id} className="pl-queue-item">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <strong style={{ textTransform: 'capitalize' }}>{o.order_type.replace('_', ' ')}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{o.department_name}{o.doctor_name ? ` · ${o.doctor_name}` : ''}</small>
                  {o.order_type === 'injection' && o.details?.drug ? (
                    <small style={{ display: 'block', color: 'var(--accent)' }}>
                      {String(o.details.drug)} {o.details.dose ? String(o.details.dose) : ''} {o.details.route ? `· ${String(o.details.route)}` : ''}
                    </small>
                  ) : null}
                  {o.status === 'completed' && o.result && Object.keys(o.result).length > 0 && (
                    <small style={{ display: 'block', color: '#2ecc71' }}>
                      {Object.entries(o.result)
                        .filter(([, v]) => v !== '' && v !== undefined && v !== null && !(typeof v === 'object' || Array.isArray(v)))
                        .map(([k, v]) => `${k.replace('_', ' ')}: ${String(v)}`)
                        .join(' · ')}
                    </small>
                  )}
                </div>
                {o.fee > 0 && <Badge tone="neutral">{o.fee} ETB</Badge>}
                <Badge tone={o.status === 'completed' ? 'good' : o.status === 'in_progress' ? 'info' : 'warn'}>{o.status}</Badge>
              </div>
            ))
          )}

          {/* Doctor actions */}
          {orderableDepts.length > 0 && (
            <div style={{ marginTop: 20, padding: 16, background: 'var(--surface)', borderRadius: 12 }}>
              <h4 style={{ margin: '0 0 8px', fontSize: '.95rem' }}>Order a service</h4>
              <form onSubmit={createOrder} style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                  <Field label="Type">
                    <select className="pl-select" value={orderType} onChange={(e) => setOrderType(e.target.value)}>
                      <option value="lab_test">Lab test</option>
                      <option value="injection">Injection</option>
                      <option value="procedure">Procedure</option>
                    </select>
                  </Field>
                  <Field label="Department">
                    <select className="pl-select" value={targetDept} onChange={(e) => setTargetDept(e.target.value)}>
                      <option value="">Select…</option>
                      {orderableDepts
                        .filter((d) => orderType === 'injection' || orderType === 'procedure' ? d.type === 'injection' || d.type === 'procedure' : d.type === 'laboratory')
                        .map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name}
                          </option>
                        ))}
                    </select>
                  </Field>
                  <Field label="Fee (ETB)">
                    <input className="pl-input" type="number" value={fee} onChange={(e) => setFee(e.target.value)} />
                  </Field>
                </div>
                {orderType === 'lab_test' && (
                  <Field label="Test name">
                    <input className="pl-input" value={details.test_name ?? ''} onChange={(e) => setDetails((d) => ({ ...d, test_name: e.target.value }))} placeholder="e.g. CBC" />
                  </Field>
                )}
                {orderType === 'injection' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                    <Field label="Drug">
                      <input className="pl-input" value={details.drug ?? ''} onChange={(e) => setDetails((d) => ({ ...d, drug: e.target.value }))} />
                    </Field>
                    <Field label="Dose">
                      <input className="pl-input" value={details.dose ?? ''} onChange={(e) => setDetails((d) => ({ ...d, dose: e.target.value }))} placeholder="e.g. 5 ml" />
                    </Field>
                    <Field label="Route">
                      <input className="pl-input" value={details.route ?? ''} onChange={(e) => setDetails((d) => ({ ...d, route: e.target.value }))} placeholder="IM / IV / PO" />
                    </Field>
                  </div>
                )}
                <div className="pl-form-actions">
                  <button type="submit" className="pl-btn pl-btn-primary" disabled={busy || !targetDept}>
                    {busy ? 'Placing…' : 'Place order'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Transfer + billing */}
          <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
            {resultDepts.length > 0 && (
              <div style={{ display: 'flex', gap: 6 }}>
                {resultDepts.map((d) => (
                  <button key={d.id} type="button" className="pl-btn pl-btn-ghost pl-btn-sm" disabled={busy} onClick={() => void doTransfer(d.id)}>
                    <i className="fa-solid fa-arrow-right" /> Send to {d.name}
                  </button>
                ))}
              </div>
            )}
            <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" disabled={busy} onClick={() => void genInvoice()}>
              <i className="fa-solid fa-file-invoice-dollar" /> Generate invoice
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}