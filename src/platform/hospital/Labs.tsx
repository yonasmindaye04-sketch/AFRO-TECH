import { useState, type FormEvent } from 'react'
import { api, fmtDateTime } from '../api'
import { useApiData } from '../hooks/useApiData'
import { exportCsv } from '../utils/csv'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface LabRow {
  id: string
  test_name: string
  status: 'ordered' | 'sample_collected' | 'resulted' | 'cancelled'
  result: string | null
  normal_range: string | null
  notes: string | null
  price: string
  created_at: string
  resulted_at: string | null
  patient_name: string
  patient_code: string
}
interface PatientOpt {
  id: string
  first_name: string
  last_name: string
  code: string
}
interface CatalogItem {
  name: string
  normal_range: string
  price: number
}

const tone = (s: LabRow['status']): 'good' | 'warn' | 'bad' | 'neutral' | 'info' =>
  s === 'resulted' ? 'good' : s === 'sample_collected' ? 'info' : s === 'cancelled' ? 'neutral' : 'warn'

export default function Labs(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState('')
  const labsQ = useApiData<{ labs: LabRow[] }>(`/hospital/labs${statusFilter ? `?status=${statusFilter}` : ''}`)
  const patientsQ = useApiData<{ patients: PatientOpt[] }>('/hospital/patients')
  const catalogQ = useApiData<{ catalog: CatalogItem[] }>('/hospital/labs/catalog')

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ patient_id: '', test_name: '', normal_range: '', price: '', notes: '' })
  const [resultFor, setResultFor] = useState<LabRow | null>(null)
  const [resultText, setResultText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickCatalog = (name: string): void => {
    const item = catalogQ.data?.catalog.find((c) => c.name === name)
    setForm((f) => ({
      ...f,
      test_name: name || f.test_name,
      normal_range: item?.normal_range ?? f.normal_range,
      price: item ? String(item.price) : f.price,
    }))
  }

  const submitOrder = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/hospital/labs', {
        patient_id: form.patient_id,
        test_name: form.test_name.trim(),
        normal_range: form.normal_range.trim() || null,
        price: Number(form.price) || 0,
        notes: form.notes.trim() || null,
      })
      setOpen(false)
      setForm({ patient_id: '', test_name: '', normal_range: '', price: '', notes: '' })
      labsQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Order failed')
    } finally {
      setBusy(false)
    }
  }

  const saveResult = async (): Promise<void> => {
    if (!resultFor) return
    setBusy(true)
    setError(null)
    try {
      await api.patch(`/hospital/labs/${resultFor.id}`, { status: 'resulted', result: resultText.trim() || null })
      setResultFor(null)
      setResultText('')
      labsQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const rows = labsQ.data?.labs ?? []

  return (
    <div>
      <PageHeader
        title="Laboratory"
        subtitle="Order tests, track samples, record results"
        action={
          <>
            <button
              type="button"
              className="pl-btn pl-btn-ghost"
              onClick={() =>
                exportCsv(
                  'lab-tests',
                  ['Date', 'Patient', 'Test', 'Status', 'Result', 'Price'],
                  rows.map((l) => [fmtDateTime(l.created_at), l.patient_name, l.test_name, l.status, l.result, l.price])
                )
              }
            >
              <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export
            </button>
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
              <i className="fa-solid fa-flask-vial" aria-hidden="true" /> Order test
            </button>
          </>
        }
      />
      <div className="pl-toolbar">
        <select className="pl-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All tests</option>
          <option value="ordered">Ordered</option>
          <option value="sample_collected">Sample collected</option>
          <option value="resulted">Resulted</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {labsQ.loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="fa-solid fa-flask-vial" title="No lab tests" hint="Order tests from here or the patient visit flow." />
      ) : (
        <DataTable
          rows={rows}
          columns={[
            { key: 'when', header: 'Ordered', render: (l) => fmtDateTime(l.created_at), width: '145px' },
            {
              key: 'pat',
              header: 'Patient',
              render: (l) => (
                <div>
                  <strong>{l.patient_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{l.patient_code}</small>
                </div>
              ),
            },
            { key: 'test', header: 'Test', render: (l) => <strong>{l.test_name}</strong> },
            { key: 'range', header: 'Normal range', render: (l) => <small>{l.normal_range ?? '—'}</small> },
            { key: 'result', header: 'Result', render: (l) => l.result ?? '—' },
            { key: 'st', header: 'Status', width: '130px', render: (l) => <Badge tone={tone(l.status)}>{l.status.replace('_', ' ')}</Badge> },
            {
              key: 'act',
              header: '',
              width: '150px',
              render: (l) => (
                <div className="pl-row-actions">
                  {l.status === 'ordered' && (
                    <button
                      type="button"
                      className="pl-btn pl-btn-ghost pl-btn-sm"
                      onClick={async () => {
                        await api.patch(`/hospital/labs/${l.id}`, { status: 'sample_collected' }).catch(() => undefined)
                        labsQ.reload()
                      }}
                    >
                      Sample taken
                    </button>
                  )}
                  {l.status !== 'resulted' && l.status !== 'cancelled' && (
                    <button
                      type="button"
                      className="pl-btn pl-btn-primary pl-btn-sm"
                      onClick={() => {
                        setResultFor(l)
                        setResultText(l.result ?? '')
                        setError(null)
                      }}
                    >
                      Result
                    </button>
                  )}
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={open} title="Order lab test" onClose={() => setOpen(false)}>
        <form onSubmit={submitOrder}>
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
          <Field label="Test" hint="Pick a common test or type a custom name">
            <input className="pl-input" required list="lab-catalog" value={form.test_name} onChange={(e) => pickCatalog(e.target.value)} />
            <datalist id="lab-catalog">
              {(catalogQ.data?.catalog ?? []).map((c) => (
                <option key={c.name} value={c.name} />
              ))}
            </datalist>
          </Field>
          <div className="pl-grid-2">
            <Field label="Normal range">
              <input className="pl-input" value={form.normal_range} onChange={(e) => setForm((f) => ({ ...f, normal_range: e.target.value }))} />
            </Field>
            <Field label="Price (ETB)">
              <input className="pl-input" type="number" min="0" step="0.01" value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
            </Field>
          </div>
          <Field label="Notes">
            <input className="pl-input" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Order test'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={resultFor !== null} title={resultFor ? `Result — ${resultFor.test_name}` : ''} onClose={() => setResultFor(null)}>
        {resultFor && (
          <form onSubmit={(e) => { e.preventDefault(); void saveResult() }}>
            <p style={{ color: 'var(--text-dim)', fontSize: '.87rem', marginBottom: 12 }}>
              {resultFor.patient_name} · Normal range: {resultFor.normal_range ?? '—'}
            </p>
            <Field label="Result">
              <textarea className="pl-textarea" required value={resultText} onChange={(e) => setResultText(e.target.value)} placeholder="Findings, values…" />
            </Field>
            {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
            <div className="pl-form-actions">
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save result'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
