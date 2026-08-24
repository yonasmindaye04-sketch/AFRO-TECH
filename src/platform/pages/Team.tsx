import { useState, type FormEvent } from 'react'
import { fmtDate, api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface StaffUser {
  id: string
  email: string
  full_name: string
  role: 'owner' | 'staff'
  is_active: boolean
  created_at: string
}

export default function Team(): JSX.Element {
  const { data, loading, reload } = useApiData<{ users: StaffUser[] }>('/users')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ full_name: '', email: '', password: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/users', { full_name: form.full_name.trim(), email: form.email.trim().toLowerCase(), password: form.password })
      setOpen(false)
      setForm({ full_name: '', email: '', password: '' })
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const toggleActive = async (u: StaffUser): Promise<void> => {
    try {
      await api.patch(`/users/${u.id}`, { is_active: !u.is_active })
      reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Update failed')
    }
  }

  return (
    <div>
      <PageHeader
        title="Team"
        subtitle="Give your staff their own login — they see the same company data"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-user-plus" aria-hidden="true" /> Add staff member
          </button>
        }
      />
      {loading ? (
        <Spinner />
      ) : !data?.users.length ? (
        <EmptyState icon="fa-solid fa-users" title="No team members yet" />
      ) : (
        <DataTable
          rows={data.users}
          columns={[
            {
              key: 'name',
              header: 'Member',
              render: (u) => (
                <div>
                  <strong>{u.full_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{u.email}</small>
                </div>
              ),
            },
            {
              key: 'role',
              header: 'Role',
              width: '100px',
              render: (u) => <Badge tone={u.role === 'owner' ? 'warn' : 'neutral'}>{u.role}</Badge>,
            },
            {
              key: 'status',
              header: 'Status',
              width: '100px',
              render: (u) => <Badge tone={u.is_active ? 'good' : 'bad'}>{u.is_active ? 'active' : 'disabled'}</Badge>,
            },
            { key: 'since', header: 'Joined', render: (u) => fmtDate(u.created_at), width: '110px' },
            {
              key: 'act',
              header: '',
              width: '120px',
              render: (u) =>
                u.role !== 'owner' ? (
                  <div className="pl-row-actions">
                    <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => toggleActive(u)}>
                      {u.is_active ? 'Disable' : 'Enable'}
                    </button>
                  </div>
                ) : (
                  <small style={{ color: 'var(--text-dim)', fontSize: '.78rem' }}>Owner account</small>
                ),
            },
          ]}
        />
      )}

      <Modal open={open} title="Add staff member" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <Field label="Full name">
            <input className="pl-input" required maxLength={120} value={form.full_name} onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
          </Field>
          <Field label="Email">
            <input className="pl-input" type="email" required value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
          </Field>
          <Field label="Temporary password" hint="At least 8 characters — share it privately">
            <input className="pl-input" type="password" required minLength={8} value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Creating…' : 'Create login'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
