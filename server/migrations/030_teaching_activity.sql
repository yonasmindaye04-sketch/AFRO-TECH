-- 030_teaching_activity.sql
-- Teacher class-session attendance + teaching activity tracking.
-- Reuses: timetable_slots (schedule source), teachers/students/classes (001/003),
-- notification_templates + notificationEngine (023), RBAC (007/026), tenant_settings JSONB.

-- Link teacher records to staff login accounts (teacher self-service)
ALTER TABLE teachers ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS ux_teachers_user ON teachers(tenant_id, user_id) WHERE user_id IS NOT NULL;

-- Class sessions: one concrete session per timetable slot per date.
-- Session-level attendance is distinct from student daily attendance:
-- a teacher is PRESENT/LATE/ABSENT per scheduled period, not per day.
CREATE TABLE IF NOT EXISTS class_sessions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  timetable_slot_id    UUID NOT NULL REFERENCES timetable_slots(id) ON DELETE CASCADE,
  teacher_id           UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id             UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject              TEXT NOT NULL,
  session_date         DATE NOT NULL,
  scheduled_start      TIMESTAMPTZ NOT NULL,
  scheduled_end        TIMESTAMPTZ NOT NULL,
  actual_start         TIMESTAMPTZ,
  actual_end           TIMESTAMPTZ,
  is_completed         BOOLEAN NOT NULL DEFAULT false,
  status               TEXT NOT NULL DEFAULT 'scheduled'
                       CHECK (status IN ('scheduled','present','late','absent','excused','cancelled','substituted')),
  minutes_late         INTEGER NOT NULL DEFAULT 0,
  grace_period_minutes INTEGER NOT NULL DEFAULT 10,
  substitute_teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  status_reason        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (timetable_slot_id, session_date)
);
CREATE INDEX IF NOT EXISTS idx_class_sessions_tenant_date   ON class_sessions(tenant_id, session_date);
CREATE INDEX IF NOT EXISTS idx_class_sessions_teacher_date  ON class_sessions(tenant_id, teacher_id, session_date);
CREATE INDEX IF NOT EXISTS idx_class_sessions_status        ON class_sessions(tenant_id, status) WHERE status IN ('scheduled','late');

