import { useState } from 'react'
import { useApiData } from '../hooks/useApiData'
import { EmptyState, PageHeader, Spinner, Card } from '../ui'

interface TermPoint { term: string; subjects: { subject: string; pct: number }[]; overall_avg: number }

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
  term_history: TermPoint[]
}
interface ClassInfo {
  id: string
  name: string
  academic_year: string
  homeroom_teacher: string | null
}

// ── Linear grade movement graph ──────────────────────────────────
function GradeGraph({ history, subjects }: { history: TermPoint[]; subjects: string[] }) {
  if (history.length < 1) return null

  const W = 480
  const H = 160
  const PAD = { top: 20, right: 20, bottom: 36, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const terms = history.map((h) => h.term)
  const xScale = (i: number) => PAD.left + (terms.length === 1 ? innerW / 2 : (i / (terms.length - 1)) * innerW)
  const yScale = (v: number) => PAD.top + innerH - (v / 100) * innerH

  // Colours for up to 8 subjects
  const PALETTE = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']

  const gridLines = [0, 25, 50, 75, 100]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block', margin: '0 auto' }}>
      {/* grid */}
      {gridLines.map((v) => (
        <g key={v}>
          <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={PAD.left - 4} y={yScale(v) + 4} textAnchor="end" fontSize={9} fill="#94a3b8">{v}</text>
        </g>
      ))}

      {/* x-axis labels */}
      {terms.map((t, i) => (
        <text key={t} x={xScale(i)} y={H - 4} textAnchor="middle" fontSize={9} fill="#64748b">{t}</text>
      ))}

      {/* Overall average line (thick) */}
      {history.length > 1 && (
        <polyline
          points={history.map((h, i) => `${xScale(i)},${yScale(h.overall_avg)}`).join(' ')}
          fill="none" stroke="#1e293b" strokeWidth={2.5} strokeDasharray="5 3"
        />
      )}

      {/* Per-subject lines */}
      {subjects.map((sub, si) => {
        const pts = history.map((h) => {
          const s = h.subjects.find((x) => x.subject === sub)
          return s ? s.pct : null
        })
        // Build connected segments skipping nulls
        const segments: string[] = []
        let seg: string[] = []
        pts.forEach((p, i) => {
          if (p !== null) {
            seg.push(`${xScale(i)},${yScale(p)}`)
          } else if (seg.length) {
            segments.push(seg.join(' '))
            seg = []
          }
        })
        if (seg.length) segments.push(seg.join(' '))

        return (
          <g key={sub}>
            {segments.map((s, idx) => (
              <polyline key={idx} points={s} fill="none" stroke={PALETTE[si % PALETTE.length]} strokeWidth={1.5} />
            ))}
            {pts.map((p, i) =>
              p !== null ? (
                <circle key={i} cx={xScale(i)} cy={yScale(p)} r={3} fill={PALETTE[si % PALETTE.length]} />
              ) : null
            )}
          </g>
        )
      })}

      {/* Overall avg dots */}
      {history.map((h, i) => (
        <circle key={i} cx={xScale(i)} cy={yScale(h.overall_avg)} r={4} fill="#1e293b" />
      ))}
    </svg>
  )
}

// ── Legend for the graph ─────────────────────────────────────────
function GraphLegend({ subjects }: { subjects: string[] }) {
  const PALETTE = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#ec4899']
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', fontSize: '.72rem', marginTop: 6, justifyContent: 'center' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <svg width={18} height={4}><line x1={0} y1={2} x2={18} y2={2} stroke="#1e293b" strokeWidth={2.5} strokeDasharray="5 3" /></svg>
        Overall Avg
      </span>
      {subjects.map((sub, i) => (
        <span key={sub} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <svg width={18} height={4}><line x1={0} y1={2} x2={18} y2={2} stroke={PALETTE[i % PALETTE.length]} strokeWidth={2} /></svg>
          {sub}
        </span>
      ))}
    </div>
  )
}

// ── Letter grade helper ──────────────────────────────────────────
function letterGrade(pct: number): string {
  if (pct >= 90) return 'A'
  if (pct >= 80) return 'B'
  if (pct >= 70) return 'C'
  if (pct >= 60) return 'D'
  if (pct >= 50) return 'D'
  return 'F'
}

