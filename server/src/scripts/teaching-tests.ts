/**
 * Teaching Activity module — integration tests.
 *
 * Requires a reachable Postgres (server/.env) with all migrations applied.
 * Spins up the real teaching router on an ephemeral port against two
 * throwaway school tenants, exercises the HTTP API and the monitor service,
 * then deletes every row it created.
 *
 * Run: npm run test:teaching
 */
import express from 'express'
import type { Server } from 'http'
import type { AddressInfo } from 'net'
import { pool, query, queryOne } from '../config/db.js'
import { signToken } from '../middleware/auth.js'
import { errorHandler, notFound } from '../middleware/validate.js'
import teachingRoutes from '../routes/teaching.js'
import { generateSessions, getGraceMinutes, monitorTenant } from '../services/teachingMonitor.js'

/* ── tiny test harness ── */
let passed = 0
let failed = 0
function ok(cond: boolean, name: string): void {
  if (cond) { passed++; console.log(`  PASS  ${name}`) }
  else { failed++; console.error(`  FAIL  ${name}`) }
}
function section(name: string): void { console.log(`\n== ${name} ==`) }

const RUN = Date.now().toString(36)
const TODAY = new Date().toISOString().slice(0, 10)
const ISODOW = ((new Date().getDay() + 6) % 7) + 1 // Postgres ISODOW: 1=Mon … 7=Sun

/** ISO timestamp offset by minutes from now. */
function ts(offsetMinutes: number): string {
  return new Date(Date.now() + offsetMinutes * 60000).toISOString()
}

/* ── HTTP helper against the ephemeral server ── */
let base = ''
async function api(
  token: string | null, method: string, path: string, body?: unknown
): Promise<{ status: number; data: Record<string, any> }> {
  const res = await fetch(`${base}/api/v1/teaching${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let data: Record<string, any> = {}
  try { data = (await res.json()) as Record<string, any> } catch { /* empty body */ }
  return { status: res.status, data }
}

/** Insert a class session (plus a backing timetable slot) with controlled timing. Returns the session id. */
async function insertSession(
  tenantId: string, teacherId: string, classId: string,
  opts: { startMin: number; endMin: number; status?: string; grace?: number },
): Promise<string> {
  const slot = await queryOne<{ id: string }>(
    `INSERT INTO timetable_slots (tenant_id, class_id, day_of_week, start_time, end_time, subject, teacher_id)
     VALUES ($1,$2,$3,$4::timestamptz::time,$5::timestamptz::time,'Mathematics',$6) RETURNING id`,
    [tenantId, classId, ISODOW, ts(opts.startMin), ts(opts.endMin), teacherId],
  )
  const row = await queryOne<{ id: string }>(
    `INSERT INTO class_sessions
       (tenant_id, timetable_slot_id, teacher_id, class_id, subject, session_date, scheduled_start, scheduled_end, grace_period_minutes, status)
     VALUES ($1,$2,$3,$4,'Mathematics',$5,$6::timestamptz,$7::timestamptz,$8,$9) RETURNING id`,
    [tenantId, slot!.id, teacherId, classId, TODAY, ts(opts.startMin), ts(opts.endMin), opts.grace ?? 10, opts.status ?? 'scheduled'],
  )
  return row!.id
}

async function sessionStatus(id: string): Promise<string> {
  const r = await queryOne<{ status: string }>(`SELECT status FROM class_sessions WHERE id = $1`, [id])
  return r?.status ?? 'MISSING'
}

async function eventCount(sessionId: string, type: string): Promise<number> {
  const r = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM teaching_activity_events WHERE session_id = $1 AND event_type = $2`, [sessionId, type])
  return r?.n ?? 0
}
/* ── fixture ids (populated by setup) ── */
const F = {
  tenantA: '', tenantB: '',
  ownerA: '', ownerB: '', teacherUser: '', staffNoPerm: '',
  tokenOwnerA: '', tokenOwnerB: '', tokenTeacher: '', tokenStaff: '',
  teacherA: '', teacherB: '', subTeacher: '',
  classA: '', classB: '',
  student1: '', student2: '',
}

