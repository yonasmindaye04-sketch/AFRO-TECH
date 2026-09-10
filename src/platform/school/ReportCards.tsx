import { useState } from 'react'
import { useApiData } from '../hooks/useApiData'
import { useAuth } from '../AuthContext'
import { EmptyState, PageHeader, Spinner, Card } from '../ui'

interface TermPoint {
  term: string
  subjects: { subject: string; pct: number }[]
  overall_avg: number
}

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
  guardian_name?: string | null
}

interface ClassInfo {
  id: string
  name: string
  academic_year: string
  homeroom_teacher: string | null
}

// ── Letter grade helper matching Image 5 high-school format ─────
function formatGrade(pct: number): string {
  if (pct >= 97) return 'A+'
  if (pct >= 93) return 'A'
  if (pct >= 90) return 'A-'
  if (pct >= 87) return 'B+'
  if (pct >= 83) return 'B'
  if (pct >= 80) return 'B-'
  if (pct >= 77) return 'C+'
  if (pct >= 73) return 'C'
  if (pct >= 70) return 'C-'
  if (pct >= 67) return 'D+'
  if (pct >= 60) return 'D'
  return 'F'
}

// ── Multi-term subject score lookup ─────────────────────────────
function getTermScore(history: TermPoint[], termPattern: string, subject: string): { pct: number; grade: string } | null {
  const match = history.find((h) => h.term.toLowerCase().includes(termPattern.toLowerCase()))
  if (!match) return null
  const sub = match.subjects.find((s) => s.subject.toLowerCase() === subject.toLowerCase())
  if (!sub) return null
  return { pct: sub.pct, grade: formatGrade(sub.pct) }
}

// ── Comments generator matching Image 5 formal remarks ──────────
function getStudentComment(studentName: string, avg: number): string {
  const firstName = studentName.split(' ')[0] || studentName
  if (avg >= 90) {
    return `${firstName} has shown exceptional academic dedication and consistent excellence throughout the year, particularly in mathematics and science. He actively participates in class discussions and is always willing to help his peers. He demonstrates strong critical thinking and intellectual curiosity across all subjects. Overall, ${firstName} has had an outstanding academic year.`
  }
  if (avg >= 80) {
    return `${firstName} has shown consistent improvement throughout the year, particularly in core coursework. He actively participates in class discussions and is always willing to help his peers. However, he should continue to focus on maintaining consistency in history and foreign language. Overall, ${firstName} has had a successful year academically.`
  }
  if (avg >= 70) {
    return `${firstName} maintains good class participation and demonstrates steady effort in assignments. He collaborates well with classmates during group projects. Increased attention to regular revision and analytical practice will help elevate his academic outcomes even further.`
  }
  return `${firstName} is encouraged to dedicate more structured study hours and complete all coursework assignments on time. Regular attendance, active class engagement, and seeking teacher assistance during tutorial hours are strongly advised to strengthen subject comprehension.`
}

