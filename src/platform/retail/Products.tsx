import { useMemo, useState, type FormEvent } from 'react'
import { api, triggerNotificationsRefresh } from '../api'
import { useAuth } from '../AuthContext'
import { useApiData } from '../hooks/useApiData'
import {
  DEFAULT_LOW_STOCK_THRESHOLD,
  buildLowStockSignature,
  collectLowStockSummary,
  evaluateProductStock,
  normalizeThreshold,
  type LowStockMode,
} from '../utils/lowStockMonitor'
import { Badge, DataTable, Field, Modal, PageHeader, Spinner } from '../ui'
import BarcodeLabelModal, { type LabelProduct } from '../ui/BarcodeLabelModal'
import BarcodeScanner from '../ui/BarcodeScanner'
import BarcodeScannerDiagnostics from '../ui/BarcodeScannerDiagnostics'
import { CustomFieldsInputs } from '../components/CustomFieldsInputs'

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
  custom_values?: Record<string, string>
}

interface TenantSettings {
  low_stock_threshold?: number
  low_stock_mode?: LowStockMode
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
  initial_stock: string
}

const EMPTY: FormState = {
  name: '',
  category: '',
  unit: 'pcs',
  sell_price: '',
  cost_price: '',
  low_stock_threshold: '10',
  barcode: '',
  sell_by_pill: false,
  pills_per_unit: '1',
  default_margin: '25',
  initial_stock: '0',
}

