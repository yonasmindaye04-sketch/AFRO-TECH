import { useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, DataTable, EmptyState, ErrorBox, Field, Modal, OkBox, PageHeader, Spinner, StatCard } from '../ui'
import { computeMonthlyDepreciation, evaluateBom } from '../utils/erpEngine'

interface ProductOpt {
  id: string
  name: string
  stock: number
  cost_price: string
}

interface BomComponent {
  product_id: string
  product_name: string
  qty_per_unit: number
  unit_cost: number
}

interface Bom {
  id: string
  code: string
  name: string
  output_product_id: string
  output_product_name: string
  output_qty: number
  components: BomComponent[]
  notes: string | null
  created_at: string
}

interface WorkOrder {
  id: string
  number: string
  bom_id: string
  bom_name: string
  output_product_id: string
  output_product_name: string
  qty_to_produce: number
  estimated_cost: number
  status: 'planned' | 'completed'
  due_date: string
  created_at: string
}

interface FixedAsset {
  id: string
  code: string
  name: string
  category: string
  location: string
  purchase_date: string
  purchase_cost: number
  salvage_value: number
  useful_life_months: number
  accumulated_depreciation: number
  status: 'active' | 'fully_depreciated'
}

type Tab = 'work-orders' | 'boms' | 'assets'

