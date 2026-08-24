import { useEffect, useState } from 'react'
import { api, fmtDate } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Card, EmptyState, Field, PageHeader, Spinner, StatCard } from '../ui'

interface RosterRow {
  student_id: string
  code: string
  first_name: string
  last_name: string
  status: string | null
  att_date: string | null
}
type AttStatus = 'present' | 'absent' | 'late' | 'excused'

const STATUSES: AttStatus[] = ['present', 'late', 'absent', 'excused']

export default function Attendance(): JSX.Element {
  const classesQ = useApiData<{ classes: { id: string; name: string }[] }>('/school/classes')
  const [classId, setClassId] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const rosterQ = useApiData<{ roster: RosterRow[] }>(classId ? `/school/attendance?class_id=${classId}&date=${date}` : null)
  const summaryQ = useApiData<{ summary: Record<string, number> }>('/school/attendance/summary')

  const [marks, setMarks] = useState<Record<string, AttStatus>>({})
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (rosterQ.data) {
      setMarks(Object.fromEntries(rosterQ.data.roster.map((r) => [r.student_id, (r.status as AttStatus) ?? 'present'])))
    }
    setSaved(false)
  }, [rosterQ.data])

  // default-select the first class once loaded
  useEffect(() => {
    if (!classId && classesQ.data?.classes.length) setClassId(classesQ.data.classes[0].id)
  }, [classesQ.data, classId])

  const save = async (): Promise<void> => {
    if (!classId || !rosterQ.data) return
    setBusy(true)
    try {
      await api.post('/school/attendance', {
        class_id: classId,
        att_date: date,
        entries: rosterQ.data.roster.map((r) => ({ student_id: r.student_id, status: marks[r.student_id] ?? 'present' })),
      })
      setSaved(true)
      summaryQ.reload()
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  const roster = rosterQ.data?.roster ?? []
  const counts = STATUSES.map((s) => ({ s, n: Object.values(marks).filter((m) => m === s).length }))
  const totalMarks = Object.keys(marks).length
  const pct = totalMarks ? Math.round(((marks && Object.values(marks).filter((m) => m === 'present').length) / totalMarks) * 100) : 0

  return (
    <div>
      <PageHeader title="Attendance" subtitle="Take the daily register per class" />
      <div className="pl-toolbar">
        <Field label="">
          <select className="pl-select" value={classId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
            <option value="">Select class…</option>
            {(classesQ.data?.classes ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="">
          <input className="pl-input" type="date" max={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" />
        </Field>
      </div>

      {!classId ? (
        <EmptyState icon="fa-solid fa-chalkboard-user" title="Choose a class" hint="Select a class above to take its register." />
      ) : rosterQ.loading ? (
        <Spinner label="Loading roster…" />
      ) : roster.length === 0 ? (
        <EmptyState icon="fa-solid fa-user-graduate" title="No active students in this class" hint="Add students to this class first." />
      ) : (
        <>
          <Card>
            {roster.map((r) => (
              <div key={r.student_id} className="pl-att-row">
                <div>
                  <strong>{r.first_name} {r.last_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{r.code}</small>
                </div>
                <div className="pl-seg" role="radiogroup" aria-label={`Status for ${r.first_name}`}>
                  {STATUSES.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className={(marks[r.student_id] ?? '') === s ? 'on' : ''}
                      onClick={() => setMarks((m) => ({ ...m, [r.student_id]: s }))}
                    >
                      {s[0].toUpperCase() + s.slice(1)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="pl-form-actions">
              {saved && <span style={{ color: '#34d399', fontSize: '.87rem', marginRight: 'auto' }}>Register saved for {fmtDate(date)} ✓</span>}
              <span style={{ marginRight: 12, color: 'var(--text-dim)', fontSize: '.87rem' }}>
                {pct}% present · {counts.find((c) => c.s === 'absent')?.n ?? 0} absent
              </span>
              <button type="button" className="pl-btn pl-btn-primary" disabled={busy} onClick={save}>
                <i className="fa-solid fa-floppy-disk" aria-hidden="true" /> {busy ? 'Saving…' : 'Save register'}
              </button>
            </div>
          </Card>

          <div className="pl-stats" style={{ gridTemplateColumns: `repeat(${counts.length}, minmax(140px,1fr))` }}>
            {summaryQ.data
              ? counts.map(({ s }) => (
                  <StatCard
                    key={s}
                    icon={
                      s === 'present'
                        ? 'fa-solid fa-check'
                        : s === 'late'
                          ? 'fa-solid fa-clock'
                          : s === 'absent'
                            ? 'fa-solid fa-xmark'
                            : 'fa-solid fa-note-sticky'
                    }
                    label={`${s} (30 days)`}
                    value={summaryQ.data?.summary[s] ?? 0}
                    tone={s === 'present' ? '#34d399' : s === 'absent' ? '#e07a7a' : undefined}
                  />
                ))
              : null}
          </div>
        </>
      )}
    </div>
  )
}
