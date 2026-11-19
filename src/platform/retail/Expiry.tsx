import { useMemo, useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney, triggerNotificationsRefresh } from '../api'
import { useApiData } from '../hooks/useApiData'
import { exportCsv } from '../utils/csv'
import {
  EXPIRY_WRITE_OFF_REASONS,
  filterExpiryBatches,
  formatExpiryCountdown,
  summarizeExpiryRisk,
  type ExpiryBatchItem,
  type ExpiryStatusFilter,
} from '../utils/expiryCompliance'
import {
  Badge,
  DataTable,
  EmptyState,
  ErrorBox,
  Field,
  Modal,
  OkBox,
  PageHeader,
  SearchInput,
  Spinner,
  StatCard,
} from '../ui'

type WriteOffModalState =
  | { mode: 'single'; batch: ExpiryBatchItem }
  | { mode: 'bulk'; count: number; units: number; value: number }
  | null

export default function Expiry(): JSX.Element {
  const [days, setDays] = useState(90)
  const [statusFilter, setStatusFilter] = useState<ExpiryStatusFilter>('all')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<WriteOffModalState>(null)
  const [reason, setReason] = useState<string>(EXPIRY_WRITE_OFF_REASONS[0])
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const { data, loading, reload } = useApiData<{ batches: ExpiryBatchItem[] }>(`/retail/expiry?days=${days}`)

  const allRows = useMemo(() => data?.batches ?? [], [data?.batches])
  const summary = useMemo(() => summarizeExpiryRisk(allRows), [allRows])
  const filteredRows = useMemo(
    () => filterExpiryBatches(allRows, { statusFilter, search }),
    [allRows, statusFilter, search]
  )

  const openSingleWriteOff = (batch: ExpiryBatchItem): void => {
    setReason(batch.expired ? 'Expired — disposed' : 'EFDA Batch Recall')
    setNotes('')
    setError(null)
    setModal({ mode: 'single', batch })
  }

  const openBulkWriteOff = (): void => {
    setReason('Expired — disposed')
    setNotes('')
    setError(null)
    setModal({
      mode: 'bulk',
      count: summary.expiredCount,
      units: summary.expiredUnits,
      value: summary.expiredValue,
    })
  }

  const submitWriteOff = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!modal || busy) return
    setBusy(true)
    setError(null)
    try {
      if (modal.mode === 'single') {
        await api.post(`/retail/expiry/${modal.batch.id}/write-off`, {
          reason,
          notes: notes.trim(),
        })
        setNotice(
          `Written off ${modal.batch.quantity} units of ${modal.batch.product_name} (Batch ${modal.batch.batch_no}).`
        )
      } else {
        const res = await api.post<{ count: number }>('/retail/expiry/write-off-expired', {
          reason,
          notes: notes.trim(),
        })
        setNotice(`Written off ${res.count} expired batch${res.count === 1 ? '' : 'es'} and synced stock & ledger.`)
      }
      setModal(null)
      reload()
      triggerNotificationsRefresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Write-off failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Expiry & Batch Compliance"
        subtitle="FEFO-enforced shelf monitoring, batch recall lookup, and audited stock disposal"
        action={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {summary.expiredCount > 0 && (
              <button
                type="button"
                className="pl-btn pl-btn-danger"
                onClick={openBulkWriteOff}
                data-testid="expiry-bulk-writeoff-btn"
              >
                <i className="fa-solid fa-trash-can" aria-hidden="true" /> Write off expired ({summary.expiredCount})
              </button>
            )}
            <button
              type="button"
              className="pl-btn pl-btn-ghost"
              onClick={() =>
                exportCsv(
                  'expiry-compliance-report',
                  ['Product', 'Category', 'Batch', 'Expiry', 'Countdown', 'Qty', 'Value at cost (ETB)', 'Status'],
                  filteredRows.map((b) => {
                    const countdown = formatExpiryCountdown(b)
                    const val =
                      typeof b.value_at_cost === 'number'
                        ? b.value_at_cost
                        : b.quantity * Number(b.cost_price)
                    return [
                      b.product_name,
                      b.category || 'General',
                      b.batch_no,
                      fmtDate(b.expiry_date),
                      countdown.label,
                      b.quantity,
                      val.toFixed(2),
                      b.expired ? 'EXPIRED' : countdown.label.includes('Critical') ? 'Critical <=30d' : 'Expiring soon',
                    ]
                  })
                )
              }
            >
              <i className="fa-solid fa-file-csv" aria-hidden="true" /> Export CSV
            </button>
          </div>
        }
      />

      <div className="pl-stats">
        <StatCard
          icon="fa-solid fa-triangle-exclamation"
          label="Expired stock value"
          value={`${fmtMoney(summary.expiredValue)} ETB`}
          tone="#e07a7a"
        />
        <StatCard
          icon="fa-solid fa-hourglass-half"
          label={`At-risk value (≤${days}d)`}
          value={`${fmtMoney(summary.atRiskValue)} ETB`}
          tone="var(--accent)"
        />
        <StatCard
          icon="fa-solid fa-clock"
          label="Critical ≤30 days"
          value={`${summary.critical30Count} batch${summary.critical30Count === 1 ? '' : 'es'}`}
          tone="#f59e0b"
        />
        <StatCard
          icon="fa-solid fa-ban"
          label="Expired batches (FEFO blocked)"
          value={summary.expiredCount}
          tone={summary.expiredCount > 0 ? '#e07a7a' : '#34d399'}
        />
      </div>

      {notice && <OkBox message={notice} />}

      <div className="pl-toolbar">
        <div className="pl-seg" role="tablist" aria-label="Time window">
          {[30, 60, 90, 180].map((d) => (
            <button key={d} type="button" role="tab" aria-selected={days === d} className={days === d ? 'on' : ''} onClick={() => setDays(d)}>
              {d} days
            </button>
          ))}
        </div>

        <div className="pl-seg" role="tablist" aria-label="Expiry status filter">
          {(
            [
              { id: 'all', label: `All (${allRows.length})` },
              { id: 'expired', label: `Expired (${summary.expiredCount})` },
              { id: 'critical_30', label: `≤30d (${summary.critical30Count})` },
              { id: 'soon', label: `Soon (${allRows.length - summary.expiredCount})` },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={statusFilter === f.id}
              className={statusFilter === f.id ? 'on' : ''}
              onClick={() => setStatusFilter(f.id)}
              data-testid={`expiry-filter-${f.id}`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search product, batch #, or category…"
          ariaLabel="Search expiring or recalled batches"
          style={{ marginLeft: 'auto', minWidth: 230 }}
        />
      </div>

      {loading ? (
        <Spinner label="Scanning batch expiry dates…" />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon="fa-solid fa-shield-heart"
          title={allRows.length === 0 ? `Nothing expiring within ${days} days` : 'No batches match your filter'}
          hint={
            allRows.length === 0
              ? 'Batches with expiry dates appear here ahead of time.'
              : 'Clear your batch search or switch status filter to inspect all batches.'
          }
        />
      ) : (
        <DataTable
          rows={filteredRows}
          searchable={false}
          columns={[
            {
              key: 'prod',
              header: 'Product',
              render: (b) => (
                <div>
                  <strong>{b.product_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{b.category || 'General'}</small>
                </div>
              ),
            },
            {
              key: 'batch',
              header: 'Batch #',
              render: (b) => (
                <span className="pl-num-cell" style={{ fontFamily: 'monospace', fontSize: '.85rem' }}>
                  {b.batch_no}
                </span>
              ),
            },
            {
              key: 'exp',
              header: 'Expiry & window',
              render: (b) => {
                const countdown = formatExpiryCountdown(b)
                return (
                  <div>
                    <span className="pl-num-cell" style={{ display: 'block' }}>{fmtDate(b.expiry_date)}</span>
                    <small
                      style={{
                        color:
                          countdown.tone === 'bad'
                            ? '#e07a7a'
                            : countdown.tone === 'warn'
                              ? 'var(--accent)'
                              : 'var(--text-dim)',
                        fontWeight: 600,
                      }}
                    >
                      {countdown.label}
                    </small>
                  </div>
                )
              },
            },
            {
              key: 'qty',
              header: 'Qty',
              render: (b) => <span className="pl-num-cell">{b.quantity}</span>,
            },
            {
              key: 'val',
              header: 'Value at cost',
              render: (b) => {
                const val =
                  typeof b.value_at_cost === 'number'
                    ? b.value_at_cost
                    : b.quantity * Number(b.cost_price)
                return <span className="pl-num-cell">{fmtMoney(val)} ETB</span>
              },
            },
            {
              key: 'st',
              header: 'Status',
              width: '145px',
              render: (b) => {
                const countdown = formatExpiryCountdown(b)
                if (b.expired) return <Badge tone="bad">Expired · Blocked</Badge>
                if (countdown.label.includes('Critical')) return <Badge tone="warn">Critical ≤30d</Badge>
                return <Badge tone="warn">Expiring soon</Badge>
              },
            },
            {
              key: 'act',
              header: 'Action',
              width: '150px',
              render: (b) => (
                <button
                  type="button"
                  className={`pl-btn pl-btn-sm ${b.expired ? 'pl-btn-danger' : 'pl-btn-ghost'}`}
                  onClick={() => openSingleWriteOff(b)}
                  aria-label={`Write off batch ${b.batch_no}`}
                  data-testid={`write-off-${b.id}`}
                >
                  {b.expired ? 'Write off' : 'Recall / Dispose'}
                </button>
              ),
            },
          ]}
        />
      )}

      <Modal
        open={modal !== null}
        title={
          modal?.mode === 'bulk'
            ? 'Write Off All Expired Batches'
            : modal?.mode === 'single'
              ? `Dispose Batch ${modal.batch.batch_no}`
              : ''
        }
        onClose={() => setModal(null)}
      >
        {modal && (
          <form onSubmit={submitWriteOff}>
            {modal.mode === 'single' ? (
              <p style={{ color: 'var(--text-dim)', fontSize: '.9rem', marginTop: 0, marginBottom: 14 }}>
                Removing <strong style={{ color: 'var(--text)' }}>{modal.batch.quantity}</strong> unit(s) of{' '}
                <strong style={{ color: 'var(--text)' }}>{modal.batch.product_name}</strong> (cost value{' '}
                <strong style={{ color: '#e07a7a' }}>
                  {fmtMoney(
                    typeof modal.batch.value_at_cost === 'number'
                      ? modal.batch.value_at_cost
                      : modal.batch.quantity * Number(modal.batch.cost_price)
                  )}{' '}
                  ETB
                </strong>
                ). This updates sellable stock, Stock Ledger, and Inventory Write-off GL entries.
              </p>
            ) : (
              <p style={{ color: 'var(--text-dim)', fontSize: '.9rem', marginTop: 0, marginBottom: 14 }}>
                Disposing <strong style={{ color: 'var(--text)' }}>{modal.count}</strong> expired batch
                {modal.count === 1 ? '' : 'es'} totaling{' '}
                <strong style={{ color: 'var(--text)' }}>{modal.units}</strong> unit(s) (cost value{' '}
                <strong style={{ color: '#e07a7a' }}>{fmtMoney(modal.value)} ETB</strong>).
              </p>
            )}

            <Field label="Compliance reason">
              <select
                className="pl-select"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                data-testid="writeoff-reason-select"
              >
                {EXPIRY_WRITE_OFF_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="Audit / EFDA disposal note (optional)">
              <input
                className="pl-input"
                maxLength={160}
                placeholder="e.g. EFDA circular #2026-14 or witness name"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                data-testid="writeoff-notes-input"
              />
            </Field>

            {error && <ErrorBox message={error} />}

            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setModal(null)}>
                Cancel
              </button>
              <button
                type="submit"
                className="pl-btn pl-btn-danger"
                disabled={busy}
                data-testid="confirm-writeoff-btn"
              >
                {busy ? 'Processing…' : 'Confirm write-off'}
              </button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  )
}
