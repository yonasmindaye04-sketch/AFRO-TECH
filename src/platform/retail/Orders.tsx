import { useMemo, useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, ErrorBox, Field, Modal, OkBox, PageHeader, Spinner, StatCard } from '../ui'
import { evaluateThreeWayMatch } from '../utils/erpEngine'

interface OrderItem {
  product_id: string
  product_name: string
  quantity: number
  unit_price?: number
  unit_cost?: number
}

interface Quotation {
  id: string
  number: string
  customer_id: string | null
  customer_name: string
  valid_until: string
  status: 'draft' | 'sent' | 'ordered' | 'expired'
  total: string
  notes: string | null
  items: OrderItem[]
  created_at: string
}

interface SalesOrder {
  id: string
  number: string
  customer_id: string | null
  customer_name: string
  delivery_date: string
  status: 'to_deliver' | 'completed' | 'cancelled'
  total: string
  notes: string | null
  items: OrderItem[]
  created_at: string
}

interface PurchaseOrder {
  id: string
  number: string
  supplier_id: string | null
  supplier_name: string
  expected_date: string
  status: 'draft' | 'submitted' | 'received'
  total: string
  notes: string | null
  items: OrderItem[]
  created_at: string
}

interface ProductOpt {
  id: string
  name: string
  sell_price: string
  cost_price: string
  stock: number
}

interface PartnerOpt {
  id: string
  name: string
}

interface DraftLine {
  product_id: string
  quantity: string
  unit_rate: string
}

type Tab = 'quotations' | 'sales-orders' | 'purchase-orders'

const emptyLine: DraftLine = { product_id: '', quantity: '1', unit_rate: '' }

const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warn' | 'good' | 'bad'> = {
  draft: 'neutral',
  sent: 'info',
  to_deliver: 'warn',
  submitted: 'warn',
  ordered: 'good',
  completed: 'good',
  received: 'good',
  expired: 'bad',
  cancelled: 'bad',
}

