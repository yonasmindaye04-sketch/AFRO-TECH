import { useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Purchase {
  id: string
  total: string
  paid_amount: string
  notes: string | null
  created_at: string
  supplier_name: string | null
  received_by: string | null
  item_count: number
}
interface ProductOpt {
  id: string
  name: string
}
interface SupplierOpt {
  id: string
  name: string
}
interface Line {
  product_id: string
  quantity: string
  unit_cost: string
  batch_no: string
  expiry_date: string
}

const emptyLine: Line = { product_id: '', quantity: '', unit_cost: '', batch_no: '', expiry_date: '' }

export default function Purchases(): JSX.Element {
  const purchases = useApiData<{ purchases: Purchase[] }>('/retail/purchases?limit=50')
  const productsQ = useApiData<{ products: ProductOpt[] }>('/retail/products')
  const suppliersQ = useApiData<{ suppliers: SupplierOpt[] }>('/retail/suppliers')

  const [open, setOpen] = useState(false)
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [paid, setPaid] = useState('')
  const [lines, setLines] = useState<Line[]>([{ ...emptyLine }])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_cost) || 0), 0)

  const setLine = (i: number, patch: Partial<Line>): void =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/retail/purchases', {
        supplier_id: supplierId || null,
        notes: notes.trim() || null,
        paid_amount: Number(paid) || 0,
        items: lines.map((l) => ({
          product_id: l.product_id,
          quantity: Number(l.quantity),
          unit_cost: Number(l.unit_cost),
          batch_no: l.batch_no.trim() || null,
          expiry_date: l.expiry_date || null,
        })),
      })
      setOpen(false)
      setLines([{ ...emptyLine }])
      setSupplierId('')
      setNotes('')
      setPaid('')
      purchases.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not record purchase')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Purchases"
        subtitle="Receive stock — batches and quantities update instantly"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Receive stock
          </button>
        }
      />
      {purchases.loading ? (
        <Spinner />
      ) : !purchases.data?.purchases.length ? (
        <EmptyState icon="fa-solid fa-truck-ramp-box" title="No purchases recorded" hint="Record your first stock delivery to start selling." />
      ) : (
        <DataTable
          rows={purchases.data.purchases}
          columns={[
            { key: 'when', header: 'Date', render: (p) => fmtDate(p.created_at), width: '110px' },
            { key: 'sup', header: 'Supplier', render: (p) => p.supplier_name ?? '—' },
            { key: 'items', header: 'Line items', render: (p) => p.item_count },
            { key: 'total', header: 'Total', render: (p) => `${fmtMoney(p.total)} ETB` },
            { key: 'paid', header: 'Paid', render: (p) => `${fmtMoney(p.paid_amount)} ETB` },
            {
              key: 'due',
              header: 'Balance',
              render: (p) => {
                const due = Number(p.total) - Number(p.paid_amount)
                return due > 0.001 ? <span style={{ color: '#e07a7a' }}>{fmtMoney(due)} ETB</span> : <span style={{ color: '#34d399' }}>Settled</span>
              },
            },
            { key: 'by', header: 'Received by', render: (p) => p.received_by ?? '—' },
          ]}
        />
      )}

      <Modal open={open} title="Receive new stock" wide onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="pl-grid-2">
            <Field label="Supplier">
              <select className="pl-select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— none / walk-in —</option>
                {(suppliersQ.data?.suppliers ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount paid now (ETB)">
              <input className="pl-input" type="number" min="0" step="0.01" placeholder={total.toFixed(2)} value={paid} onChange={(e) => setPaid(e.target.value)} />
            </Field>
          </div>

          {lines.map((l, i) => (
            <div key={i} className="pl-card" style={{ padding: 14, marginBottom: 12 }}>
              <div className="pl-grid-2">
                <Field label={`Product ${i + 1}`}>
                  <select className="pl-select" required value={l.product_id} onChange={(e) => setLine(i, { product_id: e.target.value })}>
                    <option value="">Select product…</option>
                    {(productsQ.data?.products ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="pl-grid-2">
                  <Field label="Quantity">
                    <input className="pl-input" type="number" min="1" required value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                  </Field>
                  <Field label="Unit cost">
                    <input className="pl-input" type="number" min="0" step="0.01" required value={l.unit_cost} onChange={(e) => setLine(i, { unit_cost: e.target.value })} />
                  </Field>
                </div>
              </div>
              <div className="pl-grid-2">
                <Field label="Batch no. (optional)">
                  <input className="pl-input" value={l.batch_no} onChange={(e) => setLine(i, { batch_no: e.target.value })} />
                </Field>
                <Field label="Expiry date (pharmacy)">
                  <input className="pl-input" type="date" value={l.expiry_date} onChange={(e) => setLine(i, { expiry_date: e.target.value })} />
                </Field>
              </div>
              {lines.length > 1 && (
                <button type="button" className="pl-btn pl-btn-danger pl-btn-sm" onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>
                  Remove line
                </button>
              )}
            </div>
          ))}
          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => setLines((ls) => [...ls, { ...emptyLine }])}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add another product
          </button>

          <Field label="Notes">
            <input className="pl-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Delivery note, invoice ref…" />
          </Field>

          <div className="pl-cart-total grand">
            <span>Purchase total</span>
            <span style={{ color: 'var(--accent)' }}>{fmtMoney(total)} ETB</span>
          </div>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Receive stock'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
