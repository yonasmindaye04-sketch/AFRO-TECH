-- ════════════════════════════════════════════════════════════
-- AFRO Suite — Departments Extended (vertical scoping, polymorphic visits)
-- ════════════════════════════════════════════════════════════

-- ── Extend departments table ────────────────────────────────
ALTER TABLE departments ADD COLUMN IF NOT EXISTS vertical TEXT CHECK (vertical IN ('pharmacy','store','hospital','school','shared'));
ALTER TABLE departments ADD COLUMN IF NOT EXISTS sort_order INT NOT NULL DEFAULT 0;
UPDATE departments SET vertical = 'shared' WHERE vertical IS NULL;

-- Add index for vertical filtering
CREATE INDEX IF NOT EXISTS idx_departments_vertical ON departments(tenant_id, vertical);

-- ── Extend visits for polymorphic source ───────────────────
ALTER TABLE visits ADD COLUMN IF NOT EXISTS source_entity_type TEXT CHECK (source_entity_type IN ('patient','student','customer','staff'));
ALTER TABLE visits ADD COLUMN IF NOT EXISTS source_entity_id UUID;
UPDATE visits SET source_entity_type = 'patient' WHERE source_entity_type IS NULL;

CREATE INDEX IF NOT EXISTS idx_visits_source ON visits(source_entity_type, source_entity_id);

-- ── Extend service_orders with new order types ─────────────
-- order_type already CHECK constrained; extend the constraint
ALTER TABLE service_orders DROP CONSTRAINT IF EXISTS service_orders_order_type_check;
ALTER TABLE service_orders ADD CONSTRAINT service_orders_order_type_check
  CHECK (order_type IN (
    'lab_test','injection','procedure','vitals','other',
    'counseling','compounding','verification',      -- pharmacy
    'nurse_referral','counseling','screening',      -- school
    'return_inspection','repair','special_order'    -- retail
  ));

-- ── Extend service_orders with polymorphic source ───────────
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source_visit_id UUID REFERENCES visits(id) ON DELETE SET NULL;
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source_entity_type TEXT CHECK (source_entity_type IN ('patient','student','customer','staff'));
ALTER TABLE service_orders ADD COLUMN IF NOT EXISTS source_entity_id UUID;

CREATE INDEX IF NOT EXISTS idx_service_orders_source ON service_orders(source_entity_type, source_entity_id);
CREATE INDEX IF NOT EXISTS idx_service_orders_source_visit ON service_orders(source_visit_id);

-- ── Seed default departments per business_type ──────────────
-- This runs on migration; actual per-tenant seeding happens in seed.ts on tenant create
-- We insert into a template table that seed.ts reads from, or use a function
-- For now, we'll create a view that seed.ts can use, but the actual seeding
-- happens in server/src/scripts/seed.ts when a tenant is created.
-- See server/src/scripts/seed.ts for the per-tenant seeding logic.

-- The default department configurations per business_type:
-- 
-- Pharmacy: Reception, Dispensing, Counseling, Compounding, Verification, Billing
-- Store: Reception, Sales Floor, Returns/Repair, Special Orders, Billing
-- Hospital: Reception, Consultation, Laboratory, Injection Room, Procedure, Billing, Records
-- School: Reception, Nurse/Clinic, Administration, Billing, Records

-- ── View for seed.ts to use ────────────────────────────────
CREATE OR REPLACE VIEW default_departments AS
SELECT 'pharmacy'::text AS business_type, 'Reception'::text AS name, 'reception'::text AS type, 1 AS sort_order
UNION ALL SELECT 'pharmacy','Dispensing','dispensing',2
UNION ALL SELECT 'pharmacy','Counseling','counseling',3
UNION ALL SELECT 'pharmacy','Compounding','compounding',4
UNION ALL SELECT 'pharmacy','Verification','verification',5
UNION ALL SELECT 'pharmacy','Billing','billing',6
UNION ALL SELECT 'store','Reception','reception',1
UNION ALL SELECT 'store','Sales Floor','sales',2
UNION ALL SELECT 'store','Returns/Repair','returns',3
UNION ALL SELECT 'store','Special Orders','special_orders',4
UNION ALL SELECT 'store','Billing','billing',5
UNION ALL SELECT 'hospital','Reception','reception',1
UNION ALL SELECT 'hospital','Consultation','consultation',2
UNION ALL SELECT 'hospital','Laboratory','laboratory',3
UNION ALL SELECT 'hospital','Injection Room','injection',4
UNION ALL SELECT 'hospital','Procedure','procedure',5
UNION ALL SELECT 'hospital','Billing','billing',6
UNION ALL SELECT 'hospital','Records','records',7
UNION ALL SELECT 'school','Reception','reception',1
UNION ALL SELECT 'school','Nurse/Clinic','nurse',2
UNION ALL SELECT 'school','Administration','admin',3
UNION ALL SELECT 'school','Billing','billing',4
UNION ALL SELECT 'school','Records','records',5;

-- ── Grant select on view to app role (if using RLS) ────────
-- GRANT SELECT ON default_departments TO afro_app;