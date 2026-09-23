import { useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Card, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Expense {
  id: string
  category: string
  description: string | null
  amount: string
  spent_at: string
  receipt_url: string | null
  is_recurring: boolean
  recurrence: string | null
  status: 'pending' | 'approved' | 'rejected'
  recorded_by_name: string | null
  created_at: string
}

interface Summary {
  this_month: number
  last_month: number
  this_year: number
  by_category: { category: string; total: number }[]
}

const CATEGORIES = ['Rent', 'Salaries', 'Utilities', 'Transport', 'Supplies', 'Maintenance', 'Tax & Fees', 'Marketing', 'Equipment', 'Other']

export default function Expenses(): JSX.Element {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [catFilter, setCatFilter] = useState('')
  const [search, setSearch] = useState('')

  const qs = [from && `from=${from}`, to && `to=${to}`, catFilter && `category=${encodeURIComponent(catFilter)}`, search && `search=${encodeURIComponent(search)}`].filter(Boolean).join('&')
  const { data, loading, reload } = useApiData<{ expenses: Expense[] }>(`/expenses?limit=200${qs ? '&' + qs : ''}`)
  const summaryQ = useApiData<Summary>('/expenses/summary')

  const [open, setOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState({ category: 'Other', description: '', amount: '', spent_at: new Date().toISOString().slice(0, 10), receipt_url: '', is_recurring: false, recurrence: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)

  const expenses = data?.expenses ?? []
  const summary = summaryQ.data

  const openNew = (): void => {
    setEditId(null)
    setForm({ category: 'Other', description: '', amount: '', spent_at: new Date().toISOString().slice(0, 10), receipt_url: '', is_recurring: false, recurrence: '' })
    setError(null)
    setOpen(true)
  }

  const openEdit = (e: Expense): void => {
    setEditId(e.id)
    setForm({ category: e.category, description: e.description ?? '', amount: e.amount, spent_at: e.spent_at.slice(0, 10), receipt_url: e.receipt_url ?? '', is_recurring: e.is_recurring, recurrence: e.recurrence ?? '' })
    setError(null)
    setOpen(true)
  }

  const submit = async (ev: FormEvent): Promise<void> => {
    ev.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const body = {
        category: form.category,
        description: form.description.trim() || null,
        amount: Number(form.amount),
        spent_at: form.spent_at || undefined,
        receipt_url: form.receipt_url.trim() || undefined,
        is_recurring: form.is_recurring,
        recurrence: form.is_recurring ? form.recurrence || undefined : undefined,
      }
      if (editId) {
        await api.patch(`/expenses/${editId}`, body)
      } else {
        await api.post('/expenses', body)
      }
      setOpen(false)
      void reload()
      void summaryQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!confirm('Delete this expense?')) return
    await api.del(`/expenses/${id}`)
    void reload()
    void summaryQ.reload()
  }

  const approve = async (id: string): Promise<void> => {
    await api.patch(`/expenses/${id}/approve`, {})
    void reload()
  }

  const reject = async (id: string): Promise<void> => {
    await api.patch(`/expenses/${id}/reject`, {})
    void reload()
  }

  const exportCsv = async (): Promise<void> => {
    setExporting(true)
    try {
      const res = await fetch(`/api/v1/expenses/export?${qs}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
      })
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `expenses-${new Date().toISOString().slice(0, 10)}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } finally {
      setExporting(false)
    }
  }

  if (loading && !data) return <Spinner />

  return (
    <div className="pl-page">
      <PageHeader title="Expenses" sub="Track and manage all business expenses">
        <button type="button" className="pl-btn pl-btn-ghost" onClick={exportCsv} disabled={exporting}>
          <i className="fa-solid fa-download" aria-hidden="true" /> {exporting ? 'Exporting...' : 'CSV'}
        </button>
        <button type="button" className="pl-btn pl-btn-primary" onClick={openNew}>
          <i className="fa-solid fa-plus" aria-hidden="true" /> Add Expense
        </button>
      </PageHeader>

      {/* Summary Stats */}
      {summary && (
        <div className="pl-stats">
          <div className="pl-stat">
            <div className="pl-stat-label">This Month</div>
            <div className="pl-stat-value">{fmtMoney(summary.this_month)} ETB</div>
          </div>
          <div className="pl-stat">
            <div className="pl-stat-label">Last Month</div>
            <div className="pl-stat-value">{fmtMoney(summary.last_month)} ETB</div>
          </div>
          <div className="pl-stat">
            <div className="pl-stat-label">This Year</div>
            <div className="pl-stat-value">{fmtMoney(summary.this_year)} ETB</div>
          </div>
          <div className="pl-stat">
            <div className="pl-stat-label">Top Category</div>
            <div className="pl-stat-value">{summary.by_category[0]?.category ?? '—'}</div>
          </div>
        </div>
      )}

      {/* Filters */}
      <Card>
        <div className="pl-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input className="pl-input" type="date" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} />
            <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>to</span>
            <input className="pl-input" type="date" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <select className="pl-input" style={{ width: 160 }} value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
            <option value="">All categories</option>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <input className="pl-input" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ maxWidth: 200 }} />
        </div>
      </Card>

      {/* Table */}
      {expenses.length === 0 ? (
        <EmptyState icon="fa-solid fa-file-invoice-dollar" title="No expenses recorded yet" />
      ) : (
        <DataTable
          columns={[
            { key: 'spent_at', title: 'Date', render: (r) => fmtDate(r.spent_at) },
            { key: 'category', title: 'Category' },
            { key: 'description', title: 'Description', render: (r) => r.description || '—' },
            { key: 'amount', title: 'Amount', render: (r) => `${fmtMoney(r.amount)} ETB`, align: 'right' },
            {
              key: 'status',
              title: 'Status',
              render: (r) => (
                <span style={{ fontWeight: 700, color: r.status === 'approved' ? '#059669' : r.status === 'rejected' ? '#dc2626' : '#d97706' }}>
                  {r.status}
                </span>
              ),
            },
            { key: 'recorded_by_name', title: 'By', render: (r) => r.recorded_by_name || '—' },
            {
              key: 'actions',
              title: '',
              render: (r) => (
                <div style={{ display: 'flex', gap: 6 }}>
                  {r.status === 'pending' && (
                    <>
                      <button type="button" className="pl-btn-icon" title="Approve" onClick={() => void approve(r.id)}>
                        <i className="fa-solid fa-check" />
                      </button>
                      <button type="button" className="pl-btn-icon" title="Reject" onClick={() => void reject(r.id)}>
                        <i className="fa-solid fa-xmark" />
                      </button>
                    </>
                  )}
                  <button type="button" className="pl-btn-icon" title="Edit" onClick={() => openEdit(r)}>
                    <i className="fa-solid fa-pen" />
                  </button>
                  <button type="button" className="pl-btn-icon" title="Delete" onClick={() => void remove(r.id)}>
                    <i className="fa-solid fa-trash" />
                  </button>
                </div>
              ),
            },
          ]}
          rows={expenses}
        />
      )}

      {/* Add/Edit Modal */}
      {open && (
        <Modal open={true} title={editId ? 'Edit Expense' : 'New Expense'} onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Category">
              <select className="pl-input" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Amount (ETB)">
              <input className="pl-input" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
            </Field>
            <Field label="Date">
              <input className="pl-input" type="date" value={form.spent_at} onChange={(e) => setForm({ ...form, spent_at: e.target.value })} />
            </Field>
            <Field label="Description">
              <input className="pl-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional note" />
            </Field>
            <Field label="Receipt URL">
              <input className="pl-input" value={form.receipt_url} onChange={(e) => setForm({ ...form, receipt_url: e.target.value })} placeholder="https://..." />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
              <input type="checkbox" checked={form.is_recurring} onChange={(e) => setForm({ ...form, is_recurring: e.target.checked })} />
              <span>Recurring expense</span>
            </label>
            {form.is_recurring && (
              <Field label="Recurrence">
                <select className="pl-input" value={form.recurrence} onChange={(e) => setForm({ ...form, recurrence: e.target.value })}>
                  <option value="">Select...</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </Field>
            )}
            {error && <p style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
                {busy ? 'Saving...' : editId ? 'Update' : 'Add Expense'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  )
}
