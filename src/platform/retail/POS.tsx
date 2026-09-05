import { useMemo, useRef, useState, type FormEvent } from 'react'
import { fmtMoney, api } from '../api'
import { useAuth } from '../AuthContext'
import { useApiData } from '../hooks/useApiData'
import { EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'
import ThermalReceipt from '../ui/ThermalReceipt'
import type { ReceiptData } from '../utils/receipt'

interface Product {
  id: string
  name: string
  category: string
  unit: string
  sell_price: string
  cost_price: string
  sell_by_pill: boolean
  pills_per_unit: number
  default_margin: string
  stock: number
  display_stock: number
}
interface CartLine {
  product_id: string
  name: string
  sold_as_pill: boolean
  pills_per_unit: number
  cost_price: number // per unit, or per pill for pill lines
  margin: number | null // null = list price
  unit_price: number // per unit, or per pill
  units: number // whole packs (pill lines) or quantity (unit lines)
  pills: number // loose pills (pill lines only)
}
interface SaleResult {
  sale: {
    id: string
    subtotal: string
    discount: string
    total: string
    amount_paid: string
    change_due: string
    payment_method: string
    created_at: string
    invoice_no?: string
  }
  items: { name: string; quantity: number; unit_price: number; line_total: number; sold_as_pills?: boolean }[]
}

interface PosSettings {
  business_name?: string
  tin_number?: string
  vat_number?: string
  business_phone?: string
  business_address?: string
  receipt_header?: string
  receipt_footer?: string
  currency?: string
  tax_rate?: number
  margin_presets?: string
  auto_print_receipt?: boolean
}

export default function POS(): JSX.Element {
  const { me } = useAuth()
  const { data, loading, reload } = useApiData<{ products: Product[] }>('/retail/products')
  const [cart, setCart] = useState<CartLine[]>([])
  const [search, setSearch] = useState('')
  const [discount, setDiscount] = useState('0')
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'card' | 'mobile'>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<SaleResult | null>(null)

  const products = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data?.products ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.category.toLowerCase().includes(q))
  }, [data, search])

  // Margin presets come from workspace settings (PPR parity), defaulting to 20/25/30
  const settingsQ = useApiData<{ settings: PosSettings }>('/tenant/settings')
  const marginPresets = useMemo(
    () =>
      (settingsQ.data?.settings.margin_presets ?? '20,25,30')
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0),
    [settingsQ.data]
  )

  const subtotal = cart.reduce((s, l) => s + (l.sold_as_pill ? (l.units * l.pills_per_unit + l.pills) * l.unit_price : l.units * l.unit_price), 0)
  const total = Math.max(0, subtotal - (Number(discount) || 0))

  const addToCart = (p: Product): void => {
    if ((p.sell_by_pill ? p.display_stock : p.stock) <= 0) return
    setCart((c) => {
      const existing = c.find((l) => l.product_id === p.id)
      if (!existing) {
        if (p.sell_by_pill) {
          const perPill = Number(p.sell_price) / Math.max(1, p.pills_per_unit)
          return [
            ...c,
            {
              product_id: p.id,
              name: p.name,
              sold_as_pill: true,
              pills_per_unit: p.pills_per_unit,
              cost_price: Number(p.cost_price) / Math.max(1, p.pills_per_unit),
              margin: null,
              unit_price: perPill,
              units: 1,
              pills: 0,
            },
          ]
        }
        return [
          ...c,
          { product_id: p.id, name: p.name, sold_as_pill: false, pills_per_unit: 1, cost_price: Number(p.cost_price), margin: null, unit_price: Number(p.sell_price), units: 1, pills: 0 },
        ]
      }
      // increment by one pack / one unit within stock limits
      return c.map((l) => {
        if (l.product_id !== p.id) return l
        if (l.sold_as_pill) {
          const totalPills = (l.units + 1) * l.pills_per_unit + l.pills
          if (totalPills > p.display_stock) return l
          return { ...l, units: l.units + 1 }
        }
        if (l.units + 1 > p.stock) return l
        return { ...l, units: l.units + 1 }
      })
    })
  }

  const setLinePills = (line: CartLine, units: number, pills: number): void => {
    setCart((c) =>
      c.map((l) => {
        if (l.product_id !== line.product_id) return l
        const totalPills = units * l.pills_per_unit + pills
        const prod = products.find((p) => p.id === line.product_id)
        if (totalPills <= 0 || (prod && totalPills > prod.display_stock)) return l
        return { ...l, units, pills }
      })
    )
  }

  const changeQty = (productId: string, delta: number): void => {
    setCart((c) =>
      c
        .map((l) => {
          if (l.product_id !== productId) return l
          if (l.sold_as_pill) {
            let { units, pills } = l
            pills += delta
            while (pills < 0 && units > 0) {
              units -= 1
              pills += l.pills_per_unit
            }
            return { ...l, units, pills }
          }
          return { ...l, units: l.units + delta }
        })
        .filter((l) => (l.sold_as_pill ? l.units * l.pills_per_unit + l.pills > 0 : l.units > 0))
    )
  }

  const applyMargin = (productId: string, margin: number | null): void => {
    setCart((c) =>
      c.map((l) => {
        if (l.product_id !== productId) return l
        if (margin === null) {
          // back to list price
          const prod = products.find((p) => p.id === productId)
          const listPrice = l.sold_as_pill ? Number(prod?.sell_price ?? 0) / Math.max(1, l.pills_per_unit) : Number(prod?.sell_price ?? 0)
          return { ...l, margin: null, unit_price: listPrice }
        }
        return { ...l, margin, unit_price: l.cost_price * (1 + margin / 100) }
      })
    )
  }

  const [barcode, setBarcode] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const scanRef = useRef<HTMLInputElement>(null)

  const handleScan = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const code = barcode.trim()
    if (!code) return
    setScanError(null)
    try {
      const r = await api.get<{ product: Product }>(`/retail/products/barcode/${encodeURIComponent(code)}`)
      addToCart(r.product)
      setBarcode('')
      scanRef.current?.focus()
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed')
      setBarcode('')
    }
  }

  const checkout = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const res = await api.post<SaleResult>('/retail/sales', {
        items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: l.sold_as_pill ? l.units * l.pills_per_unit + l.pills : l.units,
          ...(l.margin !== null ? { margin: l.margin } : {}),
        })),
        discount: Number(discount) || 0,
        payment_method: paymentMethod,
        amount_paid: paymentMethod === 'cash' ? Number(amountPaid) || total : total,
      })
      setReceipt(res)
      setCart([])
      setDiscount('0')
      setAmountPaid('')
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <Spinner label="Loading products…" />

  return (
    <div>
      <PageHeader title="New Sale" subtitle="Tap a product to add it to the cart" />
      <div className="pl-pos">
        <div>
          <div className="pl-toolbar">
            <form onSubmit={handleScan} style={{ display: 'flex', gap: 8, flex: 1, maxWidth: 340 }}>
              <input
                ref={scanRef}
                className="pl-input"
                style={{ flex: 1 }}
                placeholder="Scan barcode…"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                aria-label="Barcode scanner input"
                autoFocus
              />
              <button type="submit" className="pl-btn pl-btn-ghost" aria-label="Lookup barcode">
                <i className="fa-solid fa-barcode" aria-hidden="true" />
              </button>
            </form>
            <input className="pl-input" style={{ flex: 1 }} placeholder="Search by name or category…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
          </div>
          {scanError && <p role="alert" style={{ color: '#e07a7a', fontSize: '.85rem', margin: '-6px 0 10px' }}>{scanError}</p>}
          {products.length === 0 ? (
            <EmptyState icon="fa-solid fa-box-open" title="No products found" hint="Add products or receive a purchase first." />
          ) : (
            <div className="pl-pos-grid">
              {products.map((p) => {
                const pillMode = p.sell_by_pill
                const available = pillMode ? p.display_stock : p.stock
                const listPrice = pillMode ? Number(p.sell_price) / Math.max(1, p.pills_per_unit) : Number(p.sell_price)
                return (
                  <button key={p.id} type="button" className="pl-pos-item" onClick={() => addToCart(p)} disabled={available <= 0}>
                    <strong>{p.name}</strong>
                    <small>{p.category}</small>
                    <span className="pl-pos-price">
                      {fmtMoney(listPrice)} ETB{pillMode ? '/pill' : ''}
                    </span>
                    <small style={{ marginTop: 4 }}>
                      {available > 0 ? `${available}${pillMode ? ' pills' : ` ${p.unit}`} in stock` : 'Out of stock'}
                      {pillMode && available > 0 && (
                        <span style={{ display: 'block', color: 'var(--text-dim)' }}>
                          ≈ {Math.floor(available / p.pills_per_unit)} packs + {available % p.pills_per_unit} loose
                        </span>
                      )}
                    </small>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        <div className="pl-card" style={{ position: 'sticky', top: 16 }}>
          <h2>
            <i className="fa-solid fa-cart-shopping" aria-hidden="true" /> Cart ({cart.length})
          </h2>
          {cart.length === 0 ? (
            <EmptyState icon="fa-solid fa-hand-pointer" title="Cart is empty" hint="Select products from the grid." />
          ) : (
            <>
              {cart.map((l) => {
                const lineQty = l.sold_as_pill ? l.units * l.pills_per_unit + l.pills : l.units
                return (
                  <div key={l.product_id} style={{ borderBottom: '1px dashed var(--border)', padding: '8px 0' }}>
                    <div className="pl-cart-line">
                      <div style={{ flex: 1 }}>
                        <strong>{l.name}</strong>
                        <small style={{ display: 'block', color: 'var(--text-dim)' }}>
                          {fmtMoney(l.unit_price)} ETB / {l.sold_as_pill ? 'pill' : 'each'}
                          {l.margin !== null ? ` · margin ${l.margin}%` : ''}
                        </small>
                      </div>
                      {l.sold_as_pill ? (
                        <div className="qty" style={{ alignItems: 'center' }}>
                          <input
                            className="pl-input"
                            style={{ width: 52, padding: '4px 6px', textAlign: 'center' }}
                            type="number"
                            min="0"
                            value={l.units}
                            aria-label={`Packs of ${l.name}`}
                            onChange={(e) => setLinePills(l, Math.max(0, Number(e.target.value) || 0), l.pills)}
                          />
                          <small>packs</small>
                          <input
                            className="pl-input"
                            style={{ width: 52, padding: '4px 6px', textAlign: 'center' }}
                            type="number"
                            min="0"
                            max={l.pills_per_unit - 1}
                            value={l.pills}
                            aria-label={`Loose pills of ${l.name}`}
                            onChange={(e) => setLinePills(l, l.units, Math.max(0, Math.min(l.pills_per_unit - 1, Number(e.target.value) || 0)))}
                          />
                          <small>pills</small>
                        </div>
                      ) : (
                        <div className="qty">
                          <button type="button" aria-label={`Reduce ${l.name}`} onClick={() => changeQty(l.product_id, -1)}>
                            −
                          </button>
                          <span>{l.units}</span>
                          <button type="button" aria-label={`Add ${l.name}`} onClick={() => changeQty(l.product_id, +1)}>
                            +
                          </button>
                        </div>
                      )}
                      <span style={{ width: 86, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(lineQty * l.unit_price)}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                      <small style={{ color: 'var(--text-dim)' }}>Margin:</small>
                      <select
                        className="pl-select"
                        style={{ width: 'auto', padding: '2px 8px', fontSize: '.78rem' }}
                        value={l.margin === null ? '' : String(l.margin)}
                        onChange={(e) => applyMargin(l.product_id, e.target.value === '' ? null : Number(e.target.value))}
                        aria-label={`Margin for ${l.name}`}
                      >
                        <option value="">List price</option>
                        {marginPresets.map((m) => (
                          <option key={m} value={m}>
                            {m}%
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )
              })}

              <div style={{ marginTop: 14 }}>
                <div className="pl-cart-total">
                  <span>Subtotal</span>
                  <span>{fmtMoney(subtotal)} ETB</span>
                </div>
                <Field label="Discount (ETB)">
                  <input className="pl-input" type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                </Field>
                <Field label="Payment method">
                  <select className="pl-select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as 'cash')}>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="mobile">Mobile money / Telebirr</option>
                  </select>
                </Field>
                {paymentMethod === 'cash' && (
                  <Field label="Cash received (ETB)" hint={`Change due: ${fmtMoney(Math.max(0, (Number(amountPaid) || 0) - total))} ETB`}>
                    <input className="pl-input" type="number" min="0" step="0.01" placeholder={String(total.toFixed(2))} value={amountPaid} onChange={(e) => setAmountPaid(e.target.value)} />
                  </Field>
                )}
                <div className="pl-cart-total grand">
                  <span>Total</span>
                  <span style={{ color: 'var(--accent)' }}>{fmtMoney(total)} ETB</span>
                </div>
                {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
                <div className="pl-form-actions" style={{ justifyContent: 'space-between' }}>
                  <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => setCart([])}>
                    Clear
                  </button>
                  <button type="button" className="pl-btn pl-btn-primary" disabled={busy || cart.length === 0} onClick={checkout}>
                    <i className="fa-solid fa-check" aria-hidden="true" /> {busy ? 'Processing…' : 'Complete sale'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <Modal open={receipt !== null} title="Sale completed" onClose={() => setReceipt(null)}>
        {receipt && (() => {
          const cfg = settingsQ.data?.settings
          const rData: ReceiptData = {
            business_name: cfg?.business_name || me?.tenant?.name || 'AFRO SUITE STORE',
            tin_number: cfg?.tin_number,
            vat_number: cfg?.vat_number,
            business_phone: cfg?.business_phone,
            business_address: cfg?.business_address,
            receipt_header: cfg?.receipt_header,
            receipt_footer: cfg?.receipt_footer,
            currency: cfg?.currency || 'ETB',
            tax_rate: cfg?.tax_rate,
            invoice_no: receipt.sale.invoice_no,
            created_at: receipt.sale.created_at,
            cashier_name: me?.full_name,
            items: receipt.items,
            subtotal: Number(receipt.sale.subtotal),
            discount: Number(receipt.sale.discount),
            total: Number(receipt.sale.total),
            payment_method: receipt.sale.payment_method,
            amount_paid: Number(receipt.sale.amount_paid),
            change_due: Number(receipt.sale.change_due),
          }
          return (
            <ThermalReceipt
              data={rData}
              autoPrint={!!cfg?.auto_print_receipt}
              onDone={() => setReceipt(null)}
            />
          )
        })()}
      </Modal>
    </div>
  )
}
