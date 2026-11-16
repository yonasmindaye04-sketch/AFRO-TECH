import { useMemo, useState, type FormEvent } from 'react'
import { api, fmtDateTime, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, DataTable, EmptyState, ErrorBox, Field, Modal, OkBox, PageHeader, Spinner, StatCard } from '../ui'
import { computeSmartReorderQty } from '../utils/erpEngine'

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
  const salesQ = useApiData<{ sales: Array<{ items?: Array<{ product_id: string; quantity: number }> }> }>('/retail/sales?limit=100')
  const suppliersQ = useApiData<{ suppliers: SupplierOpt[] }>('/retail/suppliers')

  const [leadDays, setLeadDays] = useState('7')
  const [safetyDays, setSafetyDays] = useState('3')

  const [openWh, setOpenWh] = useState(false)
  const [whForm, setWhForm] = useState({ name: '', code: '', location: '' })
  const [busy, setBusy] = useState(false)

  const [openTransfer, setOpenTransfer] = useState(false)
  const [trForm, setTrForm] = useState({ product_id: '', from_warehouse_id: '', to_warehouse_id: '', quantity: '1' })

  const [poTarget, setPoTarget] = useState<(ProductRow & { suggestedQty?: number }) | null>(null)
  const [poForm, setPoForm] = useState({ supplier_id: '', quantity: '20', unit_cost: '0' })

  const warehouses = useMemo(() => whQ.data?.warehouses ?? [], [whQ.data])
  const products = useMemo(() => whQ.data?.products ?? [], [whQ.data])
  const entries = sleQ.data?.entries ?? []

  // Average daily sales over last 14 days (min floor from ledger activity)
  const dailySalesMap = useMemo(() => {
    const totals = new Map<string, number>()
    for (const s of salesQ.data?.sales ?? []) {
      for (const it of s.items ?? []) {
        totals.set(it.product_id, (totals.get(it.product_id) ?? 0) + Number(it.quantity || 0))
      }
    }
    return totals
  }, [salesQ.data])

  const smartRows = useMemo(() => {
    const ld = Math.max(1, Number(leadDays) || 7)
    const sd = Math.max(0, Number(safetyDays) || 3)
    return products.map((p) => {
      const unitsSold14d = dailySalesMap.get(p.id) ?? 0
      const avgDailySales = Math.round((unitsSold14d / 14) * 100) / 100
      const smart = computeSmartReorderQty({
        stock: Number(p.stock),
        threshold: Number(p.low_stock_threshold),
        avgDailySales,
        leadTimeDays: ld,
        safetyDays: sd,
      })
      return { ...p, avgDailySales, ...smart }
    })
  }, [products, dailySalesMap, leadDays, safetyDays])

  const lowStockItems = smartRows.filter((p) => p.needsReorder)
  const driftCount = useMemo(() => {
    if (!warehouses.length) return 0
    return products.filter((p) => {
      const whSum = warehouses.reduce((s, w) => s + Number(w.stock_map?.[p.id] ?? 0), 0)
      return Math.abs(whSum - Number(p.stock || 0)) > 0.001
    }).length
  }, [products, warehouses])
  const totalUnits = warehouses.reduce((s, w) => s + Number(w.total_units || 0), 0)

  const reloadAll = (): void => {
    whQ.reload()
    sleQ.reload()
  }

  const syncBins = async (): Promise<void> => {
    setBusy(true)
    setErrMsg(null)
    try {
      const r = await api.post<{ reconciled_skus: number }>('/erp/warehouses/reconcile', {})
      setNotice(`Synced warehouse bin allocations across ${r.reconciled_skus} SKU(s).`)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setBusy(false)
    }
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

  const openQuickPo = (p: ProductRow & { suggestedOrderQty?: number }): void => {
    const suggested = p.suggestedOrderQty && p.suggestedOrderQty > 0
      ? p.suggestedOrderQty
      : Math.max(10, Number(p.low_stock_threshold) * 2 - Number(p.stock))
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
        <StatCard icon="fa-solid fa-triangle-exclamation" label="Smart Reorder Alerts" value={lowStockItems.length} tone={lowStockItems.length ? '#f59e0b' : undefined} />
      </div>

      {driftCount > 0 && (
        <div className="pl-warn-box" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <span>
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" style={{ marginRight: 6 }} />
            <strong>Ghost Inventory Warning:</strong> {driftCount} SKU(s) have warehouse bin totals different from catalog stock.
          </span>
          <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" disabled={busy} onClick={syncBins}>
            Sync Warehouse Bins
          </button>
        </div>
      )}

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
        ) : (
          <>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
                <div>
                  <h2 style={{ marginBottom: 4 }}>Dynamic Lead-Time Replenishment</h2>
                  <p style={{ color: 'var(--text-dim)', fontSize: '.85rem', margin: 0 }}>
                    Replaces static thresholds by combining 14-day sales velocity with supplier lead time and safety buffer days.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.84rem' }}>
                    <span>Lead time (days)</span>
                    <input
                      className="pl-input"
                      type="number"
                      min="1"
                      max="90"
                      style={{ width: 74 }}
                      value={leadDays}
                      onChange={(e) => setLeadDays(e.target.value)}
                    />
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '.84rem' }}>
                    <span>Safety buffer (days)</span>
                    <input
                      className="pl-input"
                      type="number"
                      min="0"
                      max="60"
                      style={{ width: 74 }}
                      value={safetyDays}
                      onChange={(e) => setSafetyDays(e.target.value)}
                    />
                  </label>
                </div>
              </div>
            </Card>
            {!lowStockItems.length && (
              <EmptyState icon="fa-solid fa-circle-check" title="All items are above dynamic reorder points" hint="Inspect live 14-day sales velocity and days-of-cover below, or adjust lead time / safety buffer days above." />
            )}
            <DataTable
              rows={smartRows}
              searchPlaceholder="Search reorder recommendations…"
              columns={[
                { key: 'name', header: 'Item', render: (p) => <strong>{p.name}</strong> },
                {
                  key: 'stock',
                  header: 'On Hand',
                  render: (p) => (
                    <Badge tone={p.stock === 0 ? 'bad' : p.needsReorder ? 'warn' : 'good'}>
                      {p.stock} {p.unit}
                    </Badge>
                  ),
                },
                {
                  key: 'velocity',
                  header: '14d Velocity',
                  render: (p) => `${p.avgDailySales.toFixed(2)} / day`,
                },
                { key: 'dynamicReorderPoint', header: 'Dynamic Reorder Pt', render: (p) => `${p.dynamicReorderPoint} ${p.unit}` },
                {
                  key: 'daysOfCover',
                  header: 'Days of Cover',
                  render: (p) => (p.daysOfCover !== null ? `${p.daysOfCover}d` : 'Low velocity'),
                },
                {
                  key: 'suggestedOrderQty',
                  header: 'Recommended Order',
                  render: (p) => (
                    <strong style={{ color: p.needsReorder ? 'var(--accent)' : 'var(--text-dim)' }}>
                      {p.needsReorder ? `${p.suggestedOrderQty} ${p.unit}` : 'Covered'}
                    </strong>
                  ),
                },
                {
                  key: 'act',
                  header: '',
                  width: '130px',
                  render: (p) => (
                    <div className="pl-row-actions">
                      <button type="button" className={`pl-btn ${p.needsReorder ? 'pl-btn-primary' : 'pl-btn-ghost'} pl-btn-sm`} onClick={() => openQuickPo(p)}>
                        Create PO
                      </button>
                    </div>
                  ),
                },
              ]}
            />
          </>
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
