import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Student {
  id: string
  code: string
  first_name: string
  last_name: string
  gender: 'male' | 'female'
  dob: string | null
  class_id: string | null
  class_name: string | null
  guardian_name: string | null
  guardian_phone: string | null
  address: string | null
  status: 'active' | 'graduated' | 'withdrawn'
}
interface ClassOpt {
  id: string
  name: string
}

const empty = { first_name: '', last_name: '', gender: 'male', dob: '', class_id: '', guardian_name: '', guardian_phone: '', address: '' }

export default function Students(): JSX.Element {
  const [search, setSearch] = useState('')
  const [classFilter, setClassFilter] = useState('')
  const qs = new URLSearchParams()
  if (search) qs.set('search', search)
  if (classFilter) qs.set('class_id', classFilter)
  const { data, loading, reload } = useApiData<{ students: Student[] }>(`/school/students?${qs.toString()}`)
  const classesQ = useApiData<{ classes: ClassOpt[] }>('/school/classes')

  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<Student | null>(null)
  const [form, setForm] = useState(empty)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const openNew = (): void => {
    setForm(empty)
    setEditing(null)
    setError(null)
    setOpen(true)
  }
  const openEdit = (s: Student): void => {
    setForm({
      first_name: s.first_name,
      last_name: s.last_name,
      gender: s.gender,
      dob: s.dob ?? '',
      class_id: s.class_id ?? '',
      guardian_name: s.guardian_name ?? '',
      guardian_phone: s.guardian_phone ?? '',
      address: s.address ?? '',
    })
    setEditing(s)
    setError(null)
    setOpen(true)
  }

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const body = {
      first_name: form.first_name.trim(),
      last_name: form.last_name.trim(),
      gender: form.gender,
      dob: form.dob || null,
      class_id: form.class_id || null,
      guardian_name: form.guardian_name.trim() || null,
      guardian_phone: form.guardian_phone.trim() || null,
      address: form.address.trim() || null,
    }
    try {
      if (editing) await api.patch(`/school/students/${editing.id}`, body)
      else await api.post('/school/students', body)
      setOpen(false)
      reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Students"
        subtitle="Student IDs are generated automatically"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={openNew}>
            <i className="fa-solid fa-user-plus" aria-hidden="true" /> Add student
          </button>
        }
      />
      <div className="pl-toolbar">
        <input className="pl-input" placeholder="Search by name or ID…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search students" />
        <select className="pl-select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="Filter by class">
          <option value="">All classes</option>
          {(classesQ.data?.classes ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {loading ? (
        <Spinner />
      ) : !data?.students.length ? (
        <EmptyState icon="fa-solid fa-user-graduate" title="No students found" hint="Register your first student." />
      ) : (
        <DataTable
          rows={data.students}
          columns={[
            { key: 'code', header: 'ID', render: (s) => <strong>{s.code}</strong>, width: '100px' },
            {
              key: 'name',
              header: 'Name',
              render: (s) => (
                <div>
                  <strong>{s.first_name} {s.last_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)', textTransform: 'capitalize' }}>{s.gender}</small>
                </div>
              ),
            },
            { key: 'class', header: 'Class', render: (s) => s.class_name ?? 'Unassigned' },
            { key: 'guardian', header: 'Guardian', render: (s) => (s.guardian_name ? `${s.guardian_name}${s.guardian_phone ? ` · ${s.guardian_phone}` : ''}` : '—') },
            {
              key: 'status',
              header: 'Status',
              width: '100px',
              render: (s) => <Badge tone={s.status === 'active' ? 'good' : 'neutral'}>{s.status}</Badge>,
            },
            {
              key: 'act',
              header: '',
              width: '60px',
              render: (s) => (
                <div className="pl-row-actions">
                  <button type="button" className="pl-icon-btn" aria-label={`Edit ${s.first_name}`} onClick={() => openEdit(s)}>
                    <i className="fa-solid fa-pen" aria-hidden="true" />
                  </button>
                </div>
              ),
            },
          ]}
        />
      )}

      <Modal open={open} title={editing ? `Edit ${editing.first_name}` : 'Add student'} onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="pl-grid-2">
            <Field label="First name">
              <input className="pl-input" required maxLength={80} value={form.first_name} onChange={(e) => setForm((f) => ({ ...f, first_name: e.target.value }))} />
            </Field>
            <Field label="Last name">
              <input className="pl-input" required maxLength={80} value={form.last_name} onChange={(e) => setForm((f) => ({ ...f, last_name: e.target.value }))} />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Gender">
              <select className="pl-select" value={form.gender} onChange={(e) => setForm((f) => ({ ...f, gender: e.target.value }))}>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </Field>
            <Field label="Date of birth">
              <input className="pl-input" type="date" value={form.dob} onChange={(e) => setForm((f) => ({ ...f, dob: e.target.value }))} />
            </Field>
          </div>
          <Field label="Class">
            <select className="pl-select" value={form.class_id} onChange={(e) => setForm((f) => ({ ...f, class_id: e.target.value }))}>
              <option value="">— unassigned —</option>
              {(classesQ.data?.classes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="pl-grid-2">
            <Field label="Guardian name">
              <input className="pl-input" value={form.guardian_name} onChange={(e) => setForm((f) => ({ ...f, guardian_name: e.target.value }))} />
            </Field>
            <Field label="Guardian phone">
              <input className="pl-input" value={form.guardian_phone} onChange={(e) => setForm((f) => ({ ...f, guardian_phone: e.target.value }))} />
            </Field>
          </div>
          <Field label="Address">
            <input className="pl-input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save changes' : 'Add student'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
