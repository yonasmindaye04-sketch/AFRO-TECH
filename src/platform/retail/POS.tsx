import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { api, fmtDateTime, fmtMoney } from '../api'
import { useAuth } from '../AuthContext'
import { useApiData } from '../hooks/useApiData'
import { Badge, EmptyState, Field, Modal, PageHeader, SearchInput, Spinner } from '../ui'
import BarcodeScanner from '../ui/BarcodeScanner'
import ThermalReceipt from '../ui/ThermalReceipt'
import {
  PAYMENT_PROVIDERS,
  mapPosRailToGateway,
  type PaymentProviderId,
} from '../utils/paymentEngine'
import type { ReceiptData } from '../utils/receipt'
import {
  DEFAULT_POS_CUSTOMER,
  POS_AGE_GROUPS,
  POS_CITIES,
  POS_COUNTRY_CODES,
  POS_CUSTOMER_SOURCES,
  POS_PAYMENT_RAILS,
  addProductToCart,
  applyCartLineMargin,
  computeCartTotals,
  computeChangeDue,
  computeQuickTenderAmounts,
  createHeldOrder,
  extractCategories,
  filterPosProducts,
  getAvailableStock,
  getCartLineQty,
  getListUnitPrice,
  normalizePosCustomer,
  removeHeldOrder,
  setCartLinePills,
  splitPosPhone,
  updateCartLineQuantity,
  validatePosCustomer,
  type HeldPosOrder,
  type PosCartLine,
  type PosCustomerInfo,
  type PosDiscountMode,
  type PosOrderType,
  type PosPaymentMethod,
  type PosProduct,
} from '../utils/posEngine'

interface SaleResult {
  sale: {
    id: string
    subtotal: string
    discount: string
    tax_amount?: string
    total: string
    amount_paid: string
    change_due: string
    payment_method: string
    order_type?: string
    customer_name?: string
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

interface ActiveShift {
  id: string
  opening_balance: string
  cash_sales: string
  status: 'open' | 'closed'
  opened_at?: string
}

export default function POS(): JSX.Element {
  const { me } = useAuth()
  const { data, loading, reload } = useApiData<{ products: PosProduct[] }>('/retail/products')
  const settingsQ = useApiData<{ settings: PosSettings }>('/tenant/settings')
  const shiftQ = useApiData<{ shift: ActiveShift | null }>('/retail/shift')

  const currency = settingsQ.data?.settings.currency || 'ETB'
  const taxRate = Number(settingsQ.data?.settings.tax_rate || 0)

  // Catalog filters & mobile view switcher
  const [search, setSearch] = useState('')
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [mobileTab, setMobileTab] = useState<'catalog' | 'order'>('catalog')

  // Cart & order state
  const [cart, setCart] = useState<PosCartLine[]>([])
  const [orderType, setOrderType] = useState<PosOrderType>('pickup')
  const [paymentMethod, setPaymentMethod] = useState<PosPaymentMethod>('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [discountMode, setDiscountMode] = useState<PosDiscountMode>('fixed')
  const [discountValue, setDiscountValue] = useState<number>(0)

  // Customer profile & lookup state
  const [customer, setCustomer] = useState<PosCustomerInfo>(DEFAULT_POS_CUSTOMER)
  const [customerModalOpen, setCustomerModalOpen] = useState(false)
  const [customerDraft, setCustomerDraft] = useState<PosCustomerInfo>(DEFAULT_POS_CUSTOMER)
  const [customerCountryCode, setCustomerCountryCode] = useState('+251')
  const [customerPhoneLocal, setCustomerPhoneLocal] = useState('900 000 000')
  const [customerSearchQuery, setCustomerSearchQuery] = useState('')
  const [customerSearchResults, setCustomerSearchResults] = useState<Record<string, unknown>[]>([])
  const [searchingCustomer, setSearchingCustomer] = useState(false)
  const [savingCustomer, setSavingCustomer] = useState(false)
  const [customerFormError, setCustomerFormError] = useState<string | null>(null)

  // Discount modal state
  const [discountModalOpen, setDiscountModalOpen] = useState(false)
  const [discountModalMode, setDiscountModalMode] = useState<PosDiscountMode>('fixed')
  const [discountModalInput, setDiscountModalInput] = useState('0')

  // Held / Parked orders queue (scoped per workspace)
  const heldStorageKey = `afro_pos_held_${me?.tenant?.id ?? 'default'}`
  const [heldOrders, setHeldOrders] = useState<HeldPosOrder[]>(() => {
    try {
      const raw = localStorage.getItem(heldStorageKey)
      return raw ? (JSON.parse(raw) as HeldPosOrder[]) : []
    } catch {
      return []
    }
  })
  const [heldModalOpen, setHeldModalOpen] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(heldStorageKey, JSON.stringify(heldOrders))
    } catch {
      // Ignore storage quota issues
    }
  }, [heldOrders, heldStorageKey])

  // Quick Shift start modal
  const [shiftModalOpen, setShiftModalOpen] = useState(false)
  const [openingBalance, setOpeningBalance] = useState('0')
  const [shiftBusy, setShiftBusy] = useState(false)

  // Barcode scanner
  const [barcode, setBarcode] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [scannerOpen, setScannerOpen] = useState(false)
  const scanRef = useRef<HTMLInputElement>(null)
  const searchInputWrapperRef = useRef<HTMLDivElement>(null)

  // Checkout, Pay Link & Thermal Receipt
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [receipt, setReceipt] = useState<SaleResult | null>(null)
  const [payLinkInfo, setPayLinkInfo] = useState<{
    url: string
    externalUrl?: string | null
    provider: PaymentProviderId
    mode: string
    locked: boolean
  } | null>(null)
  const [payLinkBusy, setPayLinkBusy] = useState(false)

  const allProducts = useMemo(() => data?.products ?? [], [data?.products])
  const categories = useMemo(() => extractCategories(allProducts), [allProducts])
  const filteredProducts = useMemo(
    () => filterPosProducts(allProducts, selectedCategory, search),
    [allProducts, selectedCategory, search]
  )

