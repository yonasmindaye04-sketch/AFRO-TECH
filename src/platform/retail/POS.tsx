import { useMemo, useRef, useState, type FormEvent } from 'react'
import { fmtMoney, api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Product {
  id: string
  name: string
  category: string
  unit: string
  sell_price: string
  stock: number
}
interface CartLine {
  product_id: string
  name: string
  unit_price: number
  quantity: number
}
interface SaleResult {
  sale: { id: string; subtotal: string; discount: string; total: string; amount_paid: string; change_due: string; payment_method: string; created_at: string }
  items: { name: string; quantity: number; unit_price: number; line_total: number }[]
}

export default function POS(): JSX.Element {
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

  const subtotal = cart.reduce((s, l) => s + l.quantity * l.unit_price, 0)
  const total = Math.max(0, subtotal - (Number(discount) || 0))

  const addToCart = (p: Product): void => {
    if (p.stock <= 0) return
    setCart((c) => {
      const existing = c.find((l) => l.product_id === p.id)
      if (!existing) return [...c, { product_id: p.id, name: p.name, unit_price: Number(p.sell_price), quantity: 1 }]
      return c.map((l) => (l.product_id === p.id ? { ...l, quantity: Math.min(p.stock, l.quantity + 1) } : l))
    })
  }
  const changeQty = (productId: string, delta: number): void => {
    setCart((c) =>
      c
        .map((l) => (l.product_id === productId ? { ...l, quantity: l.quantity + delta } : l))
        .filter((l) => l.quantity > 0)
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
        items: cart.map((l) => ({ product_id: l.product_id, quantity: l.quantity })),
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
              {products.map((p) => (
                <button key={p.id} type="button" className="pl-pos-item" onClick={() => addToCart(p)} disabled={p.stock <= 0}>
                  <strong>{p.name}</strong>
                  <small>{p.category}</small>
                  <span className="pl-pos-price">{fmtMoney(p.sell_price)} ETB</span>
                  <small style={{ marginTop: 4 }}>{p.stock > 0 ? `${p.stock} ${p.unit} in stock` : 'Out of stock'}</small>
                </button>
              ))}
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
              {cart.map((l) => (
                <div key={l.product_id} className="pl-cart-line">
                  <div style={{ flex: 1 }}>
                    <strong>{l.name}</strong>
                    <small style={{ display: 'block', color: 'var(--text-dim)' }}>{fmtMoney(l.unit_price)} ETB each</small>
                  </div>
                  <div className="qty">
                    <button type="button" aria-label={`Reduce ${l.name}`} onClick={() => changeQty(l.product_id, -1)}>
                      −
                    </button>
                    <span>{l.quantity}</span>
                    <button type="button" aria-label={`Add ${l.name}`} onClick={() => changeQty(l.product_id, +1)}>
                      +
                    </button>
                  </div>
                  <span style={{ width: 86, textAlign: 'right', fontWeight: 600 }}>{fmtMoney(l.quantity * l.unit_price)}</span>
                </div>
              ))}

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
        {receipt && (
          <div>
            <div className="pl-receipt">
              <p style={{ textAlign: 'center', fontWeight: 700 }}>{new Date(receipt.sale.created_at).toLocaleString()}</p>
              <table>
                <tbody>
                  {receipt.items.map((it, i) => (
                    <tr key={i}>
                      <td>
                        {it.name} × {it.quantity}
                      </td>
                      <td style={{ textAlign: 'right' }}>{fmtMoney(it.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <hr style={{ border: 'none', borderTop: '1px dashed var(--border2)', margin: '8px 0' }} />
              <table>
                <tbody>
                  <tr>
                    <td>Subtotal</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(receipt.sale.subtotal)}</td>
                  </tr>
                  <tr>
                    <td>Discount</td>
                    <td style={{ textAlign: 'right' }}>-{fmtMoney(receipt.sale.discount)}</td>
                  </tr>
                  <tr>
                    <td>
                      <strong>TOTAL (ETB)</strong>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <strong>{fmtMoney(receipt.sale.total)}</strong>
                    </td>
                  </tr>
                  <tr>
                    <td>Paid ({receipt.sale.payment_method})</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(receipt.sale.amount_paid)}</td>
                  </tr>
                  <tr>
                    <td>Change</td>
                    <td style={{ textAlign: 'right' }}>{fmtMoney(receipt.sale.change_due)}</td>
                  </tr>
                </tbody>
              </table>
              <p style={{ textAlign: 'center', marginTop: 10, color: 'var(--text-dim)' }}>Thank you! Powered by AFRO-TECH</p>
            </div>
            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => window.print()}>
                <i className="fa-solid fa-print" aria-hidden="true" /> Print
              </button>
              <button type="button" className="pl-btn pl-btn-primary" onClick={() => setReceipt(null)}>
                New sale
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
