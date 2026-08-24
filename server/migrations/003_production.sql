-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.1 — production readiness
-- Audit trail, tenant settings, stock control, credit ledger,
-- lab tests, school subjects/timetable/announcements.
-- ═══════════════════════════════════════════════════════════

-- ── Cross-tenant audit trail ────────────────────────────────
CREATE TABLE audit_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID REFERENCES tenants(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  user_name  TEXT,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT,
  details    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_tenant ON audit_logs(tenant_id, created_at DESC);
CREATE INDEX idx_audit_recent ON audit_logs(created_at DESC);

-- ── Per-tenant settings (business profile, receipts, prefs) ─
CREATE TABLE tenant_settings (
  tenant_id  UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  data       JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Retail: barcode + invoice numbers + adjustments + credit ─
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(tenant_id, barcode);

ALTER TABLE sales ADD COLUMN IF NOT EXISTS invoice_no TEXT;

CREATE TABLE stock_adjustments (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_id   UUID REFERENCES product_batches(id) ON DELETE SET NULL,
  delta      INTEGER NOT NULL,
  reason     TEXT NOT NULL,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_adjustments_tenant ON stock_adjustments(tenant_id, created_at DESC);

CREATE TABLE customer_payments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  amount      NUMERIC(12,2) NOT NULL,
  note        TEXT,
  user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_payments ON customer_payments(tenant_id, customer_id);

-- ── Hospital: vitals + lab tests ────────────────────────────
ALTER TABLE medical_records ADD COLUMN IF NOT EXISTS vitals JSONB;

CREATE TABLE lab_tests (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  patient_id  UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  test_name   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered','sample_collected','resulted','cancelled')),
  result      TEXT,
  normal_range TEXT,
  notes       TEXT,
  price       NUMERIC(10,2) NOT NULL DEFAULT 0,
  ordered_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  resulted_at TIMESTAMPTZ
);
CREATE INDEX idx_labs_tenant ON lab_tests(tenant_id, created_at DESC);
CREATE INDEX idx_labs_patient ON lab_tests(patient_id);

-- ── School: subjects, timetable, announcements ──────────────
CREATE TABLE subjects (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);

CREATE TABLE timetable_slots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  class_id   UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 6),
  start_time TIME NOT NULL,
  end_time   TIME NOT NULL,
  subject    TEXT NOT NULL,
  teacher_id UUID REFERENCES teachers(id) ON DELETE SET NULL,
  UNIQUE(class_id, day_of_week, start_time)
);
CREATE INDEX idx_timetable_class ON timetable_slots(class_id);

CREATE TABLE announcements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  pinned     BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_announcements_tenant ON announcements(tenant_id, created_at DESC);
