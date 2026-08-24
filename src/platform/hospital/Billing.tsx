import { useState, type FormEvent } from 'react'
import { api, fmtDate, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Invoice {
  id: string
  number: string
  description: string | null
  amount: string
  paid_amount: string
  status: 'unpaid' | 'partial' | 'paid'
  issued_on: string
  patient_name: string | null
}
interface PatientOpt {
  id: string
  first_name: string
  last_name: string
  code: string
}

const tone = (s: Invoice['status']): 'good' | 'warn' | 'bad' => (s === 'paid' ? 'good' : s === 'partial' ? 'warn' : 'bad')

export default function Billing(): JSX.Element {
  const [statusFilter, setStatusFilter] = useState('')
  const invoicesQ = useApiData<{ invoices: Invoice[] }>(`/hospital/invoices${statusFilter ? `?status=${statusFilter}` : ''}`)
  const patientsQ = useApiData<{ patients: PatientOpt[] }>('/hospital/patients')

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ patient_id: '', description: '', amount: '', paid_amount: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/hospital/invoices', {
        patient_id: form.patient_id || null,
        description: form.description.trim() || null,
        amount: Number(form.amount),
        paid_amount: Number(form.paid_amount) || 0,
      })
      setOpen(false)
      setForm({ patient_id: '', description: '', amount: '', paid_amount: '' })
      invoicesQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const recordPayment = async (inv: Invoice): Promise<void> => {
    const due = Number(inv.amount) - Number(inv.paid_amount)
    const input = window.prompt(`Record payment for ${inv.number} — outstanding ${fmtMoney(due)} ETB. Amount received:`)
    if (!input) return
    try {
      await api.patch(`/hospital/invoices/${inv.id}/pay`, { amount: Number(input) })
      invoicesQ.reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Payment failed')
    }
  }

  const [printData, setPrintData] = useState<Invoice | null>(null)
  const settingsQ = useApiData<{ settings: { business_phone?: string; business_address?: string; receipt_footer?: string } }>('/tenant/settings')

  const printInvoice = (inv: Invoice): void => {
    setPrintData(inv)
    setTimeout(() => window.print(), 60)
  }

  return (
    <div>
      <PageHeader
        title="Billing"
        subtitle="Invoices per patient — consultation, lab, medication"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-file-invoice-dollar" aria-hidden="true" /> New invoice
          </button>
        }
      />
      <div className="pl-toolbar">
        <select className="pl-select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by status">
          <option value="">All invoices</option>
          <option value="unpaid">Unpaid</option>
          <option value="partial">Partially paid</option>
          <option value="paid">Paid</option>
        </select>
      </div>

      {invoicesQ.loading ? (
        <Spinner />
      ) : !invoicesQ.data?.invoices.length ? (
        <EmptyState icon="fa-solid fa-file-invoice" title="No invoices yet" hint="Create an invoice when a patient is billed." />
      ) : (
        <DataTable
          rows={invoicesQ.data.invoices}
          columns={[
            { key: 'num', header: 'Invoice #', render: (i) => <strong>{i.number}</strong>, width: '110px' },
            { key: 'pat', header: 'Patient', render: (i) => i.patient_name ?? '—' },
            { key: 'desc', header: 'Description', render: (i) => i.description ?? '—' },
            { key: 'amount', header: 'Amount', render: (i) => `${fmtMoney(i.amount)} ETB` },
            { key: 'paid', header: 'Paid', render: (i) => `${fmtMoney(i.paid_amount)} ETB` },
            { key: 'st', header: 'Status', width: '100px', render: (i) => <Badge tone={tone(i.status)}>{i.status}</Badge> },
            { key: 'issued', header: 'Issued', render: (i) => fmtDate(i.issued_on), width: '110px' },
            {
              key: 'act',
              header: '',
              width: '150px',
              render: (i) => (
                <div className="pl-row-actions">
                  {i.status !== 'paid' && (
                    <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => recordPayment(i)}>
                      Receive
                    </button>
                  )}
                  <button type="button" className="pl-icon-btn" aria-label={`Print invoice ${i.number}`} onClick={() => printInvoice(i)}>
                    <i className="fa-solid fa-print" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={open} title="New invoice" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <Field label="Patient">
            <select className="pl-select" value={form.patient_id} onChange={(e) => setForm((f) => ({ ...f, patient_id: e.target.value }))}>
              <option value="">— walk-in / no patient —</option>
              {(patientsQ.data?.patients ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.first_name} {p.last_name} ({p.code})
                </option>
              ))}
            </select>
          </Field>
          <Field label="Description">
            <input className="pl-input" maxLength={500} placeholder="Consultation + lab tests" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </Field>
          <div className="pl-grid-2">
            <Field label="Amount (ETB)">
              <input className="pl-input" type="number" min="0.01" step="0.01" required value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
            </Field>
            <Field label="Paid now (ETB)">
              <input className="pl-input" type="number" min="0" step="0.01" value={form.paid_amount} onChange={(e) => setForm((f) => ({ ...f, paid_amount: e.target.value }))} />
            </Field>
          </div>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Create invoice'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Printable invoice (hidden on screen, visible when printing) */}
      {printData && (
        <div className="pl-print-area" style={{ position: 'absolute', left: -9999, top: 0 }}>
          <div className="pl-reportcard">
            <h2 style={{ textAlign: 'center' }}>INVOICE {printData.number}</h2>
            <p style={{ textAlign: 'center', fontSize: '.85rem' }}>
              {settingsQ.data?.settings.business_address ? `${settingsQ.data.settings.business_address} · ` : ''}
              {settingsQ.data?.settings.business_phone ?? ''}
            </p>
            <table>
              <tbody>
                <tr><th>Patient</th><td>{printData.patient_name ?? 'Walk-in'}</td></tr>
                <tr><th>Description</th><td>{printData.description ?? '—'}</td></tr>
                <tr><th>Issued</th><td>{fmtDate(printData.issued_on)}</td></tr>
                <tr><th>Amount</th><td>{fmtMoney(printData.amount)} ETB</td></tr>
                <tr><th>Paid</th><td>{fmtMoney(printData.paid_amount)} ETB</td></tr>
                <tr><th>Balance</th><td><strong>{fmtMoney(Number(printData.amount) - Number(printData.paid_amount))} ETB</strong></td></tr>
                <tr><th>Status</th><td>{printData.status.toUpperCase()}</td></tr>
              </tbody>
            </table>
            <p style={{ textAlign: 'center', marginTop: 18, fontSize: '.8rem' }}>
              {settingsQ.data?.settings.receipt_footer ?? 'Thank you!'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
