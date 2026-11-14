import { useState, type FormEvent } from 'react'
import { api, fmtDateTime, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, DataTable, EmptyState, ErrorBox, Field, Modal, OkBox, PageHeader, Spinner, StatCard } from '../ui'

interface Warehouse {
  id: string
  name: string
  code: string
  location: string
  is_default: boolean
  stock_map: Record<string, number>
  total_units: number
}

interface ProductRow {
  id: string
  name: string
  category: string
  unit: string
  stock: number
  low_stock_threshold: number
  cost_price: string
}

interface StockLedgerEntry {
  id: string
  posting_date: string
  voucher_type: string
  voucher_no: string
  product_id: string
  product_name: string
  warehouse_id: string
  warehouse_name: string
  batch_no: string | null
  in_qty: number
  out_qty: number
  balance_qty: number
  valuation_rate: number
}

interface SupplierOpt {
  id: string
  name: string
}

type Tab = 'warehouses' | 'ledger' | 'reorder'

export default function Warehouses(): JSX.Element {
  const [tab, setTab] = useState<Tab>('warehouses')
  const [notice, setNotice] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const whQ = useApiData<{ warehouses: Warehouse[]; products: ProductRow[] }>('/erp/warehouses')
  const sleQ = useApiData<{ entries: StockLedgerEntry[] }>('/erp/stock-ledger')
  const suppliersQ = useApiData<{ suppliers: SupplierOpt[] }>('/retail/suppliers')

  const [openWh, setOpenWh] = useState(false)
  const [whForm, setWhForm] = useState({ name: '', code: '', location: '' })
  const [busy, setBusy] = useState(false)

  const [openTransfer, setOpenTransfer] = useState(false)
  const [trForm, setTrForm] = useState({ product_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '1' })

  const [poTarget, setPoTarget] = useState<ProductRow | null>(null)
  const [poForm, setPoForm] = useState({ supplier_id: '', quantity: '20', unit_cost: '0' })

  const warehouses = whQ.data?.warehouses ?? []
  const products = whQ.data?.products ?? []
  const entries = sleQ.data?.entries ?? []
  const lowStockItems = products.filter((p) => Number(p.stock) <= Number(p.low_stock_threshold))
  const totalUnits = warehouses.reduce((s, w) => s + Number(w.total_units || 0), 0)

  const reloadAll = (): void => {
    whQ.reload()
    sleQ.reload()
  }

  const createWarehouse = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErrMsg(null)
    try {
      await api.post('/erp/warehouses', whForm)
      setNotice(`Warehouse "${whForm.name}" created.`)
      setWhForm({ name: '', code: '', location: '' })
      setOpenWh(false)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to add warehouse')
    } finally {
      setBusy(false)
    }
  }

  const submitTransfer = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErrMsg(null)
    try {
      await api.post('/erp/stock-transfers', {
        product_id: trForm.product_id,
        from_warehouse_id: trForm.from_warehouse_id,
        to_warehouse_id: trForm.to_warehouse_id,
        quantity: Number(trForm.quantity),
      })
      setNotice('Stock transfer completed and logged to the Stock Ledger.')
      setOpenTransfer(false)
      setTrForm({ product_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '1' })
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Stock transfer failed')
    } finally {
      setBusy(false)
    }
  }

  const openQuickPo = (p: ProductRow): void => {
    const suggested = Math.max(10, Number(p.low_stock_threshold) * 2 - Number(p.stock))
    setPoForm({
      supplier_id: suppliersQ.data?.suppliers?.[0]?.id || '',
      quantity: String(suggested),
      unit_cost: String(p.cost_price),
    })
    setPoTarget(p)
  }

  const submitQuickPo = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!poTarget) return
    setBusy(true)
    setErrMsg(null)
    try {
      await api.post('/erp/purchase-orders', {
        supplier_id: poForm.supplier_id || null,
        notes: `Auto-reorder for ${poTarget.name}`,
        items: [{ product_id: poTarget.id, quantity: Number(poForm.quantity), unit_cost: Number(poForm.unit_cost) }],
      })
      setNotice(`Purchase Order created for ${poTarget.name}. Review & receive it under Orders & Quotes.`)
      setPoTarget(null)
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not create Purchase Order')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Warehouses & Stock Ledger"
        subtitle="Multi-warehouse locations, internal transfers, immutable SLE audit log and auto-reorder"
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="sub-tabs">
              <button type="button" className={`sub-tab ${tab === 'warehouses' ? 'sub-tab-active' : ''}`} onClick={() => setTab('warehouses')}>
                Warehouses ({warehouses.length})
              </button>
              <button type="button" className={`sub-tab ${tab === 'ledger' ? 'sub-tab-active' : ''}`} onClick={() => setTab('ledger')}>
                Stock Ledger ({entries.length})
              </button>
              <button type="button" className={`sub-tab ${tab === 'reorder' ? 'sub-tab-active' : ''}`} onClick={() => setTab('reorder')}>
                Reorder Alerts ({lowStockItems.length})
              </button>
            </div>
            <button type="button" className="pl-btn pl-btn-ghost" onClick={() => { setErrMsg(null); setOpenTransfer(true) }}>
              <i className="fa-solid fa-right-left" aria-hidden="true" /> Transfer Stock
            </button>
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => { setErrMsg(null); setOpenWh(true) }}>
              <i className="fa-solid fa-warehouse" aria-hidden="true" /> New Warehouse
            </button>
          </div>
        }
      />

      <div className="pl-stats">
        <StatCard icon="fa-solid fa-warehouse" label="Active Warehouses" value={warehouses.length} />
        <StatCard icon="fa-solid fa-cubes" label="Total Stocked Units" value={totalUnits} />
        <StatCard icon="fa-solid fa-book" label="Ledger Vouchers" value={entries.length} />
        <StatCard icon="fa-solid fa-triangle-exclamation" label="Low-Stock Items" value={lowStockItems.length} tone={lowStockItems.length ? '#f59e0b' : undefined} />
      </div>

      {notice && <OkBox message={notice} />}
      {errMsg && <ErrorBox message={errMsg} />}

      {tab === 'warehouses' && (
        whQ.loading ? (
          <Spinner />
        ) : !warehouses.length ? (
          <EmptyState icon="fa-solid fa-warehouse" title="No warehouses configured" />
        ) : (
          <div className="pl-grid-2">
            {warehouses.map((w) => {
              const itemsInWh = products
                .map((p) => ({ product: p, qty: Number(w.stock_map?.[p.id] ?? 0) }))
                .filter((x) => x.qty > 0)
              return (
                <Card key={w.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
                    <div>
                      <h2 style={{ marginBottom: 2 }}>{w.name}</h2>
                      <small style={{ color: 'var(--text-dim)' }}>
                        Code: <strong>{w.code}</strong> · {w.location || 'Unspecified location'}
                      </small>
                    </div>
                    <Badge tone={w.is_default ? 'good' : 'neutral'}>{w.is_default ? 'DEFAULT' : 'BRANCH'}</Badge>
                  </div>
                  <div className="pl-cart-total" style={{ marginBottom: 10 }}>
                    <span style={{ color: 'var(--text-dim)' }}>Total units stored</span>
                    <strong style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--accent)' }}>{w.total_units} units</strong>
                  </div>
                  {itemsInWh.length > 0 ? (
                    <div className="pl-table-wrap">
                      <table className="pl-table" style={{ minWidth: 0 }}>
                        <thead>
                          <tr>
                            <th>Product</th>
                            <th className="num">Qty</th>
                          </tr>
                        </thead>
                        <tbody>
                          {itemsInWh.map(({ product, qty }) => (
                            <tr key={product.id}>
                              <td>{product.name}</td>
                              <td className="num">{qty} {product.unit}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p style={{ color: 'var(--text-dim)', fontSize: '.86rem' }}>No units currently allocated to this warehouse. Use Transfer Stock to move inventory here.</p>
                  )}
                </Card>
              )
            })}
          </div>
        )
      )}

      {tab === 'ledger' && (
        sleQ.loading ? (
          <Spinner />
        ) : !entries.length ? (
          <EmptyState icon="fa-solid fa-book" title="No stock ledger entries yet" />
        ) : (
          <DataTable
            rows={entries}
            searchPlaceholder="Filter stock ledger…"
            columns={[
              { key: 'posting_date', header: 'Posting Time', render: (e) => fmtDateTime(e.posting_date), width: '145px' },
              { key: 'voucher_type', header: 'Voucher Type', render: (e) => e.voucher_type },
              { key: 'voucher_no', header: 'Voucher #', render: (e) => <strong>{e.voucher_no}</strong>, width: '115px' },
              { key: 'product_name', header: 'Item', render: (e) => e.product_name },
              { key: 'warehouse_name', header: 'Warehouse', render: (e) => e.warehouse_name },
              {
                key: 'in_qty',
                header: '+In',
                render: (e) => (e.in_qty > 0 ? <Badge tone="good">+{e.in_qty}</Badge> : '—'),
                width: '75px',
              },
              {
                key: 'out_qty',
                header: '-Out',
                render: (e) => (e.out_qty > 0 ? <Badge tone="bad">-{e.out_qty}</Badge> : '—'),
                width: '75px',
              },
              {
                key: 'balance_qty',
                header: 'Balance',
                render: (e) => <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{e.balance_qty}</strong>,
                width: '85px',
              },
              {
                key: 'valuation_rate',
                header: 'Rate',
                render: (e) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.valuation_rate)} ETB</span>,
                width: '105px',
              },
            ]}
          />
        )
      )}

      {tab === 'reorder' && (
        whQ.loading ? (
          <Spinner />
        ) : !lowStockItems.length ? (
          <EmptyState icon="fa-solid fa-circle-check" title="All items are above reorder levels" hint="Items falling at or below their low-stock threshold appear here for 1-click PO creation." />
        ) : (
          <DataTable
            rows={lowStockItems}
            searchPlaceholder="Search low stock items…"
            columns={[
              { key: 'name', header: 'Item', render: (p) => <strong>{p.name}</strong> },
              { key: 'category', header: 'Category', render: (p) => p.category },
              { key: 'stock', header: 'Current Stock', render: (p) => <Badge tone={p.stock === 0 ? 'bad' : 'warn'}>{p.stock} {p.unit}</Badge> },
              { key: 'low_stock_threshold', header: 'Reorder Level', render: (p) => `${p.low_stock_threshold} ${p.unit}` },
              { key: 'cost_price', header: 'Unit Cost', render: (p) => `${fmtMoney(p.cost_price)} ETB` },
              {
                key: 'act',
                header: '',
                width: '140px',
                render: (p) => (
                  <div className="pl-row-actions">
                    <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => openQuickPo(p)}>
                      Create PO
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )
      )}

      <Modal open={openWh} title="Add Warehouse" onClose={() => setOpenWh(false)}>
        <form onSubmit={createWarehouse}>
          <Field label="Warehouse Name">
            <input className="pl-input" required placeholder="e.g. Bole Branch Store" value={whForm.name} onChange={(e) => setWhForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="pl-grid-2">
            <Field label="Short Code">
              <input className="pl-input" required maxLength={12} placeholder="e.g. BOLE" value={whForm.code} onChange={(e) => setWhForm((f) => ({ ...f, code: e.target.value }))} />
            </Field>
            <Field label="Location">
              <input className="pl-input" placeholder="Floor / address" value={whForm.location} onChange={(e) => setWhForm((f) => ({ ...f, location: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Warehouse'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={openTransfer} title="Transfer Stock Between Warehouses" onClose={() => setOpenTransfer(false)}>
        <form onSubmit={submitTransfer}>
          <Field label="Product">
            <select className="pl-select" required value={trForm.product_id} onChange={(e) => setTrForm((f) => ({ ...f, product_id: e.target.value }))}>
              <option value="">Select item…</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>{p.name} (Total: {p.stock})</option>
              ))}
            </select>
          </Field>
          <div className="pl-grid-2">
            <Field label="Source Warehouse">
              <select className="pl-select" required value={trForm.from_warehouse_id} onChange={(e) => setTrForm((f) => ({ ...f, from_warehouse_id: e.target.value }))}>
                <option value="">From…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} {trForm.product_id ? `(${w.stock_map?.[trForm.product_id] ?? 0})` : ''}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Target Warehouse">
              <select className="pl-select" required value={trForm.to_warehouse_id} onChange={(e) => setTrForm((f) => ({ ...f, to_warehouse_id: e.target.value }))}>
                <option value="">To…</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Quantity to Transfer">
            <input className="pl-input" type="number" min="1" required value={trForm.quantity} onChange={(e) => setTrForm((f) => ({ ...f, quantity: e.target.value }))} />
          </Field>
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>{busy ? 'Transferring…' : 'Post Transfer'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={poTarget !== null} title={poTarget ? `Reorder ${poTarget.name}` : 'Reorder'} onClose={() => setPoTarget(null)}>
        {poTarget && (
          <form onSubmit={submitQuickPo}>
            <Field label="Supplier">
              <select className="pl-select" value={poForm.supplier_id} onChange={(e) => setPoForm((f) => ({ ...f, supplier_id: e.target.value }))}>
                <option value="">Select supplier…</option>
                {(suppliersQ.data?.suppliers ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </Field>
            <div className="pl-grid-2">
              <Field label="Order Quantity">
                <input className="pl-input" type="number" min="1" required value={poForm.quantity} onChange={(e) => setPoForm((f) => ({ ...f, quantity: e.target.value }))} />
              </Field>
              <Field label="Unit Cost (ETB)">
                <input className="pl-input" type="number" min="0" step="0.01" required value={poForm.unit_cost} onChange={(e) => setPoForm((f) => ({ ...f, unit_cost: e.target.value }))} />
              </Field>
            </div>
            <div className="pl-form-actions">
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create Purchase Order'}</button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