async function setup(): Promise<Server> {
  const mkTenant = async (letter: string): Promise<string> => {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO tenants (name, slug, business_type, status, trial_ends_at)
       VALUES ($1, $2, 'school', 'active', now() + interval '30 days') RETURNING id`,
      [`TeachTest ${letter} ${RUN}`, `teachtest-${letter.toLowerCase()}-${RUN}`],
    )
    return r!.id
  }
  F.tenantA = await mkTenant('A')
  F.tenantB = await mkTenant('B')

  const mkUser = async (tenantId: string, role: 'owner' | 'staff', label: string): Promise<string> => {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO users (email, password_hash, full_name, role, tenant_id)
       VALUES ($1, 'test-hash', $2, $3, $4) RETURNING id`,
      [`tt-${label}-${RUN}@test.dev`, `${label} ${RUN}`, role, tenantId],
    )
    return r!.id
  }
  F.ownerA = await mkUser(F.tenantA, 'owner', 'ownerA')
  F.ownerB = await mkUser(F.tenantB, 'owner', 'ownerB')
  F.teacherUser = await mkUser(F.tenantA, 'staff', 'teacherA')
  F.staffNoPerm = await mkUser(F.tenantA, 'staff', 'noperm')

  // Grant the staff teacher the 'teacher' role (carries teaching.own from migration 030)
  const teacherRole = await queryOne<{ id: string }>(`SELECT id FROM roles WHERE name = 'teacher'`)
  if (!teacherRole) throw new Error("roles table missing 'teacher' role — run migrations first")
  await query(`INSERT INTO user_roles (user_id, role_id, tenant_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [F.teacherUser, teacherRole.id, F.tenantA])

  const mkTeacher = async (tenantId: string, name: string, userId: string | null): Promise<string> => {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO teachers (tenant_id, full_name, subject, user_id) VALUES ($1,$2,'Mathematics',$3) RETURNING id`,
      [tenantId, `${name} ${RUN}`, userId],
    )
    return r!.id
  }
  F.teacherA = await mkTeacher(F.tenantA, 'Teacher Alpha', F.teacherUser)
  F.subTeacher = await mkTeacher(F.tenantA, 'Teacher Sub', null)
  F.teacherB = await mkTeacher(F.tenantB, 'Teacher Beta', null)

  const mkClass = async (tenantId: string, name: string): Promise<string> => {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO classes (tenant_id, name, academic_year) VALUES ($1,$2,'2026') RETURNING id`,
      [tenantId, `${name} ${RUN}`],
    )
    return r!.id
  }
  F.classA = await mkClass(F.tenantA, 'Grade 9A')
  F.classB = await mkClass(F.tenantB, 'Grade 9B')

  const mkStudent = async (n: number): Promise<string> => {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO students (tenant_id, code, first_name, last_name, gender, dob, class_id, status)
       VALUES ($1,$2,$3,'Test','male','2012-01-01',$4,'active') RETURNING id`,
      [F.tenantA, `TT-${RUN}-${n}`, `Student${n}`, F.classA],
    )
    return r!.id
  }
  F.student1 = await mkStudent(1)
  F.student2 = await mkStudent(2)

  // One timetable slot for today in tenant A (drives session generation)
  await query(
    `INSERT INTO timetable_slots (tenant_id, class_id, day_of_week, start_time, end_time, subject, teacher_id)
     VALUES ($1,$2,$3,'08:00','09:00','Mathematics',$4)`,
    [F.tenantA, F.classA, ISODOW, F.teacherA],
  )

  const sign = (id: string, tenantId: string, role: 'owner' | 'staff', name: string): string =>
    signToken({ id, email: `${id}@test.dev`, full_name: name, role, tenant_id: tenantId })
  F.tokenOwnerA = sign(F.ownerA, F.tenantA, 'owner', 'Owner A')
  F.tokenOwnerB = sign(F.ownerB, F.tenantB, 'owner', 'Owner B')
  F.tokenTeacher = sign(F.teacherUser, F.tenantA, 'staff', 'Teacher A')
  F.tokenStaff = sign(F.staffNoPerm, F.tenantA, 'staff', 'No Perm')

  const app = express()
  app.use(express.json())
  app.use('/api/v1/teaching', teachingRoutes)
  app.use(notFound)
  app.use(errorHandler)
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return server
}
/* ── test groups ── */
async function testGracePeriod(): Promise<void> {
  section('Grace period configuration')
  ok((await getGraceMinutes(F.tenantA)) === 10, 'default grace period is 10 minutes')
  await query(
    `INSERT INTO tenant_settings (tenant_id, data) VALUES ($1, $2::jsonb)
     ON CONFLICT (tenant_id) DO UPDATE SET data = tenant_settings.data || $2::jsonb`,
    [F.tenantA, JSON.stringify({ teaching: { grace_period_minutes: 15 } })],
  )
  ok((await getGraceMinutes(F.tenantA)) === 15, 'tenant-configured grace period is honored')
  await query(
    `UPDATE tenant_settings SET data = jsonb_set(data, '{teaching,grace_period_minutes}', '10') WHERE tenant_id = $1`,
    [F.tenantA],
  )
}

