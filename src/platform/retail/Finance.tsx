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
  recorded_by: string | null
}

const CATEGORIES = ['Rent', 'Salaries', 'Utilities', 'Transport', 'Supplies', 'Maintenance', 'Tax & Fees', 'Other']

export default function Finance(): JSX.Element {
  const { data, loading, reload } = useApiData<{ expenses: Expense[] }>('/retail/expenses?limit=100')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ category: 'General', description: '', amount: '', spent_at: new Date().toISOString().slice(0, 10) })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const total = (data?.expenses ?? []).reduce((s, e) => s + Number(e.amount), 0)
  const thisMonth = (data?.expenses ?? [])
    .filter((e) => new Date(e.spent_at).getMonth() === new Date().getMonth() && new Date(e.spent_at).getFullYear() === new Date().getFullYear())
    .reduce((s, e) => s + Number(e.amount), 0)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/retail/expenses', {
        category: form.category,
        description: form.description.trim() || null,
        amount: Number(form.amount),
        spent_at: form.spent_at || undefined,
      })
      setOpen(false)
      setForm({ category: 'General', description: '', amount: '', spent_at: new Date().toISOString().slice(0, 10) })
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string): Promise<void> => {
    if (!window.confirm('Delete this expense?')) return
    await api.del(`/retail/expenses/${id}`).catch(() => undefined)
    reload()
  }

  return (
    <div>
      <PageHeader
        title="Expenses"
        subtitle="Track money going out — revenue comes automatically from sales"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Record expense
          </button>
        }
      />

      <div className="pl-stats">
        <Card className="" >
          <span style={{ color: 'var(--text-dim)', fontSize: '.82rem' }}>Total recorded</span>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '1.3rem' }}>{fmtMoney(total)} ETB</div>
        </Card>
        <Card>
          <span style={{ color: 'var(--text-dim)', fontSize: '.82rem' }}>This month</span>
          <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '1.3rem' }}>{fmtMoney(thisMonth)} ETB</div>
        </Card>
      </div>

      {loading ? (
        <Spinner />
      ) : !data?.expenses.length ? (
        <EmptyState icon="fa-solid fa-coins" title="No expenses recorded" hint="Rent, salaries, utilities — log them here to see true profit." />
      ) : (
        <DataTable
          rows={data.expenses}
          columns={[
            { key: 'date', header: 'Date', render: (x) => fmtDate(x.spent_at), width: '110px' },
            { key: 'cat', header: 'Category', render: (x) => x.category },
            { key: 'desc', header: 'Description', render: (x) => x.description ?? '—' },
            { key: 'amount', header: 'Amount', render: (x) => <strong>{fmtMoney(x.amount)} ETB</strong> },
            { key: 'by', header: 'Recorded by', render: (x) => x.recorded_by ?? '—' },
            {
              key: 'act',
              header: '',
              width: '60px',
              render: (x) => (
                <div className="pl-row-actions">
                  <button type="button" className="pl-icon-btn danger" aria-label="Delete expense" onClick={() => remove(x.id)}>
                    <i className="fa-solid fa-trash-can" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={open} title="Record expense" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="pl-grid-2">
            <Field label="Category">
              <select className="pl-select" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </Field>
            <Field label="Amount (ETB)">
              <input className="pl-input" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
          </div>
          <Field label="Description">
            <input className="pl-input" maxLength={300} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <Field label="Date">
            <input className="pl-input" type="date" required value={form.spent_at} onChange={(e) => setForm((f) => ({ ...f, spent_at: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save expense'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
