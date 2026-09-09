import { useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useAuth } from '../AuthContext'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'
import ThermalReceipt from '../ui/ThermalReceipt'
import type { ReceiptData } from '../utils/receipt'

interface FeeRow {
  id: string
  title: string
  amount: string
  paid_amount: string
  due_date: string | null
  status: 'unpaid' | 'partial' | 'paid'
  paid_at: string | null
  student_name: string
  student_code: string
  class_name: string | null
}
interface ClassRow {
  id: string
  name: string
  student_count: number
}
interface StudentOpt {
  id: string
}

const tone = (s: FeeRow['status']): 'good' | 'warn' | 'bad' => (s === 'paid' ? 'good' : s === 'partial' ? 'warn' : 'bad')

export default function Fees(): JSX.Element {
  const { me } = useAuth()
  const settingsQ = useApiData<{ settings: Record<string, any> }>('/tenant/settings')
  const [receiptFee, setReceiptFee] = useState<FeeRow | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const feesQ = useApiData<{ fees: FeeRow[] }>(`/school/fees${statusFilter ? `?status=${statusFilter}` : ''}`)
  const classesQ = useApiData<{ classes: ClassRow[] }>('/school/classes')

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ title: '', amount: '', due_date: '', target: 'all' })
  const [classId, setClassId] = useState('')
  const studentsQ = useApiData<{ students: StudentOpt[] }>(form.target === 'students' && classId ? `/school/students?class_id=${classId}` : null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Guardian Fee Notice Modal state
  const [feeNoticeTarget, setFeeNoticeTarget] = useState<FeeRow | null>(null)
  const [feeNoticeChannel, setFeeNoticeChannel] = useState<'email' | 'telegram' | 'both'>('both')
  const [feeNoticeNote, setFeeNoticeNote] = useState('')
  const [feeNoticeBusy, setFeeNoticeBusy] = useState(false)
  const [feeNoticeSuccess, setFeeNoticeSuccess] = useState<string | null>(null)
  const [feeNoticeError, setFeeNoticeError] = useState<string | null>(null)

  const openFeeNoticeModal = (f: FeeRow): void => {
    setFeeNoticeTarget(f)
    setFeeNoticeChannel('both')
    setFeeNoticeNote('')
    setFeeNoticeSuccess(null)
    setFeeNoticeError(null)
  }

  const sendFeeNotice = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!feeNoticeTarget) return
    setFeeNoticeBusy(true)
    setFeeNoticeError(null)
    setFeeNoticeSuccess(null)
    try {
      const res = await api.post<{ ok: boolean; emailStatus?: string; telegramStatus?: string }>(
        `/school/fees/${feeNoticeTarget.id}/notify`,
        {
          channel: feeNoticeChannel,
          custom_message: feeNoticeNote.trim() || null,
        }
      )
      const channels: string[] = []
      if (res.emailStatus && res.emailStatus !== 'failed' && res.emailStatus !== 'not_configured') channels.push('Email')
      if (res.telegramStatus && res.telegramStatus !== 'failed' && res.telegramStatus !== 'not_configured') channels.push('Telegram')
      setFeeNoticeSuccess(`Notification sent successfully${channels.length ? ` via ${channels.join(' & ')}` : ''}!`)
      setTimeout(() => {
        setFeeNoticeTarget(null)
      }, 1500)
    } catch (err) {
      setFeeNoticeError(err instanceof Error ? err.message : 'Failed to notify guardian')
    } finally {
      setFeeNoticeBusy(false)
    }
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setError(null)
    let ids: string[] = []
    if (form.target === 'all') {
      const all: { id: string }[] = []
      for (const c of classesQ.data?.classes ?? []) {
        try {
          const res = await api.get<{ students: { id: string }[] }>(`/school/students?class_id=${c.id}`)
          all.push(...res.students)
        } catch {
          /* ignore */
        }
      }
      ids = all.map((s) => s.id)
    } else {
      ids = [...selected]
      // fall back to whole class if none picked explicitly
      if (!ids.length && classId) {
        try {
          const res = await api.get<{ students: { id: string }[] }>(`/school/students?class_id=${classId}`)
          ids = res.students.map((s) => s.id)
        } catch {
          /* ignore */
        }
      }
    }
    if (!ids.length) {
      setError('No students matched — pick a class or at least one student')
      return
    }
    setBusy(true)
    try {
      await api.post('/school/fees', {
        student_ids: ids,
        title: form.title.trim(),
        amount: Number(form.amount),
        due_date: form.due_date || null,
      })
      setOpen(false)
      setForm({ title: '', amount: '', due_date: '', target: 'all' })
      setSelected(new Set())
      feesQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const recordPayment = async (fee: FeeRow): Promise<void> => {
    const due = Number(fee.amount) - Number(fee.paid_amount)
    const input = window.prompt(`Payment for ${fee.student_name} — "${fee.title}". Outstanding ${fmtMoney(due)} ETB. Amount received:`)
    if (!input) return
    try {
      await api.patch(`/school/fees/${fee.id}/pay`, { amount: Number(input) })
      feesQ.reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Payment failed')
    }
  }

  return (
    <div>
      <PageHeader
        title="Fees"
        subtitle="Assign tuition and other fees, then record payments"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Assign fee
          </button>
        }
      />
      <div className="pl-toolbar">
        <select className="pl-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All fees</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partially paid</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      {feesQ.loading ? (
        <Spinner />
      ) : !feesQ.data?.fees.length ? (
        <EmptyState icon="fa-solid fa-money-bill-wave" title="No fees assigned yet" hint='Use "Assign fee" to charge tuition to a class.' />
      ) : (
        <DataTable
          rows={feesQ.data.fees}
          columns={[
            {
              key: 'stu',
              header: 'Student',
              render: (f) => (
                <div>
                  <strong>{f.student_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{f.class_name ?? f.student_code}</small>
                </div>
              ),
            },
            { key: 'title', header: 'Fee', render: (f) => f.title },
            { key: 'amount', header: 'Amount', render: (f) => `${fmtMoney(f.amount)} ETB` },
            { key: 'paid', header: 'Paid', render: (f) => `${fmtMoney(f.paid_amount)} ETB` },
            { key: 'due', header: 'Due', render: (f) => fmtDate(f.due_date) },
            { key: 'st', header: 'Status', width: '100px', render: (f) => <Badge tone={tone(f.status)}>{f.status}</Badge> },
            {
              key: 'act',
              header: '',
              width: '220px',
              render: (f) => (
                <div className="pl-row-actions">
                  {f.status !== 'paid' ? (
                    <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => recordPayment(f)}>
                      Receive payment
                    </button>
                  ) : (
                    <small style={{ color: 'var(--text-dim)' }}>{fmtDate(f.paid_at)}</small>
                  )}
                  <button
                    type="button"
                    className="pl-icon-btn"
                    aria-label={`Notify guardian of ${f.student_name}`}
                    title="Send notice/receipt to guardian (Email & Telegram)"
                    onClick={() => openFeeNoticeModal(f)}
                  >
                    <i className="fa-solid fa-paper-plane" aria-hidden="true" style={{ color: 'var(--accent)' }} />
                  </button>
                  <button
                    type="button"
                    className="pl-icon-btn"
                    aria-label={`Print 80mm receipt for ${f.student_name}`}
                    title="Print 80mm Thermal Receipt"
                    onClick={() => setReceiptFee(f)}
                  >
                    <i className="fa-solid fa-receipt" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={open} title="Assign a fee" wide onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="pl-grid-2">
            <Field label="Fee title">
              <input className="pl-input" required maxLength={160} placeholder="Tuition — September 2026" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
            </Field>
            <Field label="Amount per student (ETB)">
              <input className="pl-input" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Due date">
              <input className="pl-input" type="date" value={form.due_date} onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))} />
            </Field>
            <Field label="Charge who?">
              <select className="pl-select" value={form.target} onChange={(e) => setForm((f) => ({ ...f, target: e.target.value }))}>
                <option value="all">All active students</option>
                <option value="students">Specific class / students</option>
              </select>
            </Field>
          </div>

          {form.target === 'students' && (
            <>
              <Field label="Pick class">
                <select className="pl-select" value={classId} onChange={(e) => { setClassId(e.target.value); setSelected(new Set()) }}>
                  <option value="">Select class…</option>
                  {(classesQ.data?.classes ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.student_count})
                    </option>
                  ))}
                </select>
              </Field>
              {classId && studentsQ.data && (
                <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, padding: 10, marginBottom: 12 }}>
                  {(studentsQ.data.students as { id: string; first_name: string; last_name: string }[]).map((s) => (
                    <label key={s.id} className="pl-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', width: '100%' }}>
                      <input
                        type="checkbox"
                        checked={selected.has(s.id)}
                        onChange={(e) =>
                          setSelected((prev) => {
                            const next = new Set(prev)
                            if (e.target.checked) next.add(s.id)
                            else next.delete(s.id)
                            return next
                          })
                        }
                      />
                      <span>{s.first_name} {s.last_name}</span>
                    </label>
                  ))}
                  <small style={{ color: 'var(--text-dim)' }}>Leave all unchecked to charge the entire class.</small>
                </div>
              )}
            </>
          )}

          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Assign fee'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={receiptFee !== null} title={receiptFee ? `Receipt — ${receiptFee.student_name}` : ''} onClose={() => setReceiptFee(null)}>
        {receiptFee && (() => {
          const cfg = settingsQ.data?.settings
          const paid = Number(receiptFee.paid_amount || receiptFee.amount || 0)
          const rData: ReceiptData = {
            business_name: cfg?.business_name || me?.tenant?.name || 'AFRO SUITE SCHOOL',
            tin_number: cfg?.tin_number,
            vat_number: cfg?.vat_number,
            business_phone: cfg?.business_phone,
            business_address: cfg?.business_address,
            receipt_header: cfg?.receipt_header || (cfg?.academic_year ? `Academic Year: ${cfg.academic_year}` : 'Student Fee Receipt'),
            receipt_footer: cfg?.receipt_footer || 'Thank you! Education is the foundation of the future.',
            currency: cfg?.currency || 'ETB',
            tax_rate: cfg?.tax_rate,
            invoice_no: `FEE-${receiptFee.id.slice(0, 8).toUpperCase()}`,
            created_at: receiptFee.paid_at || new Date().toISOString(),
            cashier_name: me?.full_name || 'Bursar / Cashier',
            customer_name: `${receiptFee.student_name} (${receiptFee.class_name || receiptFee.student_code || 'Student'})`,
            items: [
              {
                name: receiptFee.title,
                quantity: 1,
                unit_price: paid,
                line_total: paid,
              },
            ],
            subtotal: paid,
            discount: 0,
            total: paid,
            payment_method: 'Bank Transfer / Cash',
            amount_paid: paid,
            change_due: 0,
          }
          return <ThermalReceipt data={rData} onDone={() => setReceiptFee(null)} />
        })()}
      </Modal>

      {/* Guardian Fee Notice Modal */}
      <Modal
        open={Boolean(feeNoticeTarget)}
        title={feeNoticeTarget ? `Notify Guardian — ${feeNoticeTarget.student_name}` : 'Fee Notice'}
        onClose={() => setFeeNoticeTarget(null)}
      >
        <form onSubmit={sendFeeNotice}>
          {feeNoticeTarget && (
            <div style={{ background: 'var(--card-subtle, rgba(255,255,255,0.03))', padding: '12px 14px', borderRadius: 8, marginBottom: 16, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: '.95rem', color: 'var(--text)' }}>
                {feeNoticeTarget.title}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.84rem', color: 'var(--text-dim)', marginTop: 4 }}>
                <span>Student: <b>{feeNoticeTarget.student_name}</b></span>
                <span>Class: <b>{feeNoticeTarget.class_name || 'N/A'}</b></span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.84rem', marginTop: 6, paddingTop: 6, borderTop: '1px dashed var(--border)' }}>
                <span>Total: <b>{fmtMoney(feeNoticeTarget.amount)} ETB</b></span>
                <span>Paid: <b>{fmtMoney(feeNoticeTarget.paid_amount)} ETB</b></span>
                <span style={{ color: feeNoticeTarget.status === 'paid' ? '#4ade80' : '#f87171', fontWeight: 600 }}>
                  {feeNoticeTarget.status === 'paid'
                    ? 'Fully Paid'
                    : `Due: ${fmtMoney(Number(feeNoticeTarget.amount) - Number(feeNoticeTarget.paid_amount))} ETB`}
                </span>
              </div>
            </div>
          )}

          <Field label="Notification Channel">
            <select
              className="pl-select"
              value={feeNoticeChannel}
              onChange={(e) => setFeeNoticeChannel(e.target.value as 'email' | 'telegram' | 'both')}
            >
              <option value="both">Both Email & Telegram</option>
              <option value="email">Email Only</option>
              <option value="telegram">Telegram Only</option>
            </select>
          </Field>

          <Field label="Custom Note (optional)">
            <textarea
              className="pl-textarea"
              rows={3}
              placeholder="e.g. Please note bank receipt can be brought to the accounts desk…"
              value={feeNoticeNote}
              onChange={(e) => setFeeNoticeNote(e.target.value)}
            />
          </Field>

          {feeNoticeSuccess && (
            <p style={{ color: '#4ade80', fontSize: '.87rem', background: 'rgba(74,222,128,0.1)', padding: '6px 10px', borderRadius: 6, marginBottom: 12 }}>
              <i className="fa-solid fa-circle-check" style={{ marginRight: 6 }} />
              {feeNoticeSuccess}
            </p>
          )}

          {feeNoticeError && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{feeNoticeError}</p>}

          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={feeNoticeBusy}>
              {feeNoticeBusy ? 'Sending Notice…' : feeNoticeTarget?.status === 'paid' ? 'Send Payment Receipt' : 'Send Fee Reminder'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
