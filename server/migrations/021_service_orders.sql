-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Hospital department connectivity layer (21)
-- Generic service orders: lab tests, injections, procedures
-- ═══════════════════════════════════════════════════════════

-- One row per "department A asks department B to do something for this patient"
CREATE TABLE service_orders (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  visit_id             UUID NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  patient_id           UUID NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  order_type           TEXT NOT NULL CHECK (order_type IN ('lab_test','injection','procedure','vitals','other')),
  target_department_id UUID NOT NULL REFERENCES departments(id) ON DELETE RESTRICT,
  ordered_by           UUID REFERENCES users(id) ON DELETE SET NULL,
  doctor_id            UUID REFERENCES doctors(id) ON DELETE SET NULL,
  priority             TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','urgent')),
  status               TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','completed','cancelled')),
  details              JSONB NOT NULL DEFAULT '{}'::jsonb,  -- type-specific: {test_name} / {drug,dose,route,duration}
  result               JSONB NOT NULL DEFAULT '{}'::jsonb,  -- result payload when completed
  fee                  NUMERIC(12,2) NOT NULL DEFAULT 0,    -- billed amount for this service
  completed_by         UUID REFERENCES users(id) ON DELETE SET NULL,
  completed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_service_orders_visit ON service_orders(visit_id);
CREATE INDEX idx_service_orders_dept ON service_orders(target_department_id, status, created_at);
CREATE INDEX idx_service_orders_patient ON service_orders(patient_id);

-- Billed linkage so completed orders flow into invoices (1 order <= 1 invoice)
ALTER TABLE service_orders ADD COLUMN invoice_id UUID REFERENCES invoices(id) ON DELETE SET NULL;
CREATE INDEX idx_service_orders_invoice ON service_orders(invoice_id) WHERE invoice_id IS NOT NULL;
