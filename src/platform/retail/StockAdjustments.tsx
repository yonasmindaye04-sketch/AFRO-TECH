import { useMemo, useState, type FormEvent } from 'react'
import { api, fmtDateTime } from '../api'
import { useApiData } from '../hooks/useApiData'
import { exportCsv } from '../utils/csv'
import { DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Adjustment {
  id: string
  product_name: string
  delta: number
  reason: string
  recorded_by: string | null
  created_at: string
}
interface ProductOpt {
  id: string
  name: string
  stock: number
}
interface BatchOpt {
  id: string
  batch_no: string
  quantity: number
  expiry_date: string | null
}

const REASONS = ['Physical count correction', 'Damaged / broken', 'Expired — write-off', 'Theft / lost', 'Returned to supplier', 'Gift / donation', 'Other']

export default function StockAdjustments(): JSX.Element {
  const { data, loading, reload } = useApiData<{ adjustments: Adjustment[] }>('/retail/adjustments')
  const productsQ = useApiData<{ products: ProductOpt[] }>('/retail/products')

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ product_id: '', batch_id: '', delta: '', reason: REASONS[0], note: '' })
  const [batches, setBatches] = useState<BatchOpt[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadBatches = async (productId: string): Promise<void> => {
    setBatches([])
    setForm((f) => ({ ...f, batch_id: '' }))
    if (!productId) return
    try {
      const r = await api.get<{ batches: BatchOpt[] }>(`/retail/products/${productId}/batches`)
      setBatches(r.batches)
    } catch {
      /* ignore */
    }
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/retail/adjustments', {
        product_id: form.product_id,
        batch_id: form.batch_id || null,
        delta: Number(form.delta),
        reason: `${form.reason}${form.note ? ` — ${form.note.trim()}` : ''}`,
      })
      setOpen(false)
      setForm({ product_id: '', batch_id: '', delta: '', reason: REASONS[0], note: '' })
      setBatches([])
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const rows = useMemo(() => data?.adjustments ?? [], [data])

  return (
    <div>
      <PageHeader
        title="Stock Adjustments"
        subtitle="Corrections with a full audit trail — counts, damage, theft, supplier returns"
        action={
          <>
            <button
              type="button"
              className="pl-btn pl-btn-ghost"
              onClick={() => exportCsv('stock-adjustments', ['Date', 'Product', 'Change', 'Reason', 'By'], rows.map((a) => [fmtDateTime(a.created_at), a.product_name, a.delta, a.reason, a.recorded_by]))}
            >
              <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export
            </button>
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
              <i className="fa-solid fa-sliders" aria-hidden="true" /> New adjustment
            </button>
          </>
        }
      />

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="fa-solid fa-sliders" title="No adjustments recorded" hint="Adjustments appear here whenever stock is manually corrected." />
      ) : (
        <DataTable
          rows={rows}
          columns={[
            { key: 'when', header: 'When', render: (a) => fmtDateTime(a.created_at), width: '150px' },
            { key: 'prod', header: 'Product', render: (a) => <strong>{a.product_name}</strong> },
            {
              key: 'delta',
              header: 'Change',
              width: '90px',
              render: (a) => (
                <strong style={{ color: a.delta > 0 ? '#34d399' : '#e07a7a' }}>
                  {a.delta > 0 ? '+' : ''}
                  {a.delta}
                </strong>
              ),
            },
            { key: 'reason', header: 'Reason', render: (a) => a.reason },
            { key: 'by', header: 'By', render: (a) => a.recorded_by ?? '—' },
          ]}
        />
      )}

      <Modal open={open} title="New stock adjustment" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <Field label="Product">
            <select className="pl-select" required value={form.product_id} onChange={(e) => { setForm((f) => ({ ...f, product_id: e.target.value })); void loadBatches(e.target.value) }}>
              <option value="">Select product…</option>
              {(productsQ.data?.products ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.stock} in stock)
                </option>
              ))}
            </select>
          </Field>
          {batches.length > 0 && (
            <Field label="Batch" hint="Leave on “automatic” to adjust the largest FEFO batch">
              <select className="pl-select" value={form.batch_id} onChange={(e) => setForm((f) => ({ ...f, batch_id: e.target.value }))}>
                <option value="">Automatic</option>
                {batches.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.batch_no} — {b.quantity} left{b.expiry_date ? ` (exp ${b.expiry_date})` : ''}
                  </option>
                ))}
              </select>
            </Field>
          )}
          <div className="pl-grid-2">
            <Field label="Change (+/−)" hint="e.g. −3 damaged, +5 found">
              <input className="pl-input" type="number" required value={form.delta} onChange={(e) => setForm((f) => ({ ...f, delta: e.target.value }))} />
            </Field>
            <Field label="Reason">
              <select className="pl-select" value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}>
                {REASONS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Note (optional)">
            <input className="pl-input" maxLength={200} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Apply adjustment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