-- Teaching activities: classwork / homework / quiz / etc.
CREATE TABLE IF NOT EXISTS teaching_activities (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id   UUID REFERENCES class_sessions(id) ON DELETE SET NULL,
  teacher_id   UUID NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
  class_id     UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject      TEXT NOT NULL,
  type         TEXT NOT NULL
               CHECK (type IN ('classwork','homework','quiz','exercise','assignment','project','reading','practical','exam','other')),
  title        TEXT NOT NULL,
  description  TEXT,
  status       TEXT NOT NULL DEFAULT 'draft'
               CHECK (status IN ('draft','assigned','completed','overdue','cancelled')),
  assigned_at  TIMESTAMPTZ,
  due_at       TIMESTAMPTZ,
  max_score    NUMERIC(6,2),
  created_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teaching_activities_teacher ON teaching_activities(tenant_id, teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teaching_activities_class   ON teaching_activities(tenant_id, class_id);
CREATE INDEX IF NOT EXISTS idx_teaching_activities_due     ON teaching_activities(tenant_id, status, due_at) WHERE status = 'assigned';

-- Per-student submissions for an activity
CREATE TABLE IF NOT EXISTS activity_submissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  activity_id  UUID NOT NULL REFERENCES teaching_activities(id) ON DELETE CASCADE,
  student_id   UUID NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending','submitted','graded','missing','excused')),
  submitted_at TIMESTAMPTZ,
  score        NUMERIC(6,2),
  feedback     TEXT,
  graded_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (activity_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_activity_submissions_student ON activity_submissions(tenant_id, student_id);

-- Configurable activity expectations.
-- NULL class_id + NULL subject = school-wide default; more specific rows win.
CREATE TABLE IF NOT EXISTS activity_expectations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  class_id        UUID REFERENCES classes(id) ON DELETE CASCADE,
  subject         TEXT,
  activity_type   TEXT NOT NULL DEFAULT 'any'
                  CHECK (activity_type IN ('any','classwork','homework','quiz','exercise','assignment','project','reading','practical','exam','other')),
  per_class_count INTEGER NOT NULL DEFAULT 0 CHECK (per_class_count >= 0),
  per_week_count  INTEGER NOT NULL DEFAULT 0 CHECK (per_week_count >= 0),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_activity_expectations_scope ON activity_expectations(
  tenant_id, COALESCE(class_id, '00000000-0000-0000-0000-000000000000'), COALESCE(subject, ''), activity_type);

-- Timeline / audit of everything that happens to sessions and activities
CREATE TABLE IF NOT EXISTS teaching_activity_events (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id    UUID REFERENCES class_sessions(id) ON DELETE CASCADE,
  activity_id   UUID REFERENCES teaching_activities(id) ON DELETE CASCADE,
  teacher_id    UUID REFERENCES teachers(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  meta          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_teaching_events_teacher ON teaching_activity_events(tenant_id, teacher_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_teaching_events_session ON teaching_activity_events(session_id);

-- Deduplicated notification log (survives scheduler restarts).
-- notification_key examples: teacher-session-late-{sessionId}, teacher-session-absent-{sessionId}
CREATE TABLE IF NOT EXISTS teacher_session_notifications (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  session_id       UUID REFERENCES class_sessions(id) ON DELETE CASCADE,
  notification_key TEXT NOT NULL UNIQUE,
  recipient_count  INTEGER NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- RBAC permissions
INSERT INTO permissions (id, name, description) VALUES
  (gen_random_uuid(), 'teaching.view',   'View teaching performance dashboards and reports'),
  (gen_random_uuid(), 'teaching.manage', 'Manage session overrides and activity expectations'),
  (gen_random_uuid(), 'teaching.own',    'Teacher self-service: check in to own sessions, log activities')
ON CONFLICT (name) DO NOTHING;

-- Teachers can check in to their own classes and log activities
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'teacher' AND p.name IN ('teaching.own')
ON CONFLICT DO NOTHING;

-- Registrars can view teaching performance
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'registrar' AND p.name IN ('teaching.view')
ON CONFLICT DO NOTHING;

-- System tenant required by the notification_templates FK for zero-tenant fallback templates.
-- Status 'suspended' keeps it out of alert/billing loops (which scan trial/active tenants only).
INSERT INTO tenants (id, name, slug, business_type, status, trial_ends_at)
VALUES ('00000000-0000-0000-0000-000000000000', 'AFRO Suite System', 'system', 'school', 'suspended', '1970-01-01T00:00:00Z')
ON CONFLICT (id) DO NOTHING;


-- System notification templates (zero-tenant fallback, overridable per tenant)
INSERT INTO notification_templates (tenant_id, code, name, channel, subject, body, variables, is_system, is_active)
VALUES
  ('00000000-0000-0000-0000-000000000000', 'teacher_session_late', 'Teacher late for class', 'telegram',
   'Teacher late: {{teacher_name}}',
   'Teacher {{teacher_name}} has not started {{subject}} for class {{class_name}} (scheduled {{scheduled_time}}). Grace period of {{grace_minutes}} min has passed.',
   '["teacher_name","subject","class_name","scheduled_time","grace_minutes","minutes_late"]'::jsonb, true, true),
  ('00000000-0000-0000-0000-000000000000', 'teacher_session_absent', 'Teacher absent from class', 'telegram',
   'Class missed: {{teacher_name}}',
   'Teacher {{teacher_name}} never started {{subject}} for class {{class_name}} (scheduled {{scheduled_time}}). The whole period elapsed with no check-in.',
   '["teacher_name","subject","class_name","scheduled_time"]'::jsonb, true, true)
ON CONFLICT (tenant_id, code) DO NOTHING;
