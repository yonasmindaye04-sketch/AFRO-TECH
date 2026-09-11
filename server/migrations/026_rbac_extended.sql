-- ════════════════════════════════════════════════════════════
-- AFRO Suite — RBAC Extended (new permissions for horizontal features)
-- ════════════════════════════════════════════════════════════

-- ── New permissions for department/workflow connectivity ─────
INSERT INTO permissions (id, name, description) VALUES
  -- Departments
  (gen_random_uuid(), 'departments.view', 'View departments and their queues'),
  (gen_random_uuid(), 'departments.manage', 'Create, update, deactivate departments and assign staff'),
  -- Visits (patient/student/customer journey)
  (gen_random_uuid(), 'visits.view', 'View visit queues and patient journeys'),
  (gen_random_uuid(), 'visits.manage', 'Check-in, transfer, complete, no-show visits'),
  (gen_random_uuid(), 'visits.serve', 'Call patient, serve in department (doctor/nurse)'),
  -- Service Orders (lab, injection, procedure, counseling, etc.)
  (gen_random_uuid(), 'orders.create', 'Create service orders (lab, injection, procedure, counseling, etc.)'),
  (gen_random_uuid(), 'orders.lab', 'Process laboratory orders'),
  (gen_random_uuid(), 'orders.injection', 'Administer injections/procedures'),
  (gen_random_uuid(), 'orders.counseling', 'Process counseling orders (pharmacy/school)'),
  (gen_random_uuid(), 'orders.compounding', 'Process compounding orders (pharmacy)'),
  (gen_random_uuid(), 'orders.verification', 'Process verification orders (pharmacy)'),
  (gen_random_uuid(), 'orders.nurse_referral', 'Process nurse referral orders (school)'),
  (gen_random_uuid(), 'orders.screening', 'Process screening orders (school)'),
  (gen_random_uuid(), 'orders.return_inspection', 'Process return inspection orders (retail)'),
  (gen_random_uuid(), 'orders.repair', 'Process repair orders (retail)'),
  (gen_random_uuid(), 'orders.special_order', 'Process special orders (retail)'),
  (gen_random_uuid(), 'orders.procedure', 'Process procedure orders (hospital)'),
  (gen_random_uuid(), 'orders.vitals', 'Record vitals (hospital/school)'),
  (gen_random_uuid(), 'orders.other', 'Process other service orders'),
  -- Journey reports
  (gen_random_uuid(), 'journey.reports', 'View department load and order turnaround reports'),
  -- Cash drawer (horizontal)
  (gen_random_uuid(), 'cash_drawer.view', 'View cash drawer shifts and status'),
  (gen_random_uuid(), 'cash_drawer.manage', 'Open/close shifts, record expenses, reconcile'),
  -- Notification templates
  (gen_random_uuid(), 'notifications.view', 'View notification templates and delivery logs'),
  (gen_random_uuid(), 'notifications.manage', 'Create, edit, activate/deactivate notification templates'),
  (gen_random_uuid(), 'notifications.send', 'Send ad-hoc notifications to users/roles/departments'),
ON CONFLICT (name) DO NOTHING;

-- ── New roles ────────────────────────────────────────────────
INSERT INTO roles (id, name, description, is_system) VALUES
  (gen_random_uuid(), 'receptionist', 'Front desk: check-in patients/students/customers, manage visit queues, basic records', true),
  (gen_random_uuid(), 'injection_nurse', 'Injection/treatment room: view and administer ordered injections/procedures', true),
  (gen_random_uuid(), 'counselor', 'Pharmacy/school counselor: view and complete counseling orders', true),
  (gen_random_uuid(), 'compounder', 'Pharmacy compounder: view and complete compounding orders', true),
  (gen_random_uuid(), 'verifier', 'Pharmacy verifier: view and complete verification orders', true),
  (gen_random_uuid(), 'nurse_practitioner', 'School nurse: view and complete nurse referrals/screenings', true),
  (gen_random_uuid(), 'return_inspector', 'Retail returns: inspect and process returned items', true),
  (gen_random_uuid(), 'repair_technician', 'Retail repair: process repair orders', true),
  (gen_random_uuid(), 'cashier_supervisor', 'Cash drawer supervisor: open/close/reconcile shifts across verticals', true),
  (gen_random_uuid(), 'notification_manager', 'Manage notification templates and send ad-hoc notifications', true)