// ── Linear grade movement graph ──────────────────────────────────
function GradeGraph({ history, subjects }: { history: TermPoint[]; subjects: string[] }) {
  if (history.length < 1) return null

  const W = 520
  const H = 150
  const PAD = { top: 18, right: 24, bottom: 28, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const terms = history.map((h) => h.term)
  const xScale = (i: number) => PAD.left + (terms.length === 1 ? innerW / 2 : (i / (terms.length - 1)) * innerW)
  const yScale = (v: number) => PAD.top + innerH - (v / 100) * innerH

  const PALETTE = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0284c7', '#ea580c', '#db2777']
  const gridLines = [0, 25, 50, 75, 100]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block', margin: '0 auto' }}>
      {gridLines.map((v) => (
        <g key={v}>
          <line x1={PAD.left} y1={yScale(v)} x2={W - PAD.right} y2={yScale(v)} stroke="#e2e8f0" strokeWidth={1} />
          <text x={PAD.left - 4} y={yScale(v) + 3} textAnchor="end" fontSize={9} fill="#94a3b8" fontFamily="sans-serif">
            {v}
          </text>
        </g>
      ))}

      {terms.map((t, i) => (
        <text key={t} x={xScale(i)} y={H - 6} textAnchor="middle" fontSize={10} fill="#475569" fontWeight={600} fontFamily="sans-serif">
          {t}
        </text>
      ))}

      {/* Overall average line (dashed navy) */}
      {history.length > 1 && (
        <polyline
          points={history.map((h, i) => `${xScale(i)},${yScale(h.overall_avg)}`).join(' ')}
          fill="none"
          stroke="#1e293b"
          strokeWidth={2.5}
          strokeDasharray="5 3"
        />
      )}

      {/* Per-subject lines */}
      {subjects.map((sub, si) => {
        const pts = history.map((h) => {
          const s = h.subjects.find((x) => x.subject === sub)
          return s ? s.pct : null
        })
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

      {/* Overall average dots */}
      {history.map((h, i) => (
        <circle key={i} cx={xScale(i)} cy={yScale(h.overall_avg)} r={4} fill="#1e293b" />
      ))}
    </svg>
  )
}

function GraphLegend({ subjects }: { subjects: string[] }) {
  const PALETTE = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#0284c7', '#ea580c', '#db2777']
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

// ── Complete Formal Report Card Renderer (Exact Image 5 Design) ──
function renderCard(
  s: CardRow,
  info: ClassInfo | undefined,
  currentTerm: string,
  schoolName: string
): JSX.Element {
  const subjectNames = s.subjects.map((x) => x.subject)
  const hasGraph = s.term_history && s.term_history.length > 0

  // Calculate attendance numbers matching 180-day school year
  const attRate = s.attendance_pct ?? 95
  const totalDays = 180
  const daysPresent = Math.min(totalDays, Math.round((attRate / 100) * totalDays))
  const daysAbsent = Math.max(0, totalDays - daysPresent)
  const tardies = Math.max(1, Math.floor((100 - attRate) / 5))

  // Signatures
  const guardianName = s.guardian_name || 'Patricia H. Mize'
  const teacherName = info?.homeroom_teacher || 'David M. Binkley'
  const principalName = 'Stephen Winters'

  return (
    <div className="pl-reportcard-v2">
      {/* 1. Dual-tone Header: Burgundy (left) + Navy (right) */}
      <div className="rc-header">
        <div className="rc-header-burgundy">
          <h1 className="rc-header-title">High School Report Card</h1>
        </div>
        <div className="rc-header-navy">
          <i className="fa-solid fa-graduation-cap rc-header-school-icon" aria-hidden="true" />
          <div>
            <div className="rc-header-school-name">{schoolName || 'Alexander High School'}</div>
            <div className="rc-header-school-sub">High School</div>
          </div>
        </div>
      </div>

      <div className="rc-card-body">
        {/* 2. Student Information Section */}
        <div className="rc-section-title">Student Information:</div>
        <div className="rc-info-row">
          <div className="rc-info-field">
            <label>Name:</label>
            <div className="rc-field-val">{s.name}</div>
          </div>
          <div className="rc-info-field">
            <label>Grade:</label>
            <div className="rc-field-val">{info?.name || '10th Grade'}</div>
          </div>
          <div className="rc-info-field">
            <label>School Year:</label>
            <div className="rc-field-val">{info?.academic_year || '2030-2031'}</div>
          </div>
        </div>

        {/* 3. Formal Grades Table */}
        <table className="rc-grades-table">
          <thead>
            <tr>
              <th style={{ width: '38%' }}>Subject</th>
              <th style={{ width: '20%' }}>1st Semester</th>
              <th style={{ width: '20%' }}>2nd Semester</th>
              <th style={{ width: '22%' }}>Final Grade</th>
            </tr>
          </thead>
          <tbody>
            {s.subjects.map((sub) => {
              const sem1 = getTermScore(s.term_history, '1', sub.subject)
              const sem2 = getTermScore(s.term_history, '2', sub.subject)

              // Default to current term score if multi-term not available yet
              const sem1Grade = sem1 ? sem1.grade : formatGrade(sub.pct)
              const sem2Grade = sem2 ? sem2.grade : (currentTerm.includes('2') ? formatGrade(sub.pct) : '—')
              const finalGrade = sem1 && sem2
                ? formatGrade((sem1.pct + sem2.pct) / 2)
                : formatGrade(sub.pct)

              return (
                <tr key={sub.subject}>
                  <td>{sub.subject}</td>
                  <td>{sem1Grade}</td>
                  <td>{sem2Grade}</td>
                  <td><strong>{finalGrade}</strong></td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td><strong>Overall Average</strong></td>
              <td>
                <strong>
                  {(() => {
                    const s1 = s.term_history.find((h) => h.term.toLowerCase().includes('1'))
                    return s1 ? `${Math.round(s1.overall_avg)}% (${formatGrade(s1.overall_avg)})` : `${Math.round(s.average)}%`
                  })()}
                </strong>
              </td>
              <td>
                <strong>
                  {(() => {
                    const s2 = s.term_history.find((h) => h.term.toLowerCase().includes('2'))
                    return s2 ? `${Math.round(s2.overall_avg)}% (${formatGrade(s2.overall_avg)})` : '—'
                  })()}
                </strong>
              </td>
              <td>
                <strong style={{ color: '#7b1c1c' }}>
                  {Math.round(s.average)}% ({formatGrade(s.average)})
                </strong>
              </td>
            </tr>
          </tfoot>
        </table>

        {/* 4. Grading Scale & Attendance (Side by Side) */}
        <div className="rc-two-col">
          <div>
            <div className="rc-section-title" style={{ margin: '0 0 8px' }}>Grading Scale:</div>
            <ul className="rc-bullets">
              <li>A: 90-100%</li>
              <li>B: 80-89%</li>
              <li>C: 70-79%</li>
              <li>D: 60-69%</li>
              <li>F: Below 60%</li>
            </ul>
          </div>
          <div>
            <div className="rc-section-title" style={{ margin: '0 0 8px' }}>Attendance:</div>
            <ul className="rc-bullets">
              <li>Days Present: {daysPresent}</li>
              <li>Days Absent: {daysAbsent}</li>
              <li>Tardies: {tardies}</li>
            </ul>
          </div>
        </div>

        {/* 5. Linear Grade Movement Graph */}
        {hasGraph && (
          <div className="rc-graph-container">
            <div className="rc-section-title" style={{ margin: '0 0 6px', fontSize: 13 }}>
              Grade Movement by Term:
            </div>
            <GradeGraph history={s.term_history} subjects={subjectNames} />
            <GraphLegend subjects={subjectNames} />
          </div>
        )}

        {/* 6. Comments Box */}
        <div className="rc-section-title" style={{ margin: '14px 0 6px' }}>Comments:</div>
        <div className="rc-comments-box">
          {getStudentComment(s.name, s.average)}
        </div>

        {/* 7. Signatures */}
        <div className="rc-signatures">
          <div>
            <div className="rc-sig-title">Parent's Signature:</div>
            <div className="rc-sig-handwriting">{guardianName}</div>
            <div className="rc-sig-line" />
            <div className="rc-sig-name">{guardianName}</div>
          </div>
          <div>
            <div className="rc-sig-title">Teacher Signature:</div>
            <div className="rc-sig-handwriting">{teacherName}</div>
            <div className="rc-sig-line" />
            <div className="rc-sig-name">{teacherName}</div>
          </div>
          <div>
            <div className="rc-sig-title">Principal Signature:</div>
            <div className="rc-sig-handwriting">{principalName}</div>
            <div className="rc-sig-line" />
            <div className="rc-sig-name">{principalName}</div>
          </div>
        </div>

        {/* 8. Contact Footer */}
        <div className="rc-footer-bar">
          <div className="rc-footer-item">
            <i className="fa-solid fa-location-dot" aria-hidden="true" />
            <span>108 N Platinum Ave Deming, NY 88030</span>
          </div>
          <div className="rc-footer-item">
            <i className="fa-solid fa-phone" aria-hidden="true" />
            <span>+1 312-692-0767</span>
          </div>
          <div className="rc-footer-item">
            <i className="fa-solid fa-envelope" aria-hidden="true" />
            <span>info@alexanderhighschool.com</span>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Main Page Component ──────────────────────────────────────────
export default function ReportCards(): JSX.Element {
  const { me } = useAuth()
  const schoolName = me?.tenant?.name || 'Alexander High School'

  const classesQ = useApiData<{ classes: { id: string; name: string }[] }>('/school/classes')
  const [classId, setClassId] = useState('')
  const [term, setTerm] = useState('Semester 1')
  const [viewMode, setViewMode] = useState<'preview' | 'roster'>('preview')
  const [selectedStudentId, setSelectedStudentId] = useState<string>('')
  const [printOne, setPrintOne] = useState<CardRow | null>(null)

  const effectiveClassId = classId || classesQ.data?.classes[0]?.id || ''
  const cardsQ = useApiData<{ class: ClassInfo; term: string; students: CardRow[] }>(
    effectiveClassId ? `/school/report-cards?class_id=${effectiveClassId}&term=${encodeURIComponent(term)}` : null
  )

  const info = cardsQ.data?.class
  const students = cardsQ.data?.students ?? []

  // Ensure an active student is selected for on-screen live preview
  const activeStudent = students.find((s) => s.student_id === selectedStudentId) || students[0]

  const doPrint = (student: CardRow | null): void => {
    setPrintOne(student)
    // 150ms timeout ensures React commits the print target DOM before window.print()
    setTimeout(() => {
      window.print()
    }, 150)
  }

  return (
    <div>
      <PageHeader
        title="Report Cards"
        subtitle="Official dual-tone academic report cards with term grade trajectories — ready to print"
        action={
          students.length > 0 && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                type="button"
                className="pl-btn pl-btn-primary"
                onClick={() => doPrint(activeStudent || null)}
                title="Print the currently selected student report card"
              >
                <i className="fa-solid fa-print" aria-hidden="true" /> Print current card
              </button>
              <button
                type="button"
                className="pl-btn pl-btn-ghost"
                onClick={() => doPrint(null)}
                title="Print all report cards in this class"
              >
                <i className="fa-solid fa-copy" aria-hidden="true" /> Print all ({students.length})
              </button>
            </div>
          )
        }
      />

      {/* Class & Term Selectors */}
      <div className="pl-toolbar pl-screen-only">
        <select
          className="pl-select"
          value={effectiveClassId}
          onChange={(e) => {
            setClassId(e.target.value)
            setSelectedStudentId('')
          }}
          aria-label="Class"
        >
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

        {/* View mode toggle */}
        {students.length > 0 && (
          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <button
              type="button"
              className={`pl-btn pl-btn-sm ${viewMode === 'preview' ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
              onClick={() => setViewMode('preview')}
            >
              <i className="fa-solid fa-id-card" aria-hidden="true" /> Card Preview
            </button>
            <button
              type="button"
              className={`pl-btn pl-btn-sm ${viewMode === 'roster' ? 'pl-btn-primary' : 'pl-btn-ghost'}`}
              onClick={() => setViewMode('roster')}
            >
              <i className="fa-solid fa-list-ol" aria-hidden="true" /> Class Roster ({students.length})
            </button>
          </div>
        )}
      </div>

      {!effectiveClassId ? (
        <EmptyState icon="fa-solid fa-award" title="Choose a class" hint="Select a class and term to generate report cards." />
      ) : cardsQ.loading ? (
        <Spinner label="Computing report cards…" />
      ) : students.length === 0 ? (
        <EmptyState icon="fa-solid fa-award" title="No grades recorded for this class and term" hint="Record scores from the Grades page first." />
      ) : (
        <>
          {/* ── ON SCREEN: Interactive Card Preview Mode ── */}
          {viewMode === 'preview' && activeStudent && (
            <div className="pl-screen-only" style={{ marginBottom: 28 }}>
              {/* Student selector banner */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: 12,
                background: 'var(--card)',
                padding: '12px 16px',
                borderRadius: '8px',
                border: '1px solid var(--border)',
                marginBottom: 20
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label htmlFor="student-preview-select" style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
                    Preview Student:
                  </label>
                  <select
                    id="student-preview-select"
                    className="pl-select"
                    value={activeStudent.student_id}
                    onChange={(e) => setSelectedStudentId(e.target.value)}
                    style={{ minWidth: 220 }}
                  >
                    {students.map((s) => (
                      <option key={s.student_id} value={s.student_id}>
                        #{s.rank} · {s.name} ({s.code}) — {Math.round(s.average)}%
                      </option>
                    ))}
                  </select>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="pl-btn pl-btn-primary pl-btn-sm"
                    onClick={() => doPrint(activeStudent)}
                  >
                    <i className="fa-solid fa-print" /> Print This Card
                  </button>
                </div>
              </div>

              {/* Rendered Live Card Preview */}
              <div style={{ background: 'var(--bg-alt)', padding: '24px 12px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                {renderCard(activeStudent, info, term, schoolName)}
              </div>
            </div>
          )}

          {/* ── ON SCREEN: Class Summary Table View ── */}
          {viewMode === 'roster' && (
            <div className="pl-screen-only" style={{ marginBottom: 28 }}>
              <Card>
                <div className="pl-table-wrap">
                  <table className="pl-table">
                    <thead>
                      <tr>
                        <th style={{ width: '70px' }}>Rank</th>
                        <th>Student</th>
                        <th>Subjects</th>
                        <th>Average</th>
                        <th>Grade</th>
                        <th>Attendance</th>
                        <th style={{ width: '180px' }}>Actions</th>
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
                          <td>{s.subjects.length} subjects</td>
                          <td><strong>{Math.round(s.average)}%</strong></td>
                          <td><span style={{ fontWeight: 700, color: 'var(--accent)' }}>{formatGrade(s.average)}</span></td>
                          <td>{s.attendance_pct !== null ? `${s.attendance_pct}%` : '—'}</td>
                          <td>
                            <div className="pl-row-actions">
                              <button
                                type="button"
                                className="pl-btn pl-btn-ghost pl-btn-sm"
                                onClick={() => {
                                  setSelectedStudentId(s.student_id)
                                  setViewMode('preview')
                                }}
                              >
                                <i className="fa-solid fa-eye" /> Preview
                              </button>
                              <button
                                type="button"
                                className="pl-btn pl-btn-ghost pl-btn-sm"
                                onClick={() => doPrint(s)}
                              >
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
            </div>
          )}

          {/* ── PRINT TARGET: Clean, static, full-page print container ── */}
          <div className="pl-print-area pl-print-only">
            {(printOne ? [printOne] : students).map((s) => (
              <div key={s.student_id} className="pl-print-page">
                {renderCard(s, info, term, schoolName)}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