  const marginPresets = useMemo(
    () =>
      (settingsQ.data?.settings.margin_presets ?? '20,25,30')
        .split(',')
        .map((n) => Number(n.trim()))
        .filter((n) => Number.isFinite(n) && n >= 0),
    [settingsQ.data]
  )

  const totals = useMemo(
    () => computeCartTotals(cart, discountMode, discountValue, taxRate),
    [cart, discountMode, discountValue, taxRate]
  )

  const tender = useMemo(
    () => computeChangeDue(totals.totalPayable, amountPaid === '' ? totals.totalPayable : Number(amountPaid)),
    [totals.totalPayable, amountPaid]
  )

  const quickTenderOptions = useMemo(
    () => computeQuickTenderAmounts(totals.totalPayable),
    [totals.totalPayable]
  )

  // In-cart quantity map for quick card badges
  const cartQtyByProduct = useMemo(() => {
    const map = new Map<string, number>()
    for (const line of cart) {
      map.set(line.product_id, (map.get(line.product_id) ?? 0) + getCartLineQty(line))
    }
    return map
  }, [cart])

  // Debounced live customer lookup
  useEffect(() => {
    const q = customerSearchQuery.trim()
    if (!customerModalOpen || q.length < 2) return
    let cancelled = false
    const timer = setTimeout(async () => {
      setSearchingCustomer(true)
      try {
        const res = await api.get<{ customers: Record<string, unknown>[] }>(
          `/retail/customers?search=${encodeURIComponent(q)}&limit=6`
        )
        if (!cancelled) setCustomerSearchResults(res.customers ?? [])
      } catch {
        if (!cancelled) setCustomerSearchResults([])
      } finally {
        if (!cancelled) setSearchingCustomer(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [customerSearchQuery, customerModalOpen])

  const openCustomerModal = (): void => {
    const normalized = normalizePosCustomer(customer as unknown as Record<string, unknown>)
    const parsedPhone = splitPosPhone(normalized.phone)
    setCustomerDraft(normalized)
    setCustomerCountryCode(parsedPhone.code)
    setCustomerPhoneLocal(parsedPhone.local)
    setCustomerSearchQuery('')
    setCustomerSearchResults([])
    setCustomerFormError(null)
    setCustomerModalOpen(true)
  }

  const selectExistingCustomer = (raw: Record<string, unknown>): void => {
    const normalized = normalizePosCustomer(raw)
    const parsedPhone = splitPosPhone(normalized.phone)
    setCustomerDraft(normalized)
    setCustomerCountryCode(parsedPhone.code)
    setCustomerPhoneLocal(parsedPhone.local)
    setCustomerSearchQuery('')
    setCustomerSearchResults([])
    setCustomerFormError(null)
  }

  const saveCustomerProfile = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    const cleanLocal = customerPhoneLocal.trim().replace(/^0+/, '')
    const fullPhone = cleanLocal ? `${customerCountryCode} ${cleanLocal}` : customerCountryCode
    const nextCustomer: PosCustomerInfo = { ...customerDraft, phone: fullPhone }
    const validationError = validatePosCustomer(nextCustomer)
    if (validationError) {
      setCustomerFormError(validationError)
      return
    }

    setSavingCustomer(true)
    setCustomerFormError(null)
    try {
      let savedId = nextCustomer.id
      if (savedId) {
        await api.patch(`/retail/customers/${savedId}`, nextCustomer)
      } else {
        const res = await api.post<{ customer: { id: string } }>('/retail/customers', nextCustomer)
        savedId = res.customer?.id
      }
      setCustomer({ ...nextCustomer, id: savedId })
      setCustomerModalOpen(false)
    } catch (err) {
      setCustomerFormError(err instanceof Error ? err.message : 'Could not save customer profile')
    } finally {
      setSavingCustomer(false)
    }
  }

  const handleAddToCart = (product: PosProduct): void => {
    setError(null)
    setNotice(null)
    setCart((prev) => addProductToCart(prev, product))
  }

  const handleChangeQty = (productId: string, delta: number): void => {
    const prod = allProducts.find((p) => p.id === productId)
    const maxStock = prod ? getAvailableStock(prod) : undefined
    setCart((prev) => updateCartLineQuantity(prev, productId, delta, maxStock))
  }

  const handleSetLinePills = (line: PosCartLine, units: number, pills: number): void => {
    const prod = allProducts.find((p) => p.id === line.product_id)
    const maxDisplay = prod ? prod.display_stock : line.max_stock
    setCart((prev) => setCartLinePills(prev, line.product_id, units, pills, maxDisplay))
  }

  const handleApplyMargin = (productId: string, margin: number | null): void => {
    const prod = allProducts.find((p) => p.id === productId)
    const listPrice = Number(prod?.sell_price ?? 0)
    setCart((prev) => applyCartLineMargin(prev, productId, margin, listPrice))
  }

  const clearCurrentOrder = (): void => {
    setCart([])
    setDiscountMode('fixed')
    setDiscountValue(0)
    setAmountPaid('')
    setPayLinkInfo(null)
    setError(null)
    setMobileTab('catalog')
  }

  const handleHoldOrder = (): void => {
    if (cart.length === 0) return
    const held = createHeldOrder({
      cart,
      customer,
      orderType,
      discountMode,
      discountValue,
    })
    setHeldOrders((prev) => [held, ...prev])
    clearCurrentOrder()
    setCustomer(DEFAULT_POS_CUSTOMER)
    setNotice(`Order parked for ${held.label} (${fmtMoney(held.total)} ${currency})`)
  }

  const handleResumeHeldOrder = (id: string): void => {
    const { target, remaining } = removeHeldOrder(heldOrders, id)
    if (!target) return
    setCart(target.cart)
    setCustomer(target.customer)
    setOrderType(target.order_type)
    setDiscountMode(target.discount_mode)
    setDiscountValue(target.discount_value)
    setHeldOrders(remaining)
    setHeldModalOpen(false)
    setMobileTab('order')
    setNotice(`Resumed parked order for ${target.label}`)
  }

  const handleDeleteHeldOrder = (id: string): void => {
    const { remaining } = removeHeldOrder(heldOrders, id)
    setHeldOrders(remaining)
  }

  const lookupBarcode = async (rawCode: string): Promise<void> => {
    const code = rawCode.trim()
    if (!code) return
    setScanError(null)
    try {
      const r = await api.get<{ product: PosProduct }>(`/retail/products/barcode/${encodeURIComponent(code)}`)
      const p = r.product
      const available = getAvailableStock(p)
      if (available <= 0) {
        setScanError(`"${p.name}" is out of stock`)
        setBarcode('')
        scanRef.current?.focus()
        return
      }
      handleAddToCart(p)
      setBarcode('')
      scanRef.current?.focus()
    } catch (err) {
      setScanError(err instanceof Error ? err.message : 'Scan failed')
      setBarcode('')
      scanRef.current?.focus()
    }
  }

  const handleScanSubmit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    await lookupBarcode(barcode)
  }

  const checkout = async (): Promise<void> => {
    if (cart.length === 0 || busy) return
    if (paymentMethod === 'credit' && !customer.id && customer.name === DEFAULT_POS_CUSTOMER.name) {
      setError('Select or add a customer profile before posting a Credit sale.')
      return
    }

    setBusy(true)
    setError(null)
    setNotice(null)
    const customerName = customer.name.trim() || 'Walk-in Customer'
    const customerLocation =
      customer.location.trim() || (orderType === 'delivery' ? 'Addis Ababa Delivery' : 'In-Store Counter')

    try {
      const paidAmount =
        paymentMethod === 'cash'
          ? amountPaid !== ''
            ? Number(amountPaid)
            : totals.totalPayable
          : paymentMethod === 'credit'
            ? 0
            : totals.totalPayable

      const res = await api.post<SaleResult>('/retail/sales', {
        items: cart.map((l) => ({
          product_id: l.product_id,
          quantity: getCartLineQty(l),
          sold_as_pills: l.sold_as_pill,
          ...(l.margin !== null ? { margin: l.margin } : {}),
        })),
        discount: totals.discountAmount,
        tax_amount: totals.taxIncluded,
        payment_method: paymentMethod,
        amount_paid: paidAmount,
        order_type: orderType,
        customer_id: customer.id || null,
        customer_name: customerName,
        customer_phone: customer.phone.trim() || null,
        customer_city: customer.city.trim() || 'Addis Ababa',
        customer_location: customerLocation,
        referral_code: customer.referral_code || null,
        notes: customer.notes || null,
      })

      setReceipt(res)
      clearCurrentOrder()
      setCustomer(DEFAULT_POS_CUSTOMER)
      reload()
      shiftQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checkout failed')
    } finally {
      setBusy(false)
    }
  }

  const createPosPayLink = async (): Promise<void> => {
    if (totals.totalPayable <= 0) return
    setPayLinkBusy(true)
    setError(null)
    const mappedProvider = mapPosRailToGateway(paymentMethod)
    try {
      const res = await api.post<{
        pay_path: string
        external_checkout_url?: string | null
        provider: PaymentProviderId
        provider_locked?: boolean
        mode?: string
      }>('/payments/links', {
        ...(mappedProvider ? { provider: mappedProvider, lock_provider: true } : { lock_provider: false }),
        party_name: customer.name.trim() || 'POS Walk-in Customer',
        customer_phone: customer.phone.trim() || undefined,
        amount: totals.totalPayable,
        description: `POS Order (${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'} · ${orderType})`,
        reference_type: 'pos_checkout',
      })
      setPayLinkInfo({
        url: `${window.location.origin}${res.pay_path}`,
        externalUrl: res.external_checkout_url || null,
        provider: res.provider || mappedProvider || 'cbe_bank',
        mode: res.mode || 'sandbox',
        locked: Boolean(res.provider_locked ?? mappedProvider),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate payment link')
    } finally {
      setPayLinkBusy(false)
    }
  }

  const handleStartShift = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setShiftBusy(true)
    try {
      await api.post('/retail/shift/start', { opening_balance: Number(openingBalance) || 0 })
      setShiftModalOpen(false)
      setOpeningBalance('0')
      shiftQ.reload()
      setNotice('Cash drawer shift opened')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open shift')
    } finally {
      setShiftBusy(false)
    }
  }

  // Keyboard shortcuts (F2 Search, F8 Hold, F9 Complete)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (customerModalOpen || discountModalOpen || heldModalOpen || shiftModalOpen || scannerOpen || receipt !== null) {
        return
      }
      if (e.key === 'F2') {
        e.preventDefault()
        const input = searchInputWrapperRef.current?.querySelector('input')
        input?.focus()
      } else if (e.key === 'F8' && cart.length > 0) {
        e.preventDefault()
        handleHoldOrder()
      } else if (e.key === 'F9' && cart.length > 0 && !busy) {
        e.preventDefault()
        void checkout()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (loading && !data) return <Spinner label="Loading POS catalog…" />

  const activeShift = shiftQ.data?.shift ?? null
  const terminalLabel =
    me?.tenant?.business_type === 'pharmacy' ? 'Pharmacy Dispensing POS' : 'Retail POS Terminal'

  return (
    <div className="pl-pos-wrap">
      <PageHeader
        title="Point of Sale"
        subtitle="Fast counter checkout with category filter, customer profile, held carts, and Ethiopian payment rails"
      />

      {/* POS Terminal Status & Quick Actions Bar */}
      <div className="pl-pos-topbar">
        <div className="pl-pos-topbar-meta">
          <span className="pl-pos-terminal-badge">
            <i className="fa-solid fa-cash-register" aria-hidden="true" />
            <span>{me?.tenant?.name || 'AFRO Suite'} · {terminalLabel}</span>
          </span>
          <span style={{ color: 'var(--text-dim)', fontSize: '.82rem' }}>
            Cashier: <strong style={{ color: 'var(--text)' }}>{me?.full_name || 'Staff'}</strong>
          </span>
          <button
            type="button"
            className={`pl-pos-shift-chip ${activeShift ? 'open' : 'closed'}`}
            onClick={() => {
              if (!activeShift) setShiftModalOpen(true)
            }}
            title={activeShift ? `Shift opened ${activeShift.opened_at ? fmtDateTime(activeShift.opened_at) : ''}` : 'Click to open a drawer shift'}
          >
            <i className={activeShift ? 'fa-solid fa-lock-open' : 'fa-solid fa-vault'} aria-hidden="true" />
            <span>
              {activeShift
                ? `Shift Open · Cash ${fmtMoney(activeShift.cash_sales || 0)} ${currency}`
                : 'No Open Shift (Start)'}
            </span>
          </button>
        </div>

        <div className="pl-pos-topbar-actions">
          <span className="pl-pos-kbd-hint">F2 Search · F8 Hold · F9 Checkout</span>
          <button
            type="button"
            className="pl-btn pl-btn-ghost pl-btn-sm"
            onClick={() => setHeldModalOpen(true)}
            data-testid="pos-held-btn"
          >
            <i className="fa-solid fa-pause-circle" aria-hidden="true" />
            <span>Held ({heldOrders.length})</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="pl-ok-box" role="status" style={{ margin: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span><i className="fa-solid fa-circle-check" aria-hidden="true" /> {notice}</span>
          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </div>
      )}

      {/* Mobile Catalog vs Current Order Switcher */}
      <div className="pl-pos-mobile-tabs" role="tablist" aria-label="POS mobile view">
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'catalog'}
          className={mobileTab === 'catalog' ? 'active' : ''}
          onClick={() => setMobileTab('catalog')}
        >
          <i className="fa-solid fa-boxes-stacked" aria-hidden="true" />
          <span>Catalog ({filteredProducts.length})</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobileTab === 'order'}
          className={mobileTab === 'order' ? 'active' : ''}
          onClick={() => setMobileTab('order')}
        >
          <i className="fa-solid fa-cart-shopping" aria-hidden="true" />
          <span>Order ({totals.itemCount})</span>
        </button>
      </div>

      <div className="pl-pos">
        {/* LEFT PANE: BARCODE, SEARCH, CATEGORIES & PRODUCT GRID */}
        <div className={mobileTab === 'catalog' ? '' : 'pl-pos-pane-hidden-mobile'}>
          <div className="pl-toolbar">
            <form onSubmit={handleScanSubmit} style={{ display: 'flex', gap: 8, flex: '1 1 250px', maxWidth: 340 }}>
              <input
                ref={scanRef}
                className="pl-input"
                style={{ flex: 1 }}
                placeholder="Scan barcode…"
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                aria-label="Barcode scanner input"
              />
              <button type="button" className="pl-btn pl-btn-primary" onClick={() => setScannerOpen(true)} aria-label="Scan with camera" title="Scan with camera">
                <i className="fa-solid fa-camera" aria-hidden="true" />
              </button>
              <button type="submit" className="pl-btn pl-btn-ghost" aria-label="Lookup barcode" title="Lookup barcode">
                <i className="fa-solid fa-barcode" aria-hidden="true" />
              </button>
            </form>
            <div ref={searchInputWrapperRef} style={{ flex: '1 1 220px', display: 'flex', minWidth: 0 }}>
              <SearchInput
                value={search}
                onChange={setSearch}
                placeholder="Search name, category, or barcode… (F2)"
                ariaLabel="Search products"
                style={{ flex: 1, maxWidth: 'none', minWidth: 0 }}
              />
            </div>
          </div>

          {/* Category Filter Breadcrumb Strip */}
          <div className="pl-pos-cats">
            <div className="pl-pos-cat-list" role="tablist" aria-label="Product categories">
              <button
                type="button"
                role="tab"
                aria-selected={selectedCategory === 'all'}
                className={`pl-pos-cat-btn ${selectedCategory === 'all' ? 'active' : ''}`}
                onClick={() => setSelectedCategory('all')}
              >
                All Products
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={selectedCategory.toLowerCase() === cat.toLowerCase()}
                  className={`pl-pos-cat-btn ${selectedCategory.toLowerCase() === cat.toLowerCase() ? 'active' : ''}`}
                  onClick={() => setSelectedCategory(cat)}
                >
                  {cat}
                </button>
              ))}
            </div>
            <span className="pl-pos-count">{filteredProducts.length} items</span>
          </div>