async function testGeneration(): Promise<void> {
  section('Session generation (idempotent)')
  const r1 = await api(F.tokenOwnerA, 'POST', '/sessions/generate', { date: TODAY })
  ok(r1.status === 200 && r1.data.created === 1, `generate creates 1 session (got ${JSON.stringify(r1.data)})`)
  const r2 = await api(F.tokenOwnerA, 'POST', '/sessions/generate', { date: TODAY })
  ok(r2.status === 200 && r2.data.created === 0, 're-running generate creates 0 (idempotent)')
  ok((await generateSessions(F.tenantB, TODAY)) === 0, 'tenant B has no slots → 0 sessions')
}

async function testCheckInOut(): Promise<string> {
  section('Teacher check-in / check-out')
  const onTime = await insertSession(F.tenantA, F.teacherA, F.classA, { startMin: 2, endMin: 62 })
  const start = await api(F.tokenTeacher, 'POST', `/sessions/${onTime}/start`)
  ok(start.status === 200 && start.data.session?.status === 'present', `on-time check-in → present (${start.status})`)
  const done = await api(F.tokenTeacher, 'POST', `/sessions/${onTime}/complete`)
  ok(done.status === 200 && done.data.session?.is_completed === true, 'complete marks is_completed')
  const again = await api(F.tokenTeacher, 'POST', `/sessions/${onTime}/complete`)
  ok(again.status === 200, 'second complete is a no-op (idempotent)')

  const late = await insertSession(F.tenantA, F.teacherA, F.classA, { startMin: -20, endMin: 40 })
  const lateStart = await api(F.tokenTeacher, 'POST', `/sessions/${late}/start`)
  ok(
    lateStart.status === 200 && lateStart.data.session?.status === 'late' && lateStart.data.session?.minutes_late >= 19,
    `late check-in → late with minutes_late (${lateStart.data.session?.minutes_late})`,
  )

  const over = await insertSession(F.tenantA, F.teacherA, F.classA, { startMin: -180, endMin: -120, status: 'absent' })
  const restart = await api(F.tokenTeacher, 'POST', `/sessions/${over}/start`)
  ok(restart.status === 409, 'cannot start a session already marked absent (409)')
  return onTime
}

async function testMonitorLate(): Promise<void> {
  section('Monitor: late detection + notification dedup')
  const id = await insertSession(F.tenantA, F.teacherA, F.classA, { startMin: -20, endMin: 40 })
  await monitorTenant(F.tenantA)
  ok((await sessionStatus(id)) === 'late', 'monitor marks past-grace session late')
  ok((await eventCount(id, 'session_marked_late')) === 1, 'session_marked_late event written once')
  const key = await queryOne<{ id: string }>(
    `SELECT id FROM teacher_session_notifications WHERE notification_key = $1`, [`teacher-session-late-${id}`])
  ok(!!key, 'notification dedup record created')
  await monitorTenant(F.tenantA)
  ok((await eventCount(id, 'session_marked_late')) === 1, 'second monitor run does not duplicate the late event')
}

