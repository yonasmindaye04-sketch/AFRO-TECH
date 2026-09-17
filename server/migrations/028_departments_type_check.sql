-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Fix departments.type CHECK (28)
-- The 020 constraint only allowed 7 types, but seedDefaultDepartments
-- (auth.ts) and POST /flow/departments insert many more — workspace
-- creation for pharmacy/store/school was failing with
-- departments_type_check violations.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_type_check;
ALTER TABLE departments ADD CONSTRAINT departments_type_check
  CHECK (type IN (
    'reception','consultation','laboratory','injection','procedure','billing',
    'nurse','counseling','compounding','verification','nurse_referral','screening',
    'sales','returns','special_orders','admin','records','other'
  ));