// ── Printable report card ────────────────────────────────────────
function renderCard(s: CardRow, info: ClassInfo | undefined, term: string, totalStudents: number): JSX.Element {
  const subjectNames = s.subjects.map((x) => x.subject)
  const hasGraph = s.term_history.length > 0

  return (
    <div className="pl-reportcard-v2">
      {/* Header */}
      <div className="rc-header">
        <div className="rc-header-main">
          <div className="rc-school-icon"><i className="fa-solid fa-graduation-cap" /></div>
          <div>
            <div className="rc-school-name">{info?.name ?? 'School'}</div>
            <div className="rc-school-sub">Official Student Report Card</div>
          </div>
        </div>
        <div className="rc-header-year">{info?.academic_year ?? ''}</div>
      </div>

      {/* Student info box */}
      <div className="rc-info-grid">
        <div className="rc-info-cell">
          <span className="rc-info-label">Student Name</span>
          <span className="rc-info-value">{s.name}</span>
        </div>
        <div className="rc-info-cell">
          <span className="rc-info-label">Student ID</span>
          <span className="rc-info-value">{s.code}</span>
        </div>
        <div className="rc-info-cell">
          <span className="rc-info-label">Class</span>
          <span className="rc-info-value">{info?.name ?? '—'}</span>
        </div>
        <div className="rc-info-cell">
          <span className="rc-info-label">Term</span>
          <span className="rc-info-value">{term}</span>
        </div>
        <div className="rc-info-cell">
          <span className="rc-info-label">Homeroom Teacher</span>
          <span className="rc-info-value">{info?.homeroom_teacher ?? '—'}</span>
        </div>
        <div className="rc-info-cell">
          <span className="rc-info-label">Class Rank</span>
          <span className="rc-info-value">{s.rank} of {totalStudents}</span>
        </div>
      </div>

      {/* Grades table */}
      <table className="rc-grades-table">
        <thead>
          <tr>
            <th>Subject</th>
            <th>Score (%)</th>
            <th>Assessments</th>
            <th>Grade</th>
          </tr>
        </thead>
        <tbody>
          {s.subjects.map((sub) => (
            <tr key={sub.subject}>
              <td>{sub.subject}</td>
              <td>{sub.pct.toFixed(1)}</td>
              <td>{sub.exams}</td>
              <td><strong>{letterGrade(sub.pct)}</strong></td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="rc-totals-row">
            <td><strong>Overall Average</strong></td>
            <td><strong>{s.average.toFixed(1)}%</strong></td>
            <td></td>
            <td><strong>{s.grade}</strong></td>
          </tr>
        </tfoot>
      </table>

      {/* Grading scale + Attendance side by side */}
      <div className="rc-bottom-grid">
        <div className="rc-scale-box">
          <div className="rc-box-title">Grading Scale</div>
          <table className="rc-scale-table">
            <tbody>
              <tr><td>A</td><td>90 – 100%</td><td>Excellent</td></tr>
              <tr><td>B</td><td>80 – 89%</td><td>Very Good</td></tr>
              <tr><td>C</td><td>70 – 79%</td><td>Good</td></tr>
              <tr><td>D</td><td>50 – 69%</td><td>Satisfactory</td></tr>
              <tr><td>F</td><td>0 – 49%</td><td>Needs Improvement</td></tr>
            </tbody>
          </table>
        </div>
        <div className="rc-att-box">
          <div className="rc-box-title">Attendance</div>
          <div className="rc-att-value">
            {s.attendance_pct !== null ? `${s.attendance_pct}%` : '—'}
          </div>
          <div className="rc-att-label">Attendance Rate (current month)</div>
        </div>
      </div>

      {/* Grade movement graph */}
      {hasGraph && (
        <div className="rc-graph-box">
          <div className="rc-box-title">Grade Movement by Term</div>
          <GradeGraph history={s.term_history} subjects={subjectNames} />
          <GraphLegend subjects={subjectNames} />
        </div>
      )}

      {/* Teacher Comments */}
      <div className="rc-comments-box">
        <div className="rc-box-title">Teacher Comments</div>
        <div className="rc-comments-lines">
          <div className="rc-line" />
          <div className="rc-line" />
          <div className="rc-line" />
        </div>
      </div>

      {/* Signatures */}
      <div className="rc-signatures">
        <div className="rc-sig-col">
          <div className="rc-sig-line" />
          <div className="rc-sig-label">Parent / Guardian</div>
        </div>
        <div className="rc-sig-col">
          <div className="rc-sig-line" />
          <div className="rc-sig-label">Homeroom Teacher</div>
        </div>
        <div className="rc-sig-col">
          <div className="rc-sig-line" />
          <div className="rc-sig-label">Principal</div>
        </div>
      </div>

      {/* Footer */}
      <div className="rc-footer">
        {info?.name ?? 'School'} &nbsp;|&nbsp; {info?.academic_year ?? ''}
      </div>
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────
export default function ReportCards(): JSX.Element {
  const classesQ = useApiData<{ classes: { id: string; name: string }[] }>('/school/classes')
  const [classId, setClassId] = useState('')
  const [term, setTerm] = useState('Semester 1')
  const [printOne, setPrintOne] = useState<CardRow | null>(null)

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
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <select className="pl-select" value={term} onChange={(e) => setTerm(e.target.value)} aria-label="Term">
          <option>Semester 1</option>
          <option>Semester 2</option>
          <option>Term 1</option>
          <option>Term 2</option>
          <option>Term 3</option>
          <option>Annual</option>
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
          {/* Summary table */}
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
                      <td><strong>#{s.rank}</strong></td>
                      <td>
                        <strong>{s.name}</strong>
                        <small style={{ display: 'block', color: 'var(--text-dim)' }}>{s.code}</small>
                      </td>
                      <td>{s.subjects.length}</td>
                      <td><strong>{s.average}%</strong></td>
                      <td>{s.grade}</td>
                      <td>{s.attendance_pct !== null ? `${s.attendance_pct}%` : '—'}</td>
                      <td>
                        <div className="pl-row-actions">
                          <button type="button" className="pl-btn pl-btn-ghost pl-btn-sm" onClick={() => doPrint(s)}>
                            <i className="fa-solid fa-print" /> Print
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Print area */}
          <div className="pl-print-area" style={{ position: 'absolute', left: -9999, top: 0 }}>
            {(printOne ? [printOne] : students).map((s) => (
              <div key={s.student_id} style={{ pageBreakAfter: 'always', marginBottom: 20 }}>
                {renderCard(s, info, term, students.length)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
