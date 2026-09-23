import { useState, type FormEvent } from 'react'
import { api, fmtMoney } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Card, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'
import { useAuth } from '../AuthContext'

/* ── Types ── */
interface Employee {
  id: string
  full_name: string
  email: string
  role: string
  base_salary: number | null
  transport_allow: number | null
  housing_allow: number | null
  other_allow: number | null
  pension_pct: number | null
  is_active: boolean | null
}

interface PayrollRun {
  id: string
  period_header: string
  frequency: string
  status: 'draft' | 'approved' | 'paid'
  total_gross: string
  total_net: string
  item_count: number
  created_at: string
}

interface PayrollItem {
  id: string
  user_id: string
  employee_name: string
  base_salary: string
  allowances: string
  gross: string
  income_tax: string
  pension_employee: string
  pension_employer: string
  other_deductions: string
  net_pay: string
}

interface RunDetail extends PayrollRun {
  items: PayrollItem[]
}

interface Payslip {
  id: string
  period_header: string
  frequency: string
  status: string
  employee_name: string
  base_salary: string
  allowances: string
  gross: string
  income_tax: string
  pension_employee: string
  pension_employer: string
  other_deductions: string
  net_pay: string
}

type Tab = 'employees' | 'run' | 'history' | 'my-payslips'

export default function Payroll(): JSX.Element {
  const { me } = useAuth()
  const isManager = me?.role === 'owner'
  const [tab, setTab] = useState<Tab>(isManager ? 'employees' : 'my-payslips')

  return (
    <div className="pl-page">
      <PageHeader title="Payroll" subtitle="Employee salaries, payroll runs and payslips" action={<><div className="sub-tabs">
          {isManager && (
            <>
              <button type="button" className={`sub-tab ${tab === 'employees' ? 'sub-tab-active' : ''}`} onClick={() => setTab('employees')}>Employees</button>
              <button type="button" className={`sub-tab ${tab === 'run' ? 'sub-tab-active' : ''}`} onClick={() => setTab('run')}>Run Payroll</button>
              <button type="button" className={`sub-tab ${tab === 'history' ? 'sub-tab-active' : ''}`} onClick={() => setTab('history')}>History</button>
            </>
          )}
          <button type="button" className={`sub-tab ${tab === 'my-payslips' ? 'sub-tab-active' : ''}`} onClick={() => setTab('my-payslips')}>My Payslips</button>
        </div></>} />

      {tab === 'employees' && isManager && <EmployeesTab />}
      {tab === 'run' && isManager && <RunPayrollTab />}
      {tab === 'history' && isManager && <HistoryTab />}
      {tab === 'my-payslips' && <MyPayslipsTab />}
    </div>
  )
}

/* ══════════════════ EMPLOYEES TAB ══════════════════ */

