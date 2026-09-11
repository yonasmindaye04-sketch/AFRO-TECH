-- ════════════════════════════════════════════════════════════
-- AFRO Suite — Cash Drawer Extended (vertical-specific payment methods)
-- Single table with vertical-scoped payment_method enum
-- ════════════════════════════════════════════════════════════

-- ── Extend cash_drawer_shifts with vertical ──────────────────
ALTER TABLE cash_drawer_shifts ADD COLUMN IF NOT EXISTS vertical TEXT CHECK (vertical IN ('retail','pharmacy','hospital','school','shared'));
UPDATE cash_drawer_shifts SET vertical = 'retail' WHERE vertical IS NULL;

CREATE INDEX IF NOT EXISTS idx_cash_drawer_shifts_vertical ON cash_drawer_shifts(tenant_id, vertical);

-- ── Drop and recreate payment_method check with vertical-scoped values ─────
-- Retail/Pharmacy: cash, card, mobile
-- Hospital: cash, card, insurance, mobile
-- School: cash, bank_transfer, mobile, card

-- First, drop the existing check constraint
ALTER TABLE cash_drawer_shifts DROP CONSTRAINT IF EXISTS cash_drawer_shifts_payment_method_check;

-- Add new vertical-aware check constraint
ALTER TABLE cash_drawer_shifts ADD CONSTRAINT cash_drawer_shifts_payment_method_check
  CHECK (
    (vertical IN ('retail','pharmacy') AND payment_method IN ('cash','card','mobile')) OR
    (vertical = 'hospital' AND payment_method IN ('cash','card','insurance','mobile')) OR
    (vertical = 'school' AND payment_method IN ('cash','bank_transfer','mobile','card')) OR
    (vertical = 'shared' AND payment_method IN ('cash','card','mobile','bank_transfer','insurance'))
  );

-- Add vertical column to expenses if not exists (for per-vertical categorization)
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS vertical TEXT CHECK (vertical IN ('retail','pharmacy','hospital','school','shared'));
UPDATE expenses SET vertical = 'retail' WHERE vertical IS NULL;

CREATE INDEX IF NOT EXISTS idx_expenses_vertical ON expenses(tenant_id, vertical);

-- Add vertical column to income if not exists
ALTER TABLE income ADD COLUMN IF NOT EXISTS vertical TEXT CHECK (vertical IN ('retail','pharmacy','hospital','school','shared'));
UPDATE income SET vertical = 'retail' WHERE vertical IS NULL;

CREATE INDEX IF NOT EXISTS idx_income_vertical ON income(tenant_id, vertical);

-- Add vertical column to supplier_payments if not exists
ALTER TABLE supplier_payments ADD COLUMN IF NOT EXISTS vertical TEXT CHECK (vertical IN ('retail','pharmacy','hospital','school','shared'));
UPDATE supplier_payments SET vertical = 'retail' WHERE vertical IS NULL;

CREATE INDEX IF NOT EXISTS idx_supplier_payments_vertical ON supplier_payments(tenant_id, vertical);

-- Add vertical column to customer_payments if not exists
ALTER TABLE customer_payments ADD COLUMN IF NOT EXISTS vertical TEXT CHECK (vertical IN ('retail','pharmacy','hospital','school','shared'));
UPDATE customer_payments SET vertical = 'retail' WHERE vertical IS NULL;

CREATE INDEX IF NOT EXISTS idx_customer_payments_vertical ON customer_payments(tenant_id, vertical);

-- Update cash_drawer_shifts for existing Hospital tenants to 'hospital' vertical
UPDATE cash_drawer_shifts SET vertical = 'hospital'
WHERE vertical = 'retail' AND tenant_id IN (
  SELECT id FROM tenants WHERE business_type = 'hospital'
);

-- Update cash_drawer_shifts for existing School tenants to 'school' vertical
UPDATE cash_drawer_shifts SET vertical = 'school'
WHERE vertical = 'retail' AND tenant_id IN (
  SELECT id FROM tenants WHERE business_type = 'school'
);

-- Update cash_drawer_shifts for existing Pharmacy tenants to 'pharmacy' vertical
UPDATE cash_drawer_shifts SET vertical = 'pharmacy'
WHERE vertical = 'retail' AND tenant_id IN (
  SELECT id FROM tenants WHERE business_type = 'pharmacy'
);