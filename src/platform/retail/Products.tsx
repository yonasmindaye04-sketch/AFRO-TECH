import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, Field, Modal, PageHeader, Spinner } from '../ui'

interface Product {
  id: string
  name: string
  category: string
  unit: string
  sell_price: string
  cost_price: string
  low_stock_threshold: number
  barcode?: string | null
  sell_by_pill: boolean
  pills_per_unit: number
  default_margin: string
  stock: number
  sellable_stock: number
  expired_qty: number
  display_stock: number
  expiring_soon: number
}
interface FormState {
  name: string
  category: string
  unit: string
  sell_price: string
  cost_price: string
  low_stock_threshold: string
  barcode: string
  sell_by_pill: boolean
  pills_per_unit: string
  default_margin: string
}

const EMPTY: FormState = { name: '', category: '', unit: 'pcs', sell_price: '', cost_price: '', low_stock_threshold: '10', barcode: '', sell_by_pill: false, pills_per_unit: '1', default_margin: '25' }

export default function Products(): JSX.Element {
  const { data, loading, reload } = useApiData<{ products: Product[] }>('/retail/products')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<{ open: boolean; editing: Product | null }>({ open: false, editing: null })
  const [form, setForm] = useState<FormState>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openNew = (): void => {
    setForm(EMPTY)
    setError(null)
    setModal({ open: true, editing: null })
  }
  const openEdit = (p: Product): void => {
    setForm({
      name: p.name,
      category: p.category,
      unit: p.unit,
      sell_price: p.sell_price,
      cost_price: p.cost_price,
      low_stock_threshold: String(p.low_stock_threshold),
      barcode: p.barcode ?? '',
      sell_by_pill: p.sell_by_pill,
      pills_per_unit: String(p.pills_per_unit),
      default_margin: String(Number(p.default_margin)),
    })
    setError(null)
    setModal({ open: true, editing: p })
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = {
      name: form.name.trim(),
      category: form.category.trim() || 'General',
      unit: form.unit.trim() || 'pcs',
      sell_price: Number(form.sell_price) || 0,
      cost_price: Number(form.cost_price) || 0,
      low_stock_threshold: Number(form.low_stock_threshold) || 0,
      barcode: form.barcode.trim() || null,
      sell_by_pill: form.sell_by_pill,
      pills_per_unit: Math.max(1, Number(form.pills_per_unit) || 1),
      default_margin: Number(form.default_margin) || 25,
    }
    try {
      if (modal.editing) await api.patch(`/retail/products/${modal.editing.id}`, body)
      else await api.post('/retail/products', body)
      setModal({ open: false, editing: null })
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const rows = (data?.products ?? []).filter((p) => !search || `${p.name} ${p.category}`.toLowerCase().includes(search.toLowerCase()))

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Your catalog — stock updates automatically from purchases and sales"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={openNew}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add product
          </button>
        }
      />
      <div className="pl-toolbar">
        <input
          className="pl-input"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search products"
        />
        <span style={{ color: 'var(--text-dim)', fontSize: '.85rem' }}>{rows.length} items</span>
      </div>

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          rows={rows}
          empty="No products yet — add your first product or receive stock from a purchase."
          columns={[
            {
              key: 'name',
              header: 'Product',
              render: (p) => (
                <div>
                  <strong>{p.name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{p.category}</small>
                </div>
              ),
            },
            { key: 'price', header: 'Sell price', render: (p) => `${Number(p.sell_price).toFixed(2)} ETB` },
            { key: 'cost', header: 'Cost', render: (p) => `${Number(p.cost_price).toFixed(2)} ETB` },
            {
              key: 'stock',
              header: 'Stock',
              render: (p) => {
                const sellable = p.sell_by_pill ? p.display_stock : p.sellable_stock
                return (
                  <span>
                    {p.stock <= p.low_stock_threshold ? (
                      <Badge tone="bad">
                        {p.sell_by_pill ? `${sellable} pills` : `${sellable} ${p.unit}`} left
                      </Badge>
                    ) : (
                      <>
                        {p.sell_by_pill ? `${sellable} pills` : `${sellable} ${p.unit}`}
                        {p.sell_by_pill && (
                          <small style={{ display: 'block', color: 'var(--text-dim)' }}>
                            ≈ {Math.floor(sellable / p.pills_per_unit)} {p.unit} + {sellable % p.pills_per_unit} pills
                          </small>
                        )}
                      </>
                    )}
                    {p.expired_qty > 0 && (
                      <small style={{ display: 'block', color: '#e07a7a' }} title="Expired stock cannot be sold — write it off from the Expiry page">
                        +{p.expired_qty} expired (write off)
                      </small>
                    )}
                  </span>
                )
              },
            },
            {
              key: 'exp',
              header: 'Expiring ≤90d',
              render: (p) => (p.expiring_soon > 0 ? <Badge tone="warn">{p.expiring_soon}</Badge> : '—'),
            },
            {
              key: 'act',
              header: '',
              width: '70px',
              render: (p) => (
                <div className="pl-row-actions">
                  <button type="button" className="pl-icon-btn" aria-label={`Edit ${p.name}`} onClick={() => openEdit(p)}>
                    <i className="fa-solid fa-pen" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={modal.open} title={modal.editing ? `Edit ${modal.editing.name}` : 'Add product'} onClose={() => setModal({ open: false, editing: null })}>
        <form onSubmit={submit}>
          <Field label="Product name">
            <input className="pl-input" required maxLength={160} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Barcode" hint="Scan it in the POS to add to cart instantly">
            <input className="pl-input" maxLength={60} value={form.barcode} onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))} placeholder="Scan or type…" />
          </Field>
          <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.9rem', fontWeight: 600, cursor: 'pointer' }}>
              <input type="checkbox" checked={form.sell_by_pill} onChange={(e) => setForm((f) => ({ ...f, sell_by_pill: e.target.checked }))} />
              Sell by pill / tablet
            </label>
            <p style={{ color: 'var(--text-dim)', fontSize: '.8rem', margin: '6px 0 12px' }}>
              Lets cashiers sell loose pills out of a pack. Stock is counted in pills, and packs are broken automatically when needed.
            </p>
            {form.sell_by_pill && (
              <div className="pl-grid-2">
                <Field label={`Pills per ${form.unit || 'unit'}`} hint="e.g. 30 pills per pack">
                  <input className="pl-input" type="number" min="1" required value={form.pills_per_unit} onChange={(e) => setForm((f) => ({ ...f, pills_per_unit: e.target.value }))} />
                </Field>
                <Field label="Price per pill (ETB)" hint={`From ${form.sell_price || 0} ÷ ${form.pills_per_unit || 1}`}>
                  <input className="pl-input" value={((Number(form.sell_price) || 0) / Math.max(1, Number(form.pills_per_unit) || 1)).toFixed(2)} readOnly disabled />
                </Field>
              </div>
            )}
          </div>
          <Field label="Default margin %" hint="Preselected margin in the POS — price = cost × (1 + margin)">
            <input className="pl-input" type="number" min="0" step="0.5" value={form.default_margin} onChange={(e) => setForm((f) => ({ ...f, default_margin: e.target.value }))} />
          </Field>
          <div className="pl-grid-2">
            <Field label="Category">
              <input className="pl-input" placeholder="e.g. Groceries" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
            </Field>
            <Field label="Unit">
              <input className="pl-input" placeholder="pcs / box / kg" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Sell price (ETB)">
              <input className="pl-input" type="number" min="0" step="0.01" required value={form.sell_price} onChange={(e) => setForm((f) => ({ ...f, sell_price: e.target.value }))} />
            </Field>
            <Field label="Cost price (ETB)">
              <input className="pl-input" type="number" min="0" step="0.01" value={form.cost_price} onChange={(e) => setForm((f) => ({ ...f, cost_price: e.target.value }))} />
            </Field>
          </div>
          <Field label="Low stock alert threshold" hint="We warn you when total stock drops to this level">
            <input className="pl-input" type="number" min="0" value={form.low_stock_threshold} onChange={(e) => setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : modal.editing ? 'Save changes' : 'Add product'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
