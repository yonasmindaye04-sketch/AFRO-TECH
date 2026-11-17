import { useMemo, useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, Card, DataTable, EmptyState, ErrorBox, Field, Modal, OkBox, PageHeader, Spinner, StatCard } from '../ui'
import {
  computeFinancialStatements,
  detectAccountingExceptions,
  validateJournalEntry,
  type AccountingExceptionItem,
  type CoaAccount,
} from '../utils/erpEngine'

interface GlEntry {
  id: string
  posting_date: string
  voucher_type: string
  voucher_no: string
  account_code: string
  account_name: string
  root_type: string
  party: string | null
  debit: number
  credit: number
  remarks: string
}

interface JournalLine {
  account_code: string
  debit: string
  credit: string
}

interface JournalEntry {
  id: string
  number: string
  posting_date: string
  remarks: string
  total_debit: string
  total_credit: string
  status: string
  reversed_by?: string | null
  reversal_of?: string | null
  created_by: string
  lines: Array<{ account_code: string; debit: number; credit: number }>
}

interface PartnerOpt {
  id: string
  name: string
  balance: string
}

interface ReconciliationSnapshot {
  accounts: CoaAccount[]
  gl_entries: GlEntry[]
  products: Array<{ id: string; name: string; stock: number; cost_price: number | string }>
  warehouses: Array<{ id: string; name: string; stock_map?: Record<string, number> }>
  customers: PartnerOpt[]
  suppliers: PartnerOpt[]
}

type Tab = 'coa' | 'statements' | 'gl' | 'je' | 'reconcile'

const ROOT_TONE: Record<string, 'good' | 'warn' | 'info' | 'bad' | 'neutral'> = {
  Asset: 'info',
  Liability: 'warn',
  Equity: 'neutral',
  Income: 'good',
  Expense: 'bad',
}