async function testMonitorAbsent(): Promise<void> {
  section('Monitor: late → absent progression')
  const id = await insertSession(F.tenantA, F.teacherA, F.classA, { startMin: -120, endMin: -60 })
  // One sweep may take a fully-past session scheduled → late → absent in the
  // same run (both notifications fire in order). Accept either path.
  await monitorTenant(F.tenantA)
  const after1 = await sessionStatus(id)
  ok(after1 === 'late' || after1 === 'absent', `first sweep progresses the session (got ${after1})`)
  if (after1 === 'late') await monitorTenant(F.tenantA)
  ok((await sessionStatus(id)) === 'absent', 'session reaches absent once its period has fully elapsed')
  ok((await eventCount(id, 'session_marked_absent')) === 1, 'session_marked_absent event written once')
  await monitorTenant(F.tenantA)
  ok((await eventCount(id, 'session_marked_absent')) === 1, 'absent notification not duplicated')
}
async function testOverride(): Promise<void> {
  section('Admin override (audited)')
  const id = await insertSession(F.tenantA, F.teacherA, F.classA, { startMin: -300, endMin: -240, status: 'absent' })
  const noReason = await api(F.tokenOwnerA, 'POST', `/sessions/${id}/override`, { status: 'excused' })
  ok(noReason.status === 400, 'override without reason rejected (400)')
  const badSub = await api(F.tokenOwnerA, 'POST', `/sessions/${id}/override`, { status: 'substituted', reason: 'cover needed' })
  ok(badSub.status === 400, 'substituted without substitute_teacher_id rejected (400)')
  const exc = await api(F.tokenOwnerA, 'POST', `/sessions/${id}/override`, { status: 'excused', reason: 'Teacher on sick leave' })
  ok(exc.status === 200 && exc.data.session?.status === 'excused', 'override to excused succeeds')
  ok((await eventCount(id, 'session_overridden')) === 1, 'override event recorded')
  const sub = await api(F.tokenOwnerA, 'POST', `/sessions/${id}/override`,
    { status: 'substituted', reason: 'Covered by colleague', substitute_teacher_id: F.subTeacher })
  ok(sub.status === 200 && sub.data.session?.substitute_teacher_id === F.subTeacher, 'override to substituted stores substitute')
  const before = await sessionStatus(id)
  await monitorTenant(F.tenantA)
  ok((await sessionStatus(id)) === before, 'monitor never touches overridden sessions')
}

