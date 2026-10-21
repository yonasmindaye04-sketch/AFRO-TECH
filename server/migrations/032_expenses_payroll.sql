-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Expenses (enhanced) + Payroll Management
-- ═══════════════════════════════════════════════════════════

-- Enhanced expenses columns. The `expenses` table already exists (001_init.sql),
-- so the enhancement has to be an idempotent ALTER: a CREATE TABLE IF NOT EXISTS
-- here matched nothing and the new columns never appeared (the old
-- idx_expenses_status build then failed with "column status does not exist").
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS receipt_url  TEXT;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN DEFAULT false;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recurrence   TEXT CHECK (recurrence IN ('daily','weekly','monthly','quarterly','yearly'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS status       TEXT NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS submitted_by UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_by  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS approved_at  TIMESTAMPTZ;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS recorded_by  UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS updated_at   TIMESTAMPTZ;

-- Back-fill the new bookkeeper column from the legacy user_id column
UPDATE expenses SET recorded_by = user_id WHERE recorded_by IS NULL AND user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_tenant ON expenses(tenant_id, spent_at DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_status ON expenses(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_expenses_recorded_by ON expenses(recorded_by);

-- Employee salary profiles
CREATE TABLE IF NOT EXISTS employee_salaries (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id),
  user_id         UUID NOT NULL REFERENCES users(id),
  base_salary     NUMERIC(12,2) NOT NULL DEFAULT 0,
  transport_allow NUMERIC(12,2) DEFAULT 0,
  housing_allow   NUMERIC(12,2) DEFAULT 0,
  other_allow     NUMERIC(12,2) DEFAULT 0,
  pension_pct     NUMERIC(5,2) DEFAULT 7.00,
  is_active       BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, user_id)
);

-- Payroll runs
CREATE TABLE IF NOT EXISTS payroll_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id),
  period_label  TEXT NOT NULL,
  frequency     TEXT NOT NULL DEFAULT 'monthly' CHECK (frequency IN ('weekly','biweekly','monthly')),
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','paid')),
  total_gross   NUMERIC(14,2) DEFAULT 0,
  total_net     NUMERIC(14,2) DEFAULT 0,
  approved_by   UUID REFERENCES users(id),
  approved_at   TIMESTAMPTZ,
  created_by    UUID REFERENCES users(id),
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, period_label)
);

-- Individual pay items per payroll run
CREATE TABLE IF NOT EXISTS payroll_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id    UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  employee_name     TEXT NOT NULL,
  base_salary       NUMERIC(12,2) NOT NULL,
  allowances        NUMERIC(12,2) DEFAULT 0,
  gross             NUMERIC(12,2) NOT NULL,
  income_tax        NUMERIC(12,2) DEFAULT 0,
  pension_employee  NUMERIC(12,2) DEFAULT 0,
  pension_employer  NUMERIC(12,2) DEFAULT 0,
  other_deductions  NUMERIC(12,2) DEFAULT 0,
  net_pay           NUMERIC(12,2) NOT NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_items_run ON payroll_items(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_items_user ON payroll_items(tenant_id, user_id);