export default function Accounting(): JSX.Element {
  const [tab, setTab] = useState<Tab>('statements')
  const [acctFilter, setAcctFilter] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const coaQ = useApiData<{ accounts: CoaAccount[] }>('/erp/accounts')
  const glQ = useApiData<{ entries: GlEntry[] }>('/erp/gl-entries')
  const jeQ = useApiData<{ journal_entries: JournalEntry[] }>('/erp/journal-entries')
  const customersQ = useApiData<{ customers: PartnerOpt[] }>('/retail/customers')
  const suppliersQ = useApiData<{ suppliers: PartnerOpt[] }>('/retail/suppliers')
  const snapQ = useApiData<ReconciliationSnapshot>('/erp/reconciliation-snapshot')
  const [revBusyId, setRevBusyId] = useState<string | null>(null)

  const [openJe, setOpenJe] = useState(false)
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<JournalLine[]>([
    { account_code: '5200', debit: '', credit: '0' },
    { account_code: '1110', debit: '0', credit: '' },
  ])
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const [openPe, setOpenPe] = useState(false)
  const [peForm, setPeForm] = useState({ direction: 'receive' as 'receive' | 'pay', party_id: '', amount: '', payment_method: 'cash', remarks: '' })

  const accounts = Array.isArray(coaQ.data?.accounts) ? coaQ.data.accounts : []
  const allGl = Array.isArray(glQ.data?.entries) ? glQ.data.entries : []
  const glEntries = allGl.filter((g) => !acctFilter || g.account_code === acctFilter)
  const journalEntries = Array.isArray(jeQ.data?.journal_entries) ? jeQ.data.journal_entries : []
  const customersList = Array.isArray(customersQ.data?.customers) ? customersQ.data.customers : []
  const suppliersList = Array.isArray(suppliersQ.data?.suppliers) ? suppliersQ.data.suppliers : []

  const statements = computeFinancialStatements(accounts, allGl)

  const trialDebit = glEntries.reduce((s, e) => s + Number(e.debit || 0), 0)
  const trialCredit = glEntries.reduce((s, e) => s + Number(e.credit || 0), 0)

  const jeCheck = validateJournalEntry(
    lines.map((l) => ({
      account_code: l.account_code,
      debit: Number(l.debit) || 0,
      credit: Number(l.credit) || 0,
    }))
  )

  const updateLine = (idx: number, patch: Partial<JournalLine>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  const exceptions = useMemo(() => {
    if (!snapQ.data) return []
    return detectAccountingExceptions({
      accounts: Array.isArray(snapQ.data.accounts) ? snapQ.data.accounts : [],
      glEntries: Array.isArray(snapQ.data.gl_entries) ? snapQ.data.gl_entries : [],
      products: Array.isArray(snapQ.data.products) ? snapQ.data.products : [],
      warehouses: Array.isArray(snapQ.data.warehouses) ? snapQ.data.warehouses : [],
      customers: Array.isArray(snapQ.data.customers) ? snapQ.data.customers : [],
      suppliers: Array.isArray(snapQ.data.suppliers) ? snapQ.data.suppliers : [],
    })
  }, [snapQ.data])

  const openIssuesCount = exceptions.filter((e) => e.severity !== 'ok').length
  const apiError = coaQ.error || glQ.error || jeQ.error || snapQ.error

  const reloadAll = (): void => {
    coaQ.reload()
    glQ.reload()
    jeQ.reload()
    customersQ.reload()
    suppliersQ.reload()
    snapQ.reload()
  }

  const reverseJournalEntry = async (je: JournalEntry): Promise<void> => {
    setRevBusyId(je.id)
    setErrMsg(null)
    setNotice(null)
    try {
      const res = await api.post<{ reversal: { number: string } }>(`/erp/journal-entries/${je.id}/reverse`, {})
      setNotice(`Reversed ${je.number} via contra Journal Entry ${res.reversal.number}. Ledger & Trial Balance updated.`)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Failed to reverse journal entry')
    } finally {
      setRevBusyId(null)
    }
  }

  const syncWarehouseBins = async (): Promise<void> => {
    setBusy(true)
    setErrMsg(null)
    try {
      const res = await api.post<{ reconciled_skus: number }>('/erp/warehouses/reconcile', {})
      setNotice(`Warehouse bins synchronized across ${res.reconciled_skus} SKU(s).`)
      reloadAll()
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Could not synchronize warehouses')
    } finally {
      setBusy(false)
    }
  }

  const openAdjustingJe = (ex: AccountingExceptionItem): void => {
    const absVar = Math.abs(Number(ex.variance || 0)).toFixed(2)
    const acct = ex.suggestedAccountCode || '1410'
    setRemarks(`Month-end reconciliation adjustment: ${ex.area}`)
    setLines([
      { account_code: ex.variance >= 0 ? acct : '5200', debit: absVar, credit: '0' },
      { account_code: ex.variance >= 0 ? '3100' : acct, debit: '0', credit: absVar },
    ])
    setFormErr(null)
    setOpenJe(true)
  }

  const submitJe = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!jeCheck.valid) {
      setFormErr(jeCheck.error || 'Journal entry is out of balance.')
      return
    }
    setBusy(true)
    setFormErr(null)
    setErrMsg(null)
    try {
      await api.post('/erp/journal-entries', {
        posting_date: postingDate,
        remarks: remarks.trim() || 'Manual Journal Entry',
        lines: lines.map((l) => ({
          account_code: l.account_code,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
        })),
      })
      setNotice('Journal Entry posted to the General Ledger.')
      setOpenJe(false)
      setRemarks('')
      setLines([
        { account_code: '5200', debit: '', credit: '0' },
        { account_code: '1110', debit: '0', credit: '' },
      ])
      reloadAll()
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Failed to post journal entry')
    } finally {
      setBusy(false)
    }
  }

  const submitPaymentEntry = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setFormErr(null)
    try {
      const res = await api.post<{ voucher_no: string }>('/erp/payment-entries', {
        direction: peForm.direction,
        party_id: peForm.party_id,
        amount: Number(peForm.amount) || 0,
        payment_method: peForm.payment_method,
        remarks: peForm.remarks.trim() || undefined,
      })
      setNotice(`Payment Entry ${res.voucher_no} posted to Ledger and partner balance updated.`)
      setOpenPe(false)
      setPeForm({ direction: 'receive', party_id: '', amount: '', payment_method: 'cash', remarks: '' })
      reloadAll()
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Payment entry failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Accounting & Financial Statements"
        subtitle="Chart of Accounts, Profit & Loss, Balance Sheet, General Ledger & Payment Entries"
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="sub-tabs">
              <button type="button" className={`sub-tab ${tab === 'statements' ? 'sub-tab-active' : ''}`} onClick={() => setTab('statements')}>
                Financial Statements
              </button>
              <button type="button" className={`sub-tab ${tab === 'coa' ? 'sub-tab-active' : ''}`} onClick={() => setTab('coa')}>
                Chart of Accounts
              </button>
              <button type="button" className={`sub-tab ${tab === 'gl' ? 'sub-tab-active' : ''}`} onClick={() => setTab('gl')}>
                General Ledger ({glEntries.length})
              </button>
              <button type="button" className={`sub-tab ${tab === 'je' ? 'sub-tab-active' : ''}`} onClick={() => setTab('je')}>
                Journal Entries ({journalEntries.length})
              </button>
              <button type="button" className={`sub-tab ${tab === 'reconcile' ? 'sub-tab-active' : ''}`} onClick={() => setTab('reconcile')}>
                Reconcile &amp; Checks{openIssuesCount > 0 ? ` (${openIssuesCount})` : ''}
              </button>
            </div>
            <button
              type="button"
              className="pl-btn pl-btn-ghost"
              onClick={() => {
                setFormErr(null)
                setPeForm((f) => ({
                  ...f,
                  party_id:
                    f.party_id ||
                    (f.direction === 'receive'
                      ? customersList[0]?.id ?? ''
                      : suppliersList[0]?.id ?? ''),
                }))
                setOpenPe(true)
              }}
            >
              <i className="fa-solid fa-money-bill-transfer" aria-hidden="true" /> Payment Entry
            </button>
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => { setFormErr(null); setOpenJe(true) }}>
              <i className="fa-solid fa-scale-balanced" aria-hidden="true" /> New Journal Entry
            </button>
          </div>
        }
      />

      <div className="pl-stats">
        <StatCard icon="fa-solid fa-landmark" label="Total Assets" value={`${fmtMoney(statements.totalAssets)} ETB`} />
        <StatCard icon="fa-solid fa-file-invoice" label="Total Liabilities" value={`${fmtMoney(statements.totalLiabilities)} ETB`} />
        <StatCard icon="fa-solid fa-arrow-trend-up" label="Recognized Income" value={`${fmtMoney(statements.totalIncome)} ETB`} tone="#34d399" />
        <StatCard icon="fa-solid fa-sack-dollar" label="Net Profit / (Loss)" value={`${fmtMoney(statements.netProfit)} ETB`} tone={statements.netProfit >= 0 ? '#34d399' : '#f87171'} />
      </div>

      {notice && <OkBox message={notice} />}
      {errMsg && <ErrorBox message={errMsg} />}
      {apiError && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <ErrorBox message={`Could not load full accounting data: ${apiError}`} />
          </div>
          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={reloadAll}>
            <i className="fa-solid fa-rotate-right" aria-hidden="true" /> Retry
          </button>
        </div>
      )}

      {tab === 'statements' && (
        coaQ.loading ? (
          <Spinner />
        ) : (
          <div className="pl-cols-2">
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ marginBottom: 0 }}>Profit &amp; Loss Statement</h2>
                <Badge tone={statements.netProfit >= 0 ? 'good' : 'bad'}>
                  {statements.netProfit >= 0 ? 'PROFITABLE' : 'NET LOSS'}
                </Badge>
              </div>
              <div className="pl-table-wrap">
                <table className="pl-table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th className="num">Amount (ETB)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.income.map((a) => (
                      <tr key={a.code}>
                        <td>{a.code} · {a.name}</td>
                        <td className="num" style={{ color: '#34d399' }}>+{fmtMoney(a.balance)}</td>
                      </tr>
                    ))}
                    {statements.expenses.map((a) => (
                      <tr key={a.code}>
                        <td>{a.code} · {a.name}</td>
                        <td className="num" style={{ color: '#e07a7a' }}>-{fmtMoney(a.balance)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td><strong>Net Profit / (Loss)</strong></td>
                      <td className="num">
                        <strong style={{ color: statements.netProfit >= 0 ? '#34d399' : '#e07a7a' }}>
                          {fmtMoney(statements.netProfit)} ETB
                        </strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <h2 style={{ marginBottom: 0 }}>Balance Sheet</h2>
                <Badge tone={statements.trialBalanced ? 'good' : 'warn'}>
                  {statements.trialBalanced ? 'LEDGER BALANCED' : 'CHECK GL'}
                </Badge>
              </div>
              <div className="pl-table-wrap">
                <table className="pl-table" style={{ minWidth: 0 }}>
                  <thead>
                    <tr>
                      <th>Account</th>
                      <th>Section</th>
                      <th className="num">Balance (ETB)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {statements.assets.map((a) => (
                      <tr key={a.code}>
                        <td>{a.code} · {a.name}</td>
                        <td><Badge tone="info">Asset</Badge></td>
                        <td className="num">{fmtMoney(a.balance)}</td>
                      </tr>
                    ))}
                    {statements.liabilities.map((a) => (
                      <tr key={a.code}>
                        <td>{a.code} · {a.name}</td>
                        <td><Badge tone="warn">Liability</Badge></td>
                        <td className="num">{fmtMoney(a.balance)}</td>
                      </tr>
                    ))}
                    {statements.equity.map((a) => (
                      <tr key={a.code}>
                        <td>{a.code} · {a.name}</td>
                        <td><Badge tone="neutral">Equity</Badge></td>
                        <td className="num">{fmtMoney(a.balance)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2}><strong>Total Assets vs. Liabilities + Equity + Profit</strong></td>
                      <td className="num">
                        <strong style={{ fontVariantNumeric: 'tabular-nums' }}>
                          {fmtMoney(statements.totalAssets)} / {fmtMoney(statements.liabilitiesAndEquity)}
                        </strong>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )
      )}

      {tab === 'coa' && (
        coaQ.loading ? (
          <Spinner />
        ) : !accounts.length ? (
          <EmptyState icon="fa-solid fa-sitemap" title="No accounts configured" />
        ) : (
          <DataTable
            rows={accounts}
            searchPlaceholder="Search accounts…"
            columns={[
              { key: 'code', header: 'Code', render: (a) => <strong>{a.code}</strong>, width: '90px' },
              { key: 'name', header: 'Account Name', render: (a) => a.name },
              { key: 'root_type', header: 'Root Type', render: (a) => <Badge tone={ROOT_TONE[a.root_type] ?? 'neutral'}>{a.root_type}</Badge>, width: '115px' },
              { key: 'account_type', header: 'Classification', render: (a) => a.account_type, width: '150px' },
              {
                key: 'balance',
                header: 'Current Balance',
                render: (a) => <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(a.balance)} ETB</strong>,
                width: '160px',
              },
              {
                key: 'act',
                header: '',
                width: '110px',
                render: (a) => (
                  <div className="pl-row-actions">
                    <button
                      type="button"
                      className="pl-btn pl-btn-ghost pl-btn-sm"
                      onClick={() => {
                        setAcctFilter(a.code)
                        setTab('gl')
                      }}
                    >
                      Ledger
                    </button>
                  </div>
                ),
              },
            ]}
          />
        )
      )}

      {tab === 'gl' && (
        <>
          <div className="pl-toolbar" style={{ justifyContent: 'space-between' }}>
            <select className="pl-select" value={acctFilter} onChange={(e) => setAcctFilter(e.target.value)} aria-label="Filter by account">
              <option value="">All Accounts</option>
              {accounts.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} — {a.name}
                </option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: 18, fontSize: '.9rem', fontVariantNumeric: 'tabular-nums' }}>
              <span>Total Debit: <strong>{fmtMoney(trialDebit)} ETB</strong></span>
              <span>Total Credit: <strong>{fmtMoney(trialCredit)} ETB</strong></span>
            </div>
          </div>
          {glQ.loading ? (
            <Spinner />
          ) : !glEntries.length ? (
            <EmptyState icon="fa-solid fa-book-open" title="No General Ledger entries yet" hint="POS sales, purchases, expenses, payroll and journal entries post automatically." />
          ) : (
            <DataTable
              rows={glEntries}
              searchPlaceholder="Search GL entries…"
              columns={[
                { key: 'posting_date', header: 'Date', render: (e) => fmtDate(e.posting_date), width: '110px' },
                { key: 'voucher_type', header: 'Voucher Type', render: (e) => e.voucher_type || '—' },
                { key: 'voucher_no', header: 'Voucher #', render: (e) => <strong>{e.voucher_no || '—'}</strong>, width: '125px' },
                { key: 'account_name', header: 'Account', render: (e) => `${e.account_code || ''} · ${e.account_name || ''}` },
                { key: 'party', header: 'Party', render: (e) => e.party ?? '—' },
                { key: 'debit', header: 'Debit', render: (e) => (Number(e.debit || 0) > 0 ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.debit)}</span> : '—'), width: '105px' },
                { key: 'credit', header: 'Credit', render: (e) => (Number(e.credit || 0) > 0 ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.credit)}</span> : '—'), width: '105px' },
                { key: 'remarks', header: 'Remarks', render: (e) => e.remarks || '—' },
              ]}
            />
          )}
        </>
      )}

      {tab === 'je' && (
        jeQ.loading ? (
          <Spinner />
        ) : !journalEntries.length ? (
          <EmptyState icon="fa-solid fa-scale-balanced" title="No manual journal entries yet" hint="Post adjustments, owner capital injections, or bank transfers with balanced debit & credit lines." />
        ) : (
          <DataTable
            rows={journalEntries}
            searchPlaceholder="Search journal entries…"
            columns={[
              { key: 'number', header: 'JV #', render: (j) => <strong>{j.number}</strong>, width: '110px' },
              { key: 'posting_date', header: 'Posting Date', render: (j) => fmtDate(j.posting_date), width: '120px' },
              { key: 'remarks', header: 'Remarks', render: (j) => j.remarks },
              { key: 'total_debit', header: 'Debit', render: (j) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(j.total_debit)} ETB</span> },
              { key: 'total_credit', header: 'Credit', render: (j) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(j.total_credit)} ETB</span> },
              { key: 'created_by', header: 'Posted By', render: (j) => j.created_by },
              {
                key: 'status',
                header: 'Status',
                render: (j) => {
                  const status = String(j.status || 'submitted')
                  return (
                    <Badge tone={status === 'reversed' ? 'warn' : 'good'}>
                      {status === 'reversed' && j.reversed_by ? `REVERSED (${j.reversed_by})` : status.toUpperCase()}
                    </Badge>
                  )
                },
                width: '150px',
              },
              {
                key: 'act',
                header: '',
                width: '120px',
                render: (j) => (
                  <div className="pl-row-actions">
                    {j.status === 'submitted' && !j.reversal_of && (
                      <button
                        type="button"
                        className="pl-btn pl-btn-ghost pl-btn-sm"
                        disabled={revBusyId === j.id}
                        aria-label={`Reverse journal entry ${j.number}`}
                        onClick={() => reverseJournalEntry(j)}
                      >
                        <i className="fa-solid fa-rotate-left" aria-hidden="true" />{' '}
                        {revBusyId === j.id ? 'Reversing…' : 'Reverse'}
                      </button>
                    )}
                  </div>
                ),
              },
            ]}
          />
        )
      )}

      {tab === 'reconcile' && (
        snapQ.loading ? (
          <Spinner label="Scanning ledgers and stock subledgers…" />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div>
                  <h2 style={{ marginBottom: 4 }}>Month-End Reconciliation &amp; Exception Scanner</h2>
                  <p style={{ color: 'var(--text-dim)', fontSize: '.86rem', margin: 0 }}>
                    Continuously cross-checks Trial Balance, Voucher parity, Inventory GL (1410), Warehouse Bins, AR (1210), and AP (2110).
                  </p>
                </div>
                <Badge tone={openIssuesCount === 0 ? 'good' : 'warn'}>
                  {openIssuesCount === 0 ? 'ALL BOOKS RECONCILED' : `${openIssuesCount} EXCEPTION(S) TO REVIEW`}
                </Badge>
              </div>
            </Card>

            {exceptions.map((ex) => (
              <Card key={ex.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                      <Badge tone={ex.severity === 'ok' ? 'good' : ex.severity === 'warn' ? 'warn' : 'bad'}>
                        {ex.severity === 'ok' ? 'RECONCILED' : ex.severity === 'warn' ? 'VARIANCE' : 'CRITICAL'}
                      </Badge>
                      <span style={{ fontSize: '.78rem', color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                        {ex.area}
                      </span>
                    </div>
                    <strong style={{ fontSize: '.98rem', display: 'block' }}>{ex.title}</strong>
                    <span style={{ color: 'var(--text-dim)', fontSize: '.86rem' }}>{ex.detail}</span>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {ex.id === 'exc-warehouse-sync' && ex.severity !== 'ok' && (
                      <button type="button" className="pl-btn pl-btn-primary pl-btn-sm" disabled={busy} onClick={syncWarehouseBins}>
                        Sync Warehouse Bins
                      </button>
                    )}
                    {ex.severity !== 'ok' && ex.suggestedAccountCode && Math.abs(ex.variance) >= 1 && (
                      <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => openAdjustingJe(ex)}>
                        Pre-fill Adjusting JE
                      </button>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )
      )}

      <Modal open={openJe} wide title="New Balanced Journal Entry" onClose={() => setOpenJe(false)}>
        <form onSubmit={submitJe}>
          <div className="pl-grid-2">
            <Field label="Posting Date">
              <input className="pl-input" type="date" required value={postingDate} onChange={(e) => setPostingDate(e.target.value)} />
            </Field>
            <Field label="Remarks / Narration">
              <input className="pl-input" required placeholder="e.g. Monthly office rent or bank deposit" value={remarks} onChange={(e) => setRemarks(e.target.value)} />
            </Field>
          </div>

          {lines.map((l, idx) => (
            <div key={idx} className="pl-card" style={{ padding: 12, marginBottom: 10 }}>
              <div className="pl-grid-2">
                <Field label={`Account Line ${idx + 1}`}>
                  <select className="pl-select" required value={l.account_code} onChange={(e) => updateLine(idx, { account_code: e.target.value })}>
                    {accounts.map((a) => (
                      <option key={a.code} value={a.code}>
                        {a.code} — {a.name} ({a.root_type})
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="pl-grid-2">
                  <Field label="Debit (ETB)">
                    <input className="pl-input" type="number" min="0" step="0.01" value={l.debit} onChange={(e) => updateLine(idx, { debit: e.target.value })} />
                  </Field>
                  <Field label="Credit (ETB)">
                    <input className="pl-input" type="number" min="0" step="0.01" value={l.credit} onChange={(e) => updateLine(idx, { credit: e.target.value })} />
                  </Field>
                </div>
              </div>
              {lines.length > 2 && (
                <button type="button" className="pl-btn pl-btn-danger pl-btn-sm" onClick={() => setLines((prev) => prev.filter((_, i) => i !== idx))}>
                  Remove row
                </button>
              )}
            </div>
          ))}

          <button
            type="button"
            className="pl-btn pl-btn-ghost pl-btn-sm"
            style={{ marginBottom: 14 }}
            onClick={() => setLines((prev) => [...prev, { account_code: accounts[0]?.code || '1110', debit: '0', credit: '0' }])}
          >
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add account row
          </button>

          <div className="pl-cart-total grand">
            <span>
              Debit: <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(jeCheck.totalDebit)}</strong> · Credit:{' '}
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(jeCheck.totalCredit)}</strong>
            </span>
            <Badge tone={jeCheck.valid ? 'good' : 'warn'}>{jeCheck.valid ? 'BALANCED' : 'OUT OF BALANCE'}</Badge>
          </div>

          {formErr && <ErrorBox message={formErr} />}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy || !jeCheck.valid}>
              {busy ? 'Posting…' : 'Post Journal Entry'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={openPe} title="Record Payment Entry" onClose={() => setOpenPe(false)}>
        <form onSubmit={submitPaymentEntry}>
          <Field label="Payment Type">
            <select className="pl-select" value={peForm.direction} onChange={(e) => setPeForm((f) => ({ ...f, direction: e.target.value as 'receive' | 'pay', party_id: '' }))}>
              <option value="receive">Receive from Customer (Accounts Receivable)</option>
              <option value="pay">Pay Supplier (Accounts Payable)</option>
            </select>
          </Field>
          <Field label={peForm.direction === 'receive' ? 'Customer' : 'Supplier'}>
            <select className="pl-select" value={peForm.party_id} onChange={(e) => setPeForm((f) => ({ ...f, party_id: e.target.value }))}>
              <option value="">Select party…</option>
              {(peForm.direction === 'receive' ? customersList : suppliersList).map((p) => (
                <option key={p.id} value={p.id}>{p.name} (Bal: {fmtMoney(p.balance)} ETB)</option>
              ))}
            </select>
          </Field>
          <div className="pl-grid-2">
            <Field label="Amount (ETB)">
              <input className="pl-input" type="number" min="0.01" step="0.01" placeholder="0.00" required value={peForm.amount} onChange={(e) => setPeForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
            <Field label="Account">
              <select className="pl-select" value={peForm.payment_method} onChange={(e) => setPeForm((f) => ({ ...f, payment_method: e.target.value }))}>
                <option value="cash">Cash on Hand (1110)</option>
                <option value="bank">CBE / Bank Account (1120)</option>
              </select>
            </Field>
          </div>
          <Field label="Remarks">
            <input className="pl-input" placeholder="Reference number or note…" value={peForm.remarks} onChange={(e) => setPeForm((f) => ({ ...f, remarks: e.target.value }))} />
          </Field>
          {formErr && <ErrorBox message={formErr} />}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>{busy ? 'Posting…' : 'Submit Payment Entry'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}