async function testActivities(): Promise<void> {
  section('Activities & submissions')
  const create = await api(F.tokenTeacher, 'POST', '/activities', {
    class_id: F.classA, subject: 'Mathematics', type: 'homework',
    title: 'Algebra practice', due_at: ts(120), max_score: 100,
  })
  const actId = create.data.activity?.id as string | undefined
  ok(create.status === 201 && !!actId, `teacher creates activity (${create.status})`)
  if (!actId) return

  const assign = await api(F.tokenTeacher, 'POST', `/activities/${actId}/assign`, {})
  ok(assign.status === 200 && assign.data.activity?.status === 'assigned', 'assign marks activity assigned')
  const subs = await queryOne<{ n: number }>(
    `SELECT count(*)::int AS n FROM activity_submissions WHERE activity_id = $1`, [actId])
  ok(subs?.n === 2, 'assign creates a pending submission per active student (2)')

  const bulk = await api(F.tokenTeacher, 'POST', `/activities/${actId}/submissions/bulk`, {
    entries: [
      { student_id: F.student1, status: 'submitted', score: 80 },
      { student_id: F.student2, status: 'missing' },
    ],
  })
  ok(bulk.status === 200, `bulk submissions accepted (${bulk.status})`)
  const s1 = await queryOne<{ status: string; score: number }>(
    `SELECT status, score FROM activity_submissions WHERE activity_id = $1 AND student_id = $2`, [actId, F.student1])
  ok(s1?.status === 'submitted' && Number(s1?.score) === 80, 'submission upsert stores status + score')

  const patch = await api(F.tokenTeacher, 'PATCH', `/activities/${actId}`, { status: 'completed' })
  ok(patch.status === 200 && patch.data.activity?.status === 'completed', 'teacher marks activity completed')

  // Overdue sweep
  const overdue = await api(F.tokenTeacher, 'POST', '/activities', {
    class_id: F.classA, subject: 'Mathematics', type: 'quiz', title: 'Old quiz', due_at: ts(-30),
  })
  const odId = overdue.data.activity?.id as string
  await api(F.tokenTeacher, 'POST', `/activities/${odId}/assign`, {})
  await monitorTenant(F.tenantA)
  const od = await queryOne<{ status: string }>(`SELECT status FROM teaching_activities WHERE id = $1`, [odId])
  ok(od?.status === 'overdue', 'monitor marks past-due assigned activity overdue')
}
async function testExpectations(): Promise<void> {
  section('Activity expectations (upsert)')
  const body = { class_id: F.classA, subject: 'Mathematics', activity_type: 'homework', per_class_count: 2, per_week_count: 4 }
  const c1 = await api(F.tokenOwnerA, 'POST', '/expectations', body)
  ok(c1.status === 201 && !!c1.data.expectation?.id, 'expectation created (201)')
  const c2 = await api(F.tokenOwnerA, 'POST', '/expectations', { ...body, per_week_count: 6 })
  ok(c2.status === 200 && c2.data.expectation?.id === c1.data.expectation?.id, 'same key upserts instead of duplicating')
  ok(c2.data.expectation?.per_week_count === 6, 'upsert applies new values')
  const list = await api(F.tokenOwnerA, 'GET', '/expectations')
  ok(list.status === 200 && (list.data.expectations as unknown[]).length === 1, 'exactly one expectation listed')
  const del = await api(F.tokenOwnerA, 'DELETE', `/expectations/${c1.data.expectation.id}`)
  ok(del.status === 200 && del.data.deleted === true, 'expectation deleted')
}

async function testReports(onTimeSession: string): Promise<void> {
  section('Reporting')
  const q = `from=${TODAY}&to=${TODAY}`
  const ov = await api(F.tokenOwnerA, 'GET', `/reports/overview?${q}`)
  ok(ov.status === 200 && ov.data.sessions?.total >= 4 && typeof ov.data.on_time_pct === 'number',
    `overview aggregates sessions (${JSON.stringify(ov.data.sessions)})`)
  const tlist = await api(F.tokenOwnerA, 'GET', `/reports/teachers?${q}`)
  const rows = (tlist.data.teachers ?? []) as Array<{ teacher_id: string }>
  ok(tlist.status === 200 && rows.some((r) => r.teacher_id === F.teacherA), 'per-teacher report includes teacher A')
  const det = await api(F.tokenOwnerA, 'GET', `/reports/teachers/${F.teacherA}?${q}`)
  ok(det.status === 200 && det.data.teacher?.id === F.teacherA
    && Array.isArray(det.data.sessions) && Array.isArray(det.data.activities) && Array.isArray(det.data.events),
    'teacher detail returns teacher + sessions + activities + events')
  const att = await api(F.tokenOwnerA, 'GET', `/reports/attention?${q}`)
  ok(att.status === 200, `attention report responds (${att.status})`)
  const ev = await api(F.tokenOwnerA, 'GET', `/sessions/${onTimeSession}/events`)
  const types = ((ev.data.events ?? []) as Array<{ event_type: string }>).map((e) => e.event_type)
  ok(ev.status === 200 && types.includes('session_started') && types.includes('session_completed'),
    'session event timeline includes started + completed')
}
async function testRbac(): Promise<void> {
  section('RBAC')
  const anon = await api(null, 'GET', '/sessions')
  ok(anon.status === 401, 'no token → 401')
  const staffView = await api(F.tokenStaff, 'GET', '/reports/overview')
  ok(staffView.status === 403, 'staff without teaching.view → 403 on reports')
  const teacherGen = await api(F.tokenTeacher, 'POST', '/sessions/generate', {})
  ok(teacherGen.status === 403, 'teacher cannot generate sessions (needs teaching.manage)')
  const someSession = await insertSession(F.tenantA, F.subTeacher, F.classA, { startMin: 5, endMin: 65 })
  const foreign = await api(F.tokenTeacher, 'POST', `/sessions/${someSession}/start`)
  ok(foreign.status === 403, 'teacher cannot check in to another teacher’s session')
  const teacherOv = await api(F.tokenTeacher, 'POST', `/sessions/${someSession}/override`, { status: 'excused', reason: 'nope nope' })
  ok(teacherOv.status === 403, 'teacher cannot override sessions')
  const mine = await api(F.tokenTeacher, 'GET', `/sessions?date=${TODAY}`)
  const rows = (mine.data.sessions ?? []) as Array<{ teacher_id: string }>
  ok(mine.status === 200 && rows.length > 0 && rows.every((r) => r.teacher_id === F.teacherA),
    'teacher session list is scoped to own sessions')
}

