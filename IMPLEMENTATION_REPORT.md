# Teacher Attendance & Teaching Activity Tracking — Implementation Report

## Summary

A complete teacher-attendance and teaching-activity module for the multi-tenant School ERP: automatic daily session generation from timetables, teacher self check-in/check-out, background late/absent detection with deduplicated notifications, admin overrides with audit trail, teaching-activity (assignment/quiz/lab/…) tracking with per-student submissions, configurable activity expectations, and admin reporting (overview, per-teacher, teacher detail, attention list).

**Status: complete and verified — 53/53 integration tests passing; `tsc --noEmit` clean on server and frontend.**

## Backend

| File | Purpose |
|---|---|
| `server/migrations/030_teaching_activity.sql` | Tables: `class_sessions`, `teacher_session_notifications` (dedup), `teaching_activities`, `activity_submissions`, `activity_expectations`, `teaching_activity_events`; `teachers.user_id` link column; `teaching.own/view/manage` permissions; indexes + unique constraints. |
| `server/src/services/teachingMonitor.ts` | Background sweeps: session generation (idempotent via `UNIQUE(timetable_slot_id, session_date)`), late marking after per-tenant grace period (default 10 min, configurable via `tenant_settings.teaching_grace_period_minutes`), late→absent progression after the period fully elapses, overdue activity detection. Every transition writes a `teaching_activity_events` row and a deduplicated notification (`ON CONFLICT (notification_key) DO NOTHING`). `monitorTenant` is exported for tests. |
| `server/src/routes/teaching.ts` | REST API (see below), Zod-validated, permission-gated, tenant-scoped. |
| `server/src/index.ts` | Router mounted at `/api/teaching`; monitor interval started. |

### Key endpoints
- `GET /api/teaching/sessions?date=` — scoped to the caller's own sessions for `teaching.own`, all sessions for `teaching.view/manage`
- `POST /sessions/:id/start | /complete` — teacher check-in/out (owner only, 403 for foreign teacher; 409 on invalid state transition, e.g. starting an absent session); computes `minutes_late`
- `POST /sessions/generate` (`teaching.manage`), `POST /sessions/:id/override` (`teaching.manage`, requires `reason`; `substituted` requires `substitute_teacher_id`; overridden sessions are never touched again by the monitor)
- `POST /teachers/:id/link-account` (`teaching.manage`) — links a teacher record to a tenant user (404 cross-tenant)
- `POST /activities`, `POST /activities/:id/assign`, `POST /activities/:id/complete` — assignment auto-creates a `pending` submission per active student; `POST /activities/:id/submissions` — bulk upsert of status/score/feedback
- `GET/POST /expectations` — upsert by unique key
- `GET /reports/overview | /reports/teachers | /reports/teachers/:id | /reports/attention`, `GET /sessions/:id/events`

## Frontend

| File | Purpose |
|---|---|
| `src/platform/school/Teaching.tsx` | Teacher view: today's sessions with check-in/complete, activity creation/assign/complete, submission entry. |
| `src/platform/school/TeachingPerformance.tsx` | Admin dashboard: overview stats, per-teacher table, attention list. |
| `src/platform/school/TeacherDetail.tsx` | Per-teacher detail: sessions with admin override modal, activities, expectations, full event timeline, link-account. |
| `src/platform/index.tsx` | Lazy routes: `/app/teaching`, `/app/teaching-performance`, `/app/teaching/teachers/:id`. |
| `src/platform/Shell.tsx` | Nav: "My Teaching" (`teaching.own`), "Teaching Activity" (`teaching.view`). |

## Tests — `server/src/scripts/teaching-tests.ts` (`npm run test:teaching`)

Real Express app (port 0) with the actual router + auth middleware against a live Postgres; two throwaway tenants, cleaned up in FK-safe order in a `finally` block. **53 assertions, all passing**, covering: grace-period config, idempotent generation, check-in/out (on-time/late, 409 on absent, idempotent complete), monitor late + absent progression with notification dedup, audited overrides (400 validations, monitor immunity), activities/submissions lifecycle, expectation upsert, all four reports, RBAC (401/403/scoping), tenant isolation (404 cross-tenant), and account linking.

### Bugs found & fixed by the tests
1. **late → absent progression never fired** — the absent sweep only considered `status = 'scheduled'`, so a session marked late on sweep N could never become absent on sweep N+1. Fixed in `loadDueSessions`/`markAbsent` to accept `status IN ('scheduled','late')` for the absent pass. A fully-past session now transitions scheduled → late → absent within a single run, emitting both notifications in order.
2. Fixture/schema mismatches caught while validating against the real DB: `students.gender` CHECK requires male/female; `class_sessions.timetable_slot_id` is NOT NULL (test helper now creates a backing slot per session, which also exercises the generation-conflict path).
3. Test assertion fix: pg returns NUMERIC scores as strings — compare with `Number(...)`.

## Notes / assumptions
- Session generation is daily-scoped (`session_date = CURRENT_DATE`) and safe to run at any frequency.
- Notifications reuse the existing `notificationEngine`; dedup keys: `teacher-session-late-<id>`, `teacher-session-absent-<id>`.
- Monitor runs per active tenant; overridden (`excused`/`substituted`/`cancelled`) sessions are terminal and excluded from sweeps.
