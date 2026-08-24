import { useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

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
              width: '150px',
              render: (f) =>
                f.status !== 'paid' ? (
                  <div className="pl-row-actions">
                    <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => recordPayment(f)}>
                      Receive payment
                    </button>
                  </div>
                ) : (
                  <small style={{ color: 'var(--text-dim)' }}>{fmtDate(f.paid_at)}</small>
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
                    <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px', cursor: 'pointer' }}>
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
                      {s.first_name} {s.last_name}
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
    </div>
  )
}
