import { useState, type FormEvent } from 'react'
import { api, fmtMoney, loadAuth } from '../api'
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
  profile_values?: Record<string, number>
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
  const { data: empData, loading: empLoading, reload } = useApiData<{ employees: Employee[] }>('/payroll/employees')
  const { data: compData, loading: compLoading } = useApiData<{ components: any[] }>('/payroll/components')
  const [editUser, setEditUser] = useState<Employee | null>(null)
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openEdit = (emp: Employee): void => {
    setEditUser(emp)

    // Initialize form with existing profile values or defaults for PROFILE components
    const newForm: Record<string, string> = {}
    const profileComps = compData?.components?.filter(c => c.source === 'PROFILE') || []

    for (const comp of profileComps) {
       // If employee has a value, use it, else default to '0'
       const val = emp.profile_values && emp.profile_values[comp.code] !== undefined
          ? String(emp.profile_values[comp.code])
          : '0'
       newForm[comp.code] = val
    }

    setForm(newForm)
    setError(null)
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!editUser) return
    setBusy(true)
    setError(null)
    try {
      const profile_values: Record<string, string | number> = {}
      for (const [k, v] of Object.entries(form)) {
        profile_values[k] = v
      }

      await api.post(`/payroll/employees/${editUser.id}`, { profile_values })
      setEditUser(null)
      void reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    } finally {
      setBusy(false)
    }
  }

  if ((empLoading && !empData) || (compLoading && !compData)) return <Spinner />

  const employees = empData?.employees ?? []
  const profileComps = compData?.components?.filter(c => c.source === 'PROFILE').sort((a, b) => a.display_order - b.display_order) || []

  return (
    <>
      {employees.length === 0 ? (
        <EmptyState icon="fa-solid fa-users" title="No employees found" />
      ) : (
        <DataTable
          columns={[
            { key: 'full_name', header: 'Employee', render: (r) => r.full_name },
            { key: 'role', header: 'Role', render: (r) => r.role },
            ...profileComps.map(c => ({
              key: c.code,
              header: c.label,
              render: (r: any) => {
                const val = r.profile_values?.[c.code]
                return val != null ? `${fmtMoney(val)}` : '—'
              }
            })),
            {
              key: 'actions', header: '', render: (r) => (
                <button type="button" className="pl-btn-icon" title="Set profile values" aria-label="Set profile values" onClick={() => openEdit(r)}>
                  <i className="fa-solid fa-pen" aria-hidden="true" />
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
            {profileComps.map(c => (
              <Field key={c.code} label={c.label}>
                <input
                  className="pl-input"
                  type="text"
                  value={form[c.code] || ''}
                  onChange={(e) => setForm({ ...form, [c.code]: e.target.value })}
                />
              </Field>
            ))}
            {profileComps.length === 0 && <p>No PROFILE components defined in Payroll Engine.</p>}

            {error && <p style={{ color: '#e07a7a', fontSize: '.87rem', marginTop: '1rem' }}>{error}</p>}
            <div className="pl-form-actions" style={{ marginTop: '1.5rem' }}>
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
      const res = await api.post<{ run: RunDetail }>('/payroll/run', { period_label: periodLabel, frequency })
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
                { key: 'employee_name', header: 'Employee', render: (r: any) => r.employee_name },
                ...((result as any).run?.components || []).map((c: any) => ({
                  key: c.code,
                  header: c.label,
                  render: (r: any) => {
                    const val = r.values?.[c.code]
                    return typeof val === 'number' ? fmtMoney(val) : (val ?? '—')
                  }
                })),
                { key: 'net_pay', header: 'Net Pay', render: (r: any) => <strong>{fmtMoney(r.net_pay)} ETB</strong> }
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
      headers: { Authorization: `Bearer ${loadAuth()?.token ?? ''}` },
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
            { key: 'period_label', header: 'Period', render: (r: any) => r.period_label },
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
                  <button type="button" className="pl-btn-icon" title="View run" aria-label="View payroll run" onClick={() => void viewRun(r.id)}><i className="fa-solid fa-eye" aria-hidden="true" /></button>
                  {r.status === 'draft' && <button type="button" className="pl-btn-icon" title="Approve run" aria-label="Approve payroll run" disabled={busy} onClick={() => void approve(r.id)}><i className="fa-solid fa-check" aria-hidden="true" /></button>}
                  {r.status === 'approved' && <button type="button" className="pl-btn-icon" title="Mark paid" aria-label="Mark payroll run as paid" disabled={busy} onClick={() => void markPaid(r.id)}><i className="fa-solid fa-money-bill-wave" aria-hidden="true" /></button>}
                  <button type="button" className="pl-btn-icon" title="Export CSV" aria-label="Export payroll run as CSV" onClick={() => void exportCsv(r.id)}><i className="fa-solid fa-download" aria-hidden="true" /></button>
                  {r.status === 'draft' && <button type="button" className="pl-btn-icon" title="Delete run" aria-label="Delete payroll run" onClick={() => void deleteRun(r.id)}><i className="fa-solid fa-trash" aria-hidden="true" /></button>}
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
              { key: 'employee_name', header: 'Employee', render: (r: any) => r.employee_name },
              ...((detail as any).run?.components || []).map((c: any) => ({
                key: c.code,
                header: c.label,
                render: (r: any) => {
                  const val = r.values?.[c.code]
                  return typeof val === 'number' ? fmtMoney(val) : (val ?? '—')
                }
              })),
              { key: 'net_pay', header: 'Net', render: (r: any) => <strong>{fmtMoney(r.net_pay)}</strong> }
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
        { key: 'period_label', header: 'Period', render: (r: any) => r.period_label },
        { key: 'gross', header: 'Gross', render: (r: any) => `${fmtMoney(r.values?.GROSS ?? 0)} ETB` },
        { key: 'income_tax', header: 'Tax', render: (r: any) => `${fmtMoney(r.values?.INCOME_TAX ?? 0)} ETB` },
        { key: 'pension_employee', header: 'Pension', render: (r: any) => `${fmtMoney(r.values?.PENSION_EE ?? 0)} ETB` },
        { key: 'net_pay', header: 'Net Pay', render: (r: any) => <strong style={{ color: '#059669' }}>{fmtMoney(r.net_pay)} ETB</strong> },
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