function EmployeesTab(): JSX.Element {
  const { data, loading, reload } = useApiData<{ employees: Employee[] }>('/payroll/employees')
  const [editUser, setEditUser] = useState<Employee | null>(null)
  const [form, setForm] = useState({ base_salary: '', transport_allow: '', housing_allow: '', other_allow: '', pension_pct: '7' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openEdit = (emp: Employee): void => {
    setEditUser(emp)
    setForm({
      base_salary: String(emp.base_salary ?? ''),
      transport_allow: String(emp.transport_allow ?? '0'),
      housing_allow: String(emp.housing_allow ?? '0'),
      other_allow: String(emp.other_allow ?? '0'),
      pension_pct: String(emp.pension_pct ?? '7'),
    })
    setError(null)
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!editUser) return
    setBusy(true)
    setError(null)
    try {
      await api.post(`/payroll/employees/${editUser.id}`, {
        base_salary: Number(form.base_salary),
        transport_allow: Number(form.transport_allow) || 0,
        housing_allow: Number(form.housing_allow) || 0,
        other_allow: Number(form.other_allow) || 0,
        pension_pct: Number(form.pension_pct) || 7,
      })
      setEditUser(null)
      void reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if (loading && !data) return <Spinner />

  const employees = data?.employees ?? []

  return (
    <>
      {employees.length === 0 ? (
        <EmptyState icon="fa-solid fa-users" title="No employees found" />
      ) : (
        <DataTable
          columns={[
            { key: 'full_name', header: 'Employee', render: (r) => r.full_name },
            { key: 'role', header: 'Role', render: (r) => r.role },
            { key: 'base_salary', header: 'Base Salary', render: (r) => r.base_salary ? `${fmtMoney(r.base_salary)} ETB` : '—' },
            { key: 'allowances', header: 'Allowances', render: (r) => {
              const total = (r.transport_allow ?? 0) + (r.housing_allow ?? 0) + (r.other_allow ?? 0)
              return total > 0 ? `${fmtMoney(total)} ETB` : '—'
            } },
            { key: 'pension_pct', header: 'Pension %', render: (r) => r.pension_pct != null ? `${r.pension_pct}%` : '—' },
            {
              key: 'actions', header: '', render: (r) => (
                <button type="button" className="pl-btn-icon" title="Set salary" onClick={() => openEdit(r)}>
                  <i className="fa-solid fa-pen" />
                </button>
              ),
            },
          ]}
          rows={employees}
        />
      )}

      {editUser && (
        <Modal open={true} title={`Salary — ${editUser.full_name}`} onClose={() => setEditUser(null)}>
          <form onSubmit={submit}>
            <Field label="Base Salary (ETB / month)">
              <input className="pl-input" type="number" min="0" step="0.01" required value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} />
            </Field>
            <Field label="Transport Allowance">
              <input className="pl-input" type="number" min="0" step="0.01" value={form.transport_allow} onChange={(e) => setForm({ ...form, transport_allow: e.target.value })} />
            </Field>
            <Field label="Housing Allowance">
              <input className="pl-input" type="number" min="0" step="0.01" value={form.housing_allow} onChange={(e) => setForm({ ...form, housing_allow: e.target.value })} />
            </Field>
            <Field label="Other Allowance">
              <input className="pl-input" type="number" min="0" step="0.01" value={form.other_allow} onChange={(e) => setForm({ ...form, other_allow: e.target.value })} />
            </Field>
            <Field label="Employee Pension %">
              <input className="pl-input" type="number" min="0" max="100" step="0.01" value={form.pension_pct} onChange={(e) => setForm({ ...form, pension_pct: e.target.value })} />
            </Field>
            {error && <p style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
            <div className="pl-form-actions">
              <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setEditUser(null)}>Cancel</button>
              <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  )
}

/* ══════════════════ RUN PAYROLL TAB ══════════════════ */

function RunPayrollTab(): JSX.Element {
  const now = new Date()
  const [periodLabel, setPeriodLabel] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [frequency, setFrequency] = useState<'monthly' | 'biweekly' | 'weekly'>('monthly')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RunDetail | null>(null)

  const run = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.post<{ run: RunDetail }>('/payroll/run', { period_header: periodLabel, frequency })
      setResult(res.run)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate payroll')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Card>
        <form onSubmit={run} style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <Field label="Period">
            <input className="pl-input" type="month" value={periodLabel} onChange={(e) => setPeriodLabel(e.target.value)} required />
          </Field>
          <Field label="Frequency">
            <select className="pl-input" value={frequency} onChange={(e) => setFrequency(e.target.value as typeof frequency)}>
              <option value="monthly">Monthly</option>
              <option value="biweekly">Bi-weekly</option>
              <option value="weekly">Weekly</option>
            </select>
          </Field>
          <button type="submit" className="pl-btn pl-btn-primary" disabled={busy} style={{ marginBottom: 16 }}>
            {busy ? 'Generating...' : 'Generate Payroll'}
          </button>
        </form>
        {error && <p style={{ color: '#e07a7a', fontSize: '.87rem', marginTop: 8 }}>{error}</p>}
      </Card>

      {result && (
        <>
          <div className="pl-stats" style={{ marginTop: 16 }}>
            <div className="pl-stat">
              <div className="pl-stat-label">Total Gross</div>
              <div className="pl-stat-value">{fmtMoney(result.total_gross)} ETB</div>
            </div>
            <div className="pl-stat">
              <div className="pl-stat-label">Total Net</div>
              <div className="pl-stat-value">{fmtMoney(result.total_net)} ETB</div>
            </div>
            <div className="pl-stat">
              <div className="pl-stat-label">Employees</div>
              <div className="pl-stat-value">{result.items?.length ?? 0}</div>
            </div>
            <div className="pl-stat">
              <div className="pl-stat-label">Status</div>
              <div className="pl-stat-value" style={{ fontWeight: 700, color: '#d97706' }}>{result.status}</div>
            </div>
          </div>
          {result.items && result.items.length > 0 && (
            <DataTable
              columns={[
                { key: 'employee_name', header: 'Employee', render: (r) => r.employee_name },
                { key: 'base_salary', header: 'Base', render: (r) => fmtMoney(r.base_salary) },
                { key: 'allowances', header: 'Allowances', render: (r) => fmtMoney(r.allowances) },
                { key: 'gross', header: 'Gross', render: (r) => fmtMoney(r.gross) },
                { key: 'income_tax', header: 'Tax', render: (r) => fmtMoney(r.income_tax) },
                { key: 'pension_employee', header: 'Pension', render: (r) => fmtMoney(r.pension_employee) },
                { key: 'net_pay', header: 'Net Pay', render: (r) => <strong>{fmtMoney(r.net_pay)} ETB</strong> },
              ]}
              rows={result.items}
            />
          )}
        </>
      )}
    </>
  )
}

/* ══════════════════ HISTORY TAB ══════════════════ */

function HistoryTab(): JSX.Element {
  const { data, loading, reload } = useApiData<{ runs: PayrollRun[] }>('/payroll/runs')
  const [detail, setDetail] = useState<RunDetail | null>(null)
  const [busy, setBusy] = useState(false)

  const viewRun = async (id: string): Promise<void> => {
    const res = await api.get<{ run: RunDetail }>(`/payroll/runs/${id}`)
    setDetail(res.run)
  }

  const approve = async (id: string): Promise<void> => {
    setBusy(true)
    await api.patch(`/payroll/runs/${id}/approve`, {})
    void reload()
    setBusy(false)
  }

  const markPaid = async (id: string): Promise<void> => {
    setBusy(true)
    await api.patch(`/payroll/runs/${id}/paid`, {})
    void reload()
    setBusy(false)
  }

  const deleteRun = async (id: string): Promise<void> => {
    if (!confirm('Delete this draft payroll run?')) return
    await api.del(`/payroll/runs/${id}`)
    void reload()
  }

  const exportCsv = async (id: string): Promise<void> => {
    const res = await fetch(`/api/v1/payroll/runs/${id}/export`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('token') ?? ''}` },
    })
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `payroll-${id.slice(0, 8)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  if (loading && !data) return <Spinner />

  const runs = data?.runs ?? []

  return (
    <>
      {runs.length === 0 ? (
        <EmptyState icon="fa-solid fa-clock-rotate-left" title="No payroll runs yet" />
      ) : (
        <DataTable
          columns={[
            { key: 'period_label', header: 'Period', render: (r) => r.period_label },
            { key: 'frequency', header: 'Frequency', render: (r) => r.frequency },
            { key: 'total_gross', header: 'Gross', render: (r) => `${fmtMoney(r.total_gross)} ETB` },
            { key: 'total_net', header: 'Net', render: (r) => `${fmtMoney(r.total_net)} ETB` },
            { key: 'item_count', header: 'Staff', render: (r) => String(r.item_count) },
            {
              key: 'status', header: 'Status', render: (r) => (
                <span style={{ fontWeight: 700, color: r.status === 'paid' ? '#059669' : r.status === 'approved' ? '#2563eb' : '#d97706' }}>
                  {r.status}
                </span>
              ),
            },
            {
              key: 'actions', header: '', render: (r) => (
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="pl-btn-icon" title="View" onClick={() => void viewRun(r.id)}><i className="fa-solid fa-eye" /></button>
                  {r.status === 'draft' && <button type="button" className="pl-btn-icon" title="Approve" disabled={busy} onClick={() => void approve(r.id)}><i className="fa-solid fa-check" /></button>}
                  {r.status === 'approved' && <button type="button" className="pl-btn-icon" title="Mark Paid" disabled={busy} onClick={() => void markPaid(r.id)}><i className="fa-solid fa-money-bill-wave" /></button>}
                  <button type="button" className="pl-btn-icon" title="CSV" onClick={() => void exportCsv(r.id)}><i className="fa-solid fa-download" /></button>
                  {r.status === 'draft' && <button type="button" className="pl-btn-icon" title="Delete" onClick={() => void deleteRun(r.id)}><i className="fa-solid fa-trash" /></button>}
                </div>
              ),
            },
          ]}
          rows={runs}
        />
      )}

      {detail && (
        <Modal open={true} title={`Payroll — ${(detail as any).period_label}`} onClose={() => setDetail(null)}>
          <DataTable
            columns={[
              { key: 'employee_name', header: 'Employee', render: (r) => r.employee_name },
              { key: 'base_salary', header: 'Base', render: (r) => fmtMoney(r.base_salary) },
              { key: 'allowances', header: 'Allow.', render: (r) => fmtMoney(r.allowances) },
              { key: 'gross', header: 'Gross', render: (r) => fmtMoney(r.gross) },
              { key: 'income_tax', header: 'Tax', render: (r) => fmtMoney(r.income_tax) },
              { key: 'pension_employee', header: 'Pension', render: (r) => fmtMoney(r.pension_employee) },
              { key: 'net_pay', header: 'Net', render: (r) => <strong>{fmtMoney(r.net_pay)}</strong> },
            ]}
            rows={detail.items ?? []}
          />
        </Modal>
      )}
    </>
  )
}

/* ══════════════════ MY PAYSLIPS TAB ══════════════════ */

function MyPayslipsTab(): JSX.Element {
  const { data, loading } = useApiData<{ payslips: Payslip[] }>('/payroll/my-payslips')

  if (loading && !data) return <Spinner />

  const payslips = data?.payslips ?? []

  return payslips.length === 0 ? (
    <EmptyState icon="fa-solid fa-file-invoice" title="No payslips available yet" />
  ) : (
    <DataTable
      columns={[
        { key: 'period_label', header: 'Period', render: (r) => r.period_label },
        { key: 'base_salary', header: 'Base', render: (r) => `${fmtMoney(r.base_salary)} ETB` },
        { key: 'allowances', header: 'Allowances', render: (r) => `${fmtMoney(r.allowances)} ETB` },
        { key: 'gross', header: 'Gross', render: (r) => `${fmtMoney(r.gross)} ETB` },
        { key: 'income_tax', header: 'Tax', render: (r) => `${fmtMoney(r.income_tax)} ETB` },
        { key: 'pension_employee', header: 'Pension', render: (r) => `${fmtMoney(r.pension_employee)} ETB` },
        { key: 'net_pay', header: 'Net Pay', render: (r) => <strong style={{ color: '#059669' }}>{fmtMoney(r.net_pay)} ETB</strong> },
        {
          key: 'status', header: 'Status', render: (r) => (
            <span style={{ fontWeight: 700, color: r.status === 'paid' ? '#059669' : r.status === 'approved' ? '#2563eb' : '#d97706' }}>
              {r.status}
            </span>
          ),
        },
      ]}
      rows={payslips}
    />
  )
}