ON CONFLICT (name) DO NOTHING;

-- ── Assign permissions to new roles ──────────────────────────

-- Receptionist: front desk operations
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'receptionist' AND p.name IN (
  'patients.view','patients.manage',
  'appointments.view','appointments.manage',
  'visits.view','visits.manage',
  'billing.view','billing.manage',
  'departments.view'
);

-- Injection nurse: process injection/procedure orders
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'injection_nurse' AND p.name IN (
  'visits.view','orders.injection','orders.procedure'
);

-- Counselor: process counseling orders
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'counselor' AND p.name IN (
  'visits.view','orders.counseling'
);

-- Compounder: process compounding orders
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'compounder' AND p.name IN (
  'visits.view','orders.compounding'
);

-- Verifier: process verification orders
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'verifier' AND p.name IN (
  'visits.view','orders.verification'
);

-- Nurse practitioner (school): nurse referrals and screenings
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'nurse_practitioner' AND p.name IN (
  'visits.view','orders.nurse_referral','orders.screening','visits.serve'
);

-- Return inspector: process return inspections
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'return_inspector' AND p.name IN (
  'visits.view','orders.return_inspection','orders.repair'
);

-- Repair technician: process repair orders
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'repair_technician' AND p.name IN (
  'visits.view','orders.repair'
);

-- Cashier supervisor: manage cash drawer shifts across verticals
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'cashier_supervisor' AND p.name IN (
  'cash_drawer.view','cash_drawer.manage',
  'payments.view','payments.create','payments.refund',
  'supplier_payments.view','supplier_payments.create'
);

-- Notification manager: templates and sending
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'notification_manager' AND p.name IN (
  'notifications.view','notifications.manage','notifications.send'
);

-- ── Extend existing roles with new permissions ──────────────

-- Doctor: add orders.create + visits.serve + orders.injection + orders.procedure + orders.counseling
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'doctor' AND p.name IN (
  'visits.view','visits.serve','visits.manage',
  'orders.create','orders.lab','orders.injection','orders.procedure','orders.counseling'
) ON CONFLICT DO NOTHING;

-- Lab technician: add orders.lab (already has labs.manage/view but not orders.lab)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'lab_technician' AND p.name IN (
  'orders.lab'
) ON CONFLICT DO NOTHING;

-- Nurse: add orders.injection + orders.procedure + orders.vitals + visits.serve
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'nurse' AND p.name IN (
  'visits.view','visits.serve','orders.injection','orders.procedure','orders.vitals'
) ON CONFLICT DO NOTHING;

-- Nurse (school): add orders.nurse_referral + orders.screening
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'nurse' AND p.name IN (
  'orders.nurse_referral','orders.screening'
) ON CONFLICT DO NOTHING;

-- Pharmacist: add orders.compounding + orders.verification + orders.counseling
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'pharmacist' AND p.name IN (
  'visits.view','orders.compounding','orders.verification','orders.counseling'
) ON CONFLICT DO NOTHING;

-- Accountant: add journey.reports + cash_drawer.view/manage
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'accountant' AND p.name IN (
  'journey.reports','cash_drawer.view','cash_drawer.manage',
  'notifications.view'
) ON CONFLICT DO NOTHING;

-- Owner: all new permissions (handled by 'owner gets all permissions' logic in auth.ts)

-- afrotech_admin: all permissions via '*' in req.permissions (handled in auth.ts)

-- ── Assign new permissions to afrotech_admin role (redundant but explicit) ──
-- Already covered by '*' in auth.ts, but for completeness:
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'afrotech_admin' AND p.name IN (
  'departments.view','departments.manage',
  'visits.view','visits.manage','visits.serve',
  'orders.create','orders.lab','orders.injection','orders.counseling',
  'orders.compounding','orders.verification','orders.nurse_referral',
  'orders.screening','orders.return_inspection','orders.repair',
  'orders.special_order','orders.procedure','orders.vitals','orders.other',
  'journey.reports',
  'cash_drawer.view','cash_drawer.manage',
  'notifications.view','notifications.manage','notifications.send'
) ON CONFLICT DO NOTHING;