export default function Orders(): JSX.Element {
  const [tab, setTab] = useState<Tab>('quotations')
  const [notice, setNotice] = useState<string | null>(null)
  const [actionErr, setActionErr] = useState<string | null>(null)

  const quotesQ = useApiData<{ quotations: Quotation[] }>('/erp/quotations')
  const soQ = useApiData<{ sales_orders: SalesOrder[] }>('/erp/sales-orders')
  const poQ = useApiData<{ purchase_orders: PurchaseOrder[] }>('/erp/purchase-orders')
  const productsQ = useApiData<{ products: ProductOpt[] }>('/retail/products')
  const customersQ = useApiData<{ customers: PartnerOpt[] }>('/retail/customers')
  const suppliersQ = useApiData<{ suppliers: PartnerOpt[] }>('/retail/suppliers')

  const [openCreate, setOpenCreate] = useState<Tab | null>(null)
  const [partyId, setPartyId] = useState('')
  const [targetDate, setTargetDate] = useState(() => new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10))
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<DraftLine[]>([{ ...emptyLine }])
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const [payMethod, setPayMethod] = useState('cash')
  const [convertTarget, setConvertTarget] = useState<{ kind: 'quotation' | 'so'; id: string; number: string; total: string } | null>(null)
  const [poReceiveTarget, setPoReceiveTarget] = useState<PurchaseOrder | null>(null)
  const [poRecRows, setPoRecRows] = useState<Array<{ product_id: string; product_name: string; ordered_qty: number; received_qty: string; ordered_cost: number; billed_unit_cost: string }>>([])
  const [matchNote, setMatchNote] = useState('')

  const products = productsQ.data?.products ?? []
  const quotations = quotesQ.data?.quotations ?? []
  const salesOrders = soQ.data?.sales_orders ?? []
  const purchaseOrders = poQ.data?.purchase_orders ?? []

  const openQuoteVal = quotations.filter((q) => q.status === 'draft' || q.status === 'sent').reduce((s, q) => s + Number(q.total), 0)
  const pendingSoCount = salesOrders.filter((o) => o.status === 'to_deliver').length
  const openPoCount = purchaseOrders.filter((p) => p.status !== 'received').length
  const openPoVal = purchaseOrders.filter((p) => p.status !== 'received').reduce((s, p) => s + Number(p.total), 0)

  const reloadAll = (): void => {
    quotesQ.reload()
    soQ.reload()
    poQ.reload()
  }

  const openModal = (kind: Tab): void => {
    setFormErr(null)
    setPartyId('')
    setNotes('')
    setLines([{ ...emptyLine }])
    setTargetDate(new Date(Date.now() + (kind === 'quotations' ? 14 : 7) * 86400000).toISOString().slice(0, 10))
    setOpenCreate(kind)
  }

  const updateLine = (idx: number, patch: Partial<DraftLine>, kind: Tab): void => {
    setLines((prev) =>
      prev.map((l, i) => {
        if (i !== idx) return l
        const next = { ...l, ...patch }
        if (patch.product_id && patch.unit_rate === undefined) {
          const prod = products.find((p) => p.id === patch.product_id)
          if (prod) {
            next.unit_rate = kind === 'purchase-orders' ? String(prod.cost_price) : String(prod.sell_price)
          }
        }
        return next
      })
    )
  }

  const draftTotal = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_rate) || 0), 0)

  const submitOrder = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!openCreate) return
    const validLines = lines.filter((l) => l.product_id && Number(l.quantity) > 0)
    if (!validLines.length) {
      setFormErr('Add at least one valid product line.')
      return
    }
    setBusy(true)
    setFormErr(null)
    try {
      if (openCreate === 'quotations') {
        await api.post('/erp/quotations', {
          customer_id: partyId || null,
          valid_until: targetDate,
          status: 'sent',
          notes: notes.trim() || null,
          items: validLines.map((l) => ({
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_rate),
          })),
        })
        setNotice('Quotation created and ready to send.')
      } else if (openCreate === 'sales-orders') {
        await api.post('/erp/sales-orders', {
          customer_id: partyId || null,
          delivery_date: targetDate,
          notes: notes.trim() || null,
          items: validLines.map((l) => ({
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit_price: Number(l.unit_rate),
          })),
        })
        setNotice('Sales Order confirmed.')
      } else {
        await api.post('/erp/purchase-orders', {
          supplier_id: partyId || null,
          expected_date: targetDate,
          status: 'submitted',
          notes: notes.trim() || null,
          items: validLines.map((l) => ({
            product_id: l.product_id,
            quantity: Number(l.quantity),
            unit_cost: Number(l.unit_rate),
          })),
        })
        setNotice('Purchase Order submitted to supplier.')
      }
      setOpenCreate(null)
      reloadAll()
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const markQuoteSent = async (q: Quotation): Promise<void> => {
    setActionErr(null)
    try {
      await api.patch(`/erp/quotations/${q.id}`, { status: 'sent' })
      setNotice(`${q.number} marked as sent.`)
      quotesQ.reload()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Update failed')
    }
  }

  const confirmConvert = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!convertTarget) return
    setBusy(true)
    setActionErr(null)
    try {
      if (convertTarget.kind === 'quotation') {
        await api.post(`/erp/quotations/${convertTarget.id}/convert-sale`, { payment_method: payMethod })
        setNotice(`${convertTarget.number} converted into a completed POS Sale & GL entry.`)
      } else {
        await api.post(`/erp/sales-orders/${convertTarget.id}/deliver`, { payment_method: payMethod })
        setNotice(`${convertTarget.number} delivered, stock deducted & posted to General Ledger.`)
      }
      setConvertTarget(null)
      reloadAll()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Conversion failed')
    } finally {
      setBusy(false)
    }
  }

  const openThreeWayModal = (po: PurchaseOrder): void => {
    setActionErr(null)
    setMatchNote('')
    setPoRecRows(
      po.items.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        ordered_qty: it.quantity,
        received_qty: String(it.quantity),
        ordered_cost: Number(it.unit_cost ?? 0),
        billed_unit_cost: String(Number(it.unit_cost ?? 0)),
      }))
    )
    setPoReceiveTarget(po)
  }

  const threeWayMatch = useMemo(() => {
    if (!poReceiveTarget) return null
    return evaluateThreeWayMatch(
      poReceiveTarget.items.map((it) => ({
        product_id: it.product_id,
        product_name: it.product_name,
        quantity: it.quantity,
        unit_cost: Number(it.unit_cost ?? 0),
      })),
      poRecRows.map((r) => ({
        product_id: r.product_id,
        received_qty: Number(r.received_qty || 0),
        billed_unit_cost: Number(r.billed_unit_cost || 0),
      }))
    )
  }, [poReceiveTarget, poRecRows])

  const submitThreeWayReceive = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!poReceiveTarget || !threeWayMatch) return
    setBusy(true)
    setActionErr(null)
    try {
      await api.post(`/erp/purchase-orders/${poReceiveTarget.id}/receive`, {
        received_items: poRecRows.map((r) => ({
          product_id: r.product_id,
          received_qty: Number(r.received_qty || 0),
          billed_unit_cost: Number(r.billed_unit_cost || 0),
        })),
        paid_amount: threeWayMatch.receivedTotal,
        match_note: matchNote.trim() || threeWayMatch.status.toUpperCase(),
      })
      setNotice(
        `${poReceiveTarget.number} verified (${threeWayMatch.status.toUpperCase()}) & received — stock batches, Stock Ledger & GL updated.`
      )
      setPoReceiveTarget(null)
      reloadAll()
    } catch (err) {
      setActionErr(err instanceof Error ? err.message : 'Could not receive PO')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Orders & Quotations"
        subtitle="Selling and buying cycle — Quotations, Sales Orders and Purchase Orders"
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="sub-tabs">
              <button type="button" className={`sub-tab ${tab === 'quotations' ? 'sub-tab-active' : ''}`} onClick={() => setTab('quotations')}>
                Quotations ({quotations.length})
              </button>
              <button type="button" className={`sub-tab ${tab === 'sales-orders' ? 'sub-tab-active' : ''}`} onClick={() => setTab('sales-orders')}>
                Sales Orders ({salesOrders.length})
              </button>
              <button type="button" className={`sub-tab ${tab === 'purchase-orders' ? 'sub-tab-active' : ''}`} onClick={() => setTab('purchase-orders')}>
                Purchase Orders ({purchaseOrders.length})
              </button>
            </div>
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => openModal(tab)}>
              <i className="fa-solid fa-plus" aria-hidden="true" />{' '}
              {tab === 'quotations' ? 'New Quote' : tab === 'sales-orders' ? 'New Sales Order' : 'New Purchase Order'}
            </button>
          </div>
        }
      />

      <div className="pl-stats">
        <StatCard icon="fa-solid fa-file-signature" label="Open Quotes Value" value={`${fmtMoney(openQuoteVal)} ETB`} />
        <StatCard icon="fa-solid fa-truck-fast" label="Pending Sales Orders" value={pendingSoCount} />
        <StatCard icon="fa-solid fa-clipboard-list" label="Open Purchase Orders" value={openPoCount} />
        <StatCard icon="fa-solid fa-coins" label="Incoming PO Value" value={`${fmtMoney(openPoVal)} ETB`} />
      </div>

      {notice && <OkBox message={notice} />}
      {actionErr && <ErrorBox message={actionErr} />}

      {tab === 'quotations' && (
        quotesQ.loading ? (
          <Spinner />
        ) : !quotations.length ? (
          <EmptyState icon="fa-solid fa-file-signature" title="No quotations yet" hint="Create a customer quotation and convert it to a sale in one click." />
        ) : (
          <DataTable
            rows={quotations}
            searchPlaceholder="Search quotations…"
            columns={[
              { key: 'number', header: 'Quote #', render: (q) => <strong>{q.number}</strong>, width: '110px' },
              { key: 'customer_name', header: 'Customer', render: (q) => q.customer_name },
              {
                key: 'items',
                header: 'Items',
                render: (q) => q.items.map((i) => `${i.product_name} ×${i.quantity}`).join(', ') || '—',
                searchText: (q) => q.items.map((i) => i.product_name).join(' '),
              },
              { key: 'valid_until', header: 'Valid Until', render: (q) => fmtDate(q.valid_until), width: '120px' },
              { key: 'total', header: 'Total', render: (q) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtMoney(q.total)} ETB</span> },
              {
                key: 'status',
                header: 'Status',
                render: (q) => <Badge tone={STATUS_TONE[q.status] ?? 'neutral'}>{q.status.toUpperCase()}</Badge>,
                width: '100px',
              },
              {
                key: 'act',
                header: '',
                width: '210px',
                render: (q) => (
                  <div className="pl-row-actions">
                    {q.status === 'draft' && (
                      <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => markQuoteSent(q)}>
                        Send
                      </button>
                    )}
                    {q.status !== 'ordered' && (
                      <button
                        type="button"
                        className="pl-btn pl-btn-primary pl-btn-sm"
                        onClick={() => setConvertTarget({ kind: 'quotation', id: q.id, number: q.number, total: q.total })}
                      >
                        Convert to Sale
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )
      )}

      {tab === 'sales-orders' && (
        soQ.loading ? (
          <Spinner />
        ) : !salesOrders.length ? (
          <EmptyState icon="fa-solid fa-truck-fast" title="No sales orders yet" hint="Confirm wholesale or scheduled deliveries as Sales Orders." />
        ) : (
          <DataTable
            rows={salesOrders}
            searchPlaceholder="Search sales orders…"
            columns={[
              { key: 'number', header: 'Order #', render: (o) => <strong>{o.number}</strong>, width: '110px' },
              { key: 'customer_name', header: 'Customer', render: (o) => o.customer_name },
              {
                key: 'items',
                header: 'Items',
                render: (o) => o.items.map((i) => `${i.product_name} ×${i.quantity}`).join(', ') || '—',
                searchText: (o) => o.items.map((i) => i.product_name).join(' '),
              },
              { key: 'delivery_date', header: 'Delivery Date', render: (o) => fmtDate(o.delivery_date), width: '125px' },
              { key: 'total', header: 'Total', render: (o) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtMoney(o.total)} ETB</span> },
              {
                key: 'status',
                header: 'Status',
                render: (o) => <Badge tone={STATUS_TONE[o.status] ?? 'neutral'}>{o.status.replace('_', ' ').toUpperCase()}</Badge>,
                width: '120px',
              },
              {
                key: 'act',
                header: '',
                width: '170px',
                render: (o) =>
                  o.status !== 'completed' ? (
                    <div className="pl-row-actions">
                      <button
                        type="button"
                        className="pl-btn pl-btn-primary pl-btn-sm"
                        onClick={() => setConvertTarget({ kind: 'so', id: o.id, number: o.number, total: o.total })}
                      >
                        Deliver & Invoice
                      </button>
                    </div>
                  ) : null,
              },
            ]}
          />
        )
      )}

      {tab === 'purchase-orders' && (
        poQ.loading ? (
          <Spinner />
        ) : !purchaseOrders.length ? (
          <EmptyState icon="fa-solid fa-clipboard-list" title="No purchase orders yet" hint="Submit a Purchase Order and receive it directly into stock batches." />
        ) : (
          <DataTable
            rows={purchaseOrders}
            searchPlaceholder="Search purchase orders…"
            columns={[
              { key: 'number', header: 'PO #', render: (p) => <strong>{p.number}</strong>, width: '110px' },
              { key: 'supplier_name', header: 'Supplier', render: (p) => p.supplier_name },
              {
                key: 'items',
                header: 'Items',
                render: (p) => p.items.map((i) => `${i.product_name} ×${i.quantity}`).join(', ') || '—',
                searchText: (p) => p.items.map((i) => i.product_name).join(' '),
              },
              { key: 'expected_date', header: 'Expected', render: (p) => fmtDate(p.expected_date), width: '120px' },
              { key: 'total', header: 'Total', render: (p) => <span style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{fmtMoney(p.total)} ETB</span> },
              {
                key: 'status',
                header: 'Status',
                render: (p) => <Badge tone={STATUS_TONE[p.status] ?? 'neutral'}>{p.status.toUpperCase()}</Badge>,
                width: '110px',
              },
              {
                key: 'act',
                header: '',
                width: '150px',
                render: (p) =>
                  p.status !== 'received' ? (
                    <div className="pl-row-actions">
                      <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => openThreeWayModal(p)}>
                        3-Way Receive
                      </button>
                    </div>
                  ) : null,
              },
            ]}
          />
        )
      )}

      <Modal
        open={openCreate !== null}
        wide
        title={openCreate === 'quotations' ? 'New Quotation' : openCreate === 'sales-orders' ? 'New Sales Order' : 'New Purchase Order'}
        onClose={() => setOpenCreate(null)}
      >
        {openCreate && (
          <form onSubmit={submitOrder}>
            <div className="pl-grid-2">
              <Field label={openCreate === 'purchase-orders' ? 'Supplier' : 'Customer'}>
                <select className="pl-select" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
                  <option value="">{openCreate === 'purchase-orders' ? 'Select supplier…' : 'Walk-in / general customer'}</option>
                  {(openCreate === 'purchase-orders' ? suppliersQ.data?.suppliers ?? [] : customersQ.data?.customers ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={openCreate === 'quotations' ? 'Valid until' : openCreate === 'sales-orders' ? 'Delivery date' : 'Expected receipt date'}>
                <input className="pl-input" type="date" required value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
              </Field>
            </div>

            {lines.map((l, idx) => (
              <div key={idx} className="pl-card" style={{ padding: 14, marginBottom: 12 }}>
                <div className="pl-grid-2">
                  <Field label={`Product ${idx + 1}`}>
                    <select className="pl-select" required value={l.product_id} onChange={(e) => updateLine(idx, { product_id: e.target.value }, openCreate)}>
                      <option value="">Select product…</option>
                      {products.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} (Stock: {p.stock})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <div className="pl-grid-2">
                    <Field label="Quantity">
                      <input className="pl-input" type="number" min="1" required value={l.quantity} onChange={(e) => updateLine(idx, { quantity: e.target.value }, openCreate)} />
                    </Field>
                    <Field label={openCreate === 'purchase-orders' ? 'Unit cost (ETB)' : 'Unit price (ETB)'}>
                      <input className="pl-input" type="number" min="0" step="0.01" required value={l.unit_rate} onChange={(e) => updateLine(idx, { unit_rate: e.target.value }, openCreate)} />
                    </Field>
                  </div>
                </div>
                {lines.length > 1 && (
                  <button type="button" className="pl-btn pl-btn-danger pl-btn-sm" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}>
                    Remove line
                  </button>
                )}
              </div>
            ))}

            <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" style={{ marginBottom: 14 }} onClick={() => setLines((prev) => [...prev, { ...emptyLine }])}>
              <i className="fa-solid fa-plus" aria-hidden="true" /> Add product line
            </button>

            <Field label="Notes / terms">
              <input className="pl-input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Payment terms, delivery notes…" />
            </Field>

            <div className="pl-cart-total grand">
              <span>Order Total</span>
              <span style={{ color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(draftTotal)} ETB</span>
            </div>

            {formErr && <ErrorBox message={formErr} />}
            <div className="pl-form-actions">
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Create Document'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      <Modal
        open={convertTarget !== null}
        title={convertTarget ? `Invoice ${convertTarget.number}` : 'Convert to Sale'}
        onClose={() => setConvertTarget(null)}
      >
        {convertTarget && (
          <form onSubmit={confirmConvert}>
            <p style={{ color: 'var(--text-dim)', marginBottom: 14 }}>
              This creates a completed invoice for <strong style={{ color: 'var(--text)' }}>{fmtMoney(convertTarget.total)} ETB</strong>, deducts warehouse stock, and posts a General Ledger entry.
            </p>
            <Field label="Payment Method">
              <select className="pl-select" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank Transfer (CBE)</option>
                <option value="mobile">Telebirr / M-Pesa</option>
                <option value="credit">Credit (Accounts Receivable)</option>
              </select>
            </Field>
            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setConvertTarget(null)}>Cancel</button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
                {busy ? 'Processing…' : 'Confirm & Post'}
              </button>
            </div>
          </form>
        )}
      </Modal>
      <Modal
        open={poReceiveTarget !== null}
        wide
        title={poReceiveTarget ? `3-Way Match & Receive (${poReceiveTarget.number})` : 'Receive PO'}
        onClose={() => setPoReceiveTarget(null)}
      >
        {poReceiveTarget && threeWayMatch && (
          <form onSubmit={submitThreeWayReceive}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 10 }}>
              <span style={{ color: 'var(--text-dim)', fontSize: '.88rem' }}>
                Verify physical stock count and supplier invoice unit cost against the original PO before posting.
              </span>
              <Badge tone={threeWayMatch.status === 'matched' ? 'good' : threeWayMatch.status === 'partial' ? 'warn' : 'bad'}>
                {threeWayMatch.status === 'matched'
                  ? '3-WAY EXACT MATCH'
                  : threeWayMatch.status === 'partial'
                    ? 'PARTIAL DELIVERY'
                    : 'PRICE / QTY VARIANCE'}
              </Badge>
            </div>

            <div className="pl-table-wrap" style={{ marginBottom: 14 }}>
              <table className="pl-table" style={{ minWidth: 0 }}>
                <thead>
                  <tr>
                    <th>Item</th>
                    <th className="num">Ordered</th>
                    <th>Received Qty</th>
                    <th className="num">PO Cost</th>
                    <th>Billed Cost (ETB)</th>
                  </tr>
                </thead>
                <tbody>
                  {poRecRows.map((row, idx) => (
                    <tr key={row.product_id}>
                      <td><strong>{row.product_name}</strong></td>
                      <td className="num">{row.ordered_qty}</td>
                      <td style={{ width: 110 }}>
                        <input
                          className="pl-input"
                          type="number"
                          min="0"
                          aria-label={`Received quantity for ${row.product_name}`}
                          value={row.received_qty}
                          onChange={(e) =>
                            setPoRecRows((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, received_qty: e.target.value } : x))
                            )
                          }
                        />
                      </td>
                      <td className="num">{fmtMoney(row.ordered_cost)}</td>
                      <td style={{ width: 130 }}>
                        <input
                          className="pl-input"
                          type="number"
                          min="0"
                          step="0.01"
                          aria-label={`Billed cost for ${row.product_name}`}
                          value={row.billed_unit_cost}
                          onChange={(e) =>
                            setPoRecRows((prev) =>
                              prev.map((x, i) => (i === idx ? { ...x, billed_unit_cost: e.target.value } : x))
                            )
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Field label="Variance / Receiving Note (optional)">
              <input
                className="pl-input"
                placeholder="e.g. Short-shipped 2 boxes, backordered or price updated per invoice…"
                value={matchNote}
                onChange={(e) => setMatchNote(e.target.value)}
              />
            </Field>

            <div className="pl-cart-total grand" style={{ marginBottom: 12 }}>
              <span>
                PO Total: <strong>{fmtMoney(threeWayMatch.orderedTotal)} ETB</strong> · Variance:{' '}
                <strong style={{ color: Math.abs(threeWayMatch.amountVariance) < 0.01 ? '#34d399' : '#f59e0b' }}>
                  {threeWayMatch.amountVariance >= 0 ? '+' : ''}
                  {fmtMoney(threeWayMatch.amountVariance)} ETB
                </strong>
              </span>
              <span style={{ color: 'var(--accent)' }}>Verified Bill: {fmtMoney(threeWayMatch.receivedTotal)} ETB</span>
            </div>

            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setPoReceiveTarget(null)}>Cancel</button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
                {busy ? 'Posting Receipt…' : 'Confirm 3-Way Receipt'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
