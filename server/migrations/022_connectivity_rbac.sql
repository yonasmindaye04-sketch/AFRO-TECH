-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Department connectivity RBAC + default depts
-- ═══════════════════════════════════════════════════════════

-- ── New permissions ───────────────────────────────────────
INSERT INTO permissions (id, name, description) VALUES
  (gen_random_uuid(), 'departments.manage', 'Create/configure departments'),
  (gen_random_uuid(), 'visits.view',        'View visit queues and patient journeys'),
  (gen_random_uuid(), 'visits.manage',      'Check-in patients, call, transfer, close visits'),
  (gen_random_uuid(), 'visits.serve',       'Serve patients in a department (consult, administer)'),
  (gen_random_uuid(), 'orders.create',      'Create service orders (lab, injection, procedure)'),
  (gen_random_uuid(), 'orders.lab',         'Process laboratory orders'),
  (gen_random_uuid(), 'orders.injection',   'Administer injections/procedures'),
  (gen_random_uuid(), 'journey.reports',    'View department load and order turnaround reports')
ON CONFLICT (name) DO NOTHING;

-- ── New roles ─────────────────────────────────────────────
INSERT INTO roles (id, name, description, is_system) VALUES
  (gen_random_uuid(), 'receptionist', 'Front desk: check-in patients, manage visit queues, basic patient records', true),
  (gen_random_uuid(), 'injection_nurse', 'Injection/treatment room: view and administer ordered injections', true)
ON CONFLICT (name) DO NOTHING;

-- Receptionist permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'receptionist' AND p.name IN (
  'patients.view','patients.manage',
  'appointments.view','appointments.manage',
  'visits.view','visits.manage',
  'billing.view','billing.manage'
);

-- Injection nurse permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'injection_nurse' AND p.name IN (
  'visits.view','orders.injection'
);

-- Extend existing roles
-- Doctor: create orders + work the consultation queue
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'doctor' AND p.name IN ('visits.view','visits.serve','orders.create','visits.manage')
ON CONFLICT DO NOTHING;

-- Lab technician: process lab orders
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'lab_technician' AND p.name IN ('visits.view','orders.lab')
ON CONFLICT DO NOTHING;

-- Nurse: sees visits and can process injections if assigned
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'nurse' AND p.name IN ('visits.view')
ON CONFLICT DO NOTHING;

-- Accountant: journey reports + billing
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('accountant') AND p.name IN ('visits.view','journey.reports')
ON CONFLICT DO NOTHING;

-- ── Seed default departments for every existing hospital tenant ──
INSERT INTO departments (tenant_id, name, type)
SELECT t.id, d.name, d.type
FROM tenants t
CROSS JOIN (VALUES
  ('Reception','reception'),
  ('Consultation','consultation'),
  ('Laboratory','laboratory'),
  ('Injection Room','injection'),
  ('Billing','billing')
) AS d(name, type)
WHERE t.business_type = 'hospital'
ON CONFLICT (tenant_id, name) DO NOTHING;