export default function Products(): JSX.Element {
  const { me } = useAuth()
  const isPharmacy = me?.tenant?.business_type === 'pharmacy'

  const { data, loading, reload } = useApiData<{ products: Product[] }>('/retail/products')
  const settingsQ = useApiData<{ settings: TenantSettings }>('/tenant/settings')

  const [modal, setModal] = useState<{ open: boolean; editing: Product | null }>({ open: false, editing: null })
  const [form, setForm] = useState<FormState>(EMPTY)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const [showDiagnostics, setShowDiagnostics] = useState(false)
  const [labelProduct, setLabelProduct] = useState<LabelProduct | null>(null)
  const [customValues, setCustomValues] = useState<Record<string, string>>({})

  const [thresholdInput, setThresholdInput] = useState<string | null>(null)
  const [modeOverride, setModeOverride] = useState<LowStockMode | null>(null)
  const [thresholdSaving, setThresholdSaving] = useState(false)
  const [thresholdMsg, setThresholdMsg] = useState<string | null>(null)
  const [lowStockOnly, setLowStockOnly] = useState(false)
  const [dismissedSig, setDismissedSig] = useState<string | null>(null)

  const serverThreshold = normalizeThreshold(settingsQ.data?.settings?.low_stock_threshold, DEFAULT_LOW_STOCK_THRESHOLD)
  const serverMode: LowStockMode = settingsQ.data?.settings?.low_stock_mode === 'per_product' ? 'per_product' : 'global'

  const activeThreshold =
    thresholdInput !== null ? normalizeThreshold(thresholdInput, serverThreshold) : serverThreshold
  const activeMode: LowStockMode = modeOverride ?? serverMode
  const displayedThresholdValue = thresholdInput !== null ? thresholdInput : String(serverThreshold)

  const rows = useMemo(() => data?.products ?? [], [data?.products])
  const summary = useMemo(
    () => collectLowStockSummary(rows, activeThreshold, activeMode),
    [rows, activeThreshold, activeMode]
  )
  const alertSignature = useMemo(() => buildLowStockSignature(summary), [summary])
  const showBanner = summary.alertCount > 0 && dismissedSig !== alertSignature

  const filteredRows = useMemo(() => {
    if (!lowStockOnly) return rows
    return rows.filter((p) => evaluateProductStock(p, activeThreshold, activeMode).isBelowThreshold)
  }, [rows, lowStockOnly, activeThreshold, activeMode])

  const persistThresholdSettings = async (nextThreshold: number, nextMode: LowStockMode): Promise<void> => {
    setThresholdSaving(true)
    setThresholdMsg(null)
    try {
      await api.put('/tenant/settings', {
        low_stock_threshold: nextThreshold,
        low_stock_mode: nextMode,
      })
      await settingsQ.reload()
      setThresholdInput(null)
      setModeOverride(null)
      setDismissedSig(null)
      setThresholdMsg(
        nextMode === 'global'
          ? `Saved · Alerting when stock < ${nextThreshold}`
          : `Saved · Per-product thresholds active (default < ${nextThreshold})`
      )
      triggerNotificationsRefresh()
    } catch (err) {
      setThresholdMsg(err instanceof Error ? err.message : 'Failed to save threshold')
    } finally {
      setThresholdSaving(false)
    }
  }

  const handleThresholdSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const clean = normalizeThreshold(displayedThresholdValue, serverThreshold)
    await persistThresholdSettings(clean, activeMode)
  }

  const handleModeChange = async (nextMode: LowStockMode): Promise<void> => {
    setModeOverride(nextMode)
    const clean = normalizeThreshold(displayedThresholdValue, serverThreshold)
    await persistThresholdSettings(clean, nextMode)
  }

  const openNew = (): void => {
    setForm({ ...EMPTY, low_stock_threshold: String(activeThreshold) })
    setCustomValues({})
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
      initial_stock: String(p.stock ?? 0),
    })
    setCustomValues(p.custom_values ?? {})
    setError(null)
    setModal({ open: true, editing: p })
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const nextStock = Math.max(0, Number(form.initial_stock) || 0)
    const body = {
      name: form.name.trim(),
      category: form.category.trim() || 'General',
      unit: form.unit.trim() || 'pcs',
      sell_price: Number(form.sell_price) || 0,
      cost_price: Number(form.cost_price) || 0,
      low_stock_threshold: Math.max(0, Number(form.low_stock_threshold) || 0),
      barcode: form.barcode.trim() || null,
      sell_by_pill: isPharmacy ? form.sell_by_pill : false,
      pills_per_unit: isPharmacy && form.sell_by_pill ? Math.max(1, Number(form.pills_per_unit) || 1) : 1,
      default_margin: Number(form.default_margin) || 25,
      stock: nextStock,
      initial_stock: nextStock,
      custom_values: customValues,
    }
    try {
      if (modal.editing) await api.patch(`/retail/products/${modal.editing.id}`, body)
      else await api.post('/retail/products', body)
      setModal({ open: false, editing: null })
      reload()
      triggerNotificationsRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="Inventory Management — automated low stock monitoring & catalog control"
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className={`pl-btn ${showDiagnostics ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
              onClick={() => setShowDiagnostics((v) => !v)}
            >
              <i className="fa-solid fa-camera-retro" aria-hidden="true" />{' '}
              {showDiagnostics ? 'Hide Scanner Diagnostics' : 'Scanner Diagnostics'}
            </button>
            <button type="button" className="pl-btn pl-btn-primary" onClick={openNew}>
              <i className="fa-solid fa-plus" aria-hidden="true" /> Add product
            </button>
          </div>
        }
      />

      {showDiagnostics && (
        <BarcodeScannerDiagnostics onClose={() => setShowDiagnostics(false)} />
      )}

      {/* User-defined low stock threshold control & live inventory summary */}
      <section className="pl-inv-monitor-bar" aria-label="Low stock threshold monitor">
        <form className="pl-inv-threshold-form" onSubmit={handleThresholdSubmit}>
          <label className="pl-inv-threshold-label" htmlFor="inventory-threshold-input">
            <i className="fa-solid fa-sliders" aria-hidden="true" />
            <span>Low stock threshold</span>
          </label>
          <div className="pl-inv-threshold-controls">
            <input
              id="inventory-threshold-input"
              data-testid="low-stock-threshold-input"
              className="pl-input pl-inv-threshold-input"
              type="number"
              min={0}
              max={100000}
              step={1}
              value={displayedThresholdValue}
              onChange={(e) => {
                setThresholdInput(e.target.value)
                setThresholdMsg(null)
              }}
              aria-label="User-defined low stock threshold"
            />
            <select
              className="pl-select pl-inv-mode-select"
              value={activeMode}
              onChange={(e) => void handleModeChange(e.target.value === 'per_product' ? 'per_product' : 'global')}
              aria-label="Threshold evaluation mode"
              data-testid="low-stock-mode-select"
            >
              <option value="global">Apply to all products</option>
              <option value="per_product">Per-product overrides</option>
            </select>
            <button
              type="submit"
              className="pl-btn pl-btn-primary pl-btn-sm"
              disabled={thresholdSaving}
              data-testid="save-threshold-btn"
            >
              {thresholdSaving ? 'Saving…' : 'Apply threshold'}
            </button>
          </div>
          {thresholdMsg && (
            <span className="pl-inv-threshold-msg" role="status">
              {thresholdMsg}
            </span>
          )}
        </form>

        <div className="pl-inv-summary-group">
          <div className="pl-inv-metric">
            <span className="pl-inv-metric-val">{summary.totalProducts}</span>
            <span className="pl-inv-metric-lbl">Items</span>
          </div>
          <div className={`pl-inv-metric ${summary.lowStockCount > 0 ? 'is-warn' : ''}`}>
            <span className="pl-inv-metric-val" data-testid="low-stock-count">{summary.lowStockCount}</span>
            <span className="pl-inv-metric-lbl">Low stock</span>
          </div>
          <div className={`pl-inv-metric ${summary.outOfStockCount > 0 ? 'is-bad' : ''}`}>
            <span className="pl-inv-metric-val" data-testid="out-of-stock-count">{summary.outOfStockCount}</span>
            <span className="pl-inv-metric-lbl">Out of stock</span>
          </div>
          <button
            type="button"
            className={`pl-btn pl-btn-sm ${lowStockOnly ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
            onClick={() => setLowStockOnly((v) => !v)}
            aria-pressed={lowStockOnly}
            data-testid="filter-low-stock-btn"
          >
            <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
            {lowStockOnly ? `Showing Alerts (${summary.alertCount})` : `Low Stock Only (${summary.alertCount})`}
          </button>
        </div>
      </section>

      {/* Automated Low Stock Notification Banner */}
      {showBanner && (
        <section
          className={`pl-inv-alert-banner ${summary.outOfStockCount > 0 ? 'has-critical' : ''}`}
          role="alert"
          aria-live="polite"
          data-testid="low-stock-notification-banner"
        >
          <div className="pl-inv-alert-head">
            <div className="pl-inv-alert-title-wrap">
              <i
                className={summary.outOfStockCount > 0 ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-triangle-exclamation'}
                aria-hidden="true"
              />
              <div>
                <strong>
                  Automated Low Stock Notification · {summary.alertCount} product{summary.alertCount === 1 ? '' : 's'} below threshold
                </strong>
                <small>
                  {activeMode === 'global'
                    ? `Triggered automatically for quantities strictly below ${activeThreshold} units`
                    : `Triggered automatically using per-product thresholds (default < ${activeThreshold})`}
                </small>
              </div>
            </div>
            <div className="pl-inv-alert-actions">
              <button
                type="button"
                className="pl-btn pl-btn-ghost pl-btn-sm"
                onClick={() => setLowStockOnly((v) => !v)}
              >
                {lowStockOnly ? 'Show full catalog' : 'Filter table'}
              </button>
              <button
                type="button"
                className="pl-icon-btn"
                onClick={() => setDismissedSig(alertSignature)}
                aria-label="Dismiss low stock notification"
                title="Dismiss alert until stock or threshold changes"
              >
                <i className="fa-solid fa-xmark" aria-hidden="true" />
              </button>
            </div>
          </div>

          <ul className="pl-inv-alert-list">
            {summary.alerts.slice(0, 5).map((alert) => {
              const targetProduct = rows.find((p) => p.id === alert.productId)
              return (
                <li key={alert.id} className={`pl-inv-alert-item severity-${alert.severity}`}>
                  <span className="pl-inv-alert-item-name">
                    <i
                      className={alert.severity === 'bad' ? 'fa-solid fa-circle-exclamation' : 'fa-solid fa-triangle-exclamation'}
                      aria-hidden="true"
                    />
                    <strong>{alert.productName}</strong>
                  </span>
                  <span className="pl-inv-alert-item-qty">
                    {alert.quantity} / {alert.threshold} {alert.unit}
                  </span>
                  {targetProduct && (
                    <button
                      type="button"
                      className="pl-inv-alert-restock"
                      onClick={() => openEdit(targetProduct)}
                    >
                      Restock
                    </button>
                  )}
                </li>
              )
            })}
            {summary.alerts.length > 5 && (
              <li className="pl-inv-alert-more">
                +{summary.alerts.length - 5} more below threshold
              </li>
            )}
          </ul>
        </section>
      )}

      {loading ? (
        <Spinner />
      ) : (
        <DataTable
          rows={filteredRows}
          searchPlaceholder="Search products or barcodes…"
          empty={
            lowStockOnly
              ? `No products are currently below the threshold (${activeThreshold} units).`
              : 'No products yet — add your first product or receive stock from a purchase.'
          }
          rowClassName={(p) => {
            const st = evaluateProductStock(p, activeThreshold, activeMode)
            if (st.level === 'out_of_stock') return 'pl-row-out-stock'
            if (st.level === 'low_stock') return 'pl-row-low-stock'
            return undefined
          }}
          columns={[
            {
              key: 'name',
              header: 'Product',
              searchText: (p) => `${p.name} ${p.category} ${p.barcode ?? ''}`,
              render: (p) => (
                <div>
                  <strong>{p.name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>
                    {p.category}
                    {p.barcode ? ` · ${p.barcode}` : ''}
                  </small>
                </div>
              ),
            },
            {
              key: 'price',
              header: 'Sell price',
              render: (p) => <span className="pl-num-cell">{Number(p.sell_price).toFixed(2)} ETB</span>,
            },
            {
              key: 'cost',
              header: 'Cost',
              render: (p) => <span className="pl-num-cell">{Number(p.cost_price).toFixed(2)} ETB</span>,
            },
            {
              key: 'stock',
              header: 'Stock qty',
              render: (p) => {
                const isPill = isPharmacy && p.sell_by_pill
                const status = evaluateProductStock(p, activeThreshold, activeMode)
                const unitLabel = p.unit || 'pcs'
                return (
                  <div>
                    <span className="pl-num-cell" style={{ fontWeight: status.isBelowThreshold ? 700 : 600 }}>
                      {status.quantity} {unitLabel}
                    </span>
                    {isPill && (
                      <small style={{ display: 'block', color: 'var(--text-dim)' }}>
                        {p.display_stock} pills sellable
                      </small>
                    )}
                    {p.expired_qty > 0 && (
                      <small style={{ display: 'block', color: '#e07a7a' }} title="Expired stock cannot be sold — write it off from the Expiry page">
                        +{p.expired_qty} expired (write off)
                      </small>
                    )}
                  </div>
                )
              },
            },
            {
              key: 'threshold',
              header: 'Threshold',
              render: (p) => {
                const status = evaluateProductStock(p, activeThreshold, activeMode)
                return (
                  <span className="pl-num-cell" style={{ color: 'var(--text-dim)' }}>
                    {status.threshold > 0 ? `< ${status.threshold} ${status.unit}` : 'Off'}
                  </span>
                )
              },
            },
            {
              key: 'status',
              header: 'Warning status',
              searchText: (p) => {
                const st = evaluateProductStock(p, activeThreshold, activeMode)
                return st.level === 'out_of_stock'
                  ? 'out of stock warning critical'
                  : st.level === 'low_stock'
                    ? 'low stock warning reorder'
                    : 'in stock healthy'
              },
              render: (p) => {
                const status = evaluateProductStock(p, activeThreshold, activeMode)
                if (status.level === 'out_of_stock') {
                  return (
                    <span className="pl-stock-indicator is-out" data-stock-status="out_of_stock" role="status">
                      <i className="fa-solid fa-circle-exclamation" aria-hidden="true" />
                      <span>
                        <strong>Out of stock</strong>
                        <small>Short {status.deficit} {status.unit}</small>
                      </span>
                    </span>
                  )
                }
                if (status.level === 'low_stock') {
                  return (
                    <span className="pl-stock-indicator is-low" data-stock-status="low_stock" role="status">
                      <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" />
                      <span>
                        <strong>Low stock warning</strong>
                        <small>{status.deficit} {status.unit} below threshold</small>
                      </span>
                    </span>
                  )
                }
                return (
                  <span className="pl-stock-indicator is-ok" data-stock-status="in_stock">
                    <i className="fa-solid fa-circle-check" aria-hidden="true" />
                    <span>In stock</span>
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
              header: 'Actions',
              width: '175px',
              render: (p) => (
                <div className="pl-row-actions">
                  <button
                    type="button"
                    className="pl-btn pl-btn-ghost pl-btn-sm"
                    aria-label={`Print Label for ${p.name}`}
                    title="Generate printable PDF barcode label"
                    onClick={() => setLabelProduct(p)}
                    data-testid={`print-label-${p.id}`}
                  >
                    <i className="fa-solid fa-barcode" aria-hidden="true" />
                    <span>Print Label</span>
                  </button>
                  <button type="button" className="pl-icon-btn" aria-label={`Edit ${p.name}`} title="Edit product & stock" onClick={() => openEdit(p)}>
                    <i className="fa-solid fa-pen" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal wide open={modal.open} title={modal.editing ? `Edit ${modal.editing.name}` : 'Add product'} onClose={() => setModal({ open: false, editing: null })}>
        <form onSubmit={submit}>
          <Field label="Product name">
            <input className="pl-input" required maxLength={160} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Barcode" hint="Scan it in the POS to add to cart instantly">
            <div style={{ display: 'flex', gap: 8 }}>
              <input className="pl-input" maxLength={60} value={form.barcode} onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))} placeholder="Scan or type…" />
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setScannerOpen(true)} aria-label="Scan barcode with camera" title="Scan with camera">
                <i className="fa-solid fa-camera" aria-hidden="true" />
              </button>
            </div>
          </Field>
          {scannerOpen && (
            <BarcodeScanner
              title="Scan product barcode"
              onDetected={(code) => {
                setScannerOpen(false)
                setForm((f) => ({ ...f, barcode: code }))
              }}
              onClose={() => setScannerOpen(false)}
            />
          )}
          {isPharmacy && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, padding: 14, marginBottom: 14 }}>
              <label className="pl-checkbox-label" style={{ fontWeight: 600 }}>
                <input type="checkbox" checked={form.sell_by_pill} onChange={(e) => setForm((f) => ({ ...f, sell_by_pill: e.target.checked }))} />
                <span>Sell by pill / tablet</span>
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
          )}
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
          <div className="pl-grid-2">
            <Field
              label={modal.editing ? `Current stock on hand (${form.unit || 'pcs'})` : `Initial stock (${form.unit || 'pcs'})`}
              hint={modal.editing ? 'Edit to adjust your current in-stock quantity' : 'Opening inventory count — sets in-stock level immediately'}
            >
              <input
                className="pl-input"
                type="number"
                min="0"
                value={form.initial_stock}
                onChange={(e) => setForm((f) => ({ ...f, initial_stock: e.target.value }))}
                placeholder="0"
              />
            </Field>
            <Field
              label="Product-specific threshold"
              hint={
                activeMode === 'global'
                  ? `Workspace threshold (${activeThreshold}) applies unless switched to Per-product overrides`
                  : 'We warn when stock drops strictly below this level'
              }
            >
              <input className="pl-input" type="number" min="0" value={form.low_stock_threshold} onChange={(e) => setForm((f) => ({ ...f, low_stock_threshold: e.target.value }))} />
            </Field>
          </div>
          <CustomFieldsInputs entity="product" values={customValues} onChange={setCustomValues} />
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : modal.editing ? 'Save changes' : 'Add product'}
            </button>
          </div>
        </form>
      </Modal>

      <BarcodeLabelModal
        product={labelProduct}
        businessName={me?.tenant?.name || 'AFRO Suite'}
        onClose={() => setLabelProduct(null)}
      />
    </div>
  )
}
