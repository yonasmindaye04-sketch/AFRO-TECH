import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface ClassRow {
  id: string
  name: string
  academic_year: string
  homeroom_teacher_id: string | null
  homeroom_teacher: string | null
  student_count: number
}
interface TeacherRow {
  id: string
  full_name: string
  subject: string | null
  phone: string | null
}

export default function Classes(): JSX.Element {
  const classesQ = useApiData<{ classes: ClassRow[] }>('/school/classes')
  const teachersQ = useApiData<{ teachers: TeacherRow[] }>('/school/teachers')
  const subjectsQ = useApiData<{ subjects: { id: string; name: string }[] }>('/school/subjects')

  const [openClass, setOpenClass] = useState(false)
  const [cls, setCls] = useState({ name: '', academic_year: '2025/2026', homeroom_teacher_id: '' })
  const [busyCls, setBusyCls] = useState(false)
  const [errorCls, setErrorCls] = useState<string | null>(null)

  const [openTeacher, setOpenTeacher] = useState(false)
  const [tea, setTea] = useState({ full_name: '', subject: '', phone: '' })
  const [busyTea, setBusyTea] = useState(false)
  const [errorTea, setErrorTea] = useState<string | null>(null)

  const [newSubject, setNewSubject] = useState('')
  const [subjectError, setSubjectError] = useState<string | null>(null)

  const [openPromote, setOpenPromote] = useState(false)
  const [promo, setPromo] = useState({ from_class_id: '', to_class_id: '' })
  const [promoBusy, setPromoBusy] = useState(false)
  const [promoMsg, setPromoMsg] = useState<string | null>(null)

  const addSubject = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setSubjectError(null)
    try {
      await api.post('/school/subjects', { name: newSubject.trim() })
      setNewSubject('')
      subjectsQ.reload()
    } catch (err) {
      setSubjectError(err instanceof Error ? err.message : 'Save failed')
    }
  }

  const removeSubject = async (id: string): Promise<void> => {
    await api.del(`/school/subjects/${id}`).catch(() => undefined)
    subjectsQ.reload()
  }

  const promote = async (): Promise<void> => {
    setPromoBusy(true)
    setPromoMsg(null)
    try {
      const r = await api.post<{ moved: number }>('/school/students/promote', {
        from_class_id: promo.from_class_id,
        to_class_id: promo.to_class_id || null,
      })
      setPromoMsg(`${r.moved} student${r.moved === 1 ? '' : 's'} ${promo.to_class_id ? 'promoted ✓' : 'graduated ✓'}`)
      classesQ.reload()
    } catch (err) {
      setPromoMsg(err instanceof Error ? err.message : 'Promotion failed')
    } finally {
      setPromoBusy(false)
    }
  }

  const submitClass = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusyCls(true)
    setErrorCls(null)
    try {
      await api.post('/school/classes', {
        name: cls.name.trim(),
        academic_year: cls.academic_year.trim() || '2025/2026',
        homeroom_teacher_id: cls.homeroom_teacher_id || null,
      })
      setOpenClass(false)
      setCls({ name: '', academic_year: '2025/2026', homeroom_teacher_id: '' })
      classesQ.reload()
    } catch (err) {
      setErrorCls(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusyCls(false)
    }
  }

  const submitTeacher = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusyTea(true)
    setErrorTea(null)
    try {
      await api.post('/school/teachers', {
        full_name: tea.full_name.trim(),
        subject: tea.subject.trim() || null,
        phone: tea.phone.trim() || null,
      })
      setOpenTeacher(false)
      setTea({ full_name: '', subject: '', phone: '' })
      teachersQ.reload()
    } catch (err) {
      setErrorTea(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusyTea(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Classes & Teachers"
        subtitle="Organize sections, subjects and homeroom teachers"
        action={
          <>
            <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setOpenTeacher(true)}>
              <i className="fa-solid fa-person-chalkboard" aria-hidden="true" /> Add teacher
            </button>
            <button type="button" className="pl-btn pl-btn-ghost" onClick={() => setOpenPromote(true)}>
              <i className="fa-solid fa-up-long" aria-hidden="true" /> Promote students
            </button>
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpenClass(true)}>
              <i className="fa-solid fa-plus" aria-hidden="true" /> Create class
            </button>
          </>
        }
      />

      {classesQ.loading ? (
        <Spinner />
      ) : !classesQ.data?.classes.length ? (
        <EmptyState icon="fa-solid fa-chalkboard" title="No classes yet" hint="Create your first class to start enrolling students." />
      ) : (
        <DataTable
          rows={classesQ.data.classes}
          columns={[
            { key: 'name', header: 'Class', render: (c) => <strong>{c.name}</strong> },
            { key: 'year', header: 'Academic year', render: (c) => c.academic_year },
            { key: 'teacher', header: 'Homeroom', render: (c) => c.homeroom_teacher ?? 'Unassigned' },
            { key: 'n', header: 'Students', render: (c) => c.student_count },
          ]}
        />
      )}

      {!teachersQ.loading && (teachersQ.data?.teachers.length ?? 0) > 0 && (
        <div style={{ marginTop: 28 }}>
          <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1.05rem', marginBottom: 12 }}>Teachers</h2>
          <DataTable
            rows={teachersQ.data!.teachers}
            columns={[
              { key: 'name', header: 'Name', render: (t) => <strong>{t.full_name}</strong> },
              { key: 'sub', header: 'Subject', render: (t) => t.subject ?? '—' },
              { key: 'phone', header: 'Phone', render: (t) => t.phone ?? '—' },
            ]}
          />
        </div>
      )}

      {/* Subjects */}
      <div style={{ marginTop: 28 }}>
        <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1.05rem', marginBottom: 12 }}>Subjects</h2>
        <form onSubmit={addSubject} className="pl-toolbar">
          <input
            className="pl-input"
            placeholder="Add subject (e.g. Biology)…"
            value={newSubject}
            onChange={(e) => setNewSubject(e.target.value)}
            aria-label="New subject name"
            maxLength={80}
          />
          <button type="submit" className="pl-btn pl-btn-primary pl-btn-sm">
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add
          </button>
        </form>
        {subjectError && <p role="alert" style={{ color: '#e07a7a', fontSize: '.85rem' }}>{subjectError}</p>}
        {(subjectsQ.data?.subjects.length ?? 0) > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            {(subjectsQ.data?.subjects ?? []).map((s) => (
              <span key={s.id} className="pl-badge pl-badge-neutral" style={{ fontSize: '.85rem', gap: 8, padding: '6px 12px' }}>
                {s.name}
                <button
                  type="button"
                  aria-label={`Remove subject ${s.name}`}
                  onClick={() => removeSubject(s.id)}
                  style={{ border: 'none', background: 'transparent', color: 'var(--text-dim)', cursor: 'pointer', padding: 0 }}
                >
                  <i className="fa-solid fa-xmark" aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      <Modal open={openClass} title="Create class" onClose={() => setOpenClass(false)}>
        <form onSubmit={submitClass}>
          <div className="pl-grid-2">
            <Field label="Class name">
              <input className="pl-input" required maxLength={80} placeholder="Grade 5 A" value={cls.name} onChange={(e) => setCls((c) => ({ ...c, name: e.target.value }))} />
            </Field>
            <Field label="Academic year">
              <input className="pl-input" placeholder="2025/2026" value={cls.academic_year} onChange={(e) => setCls((c) => ({ ...c, academic_year: e.target.value }))} />
            </Field>
          </div>
          <Field label="Homeroom teacher">
            <select className="pl-select" value={cls.homeroom_teacher_id} onChange={(e) => setCls((c) => ({ ...c, homeroom_teacher_id: e.target.value }))}>
              <option value="">— unassigned —</option>
              {(teachersQ.data?.teachers ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </Field>
          {errorCls && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{errorCls}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busyCls}>
              {busyCls ? 'Saving…' : 'Create class'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={openTeacher} title="Add teacher" onClose={() => setOpenTeacher(false)}>
        <form onSubmit={submitTeacher}>
          <Field label="Full name">
            <input className="pl-input" required maxLength={120} value={tea.full_name} onChange={(e) => setTea((f) => ({ ...f, full_name: e.target.value }))} />
          </Field>
          <div className="pl-grid-2">
            <Field label="Main subject">
              <input className="pl-input" placeholder="Mathematics" value={tea.subject} onChange={(e) => setTea((f) => ({ ...f, subject: e.target.value }))} />
            </Field>
            <Field label="Phone">
              <input className="pl-input" value={tea.phone} onChange={(e) => setTea((f) => ({ ...f, phone: e.target.value }))} />
            </Field>
          </div>
          {errorTea && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{errorTea}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busyTea}>
              {busyTea ? 'Saving…' : 'Save teacher'}
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={openPromote} title="Promote students (year end)" onClose={() => setOpenPromote(false)}>
        <p style={{ color: 'var(--text-dim)', fontSize: '.88rem', marginBottom: 14 }}>
          Move every active student from one class to the next. Choose <strong>“Graduate”</strong> to move them out of active classes instead.
        </p>
        <Field label="From class">
          <select className="pl-select" value={promo.from_class_id} onChange={(e) => setPromo((p) => ({ ...p, from_class_id: e.target.value }))}>
            <option value="">Select class…</option>
            {(classesQ.data?.classes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.student_count} students)
              </option>
            ))}
          </select>
        </Field>
        <Field label="To class">
          <select className="pl-select" value={promo.to_class_id} onChange={(e) => setPromo((p) => ({ ...p, to_class_id: e.target.value }))}>
            <option value="">— Graduate (leave school) —</option>
            {(classesQ.data?.classes ?? [])
              .filter((c) => c.id !== promo.from_class_id)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </select>
        </Field>
        {promoMsg && <p style={{ fontSize: '.87rem', color: promoMsg.includes('✓') ? '#34d399' : '#e07a7a' }}>{promoMsg}</p>}
        <div className="pl-form-actions">
          <button
            type="button"
            className="pl-btn pl-btn-primary"
            disabled={promoBusy || !promo.from_class_id}
            onClick={() => {
              if (window.confirm(promo.to_class_id ? 'Promote the whole class now?' : 'Graduate the whole class now?')) void promote()
            }}
          >
            {promoBusy ? 'Working…' : 'Confirm promotion'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
