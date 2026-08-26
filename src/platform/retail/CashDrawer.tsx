import { useState, type FormEvent } from 'react'
import { api, fmtDateTime, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, DataTable, EmptyState, Field, Modal, PageHeader, Spinner, StatCard } from '../ui'

interface Shift {
  id: string
  opening_balance: string
  cash_sales: string
  card_sales: string
  mobile_sales: string
  expenses: string
  counted_cash: string | null
  expected_cash: string | null
  difference: string | null
  status: 'open' | 'closed'
  opened_at: string
  closed_at: string | null
}

export default function CashDrawer(): JSX.Element {
  const shiftQ = useApiData<{ shift: Shift | null }>('/retail/shift')
  const historyQ = useApiData<{ shifts: Shift[] }>('/retail/shift/history')

  const [startOpen, setStartOpen] = useState(false)
  const [openingBalance, setOpeningBalance] = useState('0')
  const [endOpen, setEndOpen] = useState(false)
  const [counted, setCounted] = useState('')
  const [result, setResult] = useState<Shift | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const shift = shiftQ.data?.shift ?? null

  const start = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/retail/shift/start', { opening_balance: Number(openingBalance) || 0 })
      setStartOpen(false)
      setOpeningBalance('0')
      shiftQ.reload()
      historyQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not open shift')
    } finally {
      setBusy(false)
    }
  }

  const end = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const r = await api.post<{ shift: Shift }>('/retail/shift/end', { counted_cash: Number(counted) })
      setResult(r.shift)
      setEndOpen(false)
      setCounted('')
      shiftQ.reload()
      historyQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not close shift')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Cash Drawer"
        subtitle="Track every shift — expected vs counted cash at close"
        action={
          !shift && (
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => setStartOpen(true)}>
              <i className="fa-solid fa-door-open" aria-hidden="true" /> Start shift
            </button>
          )
        }
      />

      {shiftQ.loading ? (
        <Spinner />
      ) : !shift ? (
        <EmptyState icon="fa-solid fa-vault" title="No open shift" hint="Start a shift to begin tracking cash sales and expenses." />
      ) : (
        <>
          <div className="pl-stats">
            <StatCard icon="fa-solid fa-money-bill-1" label="Opening cash" value={`${fmtMoney(shift.opening_balance)} ETB`} />
            <StatCard icon="fa-solid fa-cash-register" label="Cash sales" value={`${fmtMoney(shift.cash_sales)} ETB`} />
            <StatCard icon="fa-solid fa-credit-card" label="Card sales" value={`${fmtMoney(shift.card_sales)} ETB`} />
            <StatCard icon="fa-solid fa-mobile-screen" label="Mobile sales" value={`${fmtMoney(shift.mobile_sales)} ETB`} />
            <StatCard icon="fa-solid fa-receipt" label="Expenses taken" value={`${fmtMoney(shift.expenses)} ETB`} tone="#e07a7a" />
          </div>

          <Card>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ marginBottom: 4 }}>Expected in drawer</h2>
                <p style={{ color: 'var(--text-dim)', fontSize: '.88rem', margin: 0 }}>
                  Opening {fmtMoney(shift.opening_balance)} + cash sales {fmtMoney(shift.cash_sales)} − expenses {fmtMoney(shift.expenses)}
                </p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: "'Space Grotesk',sans-serif", fontWeight: 700, fontSize: '1.6rem', color: 'var(--accent)' }}>
                  {fmtMoney(Number(shift.opening_balance) + Number(shift.cash_sales) - Number(shift.expenses))} ETB
                </div>
                <Badge tone="good">Shift open since {fmtDateTime(shift.opened_at)}</Badge>
              </div>
            </div>
            <div className="pl-form-actions" style={{ justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" className="pl-btn pl-btn-primary" onClick={() => setEndOpen(true)}>
                <i className="fa-solid fa-lock" aria-hidden="true" /> End shift &amp; count cash
              </button>
            </div>
          </Card>
        </>
      )}

      <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1.05rem', margin: '10px 0 12px' }}>Shift history</h2>
      <DataTable
        rows={historyQ.data?.shifts ?? []}
        empty="No shifts recorded yet"
        columns={[
          { key: 'opened', header: 'Opened', render: (s) => fmtDateTime(s.opened_at), width: '150px' },
          { key: 'closed', header: 'Closed', render: (s) => (s.closed_at ? fmtDateTime(s.closed_at) : '—'), width: '150px' },
          { key: 'cashier', header: 'Cashier', render: (s) => (s as unknown as { cashier?: string }).cashier ?? '—' },
          { key: 'open', header: 'Opening', render: (s) => fmtMoney(s.opening_balance) },
          { key: 'sales', header: 'Sales (cash/card/mobile)', render: (s) => `${fmtMoney(s.cash_sales)} / ${fmtMoney(s.card_sales)} / ${fmtMoney(s.mobile_sales)}` },
          { key: 'exp', header: 'Expenses', render: (s) => fmtMoney(s.expenses) },
          {
            key: 'diff',
            header: 'Difference',
            render: (s) => {
              if (s.difference === null || s.difference === undefined) return <Badge tone="warn">Open</Badge>
              const d = Number(s.difference)
              return d === 0 ? <Badge tone="good">Balanced</Badge> : <Badge tone={d > 0 ? 'info' : 'bad'}>{d > 0 ? '+' : ''}{fmtMoney(d)} ETB</Badge>
            },
          },
        ]}
      />

      {/* Start shift */}
      <Modal open={startOpen} title="Start a new shift" onClose={() => setStartOpen(false)}>
        <form onSubmit={start}>
          <Field label="Opening cash in drawer (ETB)">
            <input className="pl-input" type="number" min="0" step="0.01" value={openingBalance} onChange={(e) => setOpeningBalance(e.target.value)} autoFocus />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Opening…' : 'Open shift'}
            </button>
          </div>
        </form>
      </Modal>

      {/* End shift */}
      <Modal open={endOpen} title="End shift — count the drawer" onClose={() => setEndOpen(false)}>
        <form onSubmit={end}>
          <p style={{ color: 'var(--text-dim)', fontSize: '.9rem', marginBottom: 12 }}>
            Expected cash: <strong style={{ color: 'var(--text)' }}>{fmtMoney(Number(shift?.opening_balance ?? 0) + Number(shift?.cash_sales ?? 0) - Number(shift?.expenses ?? 0))} ETB</strong>
          </p>
          <Field label="Counted cash (ETB)">
            <input className="pl-input" type="number" min="0" step="0.01" required value={counted} onChange={(e) => setCounted(e.target.value)} autoFocus />
          </Field>
          {counted !== '' && shift && (
            <p style={{ fontSize: '.9rem' }}>
              Difference:{' '}
              <strong style={{ color: Math.abs(Number(counted) - (Number(shift.opening_balance) + Number(shift.cash_sales) - Number(shift.expenses))) < 0.005 ? '#34d399' : '#e07a7a' }}>
                {fmtMoney(Number(counted) - (Number(shift.opening_balance) + Number(shift.cash_sales) - Number(shift.expenses)))} ETB
              </strong>
            </p>
          )}
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Closing…' : 'Close shift'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Closed-shift result */}
      <Modal open={result !== null} title="Shift closed" onClose={() => setResult(null)}>
        {result && (
          <div style={{ textAlign: 'center' }}>
            <i
              className="fa-solid"
              aria-hidden="true"
              style={{ fontSize: '2.2rem', marginBottom: 12, display: 'block', color: Math.abs(Number(result.difference)) < 0.005 ? '#34d399' : '#e07a7a' }}
            >
              {Math.abs(Number(result.difference)) < 0.005 ? '\uf058' : '\uf071'}
            </i>
            <h3 style={{ fontFamily: "'Space Grotesk',sans-serif", marginBottom: 8 }}>
              {Math.abs(Number(result.difference)) < 0.005 ? 'Drawer balanced perfectly' : `Difference of ${fmtMoney(result.difference)} ETB`}
            </h3>
            <p style={{ color: 'var(--text-dim)', fontSize: '.9rem' }}>
              Counted {fmtMoney(result.counted_cash)} ETB · Expected {fmtMoney(result.expected_cash)} ETB
            </p>
            <div className="pl-form-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="pl-btn pl-btn-primary" onClick={() => setResult(null)}>
                Done
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