          {scannerOpen && (
            <BarcodeScanner
              title="Scan product barcode"
              onDetected={(code) => {
                setScannerOpen(false)
                void lookupBarcode(code)
              }}
              onClose={() => setScannerOpen(false)}
            />
          )}

          {scanError && (
            <p role="alert" style={{ color: '#e07a7a', fontSize: '.85rem', margin: '-4px 0 10px' }}>
              {scanError}
            </p>
          )}

          {filteredProducts.length === 0 ? (
            <EmptyState
              icon="fa-solid fa-box-open"
              title="No products match your filter"
              hint="Try clearing your search or switching back to All Products."
            />
          ) : (
            <div className="pl-pos-grid" data-testid="pos-product-grid">
              {filteredProducts.map((p) => {
                const pillMode = p.sell_by_pill
                const available = getAvailableStock(p)
                const listPrice = getListUnitPrice(p)
                const inCartQty = cartQtyByProduct.get(p.id) ?? 0
                const isLow = available > 0 && available <= (p.low_stock_threshold ?? 5)
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`pl-pos-item ${inCartQty > 0 ? 'in-cart' : ''}`}
                    onClick={() => handleAddToCart(p)}
                    disabled={available <= 0}
                    data-testid={`pos-product-${p.id}`}
                  >
                    <div>
                      <div className="pl-pos-item-head">
                        <span className="pl-pos-item-cat">{p.category || 'General'}</span>
                        {inCartQty > 0 && (
                          <span className="pl-pos-in-cart-tag" aria-label={`${inCartQty} in cart`}>
                            ×{inCartQty}
                          </span>
                        )}
                      </div>
                      <strong style={{ marginTop: 4 }}>{p.name}</strong>
                    </div>
                    <div className="pl-pos-item-foot">
                      <span className="pl-pos-price">
                        {fmtMoney(listPrice)} {currency}
                        {pillMode ? '/pill' : ''}
                      </span>
                      <small className={isLow ? 'pl-pos-stock-low' : ''}>
                        {available > 0 ? `${available} ${pillMode ? 'pills' : p.unit}` : 'Out of stock'}
                      </small>
                    </div>
                  </button>
                )
              })}
            </div>
          )}

          {/* Mobile Sticky Quick-Jump to Cart */}
          {totals.itemCount > 0 && mobileTab === 'catalog' && (
            <div className="pl-pos-mobile-sticky">
              <button
                type="button"
                className="pl-btn pl-btn-primary"
                style={{ width: '100%', justifyContent: 'space-between', padding: '12px 16px', fontVariantNumeric: 'tabular-nums' }}
                onClick={() => setMobileTab('order')}
              >
                <span>
                  <i className="fa-solid fa-cart-shopping" aria-hidden="true" /> {totals.itemCount}{' '}
                  {totals.itemCount === 1 ? 'item' : 'items'} in order
                </span>
                <span>
                  {fmtMoney(totals.totalPayable)} {currency} →
                </span>
              </button>
            </div>
          )}
        </div>

        {/* RIGHT PANE: CURRENT ORDER, CUSTOMER, PAYMENT RAILS & CHECKOUT */}
        <aside className={`pl-card pl-pos-cart ${mobileTab === 'order' ? '' : 'pl-pos-pane-hidden-mobile'}`}>
          <div className="pl-pos-cart-head">
            <h2>
              <i className="fa-solid fa-cart-shopping" aria-hidden="true" /> Current Order ({totals.itemCount})
            </h2>
            <div style={{ display: 'flex', gap: 6 }}>
              {cart.length > 0 && (
                <>
                  <button
                    type="button"
                    className="pl-btn pl-btn-ghost pl-btn-sm"
                    onClick={handleHoldOrder}
                    title="Park current order (F8)"
                  >
                    <i className="fa-solid fa-pause" aria-hidden="true" /> Hold
                  </button>
                  <button
                    type="button"
                    className="pl-btn pl-btn-ghost pl-btn-sm"
                    onClick={clearCurrentOrder}
                    style={{ color: '#e07a7a' }}
                  >
                    Clear
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Pickup vs Delivery Mode Toggle */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: '.78rem', color: 'var(--text-dim)', fontWeight: 600 }}>Order mode</span>
            <div className="pl-seg" role="group" aria-label="Order fulfillment mode">
              <button
                type="button"
                className={orderType === 'pickup' ? 'on' : ''}
                onClick={() => setOrderType('pickup')}
              >
                Pickup
              </button>
              <button
                type="button"
                className={orderType === 'delivery' ? 'on' : ''}
                onClick={() => setOrderType('delivery')}
              >
                Delivery
              </button>
            </div>
          </div>

          {/* Customer Profile Card */}
          <div className="pl-pos-customer-card">
            <div className="pl-pos-customer-top">
              <div className="pl-pos-customer-name">
                <i className="fa-solid fa-user" aria-hidden="true" />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {customer.name}
                </span>
                <Badge tone={customer.name === DEFAULT_POS_CUSTOMER.name ? 'neutral' : 'good'}>
                  {customer.name === DEFAULT_POS_CUSTOMER.name ? 'Walk-in' : 'Customer'}
                </Badge>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                {customer.name !== DEFAULT_POS_CUSTOMER.name && (
                  <button
                    type="button"
                    className="pl-btn pl-btn-ghost pl-btn-sm"
                    style={{ padding: '3px 7px', fontSize: '.74rem' }}
                    onClick={() => setCustomer(DEFAULT_POS_CUSTOMER)}
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  className="pl-btn pl-btn-primary pl-btn-sm"
                  onClick={openCustomerModal}
                  data-testid="pos-customer-btn"
                >
                  <i className="fa-solid fa-user-pen" aria-hidden="true" />
                  <span>{customer.name === DEFAULT_POS_CUSTOMER.name ? 'Select / Add' : 'Edit'}</span>
                </button>
              </div>
            </div>
            <div className="pl-pos-customer-sub">
              <span>{customer.phone}</span>
              <span>{customer.location || customer.city}</span>
            </div>
          </div>

          {/* Cart Items */}
          {cart.length === 0 ? (
            <EmptyState
              icon="fa-solid fa-hand-pointer"
              title="Order is empty"
              hint="Tap any product card or scan a barcode to add items."
            />
          ) : (
            <>
              <div style={{ maxHeight: 280, overflowY: 'auto', paddingRight: 2 }}>
                {cart.map((l) => {
                  const lineQty = getCartLineQty(l)
                  return (
                    <div key={l.product_id} className="pl-cart-line-wrap">
                      <div className="pl-cart-line">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {l.name}
                          </strong>
                          <small style={{ display: 'block', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                            {fmtMoney(l.unit_price)} {currency} / {l.sold_as_pill ? 'pill' : l.unit}
                            {l.margin !== null ? ` · ${l.margin}% margin` : ''}
                          </small>
                        </div>

                        {l.sold_as_pill ? (
                          <div className="qty">
                            <input
                              className="pl-input"
                              style={{ width: 48, padding: '4px 5px', textAlign: 'center' }}
                              type="number"
                              min="0"
                              value={l.units}
                              aria-label={`Packs of ${l.name}`}
                              onChange={(e) => handleSetLinePills(l, Math.max(0, Number(e.target.value) || 0), l.pills)}
                            />
                            <small>pk</small>
                            <input
                              className="pl-input"
                              style={{ width: 48, padding: '4px 5px', textAlign: 'center' }}
                              type="number"
                              min="0"
                              max={Math.max(0, l.pills_per_unit - 1)}
                              value={l.pills}
                              aria-label={`Loose pills of ${l.name}`}
                              onChange={(e) =>
                                handleSetLinePills(
                                  l,
                                  l.units,
                                  Math.max(0, Math.min(l.pills_per_unit - 1, Number(e.target.value) || 0))
                                )
                              }
                            />
                            <small>pl</small>
                          </div>
                        ) : (
                          <div className="qty">
                            <button
                              type="button"
                              aria-label={`Reduce ${l.name}`}
                              onClick={() => handleChangeQty(l.product_id, -1)}
                            >
                              −
                            </button>
                            <span style={{ minWidth: 20, textAlign: 'center' }}>{l.units}</span>
                            <button
                              type="button"
                              aria-label={`Add ${l.name}`}
                              onClick={() => handleChangeQty(l.product_id, +1)}
                            >
                              +
                            </button>
                          </div>
                        )}

                        <span className="pl-cart-line-amount">{fmtMoney(lineQty * l.unit_price)}</span>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <small style={{ color: 'var(--text-dim)' }}>Margin:</small>
                          <select
                            className="pl-select"
                            style={{ width: 'auto', padding: '2px 8px', fontSize: '.76rem' }}
                            value={l.margin === null ? '' : String(l.margin)}
                            onChange={(e) => handleApplyMargin(l.product_id, e.target.value === '' ? null : Number(e.target.value))}
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
                        <button
                          type="button"
                          className="pl-btn pl-btn-ghost pl-btn-sm"
                          style={{ padding: '2px 6px', fontSize: '.74rem', color: 'var(--text-dim)' }}
                          onClick={() => setCart((prev) => prev.filter((item) => item.product_id !== l.product_id))}
                          aria-label={`Remove ${l.name}`}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Order Totals & Discount */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10 }}>
                <div className="pl-cart-total">
                  <span style={{ color: 'var(--text-dim)' }}>Subtotal</span>
                  <span>{fmtMoney(totals.subtotal)} {currency}</span>
                </div>
                <div className="pl-cart-total">
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--text-dim)' }}>
                    <span>
                      Discount
                      {totals.discountAmount > 0 && discountMode === 'percent' ? ` (${discountValue}%)` : ''}
                    </span>
                    <button
                      type="button"
                      className="pl-btn pl-btn-ghost pl-btn-sm"
                      style={{ padding: '2px 8px', fontSize: '.74rem' }}
                      onClick={() => {
                        setDiscountModalMode(discountMode)
                        setDiscountModalInput(String(discountValue || 0))
                        setDiscountModalOpen(true)
                      }}
                      data-testid="pos-discount-btn"
                    >
                      Set
                    </button>
                  </span>
                  <span style={{ color: totals.discountAmount > 0 ? '#34d399' : 'var(--text-dim)' }}>
                    − {fmtMoney(totals.discountAmount)} {currency}
                  </span>
                </div>
                {totals.taxIncluded > 0 && (
                  <div className="pl-cart-total">
                    <span style={{ color: 'var(--text-dim)' }}>VAT ({taxRate}% incl.)</span>
                    <span style={{ color: 'var(--text-dim)' }}>{fmtMoney(totals.taxIncluded)} {currency}</span>
                  </div>
                )}
                <div className="pl-cart-total grand">
                  <span>Total Payable</span>
                  <span style={{ color: 'var(--accent)' }}>{fmtMoney(totals.totalPayable)} {currency}</span>
                </div>
              </div>

              {/* Payment Rail Selector */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '.76rem', color: 'var(--text-dim)' }}>
                  <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em' }}>Payment rail</span>
                  <span>{POS_PAYMENT_RAILS.find((r) => r.id === paymentMethod)?.label}</span>
                </div>
                <div className="pl-pos-rails" role="radiogroup" aria-label="Payment method">
                  {POS_PAYMENT_RAILS.map((rail) => (
                    <button
                      key={rail.id}
                      type="button"
                      role="radio"
                      aria-checked={paymentMethod === rail.id}
                      className={`pl-pos-rail-btn ${paymentMethod === rail.id ? 'active' : ''}`}
                      onClick={() => {
                        setPaymentMethod(rail.id)
                        setPayLinkInfo(null)
                        setError(null)
                      }}
                      data-testid={`pos-rail-${rail.id}`}
                    >
                      <i className={rail.icon} aria-hidden="true" />
                      <span>{rail.shortLabel}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Cash Tender & Change */}
              {paymentMethod === 'cash' && (
                <div>
                  <Field
                    label={`Cash received (${currency})`}
                    hint={`Change due: ${fmtMoney(tender.changeDue)} ${currency}`}
                  >
                    <input
                      className="pl-input"
                      type="number"
                      min="0"
                      step="0.01"
                      placeholder={totals.totalPayable.toFixed(2)}
                      value={amountPaid}
                      onChange={(e) => setAmountPaid(e.target.value)}
                    />
                  </Field>
                  {quickTenderOptions.length > 0 && (
                    <div className="pl-pos-quick-tender" aria-label="Quick cash tender amounts">
                      {quickTenderOptions.map((amt, idx) => (
                        <button
                          key={amt}
                          type="button"
                          onClick={() => setAmountPaid(String(amt))}
                        >
                          {idx === 0 ? `Exact (${fmtMoney(amt)})` : fmtMoney(amt)}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {error && (
                <p role="alert" style={{ color: '#e07a7a', fontSize: '.85rem', margin: 0 }}>
                  {error}
                </p>
              )}

              {payLinkInfo && (
                <div
                  data-testid="pos-pay-link-card"
                  style={{ padding: 10, borderRadius: 10, border: '1px solid var(--accent)', fontSize: '.82rem' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                    <span style={{ color: 'var(--text)', fontWeight: 600 }}>
                      {payLinkInfo.locked
                        ? `${PAYMENT_PROVIDERS[payLinkInfo.provider]?.name ?? payLinkInfo.provider} Checkout Ready`
                        : 'Multi-Gateway Checkout Ready'}
                    </span>
                    <Badge tone={payLinkInfo.mode === 'live' ? 'good' : payLinkInfo.mode === 'direct' ? 'info' : 'warn'}>
                      {payLinkInfo.mode === 'live' ? 'LIVE' : payLinkInfo.mode === 'direct' ? 'BANK' : 'SANDBOX'}
                    </Badge>
                  </div>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                    <input
                      className="pl-input"
                      readOnly
                      value={payLinkInfo.url}
                      aria-label="POS payment link"
                      style={{ fontSize: '.78rem', padding: '6px 8px' }}
                    />
                    <a
                      className="pl-btn pl-btn-primary pl-btn-sm"
                      href={payLinkInfo.url}
                      target="_blank"
                      rel="noreferrer"
                      data-testid="pos-pay-link-open"
                    >
                      Open
                    </a>
                    {payLinkInfo.externalUrl && (
                      <a
                        className="pl-btn pl-btn-ghost pl-btn-sm"
                        href={payLinkInfo.externalUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Direct
                      </a>
                    )}
                  </div>
                </div>
              )}

              <div className="pl-form-actions" style={{ justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 2 }}>
                <button
                  type="button"
                  className="pl-btn pl-btn-ghost pl-btn-sm"
                  disabled={payLinkBusy || cart.length === 0}
                  onClick={() => void createPosPayLink()}
                >
                  <i className="fa-solid fa-link" aria-hidden="true" /> {payLinkBusy ? 'Creating…' : 'Pay Link'}
                </button>
                <button
                  type="button"
                  className="pl-btn pl-btn-primary"
                  style={{ flex: 1, justifyContent: 'center' }}
                  disabled={busy || cart.length === 0}
                  onClick={() => void checkout()}
                  data-testid="pos-checkout-btn"
                >
                  <i className="fa-solid fa-check" aria-hidden="true" />{' '}
                  {busy ? 'Processing…' : `Complete Sale · ${fmtMoney(totals.totalPayable)} ${currency}`}
                </button>
              </div>
            </>
          )}
        </aside>
      </div>

      {/* CUSTOMER LOOKUP & PROFILE MODAL */}
      <Modal open={customerModalOpen} title="Customer Profile & Lookup" onClose={() => setCustomerModalOpen(false)}>
        <form onSubmit={(e) => void saveCustomerProfile(e)}>
          <Field label="Lookup Existing Customer (name or phone)">
            <div style={{ position: 'relative' }}>
              <input
                className="pl-input"
                placeholder="Type 2+ characters to search saved customers…"
                value={customerSearchQuery}
                onChange={(e) => {
                  const val = e.target.value
                  setCustomerSearchQuery(val)
                  if (val.trim().length < 2) setCustomerSearchResults([])
                }}
              />
              {searchingCustomer && (
                <small style={{ display: 'block', color: 'var(--text-dim)', marginTop: 4 }}>Searching…</small>
              )}
              {customerSearchResults.length > 0 && (
                <div className="pl-pos-cust-results" role="listbox" aria-label="Matching customers">
                  {customerSearchResults.map((raw, idx) => {
                    const c = normalizePosCustomer(raw)
                    return (
                      <button
                        key={c.id || `${c.phone}-${idx}`}
                        type="button"
                        className="pl-pos-cust-result-row"
                        onClick={() => selectExistingCustomer(raw)}
                      >
                        <div>
                          <strong>{c.name}</strong>
                          <span style={{ color: 'var(--text-dim)', marginLeft: 8 }}>{c.phone}</span>
                        </div>
                        <span style={{ color: 'var(--accent)', fontWeight: 600, fontSize: '.76rem' }}>Select</span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </Field>

          <div className="pl-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Customer Full Name *">
              <input
                className="pl-input"
                required
                placeholder="e.g. Abebe Bikila"
                value={customerDraft.name}
                onChange={(e) => setCustomerDraft((p) => ({ ...p, name: e.target.value }))}
              />
            </Field>
            <Field label="Phone Number *">
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  className="pl-select"
                  style={{ width: 96, flexShrink: 0 }}
                  value={customerCountryCode}
                  onChange={(e) => setCustomerCountryCode(e.target.value)}
                  aria-label="Country code"
                >
                  {POS_COUNTRY_CODES.map((cc) => (
                    <option key={`${cc.c}-${cc.n}`} value={cc.c}>
                      {cc.f} {cc.c}
                    </option>
                  ))}
                </select>
                <input
                  className="pl-input"
                  type="tel"
                  required
                  placeholder="911 234 567"
                  value={customerPhoneLocal}
                  onChange={(e) => setCustomerPhoneLocal(e.target.value)}
                />
              </div>
            </Field>
          </div>

          <div className="pl-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="City / Region">
              <select
                className="pl-select"
                value={customerDraft.city}
                onChange={(e) => setCustomerDraft((p) => ({ ...p, city: e.target.value }))}
              >
                {POS_CITIES.map((city) => (
                  <option key={city} value={city}>
                    {city}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Specific Location / Address">
              <input
                className="pl-input"
                placeholder="e.g. Bole, near airport…"
                value={customerDraft.location}
                onChange={(e) => setCustomerDraft((p) => ({ ...p, location: e.target.value }))}
              />
            </Field>
          </div>

          <div className="pl-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Source">
              <select
                className="pl-select"
                value={customerDraft.source || 'walk-in'}
                onChange={(e) =>
                  setCustomerDraft((p) => ({ ...p, source: e.target.value as PosCustomerInfo['source'] }))
                }
              >
                {POS_CUSTOMER_SOURCES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Referral Code (Optional)">
              <input
                className="pl-input"
                placeholder="e.g. ASELLA10"
                value={customerDraft.referral_code || ''}
                onChange={(e) => setCustomerDraft((p) => ({ ...p, referral_code: e.target.value.toUpperCase() }))}
              />
            </Field>
          </div>

          <div className="pl-form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Gender">
              <select
                className="pl-select"
                value={customerDraft.gender || ''}
                onChange={(e) =>
                  setCustomerDraft((p) => ({ ...p, gender: e.target.value as PosCustomerInfo['gender'] }))
                }
              >
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </select>
            </Field>
            <Field label="Age Group">
              <select
                className="pl-select"
                value={customerDraft.age_group || ''}
                onChange={(e) =>
                  setCustomerDraft((p) => ({ ...p, age_group: e.target.value as PosCustomerInfo['age_group'] }))
                }
              >
                <option value="">—</option>
                {POS_AGE_GROUPS.map((ag) => (
                  <option key={ag.value} value={ag.value}>
                    {ag.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <Field label="Customer Notes / Delivery Remarks">
            <textarea
              className="pl-input"
              rows={2}
              placeholder="Preferences, delivery landmarks, or instructions…"
              value={customerDraft.notes || ''}
              onChange={(e) => setCustomerDraft((p) => ({ ...p, notes: e.target.value }))}
            />
          </Field>

          {customerFormError && (
            <p role="alert" style={{ color: '#e07a7a', fontSize: '.85rem', marginBottom: 8 }}>
              {customerFormError}
            </p>
          )}

          <div className="pl-form-actions" style={{ justifyContent: 'space-between' }}>
            <button
              type="button"
              className="pl-btn pl-btn-ghost pl-btn-sm"
              onClick={() => {
                setCustomer(DEFAULT_POS_CUSTOMER)
                setCustomerModalOpen(false)
              }}
            >
              Reset to Walk-in
            </button>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setCustomerModalOpen(false)}>
                Cancel
              </button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={savingCustomer}>
                {savingCustomer ? 'Saving…' : 'Save Customer Profile'}
              </button>
            </div>
          </div>
        </form>
      </Modal>

      {/* ORDER DISCOUNT MODAL */}
      <Modal open={discountModalOpen} title="Set Order Discount" onClose={() => setDiscountModalOpen(false)}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '.86rem', color: 'var(--text-dim)' }}>Discount type</span>
            <div className="pl-seg">
              <button
                type="button"
                className={discountModalMode === 'fixed' ? 'on' : ''}
                onClick={() => setDiscountModalMode('fixed')}
              >
                Fixed ({currency})
              </button>
              <button
                type="button"
                className={discountModalMode === 'percent' ? 'on' : ''}
                onClick={() => setDiscountModalMode('percent')}
              >
                Percent (%)
              </button>
            </div>
          </div>

          <Field
            label={discountModalMode === 'percent' ? 'Discount Percentage (0–100%)' : `Discount Amount (${currency})`}
            hint={`Subtotal: ${fmtMoney(totals.subtotal)} ${currency}`}
          >
            <input
              className="pl-input"
              type="number"
              min="0"
              max={discountModalMode === 'percent' ? 100 : totals.subtotal}
              step="0.01"
              value={discountModalInput}
              onChange={(e) => setDiscountModalInput(e.target.value)}
              autoFocus
            />
          </Field>

          <div className="pl-form-actions" style={{ justifyContent: 'space-between' }}>
            <button
              type="button"
              className="pl-btn pl-btn-ghost"
              onClick={() => {
                setDiscountMode('fixed')
                setDiscountValue(0)
                setDiscountModalOpen(false)
              }}
            >
              Clear Discount
            </button>
            <button
              type="button"
              className="pl-btn pl-btn-primary"
              onClick={() => {
                const parsed = Math.max(0, Number(discountModalInput) || 0)
                setDiscountMode(discountModalMode)
                setDiscountValue(
                  discountModalMode === 'percent'
                    ? Math.min(100, parsed)
                    : Math.min(totals.subtotal, parsed)
                )
                setDiscountModalOpen(false)
              }}
            >
              Apply Discount
            </button>
          </div>
        </div>
      </Modal>

      {/* HELD / PARKED ORDERS MODAL */}
      <Modal open={heldModalOpen} title={`Held Orders (${heldOrders.length})`} onClose={() => setHeldModalOpen(false)}>
        {heldOrders.length === 0 ? (
          <EmptyState
            icon="fa-solid fa-pause-circle"
            title="No held orders"
            hint="Use Hold on an active cart when a customer needs a moment."
          />
        ) : (
          <div>
            {heldOrders.map((order) => (
              <div key={order.id} className="pl-pos-held-row">
                <div>
                  <strong>{order.label}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)', fontVariantNumeric: 'tabular-nums' }}>
                    {order.item_count} items · {fmtMoney(order.total)} {currency} · {order.order_type} · {fmtDateTime(order.held_at)}
                  </small>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    className="pl-btn pl-btn-primary pl-btn-sm"
                    onClick={() => handleResumeHeldOrder(order.id)}
                  >
                    Resume
                  </button>
                  <button
                    type="button"
                    className="pl-btn pl-btn-ghost pl-btn-sm"
                    style={{ color: '#e07a7a' }}
                    onClick={() => handleDeleteHeldOrder(order.id)}
                    aria-label={`Discard held order ${order.label}`}
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* QUICK START SHIFT MODAL */}
      <Modal open={shiftModalOpen} title="Start Cash Drawer Shift" onClose={() => setShiftModalOpen(false)}>
        <form onSubmit={(e) => void handleStartShift(e)}>
          <Field label={`Opening cash in drawer (${currency})`}>
            <input
              className="pl-input"
              type="number"
              min="0"
              step="0.01"
              value={openingBalance}
              onChange={(e) => setOpeningBalance(e.target.value)}
              autoFocus
            />
          </Field>
          <div className="pl-form-actions">
            <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setShiftModalOpen(false)}>
              Cancel
            </button>
            <button type="submit" className="pl-btn pl-btn-primary" disabled={shiftBusy}>
              {shiftBusy ? 'Opening…' : 'Open Shift'}
            </button>
          </div>
        </form>
      </Modal>

      {/* 80MM THERMAL RECEIPT MODAL */}
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
            currency,
            tax_rate: cfg?.tax_rate,
            invoice_no: receipt.sale.invoice_no,
            created_at: receipt.sale.created_at,
            cashier_name: me?.full_name,
            customer_name: receipt.sale.customer_name || undefined,
            items: receipt.items,
            subtotal: Number(receipt.sale.subtotal),
            discount: Number(receipt.sale.discount),
            tax_amount: receipt.sale.tax_amount !== undefined ? Number(receipt.sale.tax_amount) : undefined,
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
