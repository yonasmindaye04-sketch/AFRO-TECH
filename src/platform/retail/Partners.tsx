import { useState, type FormEvent } from 'react'
import { api, fmtDate } from '../api'
import { useApiData } from '../hooks/useApiData'
import { DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Partner {
  id: string
  name: string
  phone: string | null
  email: string | null
  address?: string | null
  created_at: string
}

/** Shared page for Suppliers and Customers (kind = 'suppliers' | 'customers'). */
export default function Partners({ kind }: { kind: 'suppliers' | 'customers' }): JSX.Element {
  const isSupplier = kind === 'suppliers'
  const { data, loading, reload } = useApiData<{ suppliers?: Partner[]; customers?: Partner[] }>(`/retail/${kind}`)
  const rows = (isSupplier ? data?.suppliers : data?.customers) ?? []

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', address: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post(`/retail/${kind}`, {
        name: form.name.trim(),
        phone: form.phone.trim() || null,
        email: form.email.trim() || null,
        ...(isSupplier ? { address: form.address.trim() || null } : {}),
      })
      setOpen(false)
      setForm({ name: '', phone: '', email: '', address: '' })
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
            ...(isSupplier ? [{ key: 'addr', header: 'Address', render: (p: Partner) => p.address ?? '—' }] : []),
            { key: 'since', header: 'Since', render: (p) => fmtDate(p.created_at), width: '110px' },
            {
              key: 'act',
              header: '',
              width: '60px',
              render: (p) => (
                <div className="pl-row-actions">
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
            <Field label="Address">
              <input className="pl-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </Field>
          )}
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
