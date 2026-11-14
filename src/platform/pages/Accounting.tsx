import { useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, ErrorBox, Field, Modal, OkBox, PageHeader, Spinner, StatCard } from '../ui'

interface Account {
  code: string
  name: string
  root_type: 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'
  account_type: string
  balance: number
}

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
  created_by: string
  lines: Array<{ account_code: string; debit: number; credit: number }>
}

type Tab = 'coa' | 'gl' | 'je'

const ROOT_TONE: Record<string, 'good' | 'warn' | 'info' | 'bad' | 'neutral'> = {
  Asset: 'info',
  Liability: 'warn',
  Equity: 'neutral',
  Income: 'good',
  Expense: 'bad',
}

export default function Accounting(): JSX.Element {
  const [tab, setTab] = useState<Tab>('coa')
  const [acctFilter, setAcctFilter] = useState('')
  const [notice, setNotice] = useState<string | null>(null)
  const [errMsg, setErrMsg] = useState<string | null>(null)

  const coaQ = useApiData<{ accounts: Account[] }>('/erp/accounts')
  const glQ = useApiData<{ entries: GlEntry[] }>('/erp/gl-entries')
  const jeQ = useApiData<{ journal_entries: JournalEntry[] }>('/erp/journal-entries')

  const [openJe, setOpenJe] = useState(false)
  const [postingDate, setPostingDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [remarks, setRemarks] = useState('')
  const [lines, setLines] = useState<JournalLine[]>([
    { account_code: '5200', debit: '', credit: '0' },
    { account_code: '1110', debit: '0', credit: '' },
  ])
  const [busy, setBusy] = useState(false)
  const [formErr, setFormErr] = useState<string | null>(null)

  const accounts = coaQ.data?.accounts ?? []
  const glEntries = (glQ.data?.entries ?? []).filter((g) => !acctFilter || g.account_code === acctFilter)
  const journalEntries = jeQ.data?.journal_entries ?? []

  const totalAssets = accounts.filter((a) => a.root_type === 'Asset').reduce((s, a) => s + Number(a.balance || 0), 0)
  const totalLiabilities = accounts.filter((a) => a.root_type === 'Liability').reduce((s, a) => s + Number(a.balance || 0), 0)
  const totalIncome = accounts.filter((a) => a.root_type === 'Income').reduce((s, a) => s + Number(a.balance || 0), 0)
  const totalExpense = accounts.filter((a) => a.root_type === 'Expense').reduce((s, a) => s + Number(a.balance || 0), 0)

  const trialDebit = glEntries.reduce((s, e) => s + Number(e.debit || 0), 0)
  const trialCredit = glEntries.reduce((s, e) => s + Number(e.credit || 0), 0)

  const draftDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
  const draftCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
  const isBalanced = draftDebit > 0 && Math.abs(draftDebit - draftCredit) < 0.01

  const updateLine = (idx: number, patch: Partial<JournalLine>): void => {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }

  const submitJe = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!isBalanced) {
      setFormErr('Total Debit must equal Total Credit and be greater than 0.')
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
      coaQ.reload()
      glQ.reload()
      jeQ.reload()
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : 'Failed to post journal entry')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Accounting & General Ledger"
        subtitle="Chart of Accounts, automatic double-entry General Ledger & balanced Journal Entries"
        action={
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
            <div className="sub-tabs">
              <button type="button" className={`sub-tab ${tab === 'coa' ? 'sub-tab-active' : ''}`} onClick={() => setTab('coa')}>
                Chart of Accounts
              </button>
              <button type="button" className={`sub-tab ${tab === 'gl' ? 'sub-tab-active' : ''}`} onClick={() => setTab('gl')}>
                General Ledger ({glEntries.length})
              </button>
              <button type="button" className={`sub-tab ${tab === 'je' ? 'sub-tab-active' : ''}`} onClick={() => setTab('je')}>
                Journal Entries ({journalEntries.length})
              </button>
            </div>
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => { setFormErr(null); setOpenJe(true) }}>
              <i className="fa-solid fa-scale-balanced" aria-hidden="true" /> New Journal Entry
            </button>
          </div>
        }
      />

      <div className="pl-stats">
        <StatCard icon="fa-solid fa-landmark" label="Total Assets" value={`${fmtMoney(totalAssets)} ETB`} />
        <StatCard icon="fa-solid fa-file-invoice" label="Total Liabilities" value={`${fmtMoney(totalLiabilities)} ETB`} />
        <StatCard icon="fa-solid fa-arrow-trend-up" label="Recognized Income" value={`${fmtMoney(totalIncome)} ETB`} tone="#34d399" />
        <StatCard icon="fa-solid fa-arrow-trend-down" label="Total Expenses" value={`${fmtMoney(totalExpense)} ETB`} />
      </div>

      {notice && <OkBox message={notice} />}
      {errMsg && <ErrorBox message={errMsg} />}

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
              { key: 'account_type', header: 'Classification', render: (a) => a.account_type, width: '130px' },
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
                { key: 'voucher_type', header: 'Voucher Type', render: (e) => e.voucher_type },
                { key: 'voucher_no', header: 'Voucher #', render: (e) => <strong>{e.voucher_no}</strong>, width: '115px' },
                { key: 'account_name', header: 'Account', render: (e) => `${e.account_code} · ${e.account_name}` },
                { key: 'party', header: 'Party', render: (e) => e.party ?? '—' },
                { key: 'debit', header: 'Debit', render: (e) => (e.debit > 0 ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.debit)}</span> : '—'), width: '105px' },
                { key: 'credit', header: 'Credit', render: (e) => (e.credit > 0 ? <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(e.credit)}</span> : '—'), width: '105px' },
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
              { key: 'status', header: 'Status', render: (j) => <Badge tone="good">{j.status.toUpperCase()}</Badge>, width: '100px' },
            ]}
          />
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
              Debit: <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(draftDebit)}</strong> · Credit:{' '}
              <strong style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtMoney(draftCredit)}</strong>
            </span>
            <Badge tone={isBalanced ? 'good' : 'warn'}>{isBalanced ? 'BALANCED' : 'OUT OF BALANCE'}</Badge>
          </div>

          {formErr && <ErrorBox message={formErr} />}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy || !isBalanced}>
              {busy ? 'Posting…' : 'Post Journal Entry'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
