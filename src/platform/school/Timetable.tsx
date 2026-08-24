import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { useApiData } from '../hooks/useApiData'
import { EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface Slot {
  id: string
  day_of_week: number
  start_time: string
  end_time: string
  subject: string
  teacher_name: string | null
}
interface ClassOpt {
  id: string
  name: string
}
interface TeacherOpt {
  id: string
  full_name: string
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export default function Timetable(): JSX.Element {
  const classesQ = useApiData<{ classes: ClassOpt[] }>('/school/classes')
  const [classId, setClassId] = useState('')
  const ttQ = useApiData<{ slots: Slot[] }>(classId ? `/school/timetable?class_id=${classId}` : null)
  const teachersQ = useApiData<{ teachers: TeacherOpt[] }>('/school/teachers')

  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ day_of_week: '1', start_time: '08:00', end_time: '08:45', subject: '', teacher_id: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!classId && classesQ.data?.classes.length) setClassId(classesQ.data.classes[0].id)
  }, [classesQ.data, classId])

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await api.post('/school/timetable', {
        class_id: classId,
        day_of_week: Number(form.day_of_week),
        start_time: form.start_time,
        end_time: form.end_time,
        subject: form.subject.trim(),
        teacher_id: form.teacher_id || null,
      })
      setOpen(false)
      setForm({ day_of_week: '1', start_time: '08:00', end_time: '08:45', subject: '', teacher_id: '' })
      ttQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const removeSlot = async (id: string): Promise<void> => {
    await api.del(`/school/timetable/${id}`).catch(() => undefined)
    ttQ.reload()
  }

  const slots = ttQ.data?.slots ?? []

  return (
    <div>
      <PageHeader
        title="Timetable"
        subtitle="Weekly schedule per class"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)} disabled={!classId}>
            <i className="fa-solid fa-plus" aria-hidden="true" /> Add period
          </button>
        }
      />
      <div className="pl-toolbar">
        <select className="pl-select" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
          <option value="">Select class…</option>
          {(classesQ.data?.classes ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {!classId ? (
        <EmptyState icon="fa-solid fa-calendar-week" title="Choose a class" hint="Select a class to view or edit its weekly timetable." />
      ) : ttQ.loading ? (
        <Spinner />
      ) : (
        <div className="pl-tt-grid">
          {DAYS.map((day, i) => {
            const daySlots = slots.filter((s) => s.day_of_week === i + 1)
            return (
              <div key={day} className="pl-tt-day">
                <h3>{day}</h3>
                {daySlots.length === 0 && <small style={{ color: 'var(--text-dim)' }}>No periods</small>}
                {daySlots.map((s) => (
                  <div key={s.id} className="pl-tt-slot">
                    <button type="button" className="pl-tt-del" aria-label={`Remove ${s.subject} on ${day}`} onClick={() => removeSlot(s.id)}>
                      <i className="fa-solid fa-xmark" aria-hidden="true" />
                    </button>
                    <strong>{s.subject}</strong>
                    <small>
                      {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                      {s.teacher_name ? ` · ${s.teacher_name}` : ''}
                    </small>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}

      <Modal open={open} title="Add period" onClose={() => setOpen(false)}>
        <form onSubmit={submit}>
          <div className="pl-grid-2">
            <Field label="Day">
              <select className="pl-select" value={form.day_of_week} onChange={(e) => setForm((f) => ({ ...f, day_of_week: e.target.value }))}>
                {DAYS.map((d, i) => (
                  <option key={d} value={i + 1}>
                    {d}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Subject">
              <input className="pl-input" required list="tt-subjects" value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
              <datalist id="tt-subjects" />
            </Field>
          </div>
          <div className="pl-grid-2">
            <Field label="Starts">
              <input className="pl-input" type="time" required value={form.start_time} onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))} />
            </Field>
            <Field label="Ends">
              <input className="pl-input" type="time" required value={form.end_time} onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))} />
            </Field>
          </div>
          <Field label="Teacher">
            <select className="pl-select" value={form.teacher_id} onChange={(e) => setForm((f) => ({ ...f, teacher_id: e.target.value }))}>
              <option value="">— unassigned —</option>
              {(teachersQ.data?.teachers ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.full_name}
                </option>
              ))}
            </select>
          </Field>
          {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
          <div className="pl-form-actions">
            <button type="submit" className="pl-btn pl-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Add period'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
