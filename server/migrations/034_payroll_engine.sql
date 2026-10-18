-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Configurable Formula-Driven Payroll Engine
-- ═══════════════════════════════════════════════════════════

-- Configurable Payroll Components
CREATE TABLE IF NOT EXISTS payroll_components (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code              TEXT NOT NULL,
  label             TEXT NOT NULL,
  category          TEXT NOT NULL CHECK (category IN ('EARNING', 'DEDUCTION', 'EMPLOYER_COST', 'MEMO')),
  source            TEXT NOT NULL CHECK (source IN ('PROFILE', 'MANUAL', 'DERIVED')),
  taxability        TEXT NOT NULL CHECK (taxability IN ('TAXABLE', 'NON_TAXABLE')),
  pensionable       BOOLEAN NOT NULL DEFAULT false,
  formula           TEXT,
  rounding_decimals INTEGER NOT NULL DEFAULT 2,
  applies_to        TEXT NOT NULL DEFAULT 'ALL',
  active_from       DATE NOT NULL DEFAULT CURRENT_DATE,
  active_to         DATE,
  display_order     INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);
CREATE INDEX IF NOT EXISTS idx_payroll_components_tenant ON payroll_components(tenant_id, display_order);

-- Tax Brackets Setup
CREATE TABLE IF NOT EXISTS tax_brackets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, code)
);

CREATE TABLE IF NOT EXISTS tax_bracket_lines (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bracket_id  UUID NOT NULL REFERENCES tax_brackets(id) ON DELETE CASCADE,
  min_amount  NUMERIC(14,2) NOT NULL,
  max_amount  NUMERIC(14,2), -- Null implies infinity
  rate        NUMERIC(5,2) NOT NULL, -- percentage
  deduction   NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tax_bracket_lines_bracket ON tax_bracket_lines(bracket_id, min_amount);

-- Enhance payroll_runs
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS components_snapshot JSONB;
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS prepared_by UUID REFERENCES users(id);
ALTER TABLE payroll_runs ADD COLUMN IF NOT EXISTS checked_by UUID REFERENCES users(id);

-- Instead of status CHECK constraint which is hard to alter in postgres,
-- we will just let it be, but our code will enforce draft/calculated/approved/paid.
-- It's actually possible to drop and recreate the constraint if we really wanted to,
-- but let's just do it directly.
ALTER TABLE payroll_runs DROP CONSTRAINT IF EXISTS payroll_runs_status_check;
ALTER TABLE payroll_runs ADD CONSTRAINT payroll_runs_status_check CHECK (status IN ('draft', 'calculated', 'approved', 'paid'));

-- Create new payroll_lines (Replaces/Upgrades payroll_items)
CREATE TABLE IF NOT EXISTS payroll_lines (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payroll_run_id    UUID NOT NULL REFERENCES payroll_runs(id) ON DELETE CASCADE,
  tenant_id         UUID NOT NULL REFERENCES tenants(id),
  user_id           UUID NOT NULL REFERENCES users(id),
  employee_name     TEXT NOT NULL,
  values            JSONB NOT NULL DEFAULT '{}'::jsonb,
  overrides         JSONB NOT NULL DEFAULT '{}'::jsonb,
  net_pay           NUMERIC(14,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_run ON payroll_lines(payroll_run_id);
CREATE INDEX IF NOT EXISTS idx_payroll_lines_user ON payroll_lines(tenant_id, user_id);

-- Add profile_values to employee_salaries
ALTER TABLE employee_salaries ADD COLUMN IF NOT EXISTS profile_values JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Migrate existing employee_salaries data into profile_values jsonb
UPDATE employee_salaries
SET profile_values = jsonb_build_object(
    'BASIC', COALESCE(base_salary, 0),
    'TRANS_ALLOW', COALESCE(transport_allow, 0),
    'PENSION_EE_PCT', COALESCE(pension_pct, 7.00)
)
WHERE profile_values = '{}'::jsonb;

-- To keep views / legacy endpoints working if needed we could leave old tables,
-- but the prompt explicitly said to replace/upgrade payroll_items.
-- Since payroll_items is already created in 032, we can just leave it there or copy data.
-- We'll leave payroll_items alone so it doesn't break anything unexpectedly right now if it's referenced elsewhere,
-- but we will use payroll_lines for the new engine.
