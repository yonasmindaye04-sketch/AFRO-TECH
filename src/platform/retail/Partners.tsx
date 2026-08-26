import { useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Partner {
  id: string
  name: string
  phone: string | null
  email: string | null
  address?: string | null
  balance?: string
  payment_terms?: number
  created_at: string
}

/** Shared page for Suppliers and Customers (kind = 'suppliers' | 'customers'). */
export default function Partners({ kind }: { kind: 'suppliers' | 'customers' }): JSX.Element {
  const isSupplier = kind === 'suppliers'
  const { data, loading, reload } = useApiData<{ suppliers?: Partner[]; customers?: Partner[] }>(`/retail/${kind}`)
  const rows = (isSupplier ? data?.suppliers : data?.customers) ?? []

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '', payment_terms: '30' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Supplier payment collection (PPR finance parity)
  const [payFor, setPayFor] = useState<Partner | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [payNote, setPayNote] = useState('')
  const [payBusy, setPayBusy] = useState(false)

  const submitPayment = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!payFor) return
    setPayBusy(true)
    try {
      await api.post('/retail/supplier-payments', {
        supplier_id: payFor.id,
        amount: Number(payAmount),
        payment_method: payMethod,
        notes: payNote.trim() || null,
      })
      setPayFor(null)
      setPayAmount('')
      setPayNote('')
      reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setPayBusy(false)
    }
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post(`/retail/${kind}`, {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        ...(isSupplier ? { address: form.address.trim() || null, payment_terms: Number(form.payment_terms) || 30 } : {}),
      })
      setOpen(false)
      setForm({ name: '', phone: '', email: '', address: '', payment_terms: '30' })
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this record?')) return
    try {
      await api.del(`/retail/${kind}/${id}`)
      reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Delete failed — the record may be linked to transactions.')
    }
  }

  return (
    <div>
      <PageHeader
        title={isSupplier ? 'Suppliers' : 'Customers'}
        subtitle={isSupplier ? 'Who you buy stock from' : 'Your registered customers'}
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add {isSupplier ? 'supplier' : 'customer'}
          </button>
        }
      />
      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon={isSupplier ? 'fa-solid fa-truck-field' : 'fa-solid fa-users'} title={`No ${kind} yet`} />
      ) : (
        <DataTable
          rows={rows}
          columns={[
            { key: 'name', header: 'Name', render: (p) => <strong>{p.name}</strong> },
            { key: 'phone', header: 'Phone', render: (p) => p.phone ?? '—' },
            { key: 'email', header: 'Email', render: (p) => p.email ?? '—' },
            ...(isSupplier
              ? [
                  { key: 'addr', header: 'Address', render: (p: Partner) => p.address ?? '—' },
                  { key: 'terms', header: 'Terms', width: '80px', render: (p: Partner) => `${p.payment_terms ?? 30}d` },
                  {
                    key: 'bal',
                    header: 'We owe',
                    render: (p: Partner) => {
                      const bal = Number(p.balance ?? 0)
                      return bal > 0.001 ? <strong style={{ color: '#e07a7a' }}>{fmtMoney(bal)} ETB</strong> : <span style={{ color: '#34d399' }}>—</span>
                    },
                  },
                ]
              : []),
            { key: 'since', header: 'Since', render: (p) => fmtDate(p.created_at), width: '110px' },
            {
              key: 'act',
              header: '',
              width: isSupplier ? '170px' : '60px',
              render: (p: Partner) => (
                <div className="pl-row-actions">
                  {isSupplier && Number(p.balance ?? 0) > 0.001 && (
                    <button
                      type="button"
                      className="pl-btn pl-btn-primary pl-btn-sm"
                      onClick={() => {
                        setPayFor(p)
                        setPayAmount(String(Number(p.balance).toFixed(2)))
                      }}
                    >
                      Pay supplier
                    </button>
                  )}
                  <button type="button" className="pl-icon-btn danger" aria-label={`Delete ${p.name}`} onClick={() => remove(p.id)}>
                    <i className="fa-solid fa-trash-can" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={open} title={isSupplier ? 'Add supplier' : 'Add customer'} onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <Field label="Name">
            <input className="pl-input" required maxLength={160} value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <div className="pl-grid-2">
            <Field label="Phone">
              <input className="pl-input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
            <Field label="Email">
              <input className="pl-input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
            </Field>
          </div>
          {isSupplier && (
            <>
              <Field label="Address">
                <input className="pl-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
              </Field>
              <Field label="Payment terms (days)" hint="Used for supplier due tracking">
                <input className="pl-input" type="number" min="0" max="365" value={form.payment_terms} onChange={(e) => setForm((f) => ({ ...f, payment_terms: e.target.value }))} />
              </Field>
            </>
          )}
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Pay supplier (PPR finance parity) */}
      <Modal open={payFor !== null} title={payFor ? `Pay ${payFor.name}` : ''} onClose={() => setPayFor(null)}>
        <form onSubmit={submitPayment}>
          <p style={{ color: 'var(--text-dim)', marginBottom: 12 }}>
            Outstanding balance: <strong style={{ color: '#e07a7a' }}>{payFor ? fmtMoney(payFor.balance ?? 0) : ''} ETB</strong>
          </p>
          <Field label="Amount (ETB)">
            <input className="pl-input" type="number" min="0.01" step="0.01" required value={payAmount} onChange={(e) => setPayAmount(e.target.value)} />
          </Field>
          <div className="pl-grid-2">
            <Field label="Method">
              <select className="pl-select" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="bank">Bank transfer</option>
                <option value="card">Card</option>
                <option value="mobile">Mobile money</option>
              </select>
            </Field>
            <Field label="Note">
              <input className="pl-input" value={payNote} onChange={(e) => setPayNote(e.target.value)} />
            </Field>
          </div>
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={payBusy}>
              {payBusy ? 'Saving…' : 'Record payment'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
