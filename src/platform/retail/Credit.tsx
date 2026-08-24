import { useState } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { exportCsv } from '../utils/csv'
import { DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface CreditRow {
  id: string
  name: string
  phone: string | null
  balance: string
}
interface Statement {
  customer: { id: string; name: string; phone: string | null }
  credit_sales: { id: string; invoice_no: string | null; total: string; amount_paid: string; due: string; created_at: string }[]
  payments: { id: string; amount: string; note: string | null; created_at: string; recorded_by: string | null }[]
  balance: number
}

export default function Credit(): JSX.Element {
  const { data, loading, reload } = useApiData<{ customers: CreditRow[] }>('/retail/credit')
  const [statement, setStatement] = useState<Statement | null>(null)
  const [payFor, setPayFor] = useState<CreditRow | null>(null)
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openStatement = async (c: CreditRow): Promise<void> => {
    try {
      const r = await api.get<Statement>(`/retail/customers/${c.id}/statement`)
      setStatement(r)
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Could not load statement')
    }
  }

  const settle = async (): Promise<void> => {
    if (!payFor) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/retail/customers/${payFor.id}/payments`, { amount: Number(amount), note: note.trim() || null })
      setPayFor(null)
      setAmount('')
      setNote('')
      setStatement(null)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed')
    } finally {
      setBusy(false)
    }
  }

  const rows = data?.customers ?? []
  const totalOutstanding = rows.reduce((s, r) => s + Number(r.balance), 0)

  return (
    <div>
      <PageHeader
        title="Customer Credit"
        subtitle="Outstanding khata balances — collect and keep a clean ledger"
        action={
          <button
            type="button"
            className="pl-btn pl-btn-ghost"
            onClick={() => exportCsv('credit-balances', ['Customer', 'Phone', 'Balance'], rows.map((r) => [r.name, r.phone, Number(r.balance).toFixed(2)]))}
          >
            <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export
          </button>
        }
      />

      <div className="pl-stats">
        <div className="pl-stat">
          <span className="pl-stat-icon"><i className="fa-solid fa-hand-holding-dollar" aria-hidden="true" /></span>
          <div>
            <span className="pl-stat-value">{fmtMoney(totalOutstanding)} ETB</span>
            <span className="pl-stat-label">Total outstanding across {rows.length} customers</span>
          </div>
        </div>
      </div>

      {loading ? (
        <Spinner />
      ) : rows.length === 0 ? (
        <EmptyState icon="fa-solid fa-circle-check" title="No outstanding credit" hint="Customers with unpaid credit sales appear here." />
      ) : (
        <DataTable
          rows={rows}
          columns={[
            { key: 'name', header: 'Customer', render: (r) => <strong>{r.name}</strong> },
            { key: 'phone', header: 'Phone', render: (r) => r.phone ?? '—' },
            { key: 'bal', header: 'Balance due', render: (r) => <strong style={{ color: '#e07a7a' }}>{fmtMoney(r.balance)} ETB</strong> },
            {
              key: 'act',
              header: '',
              width: '220px',
              render: (r) => (
                <div className="pl-row-actions">
                  <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => openStatement(r)}>
                    Statement
                  </button>
                  <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" onClick={() => setPayFor(r)}>
                    Collect payment
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      {/* Collect payment */}
      <Modal open={payFor !== null} title={payFor ? `Collect from ${payFor.name}` : ''} onClose={() => setPayFor(null)}>
        <form onSubmit={(e) => { e.preventDefault(); void settle() }}>
          <p style={{ color: 'var(--text-dim)', marginBottom: 14 }}>
            Outstanding: <strong style={{ color: '#e07a7a' }}>{payFor ? fmtMoney(payFor.balance) : ''} ETB</strong>
          </p>
          <Field label="Amount received (ETB)">
            <input className="pl-input" type="number" min="0.01" step="0.01" required max={payFor?.balance} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </Field>
          <Field label="Note (optional)">
            <input className="pl-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Partial payment…" />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Record payment'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Statement */}
      <Modal open={statement !== null} title={statement ? `Statement — ${statement.customer.name}` : ''} wide onClose={() => setStatement(null)}>
        {statement && (
          <div className="pl-print-area">
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <div>
                <h3 style={{ fontFamily: "'Space Grotesk',sans-serif" }}>{statement.customer.name}</h3>
                <small style={{ color: 'var(--text-dim)' }}>{statement.customer.phone ?? ''}</small>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: 'var(--text-dim)', fontSize: '.8rem' }}>Balance due</div>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '1.3rem', color: statement.balance > 0 ? '#e07a7a' : '#34d399' }}>
                  {fmtMoney(statement.balance)} ETB
                </div>
              </div>
            </div>

            {statement.credit_sales.length > 0 && (
              <>
                <h4 style={{ margin: '16px 0 8px' }}>Unpaid credit sales</h4>
                <div className="pl-table-wrap">
                  <table className="pl-table" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>Invoice</th>
                        <th>Date</th>
                        <th className="num">Total</th>
                        <th className="num">Paid</th>
                        <th className="num">Due</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.credit_sales.map((s) => (
                        <tr key={s.id}>
                          <td>{s.invoice_no ?? '—'}</td>
                          <td>{fmtDate(s.created_at)}</td>
                          <td className="num">{fmtMoney(s.total)}</td>
                          <td className="num">{fmtMoney(s.amount_paid)}</td>
                          <td className="num" style={{ color: '#e07a7a' }}>{fmtMoney(s.due)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {statement.payments.length > 0 && (
              <>
                <h4 style={{ margin: '16px 0 8px' }}>Payment history</h4>
                <div className="pl-table-wrap">
                  <table className="pl-table" style={{ minWidth: 0 }}>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Amount</th>
                        <th>Note</th>
                        <th>By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statement.payments.map((p) => (
                        <tr key={p.id}>
                          <td>{fmtDate(p.created_at)}</td>
                          <td style={{ color: '#34d399' }}>{fmtMoney(p.amount)} ETB</td>
                          <td>{p.note ?? '—'}</td>
                          <td>{p.recorded_by ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="pl-form-actions" style={{ marginTop: 16 }}>
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => window.print()}>
                <i className="fa-solid fa-print" aria-hidden="true" /> Print statement
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
