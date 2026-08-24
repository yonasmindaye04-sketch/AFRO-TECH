import { useEffect, useState } from 'react'
import { api, fmtDate } from '../api'
import { useApiData } from '../hooks/useApiData'
import { Badge, DataTable, EmptyState, Field, Modal, PageHeader, Spinner } from '../ui'

interface GradeRow {
  id: string
  subject: string
  exam_type: 'test' | 'assignment' | 'mid' | 'final'
  term: string
  score: string
  max_score: string
  created_at: string
  student_name: string
  student_code: string
  class_name: string | null
}
interface ClassRow {
  id: string
  name: string
}
interface StudentOpt {
  id: string
  first_name: string
  last_name: string
  code: string
}

const EXAMS = ['test', 'assignment', 'mid', 'final'] as const

function letterGrade(pct: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (pct >= 90) return { label: 'A', tone: 'good' }
  if (pct >= 80) return { label: 'B', tone: 'good' }
  if (pct >= 70) return { label: 'C', tone: 'warn' }
  if (pct >= 60) return { label: 'D', tone: 'warn' }
  return { label: 'F', tone: 'bad' }
}

export default function Grades(): JSX.Element {
  const [classFilter, setClassFilter] = useState('')
  const gradesQ = useApiData<{ grades: GradeRow[] }>(`/school/grades${classFilter ? `?class_id=${classFilter}` : ''}`)
  const classesQ = useApiData<{ classes: ClassRow[] }>('/school/classes')

  const [open, setOpen] = useState(false)
  const [classId, setClassId] = useState('')
  const rosterQ = useApiData<{ students: StudentOpt[] }>(open && classId ? `/school/students?class_id=${classId}` : null)
  const [subject, setSubject] = useState('')
  const [examType, setExamType] = useState<(typeof EXAMS)[number]>('test')
  const [term, setTerm] = useState('Semester 1')
  const [maxScore, setMaxScore] = useState('100')
  const [scores, setScores] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setScores({})
  }, [classId, examType, term, subject])

  const saveAll = async (): Promise<void> => {
    const entries = Object.entries(scores)
      .filter(([, v]) => v !== '' && !Number.isNaN(Number(v)))
      .map(([student_id, v]) => ({ student_id, subject: subject.trim(), exam_type: examType, term, score: Number(v), max_score: Number(maxScore) || 100 }))
    if (!entries.length) {
      setError('Enter at least one score')
      return
    }
    if (!subject.trim()) {
      setError('Subject is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.post('/school/grades/bulk', { entries })
      setOpen(false)
      setScores({})
      setSubject('')
      gradesQ.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="Grades"
        subtitle="Record scores and track performance"
        action={
          <button type="button" className="pl-btn pl-btn-primary" onClick={() => setOpen(true)}>
            <i className="fa-solid fa-pen-to-square" aria-hidden="true" /> Record scores
          </button>
        }
      />
      <div className="pl-toolbar">
        <select className="pl-select" value={classFilter} onChange={(e) => setClassFilter(e.target.value)} aria-label="Filter by class">
          <option value="">All classes</option>
          {(classesQ.data?.classes ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {gradesQ.loading ? (
        <Spinner />
      ) : !gradesQ.data?.grades.length ? (
        <EmptyState icon="fa-solid fa-star-half-stroke" title="No grades recorded" hint="Use “Record scores” to enter marks for a whole class." />
      ) : (
        <DataTable
          rows={gradesQ.data.grades}
          columns={[
            {
              key: 'stu',
              header: 'Student',
              render: (g) => (
                <div>
                  <strong>{g.student_name}</strong>
                  <small style={{ display: 'block', color: 'var(--text-dim)' }}>{g.class_name ?? g.student_code}</small>
                </div>
              ),
            },
            { key: 'sub', header: 'Subject', render: (g) => g.subject },
            { key: 'exam', header: 'Assessment', render: (g) => <span style={{ textTransform: 'capitalize' }}>{g.exam_type}</span> },
            { key: 'term', header: 'Term', render: (g) => g.term },
            {
              key: 'score',
              header: 'Score',
              render: (g) => (
                <>
                  {Number(g.score).toFixed(0)} / {Number(g.max_score).toFixed(0)}{' '}
                  <Badge tone={letterGrade((Number(g.score) / Number(g.max_score)) * 100).tone}>
                    {letterGrade((Number(g.score) / Number(g.max_score)) * 100).label}
                  </Badge>
                </>
              ),
            },
            { key: 'date', header: 'Recorded', render: (g) => fmtDate(g.created_at), width: '110px' },
          ]}
        />
      )}

      <Modal open={open} title="Record scores for a class" wide onClose={() => setOpen(false)}>
        <div className="pl-grid-2">
          <Field label="Class">
            <select className="pl-select" value={classId} onChange={(e) => setClassId(e.target.value)}>
              <option value="">Select class…</option>
              {(classesQ.data?.classes ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Subject">
            <input className="pl-input" placeholder="Mathematics" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </Field>
        </div>
        <div className="pl-grid-2">
          <Field label="Assessment type">
            <select className="pl-select" value={examType} onChange={(e) => setExamType(e.target.value as (typeof EXAMS)[number])}>
              {EXAMS.map((x) => (
                <option key={x} value={x}>
                  {x[0].toUpperCase() + x.slice(1)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Out of">
            <input className="pl-input" type="number" min="1" value={maxScore} onChange={(e) => setMaxScore(e.target.value)} />
          </Field>
        </div>

        {!classId ? (
          <EmptyState title="Pick a class to load its students" />
        ) : rosterQ.loading ? (
          <Spinner label="Loading students…" />
        ) : (
          <>
            {(rosterQ.data?.students ?? []).length === 0 ? (
              <EmptyState icon="fa-solid fa-user-graduate" title="This class has no active students" />
            ) : (
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {(rosterQ.data!.students ?? []).map((s) => (
                  <div key={s.id} className="pl-att-row">
                    <span>
                      {s.first_name} {s.last_name}
                    </span>
                    <input
                      className="pl-input"
                      style={{ width: 100, textAlign: 'right' }}
                      type="number"
                      min="0"
                      max={Number(maxScore)}
                      placeholder="—"
                      value={scores[s.id] ?? ''}
                      onChange={(e) => setScores((m) => ({ ...m, [s.id]: e.target.value }))}
                      aria-label={`Score for ${s.first_name}`}
                    />
                  </div>
                ))}
              </div>
            )}
            <Field label="Term">
              <select className="pl-select" value={term} onChange={(e) => setTerm(e.target.value)}>
                <option>Semester 1</option>
                <option>Semester 2</option>
              </select>
            </Field>
          </>
        )}
        {error && <p role="alert" style={{ color: '#e07a7a', fontSize: '.87rem' }}>{error}</p>}
        <div className="pl-form-actions">
          <button type="button" className="pl-btn pl-btn-primary" disabled={busy} onClick={saveAll}>
            <i className="fa-solid fa-floppy-disk" aria-hidden="true" /> {busy ? 'Saving…' : 'Save all scores'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
