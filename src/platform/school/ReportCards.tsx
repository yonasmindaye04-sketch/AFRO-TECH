import { useState } from 'react'
import { useApiData } from '../hooks/useApiData'
import { Card, EmptyState, PageHeader, Spinner } from '../ui'

interface CardRow {
  student_id: string
  code: string
  name: string
  subjects: { subject: string; pct: number; exams: number }[]
  total: number
  average: number
  grade: string
  attendance_pct: number | null
  rank: number
}
interface ClassInfo {
  id: string
  name: string
  academic_year: string
  homeroom_teacher: string | null
}

export default function ReportCards(): JSX.Element {
  const classesQ = useApiData<{ classes: { id: string; name: string }[] }>('/school/classes')
  const [classId, setClassId] = useState('')
  const [term, setTerm] = useState('Semester 1')
  const [printOne, setPrintOne] = useState<CardRow | null>(null)
  // Fall back to the first class until the user picks one — no effect needed
  const effectiveClassId = classId || classesQ.data?.classes[0]?.id || ''
  const cardsQ = useApiData<{ class: ClassInfo; term: string; students: CardRow[] }>(
    effectiveClassId ? `/school/report-cards?class_id=${effectiveClassId}&term=${encodeURIComponent(term)}` : null
  )

  const doPrint = (student: CardRow | null): void => {
    setPrintOne(student)
    setTimeout(() => window.print(), 80)
  }

  const info = cardsQ.data?.class
  const students = cardsQ.data?.students ?? []

  const renderCard = (s: CardRow): JSX.Element => (
    <div className="pl-reportcard">
      <h2 style={{ textAlign: 'center' }}>Student Report Card</h2>
      <p style={{ textAlign: 'center', marginBottom: 14 }}>
        {info?.name} · {info?.academic_year} · {term}
      </p>
      <table>
        <tbody>
          <tr>
            <th>Student</th>
            <td>{s.name}</td>
            <th>ID</th>
            <td>{s.code}</td>
          </tr>
          <tr>
            <th>Homeroom</th>
            <td>{info?.homeroom_teacher ?? '—'}</td>
            <th>Attendance</th>
            <td>{s.attendance_pct !== null ? `${s.attendance_pct}%` : '—'}</td>
          </tr>
        </tbody>
      </table>
      <table>
        <thead>
          <tr>
            <th>Subject</th>
            <th>Average %</th>
            <th>Assessments</th>
            <th>Grade</th>
          </tr>
        </thead>
        <tbody>
          {s.subjects.map((sub) => (
            <tr key={sub.subject}>
              <td>{sub.subject}</td>
              <td>{sub.pct}</td>
              <td>{sub.exams}</td>
              <td>{sub.pct >= 90 ? 'A' : sub.pct >= 80 ? 'B' : sub.pct >= 70 ? 'C' : sub.pct >= 60 ? 'D' : sub.pct >= 50 ? 'D' : 'F'}</td>
            </tr>
          ))}
          <tr>
            <th>Total</th>
            <th colSpan={3}>{s.total}</th>
          </tr>
          <tr>
            <th>Average</th>
            <td>{s.average}%</td>
            <th>Grade</th>
            <td>{s.grade}</td>
          </tr>
          <tr>
            <th>Rank in class</th>
            <td colSpan={3}>{s.rank} of {students.length}</td>
          </tr>
        </tbody>
      </table>
    </div>
  )

  return (
    <div>
      <PageHeader
        title="Report Cards"
        subtitle="Computed from recorded grades — rank included, ready to print"
        action={
          students.length > 0 && (
            <button type="button" className="pl-btn pl-btn-primary" onClick={() => doPrint(null)}>
              <i className="fa-solid fa-print" aria-hidden="true" /> Print all
            </button>
          )
        }
      />
      <div className="pl-toolbar">
        <select className="pl-select" value={effectiveClassId} onChange={(e) => setClassId(e.target.value)} aria-label="Class">
          <option value="">Select class…</option>
          {(classesQ.data?.classes ?? []).map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className="pl-select" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term">
          <option>Semester 1</option>
          <option>Semester 2</option>
        </select>
      </div>

      {!effectiveClassId ? (
        <EmptyState icon="fa-solid fa-award" title="Choose a class" hint="Select a class and term to generate report cards." />
      ) : cardsQ.loading ? (
        <Spinner label="Computing results…" />
      ) : students.length === 0 ? (
        <EmptyState icon="fa-solid fa-award" title="No grades recorded for this class and term" hint="Record scores from the Grades page first." />
      ) : (
        <>
          <Card>
            <div className="pl-table-wrap">
              <table className="pl-table">
                <thead>
                  <tr>
                    <th>Rank</th>
                    <th>Student</th>
                    <th>Subjects</th>
                    <th>Average</th>
                    <th>Grade</th>
                    <th>Attendance</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {students.map((s) => (
                    <tr key={s.student_id}>
                      <td>
                        <strong>#{s.rank}</strong>
                      </td>
                      <td>
                        <strong>{s.name}</strong>
                        <small style={{ display: 'block', color: 'var(--text-dim)' }}>{s.code}</small>
                      </td>
                      <td>{s.subjects.length}</td>
                      <td>
                        <strong>{s.average}%</strong>
                      </td>
                      <td>{s.grade}</td>
                      <td>{s.attendance_pct !== null ? `${s.attendance_pct}%` : '—'}</td>
                      <td>
                        <div className="pl-row-actions">
                          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => doPrint(s)}>
                            Print
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Print target: all cards, or just one */}
          <div className="pl-print-area" style={{ position: 'absolute', left: -9999, top: 0 }}>
            {(printOne ? [printOne] : students).map((s) => (
              <div key={s.student_id} style={{ pageBreakAfter: 'always', marginBottom: 20 }}>
                {renderCard(s)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