export default function Manufacturing(): JSX.Element {
  const [tab, setTab] = useState<Tab>('work-orders')
  const [notice, setNotice] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const bomsQ = useApiData<{ boms: Bom[]; products: ProductOpt[] }>('/erp/boms')
  const woQ = useApiData<{ work_orders: WorkOrder[] }>('/erp/work-orders')
  const assetsQ = useApiData<{ assets: FixedAsset[] }>('/erp/assets')

  const [openWo, setOpenWo] = useState(false)
  const [woForm, setWoForm] = useState(() => ({
    bom_id: '',
    qty_to_produce: '1',
    due_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
  }))

  const [openBom, setOpenBom] = useState(false)
  const [bomForm, setBomForm] = useState({ name: '', output_product_id: '', output_qty: '1', raw_product_id: '', raw_qty: '1', notes: '' })

  const [openAsset, setOpenAsset] = useState(false)
  const [assetForm, setAssetForm] = useState({ name: '', category: 'Equipment', location: 'Main Branch', purchase_cost: '', salvage_value: '0', useful_life_months: '36' })

  const boms = bomsQ.data?.boms ?? []
  const products = bomsQ.data?.products ?? []
  const workOrders = woQ.data?.work_orders ?? []
  const assets = assetsQ.data?.assets ?? []

  const plannedWoCount = workOrders.filter((w) => w.status === 'planned').length
  const totalAssetNbv = assets.reduce((s, a) => s + Math.max(0, Number(a.purchase_cost) - Number(a.accumulated_depreciation)), 0)

  const productById = (id: string) => products.find((p) => p.id === id)

  const bomEval = (b: Bom) =>
    evaluateBom(
      (b.components ?? []).map((c) => ({
        product_id: c.product_id,
        qty_per_unit: c.qty_per_unit,
        unit_cost: Number(productById(c.product_id)?.cost_price ?? c.unit_cost ?? 0),
        available_stock: Number(productById(c.product_id)?.stock ?? 0),
      }))
    )

  const reloadAll = (): void => {
    bomsQ.reload()
    woQ.reload()
    assetsQ.reload()
  }

  const submitWo = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErrMsg(null)
    try {
      await api.post('/erp/work-orders', {
        bom_id: woForm.bom_id || boms[0]?.id,
        qty_to_produce: Number(woForm.qty_to_produce) || 1,
        due_date: woForm.due_date,
      })
      setNotice('Production Work Order planned.')
      setOpenWo(false)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not create work order')
    } finally {
      setBusy(false)
    }
  }

  const completeWo = async (wo: WorkOrder): Promise<void> => {
    setErrMsg(null)
    try {
      await api.post(`/erp/work-orders/${wo.id}/complete`, {})
      setNotice(`${wo.number} completed — raw materials consumed and finished units added to Stock Ledger.`)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to complete work order')
    }
  }

  const submitBom = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErrMsg(null)
    try {
      await api.post('/erp/boms', {
        name: bomForm.name.trim(),
        output_product_id: bomForm.output_product_id,
        output_qty: Number(bomForm.output_qty) || 1,
        notes: bomForm.notes.trim() || null,
        components: [{ product_id: bomForm.raw_product_id, qty_per_unit: Number(bomForm.raw_qty) || 1 }],
      })
      setNotice('Bill of Materials created.')
      setOpenBom(false)
      setBomForm({ name: '', output_product_id: '', output_qty: '1', raw_product_id: '', raw_qty: '1', notes: '' })
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not save BOM')
    } finally {
      setBusy(false)
    }
  }

  const submitAsset = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setErrMsg(null)
    try {
      await api.post('/erp/assets', {
        name: assetForm.name.trim(),
        category: assetForm.category.trim(),
        location: assetForm.location.trim(),
        purchase_cost: Number(assetForm.purchase_cost) || 0,
        salvage_value: Number(assetForm.salvage_value) || 0,
        useful_life_months: Number(assetForm.useful_life_months) || 36,
      })
      setNotice('Fixed Asset capitalized and posted to General Ledger.')
      setOpenAsset(false)
      setAssetForm({ name: '', category: 'Equipment', location: 'Main Branch', purchase_cost: '', salvage_value: '0', useful_life_months: '36' })
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not capitalize asset')
    } finally {
      setBusy(false)
    }
  }

  const depreciateAsset = async (asset: FixedAsset): Promise<void> => {
    setErrMsg(null)
    try {
      const res = await api.post<{ posted_amount: number }>(`/erp/assets/${asset.id}/depreciate`, {})
      setNotice(`Posted ${fmtMoney(res.posted_amount)} ETB monthly depreciation for ${asset.name} to General Ledger.`)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Depreciation failed')
    }
  }

  return (
    <div>
      <PageHeader
        title="Manufacturing & Fixed Assets"
        subtitle="Bill of Materials, production Work Orders, and capitalized asset depreciation schedules"
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="sub-tabs">
              <button type="button" className={`sub-tab ${tab === 'work-orders' ? 'sub-tab-active' : ''}`} onClick={() => setTab('work-orders')}>
                Work Orders ({workOrders.length})
              </button>
              <button type="button" className={`sub-tab ${tab === 'boms' ? 'sub-tab-active' : ''}`} onClick={() => setTab('boms')}>
                BOMs ({boms.length})
              </button>
              <button type="button" className={`sub-tab ${tab === 'assets' ? 'sub-tab-active' : ''}`} onClick={() => setTab('assets')}>
                Fixed Assets ({assets.length})
              </button>
            </div>
            {tab === 'work-orders' && (
              <button type="button" className="pl-btn pl-btn-primary" onClick={() => { setWoForm((f) => ({ ...f, bom_id: boms[0]?.id || '' })); setOpenWo(true) }}>
                <i className="fa-solid fa-industry" aria-hidden="true" /> New Work Order
              </button>
            )}
            {tab === 'boms' && (
              <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpenBom(true)}>
                <i className="fa-solid fa-diagram-project" aria-hidden="true" /> New BOM
              </button>
            )}
            {tab === 'assets' && (
              <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpenAsset(true)}>
                <i className="fa-solid fa-building-columns" aria-hidden="true" /> Capitalize Asset
              </button>
            )}
          </div>
        }
      />

      <div className="pl-stats">
        <StatCard icon="fa-solid fa-diagram-project" label="Active BOMs" value={boms.length} />
        <StatCard icon="fa-solid fa-gears" label="Planned Work Orders" value={plannedWoCount} />
        <StatCard icon="fa-solid fa-laptop-medical" label="Fixed Assets" value={assets.length} />
        <StatCard icon="fa-solid fa-coins" label="Net Asset Book Value" value={`${fmtMoney(totalAssetNbv)} ETB`} />
      </div>

      {notice && <OkBox message={notice} />}
      {errMsg && <ErrorBox message={errMsg} />}

      {tab === 'work-orders' && (
        woQ.loading ? (
          <Spinner />
        ) : !workOrders.length ? (
          <EmptyState icon="fa-solid fa-industry" title="No work orders yet" hint="Create a Work Order from a Bill of Materials to assemble or compound items." />
        ) : (
          <DataTable
            rows={workOrders}
            searchPlaceholder="Search work orders…"
            columns={[
              { key: 'number', header: 'WO #', render: (w) => <strong>{w.number}</strong>, width: '110px' },
              { key: 'bom_name', header: 'BOM / Recipe', render: (w) => w.bom_name },
              { key: 'output_product_name', header: 'Output Item', render: (w) => w.output_product_name },
              { key: 'qty_to_produce', header: 'Qty', render: (w) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{w.qty_to_produce}</span>, width: '75px' },
              { key: 'estimated_cost', header: 'Est. Material Cost', render: (w) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(w.estimated_cost)} ETB</span> },
              { key: 'due_date', header: 'Due Date', render: (w) => fmtDate(w.due_date), width: '115px' },
              {
                key: 'status',
                header: 'Status',
                render: (w) => <Badge tone={w.status === 'completed' ? 'good' : 'warn'}>{w.status.toUpperCase()}</Badge>,
                width: '115px',
              },
              {
                key: 'act',
                header: '',
                width: '175px',
                render: (w) =>
                  w.status !== 'completed' ? (
                    <div className="pl-row-actions">
                      <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => completeWo(w)}>
                        Complete Production
                      </button>
                    </div>
                  ) : null,
              },
            ]}
          />
        )
      )}

      {tab === 'boms' && (
        bomsQ.loading ? (
          <Spinner />
        ) : !boms.length ? (
          <EmptyState icon="fa-solid fa-diagram-project" title="No Bills of Materials yet" />
        ) : (
          <div className="pl-grid-2">
            {boms.map((b) => {
              const metrics = bomEval(b)
              return (
                <Card key={b.id}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                      <h2 style={{ marginBottom: 2 }}>{b.name}</h2>
                      <small style={{ color: 'var(--text-dim)' }}>{b.code} → Produces {b.output_qty} × {b.output_product_name}</small>
                    </div>
                    <Badge tone={metrics.maxBuildableUnits > 0 ? 'good' : 'warn'}>
                      {metrics.maxBuildableUnits} buildable
                    </Badge>
                  </div>
                  <div className="pl-table-wrap" style={{ marginBottom: 12 }}>
                    <table className="pl-table" style={{ minWidth: 0 }}>
                      <thead>
                        <tr>
                          <th>Raw Material</th>
                          <th className="num">Req / Unit</th>
                          <th className="num">In Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {b.components.map((c) => (
                          <tr key={c.product_id}>
                            <td>{c.product_name}</td>
                            <td className="num">{c.qty_per_unit}</td>
                            <td className="num">{productById(c.product_id)?.stock ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ color: 'var(--text-dim)', fontSize: '.86rem' }}>
                      Est. Cost / Unit: <strong style={{ color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(metrics.unitMaterialCost)} ETB</strong>
                    </span>
                    <button
                      type="button"
                      className="pl-btn pl-btn-ghost pl-btn-sm"
                      onClick={() => {
                        setWoForm({ bom_id: b.id, qty_to_produce: '1', due_date: new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10) })
                        setOpenWo(true)
                      }}
                    >
                      Create Work Order
                    </button>
                  </div>
                </Card>
              )
            })}
          </div>
        )
      )}

      {tab === 'assets' && (
        assetsQ.loading ? (
          <Spinner />
        ) : !assets.length ? (
          <EmptyState icon="fa-solid fa-building-columns" title="No fixed assets registered" hint="Capitalize medical equipment, POS hardware, lab tools, or vehicles to track depreciation." />
        ) : (
          <DataTable
            rows={assets}
            searchPlaceholder="Search fixed assets…"
            columns={[
              { key: 'code', header: 'Asset #', render: (a) => <strong>{a.code}</strong>, width: '105px' },
              {
                key: 'name',
                header: 'Asset',
                render: (a) => (
                  <div>
                    <strong>{a.name}</strong>
                    <small style={{ display: 'block', color: 'var(--text-dim)' }}>{a.category} · {a.location}</small>
                  </div>
                ),
              },
              { key: 'purchase_cost', header: 'Cost', render: (a) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(a.purchase_cost)} ETB</span> },
              { key: 'accumulated_depreciation', header: 'Depreciated', render: (a) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(a.accumulated_depreciation)} ETB</span> },
              {
                key: 'nbv',
                header: 'Net Book Value',
                render: (a) => {
                  const calc = computeMonthlyDepreciation(a)
                  return (
                    <div>
                      <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(Math.max(0, a.purchase_cost - a.accumulated_depreciation))} ETB</strong>
                      {!calc.isFullyDepreciated && (
                        <small style={{ display: 'block', color: 'var(--text-dim)' }}>~{fmtMoney(calc.monthlyAmount)}/mo</small>
                      )}
                    </div>
                  )
                },
              },
              {
                key: 'status',
                header: 'Status',
                render: (a) => <Badge tone={a.status === 'active' ? 'good' : 'neutral'}>{a.status === 'active' ? 'ACTIVE' : 'DEPRECIATED'}</Badge>,
                width: '125px',
              },
              {
                key: 'act',
                header: '',
                width: '160px',
                render: (a) =>
                  a.status === 'active' ? (
                    <div className="pl-row-actions">
                      <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => depreciateAsset(a)}>
                        Post Depreciation
                      </button>
                    </div>
                  ) : null,
              },
            ]}
          />
        )
      )}

      <Modal open={openWo} title="New Production Work Order" onClose={() => setOpenWo(false)}>
        <form onSubmit={submitWo}>
          <Field label="Bill of Materials (BOM)">
            <select className="pl-select" required value={woForm.bom_id} onChange={(e) => setWoForm((f) => ({ ...f, bom_id: e.target.value }))}>
              <option value="">Select BOM…</option>
              {boms.map((b) => (
                <option key={b.id} value={b.id}>{b.code} — {b.name}</option>
              ))}
            </select>
          </Field>
          <div className="pl-grid-2">
            <Field label="Quantity to Produce">
              <input className="pl-input" type="number" min="1" required value={woForm.qty_to_produce} onChange={(e) => setWoForm((f) => ({ ...f, qty_to_produce: e.target.value }))} />
            </Field>
            <Field label="Target Due Date">
              <input className="pl-input" type="date" required value={woForm.due_date} onChange={(e) => setWoForm((f) => ({ ...f, due_date: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Create Work Order'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={openBom} title="Create Bill of Materials (BOM)" onClose={() => setOpenBom(false)}>
        <form onSubmit={submitBom}>
          <Field label="BOM Title">
            <input className="pl-input" required placeholder="e.g. Pediatric Starter Kit" value={bomForm.name} onChange={(e) => setBomForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="pl-grid-2">
            <Field label="Finished Product">
              <select className="pl-select" required value={bomForm.output_product_id} onChange={(e) => setBomForm((f) => ({ ...f, output_product_id: e.target.value }))}>
                <option value="">Select output item…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </Field>
            <Field label="Output Qty">
              <input className="pl-input" type="number" min="1" required value={bomForm.output_qty} onChange={(e) => setBomForm((f) => ({ ...f, output_qty: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Component / Raw Material">
              <select className="pl-select" required value={bomForm.raw_product_id} onChange={(e) => setBomForm((f) => ({ ...f, raw_product_id: e.target.value }))}>
                <option value="">Select ingredient…</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name} (Stock: {p.stock})</option>
                ))}
              </select>
            </Field>
            <Field label="Qty Required / Unit">
              <input className="pl-input" type="number" min="0.1" step="0.1" required value={bomForm.raw_qty} onChange={(e) => setBomForm((f) => ({ ...f, raw_qty: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save BOM'}</button>
          </div>
        </form>
      </Modal>

      <Modal open={openAsset} title="Capitalize Fixed Asset" onClose={() => setOpenAsset(false)}>
        <form onSubmit={submitAsset}>
          <Field label="Asset Name">
            <input className="pl-input" required placeholder="e.g. Ultrasound Scanner or Delivery Van" value={assetForm.name} onChange={(e) => setAssetForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="pl-grid-2">
            <Field label="Category">
              <select className="pl-select" value={assetForm.category} onChange={(e) => setAssetForm((f) => ({ ...f, category: e.target.value }))}>
                <option value="Equipment">Equipment</option>
                <option value="Hardware & IT">Hardware & IT</option>
                <option value="Vehicles">Vehicles</option>
                <option value="Furniture">Furniture</option>
              </select>
            </Field>
            <Field label="Location">
              <input className="pl-input" value={assetForm.location} onChange={(e) => setAssetForm((f) => ({ ...f, location: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-3">
            <Field label="Purchase Cost (ETB)">
              <input className="pl-input" type="number" min="1" required value={assetForm.purchase_cost} onChange={(e) => setAssetForm((f) => ({ ...f, purchase_cost: e.target.value }))} />
            </Field>
            <Field label="Salvage Value">
              <input className="pl-input" type="number" min="0" value={assetForm.salvage_value} onChange={(e) => setAssetForm((f) => ({ ...f, salvage_value: e.target.value }))} />
            </Field>
            <Field label="Useful Life (Months)">
              <input className="pl-input" type="number" min="1" required value={assetForm.useful_life_months} onChange={(e) => setAssetForm((f) => ({ ...f, useful_life_months: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Capitalize Asset'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
