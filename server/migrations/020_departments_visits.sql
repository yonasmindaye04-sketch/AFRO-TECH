-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Hospital department connectivity layer (20)
-- Departments, patient visits (journey backbone), history
-- ═══════════════════════════════════════════════════════════

-- ── Departments ─────────────────────────────────────────────
CREATE TABLE departments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('reception','consultation','laboratory','injection','procedure','billing','other')),
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);
CREATE INDEX idx_departments_tenant ON departments(tenant_id);

-- Which user works in which department (queue visibility)
CREATE TABLE department_staff (
  department_id UUID NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (department_id, user_id)
);

-- ── Visits: one row per patient's physical journey ────────
CREATE TABLE visits (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id            UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  appointment_id        UUID REFERENCES appointments(id) ON DELETE SET NULL,
  visit_type            TEXT NOT NULL DEFAULT 'walk_in' CHECK (visit_type IN ('walk_in','scheduled')),
  current_department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  status                TEXT NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','in_service','transferred','completed','no_show')),
  priority              TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  chief_complaint       TEXT,
  opened_by             UUID REFERENCES users(id) ON DELETE SET NULL,
  opened_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at             TIMESTAMPTZ,
  closed_by             UUID REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX idx_visits_tenant_day ON visits(tenant_id, opened_at DESC);
CREATE INDEX idx_visits_dept ON visits(current_department_id, status);
CREATE INDEX idx_visits_patient ON visits(patient_id);
-- A scheduled appointment can only be checked in once
CREATE UNIQUE INDEX idx_visits_appointment ON visits(appointment_id) WHERE appointment_id IS NOT NULL;

-- ── Journey timeline (append-only) ────────────────────────
CREATE TABLE visit_status_history (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id      UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  department_id UUID REFERENCES departments(id) ON DELETE SET NULL,
  event         TEXT NOT NULL CHECK (event IN ('checked_in','called','in_service','transferred','completed','no_show','order_created','order_completed')),
  handled_by    UUID REFERENCES users(id) ON DELETE SET NULL,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_visit_history_visit ON visit_status_history(visit_id, created_at);
CREATE INDEX idx_visit_history_tenant ON visit_status_history(tenant_id, created_at DESC);