async function testIsolation(): Promise<void> {
  section('Tenant isolation')
  const q = `from=${TODAY}&to=${TODAY}`
  const cross = await api(F.tokenOwnerB, 'GET', `/reports/teachers/${F.teacherA}?${q}`)
  ok(cross.status === 404, 'tenant B owner gets 404 for tenant A teacher')
  const bSessions = await api(F.tokenOwnerB, 'GET', `/sessions?date=${TODAY}`)
  ok(bSessions.status === 200 && (bSessions.data.sessions as unknown[]).length === 0,
    'tenant B sees none of tenant A’s sessions')
  const aSession = await queryOne<{ id: string }>(`SELECT id FROM class_sessions WHERE tenant_id = $1 LIMIT 1`, [F.tenantA])
  const crossOv = await api(F.tokenOwnerB, 'POST', `/sessions/${aSession!.id}/override`,
    { status: 'excused', reason: 'cross-tenant attempt' })
  ok(crossOv.status === 404, 'tenant B cannot override tenant A session (404)')
}

async function testLinkAccount(): Promise<void> {
  section('Link teacher account')
  const bad = await api(F.tokenOwnerA, 'POST', `/teachers/${F.subTeacher}/link-account`, { user_id: F.ownerB })
  ok(bad.status === 404, 'cannot link a user from another tenant (404)')
  const good = await api(F.tokenOwnerA, 'POST', `/teachers/${F.subTeacher}/link-account`, { user_id: F.staffNoPerm })
  ok(good.status === 200 && good.data.teacher?.user_id === F.staffNoPerm, 'link account succeeds')
  const det = await api(F.tokenOwnerA, 'GET', `/reports/teachers/${F.subTeacher}`)
  ok(det.data.teacher?.user_id === F.staffNoPerm, 'teacher detail reflects linked account')
}

/* ── teardown: remove everything we created ── */
async function cleanup(): Promise<void> {
  const ids = [F.tenantA, F.tenantB]
  await query(`DELETE FROM audit_logs WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM activity_submissions WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM teaching_activities WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM teacher_session_notifications WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM teaching_activity_events WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM class_sessions WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM activity_expectations WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM timetable_slots WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM students WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM teachers WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM classes WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM user_roles WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM users WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM tenant_settings WHERE tenant_id = ANY($1)`, [ids])
  await query(`DELETE FROM tenants WHERE id = ANY($1)`, [ids])
}

async function main(): Promise<void> {
  console.log(`Teaching module integration tests (run ${RUN}, ${TODAY})`)
  const server = await setup()
  try {
    await testGracePeriod()
    await testGeneration()
    const onTime = await testCheckInOut()
    await testMonitorLate()
    await testMonitorAbsent()
    await testOverride()
    await testActivities()
    await testExpectations()
    await testReports(onTime)
    await testRbac()
    await testIsolation()
    await testLinkAccount()
  } finally {
    server.close()
    await cleanup()
    await pool.end()
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

main().catch(async (err) => {
  console.error('Test run crashed:', err)
  try { await cleanup(); await pool.end() } catch { /* best effort */ }
  process.exit(1)
})
