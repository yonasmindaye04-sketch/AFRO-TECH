-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.4 — RBAC System (Phase 1)
-- ═══════════════════════════════════════════════════════════

-- ── Permissions: resource.action format ──────────────────────
CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,          -- e.g., 'sales.create'
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Roles: named sets of permissions ─────────────────────────
CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL UNIQUE,          -- e.g., 'pharmacist'
  description TEXT,
  is_system   BOOLEAN NOT NULL DEFAULT false, -- system roles cannot be deleted
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Role ↔ Permission mapping ────────────────────────────────
CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ── User ↔ Role mapping (tenant-scoped) ──────────────────────
CREATE TABLE user_roles (
  user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id  UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  granted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role_id, tenant_id)
);

-- ── Indexes ──────────────────────────────────────────────────
CREATE INDEX idx_user_roles_user ON user_roles(user_id);
CREATE INDEX idx_user_roles_tenant ON user_roles(tenant_id);
CREATE INDEX idx_role_permissions_role ON role_permissions(role_id);
CREATE INDEX idx_role_permissions_perm ON role_permissions(permission_id);

-- ── Seed system roles (cannot be deleted) ────────────────────
INSERT INTO roles (id, name, description, is_system) VALUES
  (gen_random_uuid(), 'owner', 'Full workspace access including settings and team management', true),
  (gen_random_uuid(), 'admin', 'Full access except workspace settings', true),
  (gen_random_uuid(), 'manager', 'Can manage inventory, sales, purchases, staff', true),
  (gen_random_uuid(), 'cashier', 'POS, sales, returns, basic customer management', true),
  (gen_random_uuid(), 'pharmacist', 'Prescriptions, dispensing, inventory, controlled substances', true),
  (gen_random_uuid(), 'doctor', 'Patients, appointments, records, prescriptions', true),
  (gen_random_uuid(), 'nurse', 'Patients, vitals, appointments, queue', true),
  (gen_random_uuid(), 'lab_technician', 'Lab orders, results, samples', true),
  (gen_random_uuid(), 'accountant', 'Finance, expenses, invoices, payments, reports', true),
  (gen_random_uuid(), 'teacher', 'Attendance, grades, report cards, students', true),
  (gen_random_uuid(), 'registrar', 'Students, enrollment, report cards, transcripts', true),
  (gen_random_uuid(), 'custom', 'Custom role created by owner', false)
ON CONFLICT (name) DO NOTHING;

-- ── Seed permissions (resource.action format) ────────────────
INSERT INTO permissions (id, name, description) VALUES
  -- Sales
  (gen_random_uuid(), 'sales.view', 'View sales history and POS'),
  (gen_random_uuid(), 'sales.create', 'Create new sales / POS'),
  (gen_random_uuid(), 'sales.refund', 'Process refunds and returns'),
  (gen_random_uuid(), 'sales.delete', 'Delete/refund sales (owner only)'),
  -- Inventory
  (gen_random_uuid(), 'inventory.view', 'View products, batches, stock'),
  (gen_random_uuid(), 'inventory.adjust', 'Stock adjustments, write-offs'),
  (gen_random_uuid(), 'inventory.manage', 'Products, categories, batches, pricing'),
  -- Purchases
  (gen_random_uuid(), 'purchases.view', 'View purchase orders and history'),
  (gen_random_uuid(), 'purchases.create', 'Create purchase orders, receive stock'),
  (gen_random_uuid(), 'purchases.delete', 'Delete/reverse purchases (owner only)'),
  -- Payments
  (gen_random_uuid(), 'payments.view', 'View payments and transactions'),
  (gen_random_uuid(), 'payments.create', 'Record payments (customer/supplier)'),
  (gen_random_uuid(), 'payments.refund', 'Process refunds'),
  -- Reports
  (gen_random_uuid(), 'reports.view', 'View dashboards and reports'),
  (gen_random_uuid(), 'reports.export', 'Export CSV/PDF reports'),
  -- Users
  (gen_random_uuid(), 'users.view', 'View team members'),
  (gen_random_uuid(), 'users.manage', 'Invite, disable, assign roles'),
  -- Settings
  (gen_random_uuid(), 'settings.view', 'View workspace settings'),
  (gen_random_uuid(), 'settings.manage', 'Manage workspace settings, integrations'),
  -- Pharmacy specific
  (gen_random_uuid(), 'prescriptions.create', 'Create and manage prescriptions'),
  (gen_random_uuid(), 'controlled_substances.manage', 'Controlled substance logs'),
  -- Hospital
  (gen_random_uuid(), 'patients.view', 'View patient records'),
  (gen_random_uuid(), 'patients.manage', 'Create/edit patient records'),
  (gen_random_uuid(), 'appointments.view', 'View appointment schedule'),
  (gen_random_uuid(), 'appointments.manage', 'Book/cancel/modify appointments'),
  (gen_random_uuid(), 'queue.manage', 'Manage patient queue'),
  (gen_random_uuid(), 'records.view', 'View medical records'),
  (gen_random_uuid(), 'records.create', 'Create medical records/prescriptions'),
  (gen_random_uuid(), 'labs.view', 'View lab orders/results'),
  (gen_random_uuid(), 'labs.manage', 'Order/record lab results'),
  (gen_random_uuid(), 'billing.view', 'View invoices and billing'),
  (gen_random_uuid(), 'billing.manage', 'Create/send invoices, record payments'),
  -- School
  (gen_random_uuid(), 'students.view', 'View student records'),
  (gen_random_uuid(), 'students.manage', 'Enroll/transfer/graduate students'),
  (gen_random_uuid(), 'attendance.view', 'View attendance'),
  (gen_random_uuid(), 'attendance.record', 'Record attendance'),
  (gen_random_uuid(), 'grades.view', 'View grades'),
  (gen_random_uuid(), 'grades.record', 'Record/override grades'),
  (gen_random_uuid(), 'report_cards.generate', 'Generate report cards'),
  (gen_random_uuid(), 'fees.view', 'View fee structures'),
  (gen_random_uuid(), 'fees.manage', 'Assign/collect fees'),
  (gen_random_uuid(), 'timetable.view', 'View timetables'),
  (gen_random_uuid(), 'timetable.manage', 'Manage class timetables'),
  (gen_random_uuid(), 'announcements.view', 'View announcements'),
  (gen_random_uuid(), 'announcements.create', 'Post announcements'),
  -- Reporting
  (gen_random_uuid(), 'reports.financial', 'Financial reports (P&L, cash flow)'),
  (gen_random_uuid(), 'reports.operational', 'Operational reports (stock, attendance)'),
  (gen_random_uuid(), 'reports.regulatory', 'Regulatory/compliance reports'),
  -- Settings
  (gen_random_uuid(), 'settings.business', 'Business info, tax, currency'),
  (gen_random_uuid(), 'settings.integrations', 'Telegram, payment gateways'),
  (gen_random_uuid(), 'settings.team', 'Team roles and permissions')
ON CONFLICT (name) DO NOTHING;

-- ── Assign permissions to system roles ───────────────────────
-- Owner: all permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p WHERE r.name = 'owner';

-- Admin: all except settings.manage (owner only)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'admin' AND p.name NOT IN ('settings.manage');

-- Manager: operational permissions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'manager' AND p.name IN (
  'sales.view','sales.create','sales.refund',
  'inventory.view','inventory.adjust','inventory.manage',
  'purchases.view','purchases.create','purchases.delete',
  'payments.view','payments.create','payments.refund',
  'reports.view','reports.export',
  'users.view','users.manage'
);

-- Cashier: POS and basic customer management
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'cashier' AND p.name IN (
  'sales.view','sales.create','sales.refund',
  'inventory.view',
  'payments.view','payments.create'
);

-- Pharmacist: dispensing, inventory, controlled substances
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'pharmacist' AND p.name IN (
  'sales.view','sales.create','sales.refund',
  'inventory.view','inventory.adjust','inventory.manage',
  'purchases.view','purchases.create',
  'prescriptions.create',
  'controlled_substances.manage',
  'reports.view','reports.export'
);

-- Doctor: patients, appointments, records, prescriptions
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'doctor' AND p.name IN (
  'patients.view','patients.manage',
  'appointments.view','appointments.manage',
  'queue.manage',
  'records.view','records.create',
  'labs.view','labs.manage',
  'billing.view','billing.manage',
  'reports.view'
);

-- Nurse: patients, vitals, appointments, queue
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'nurse' AND p.name IN (
  'patients.view','patients.manage',
  'appointments.view','appointments.manage',
  'queue.manage',
  'records.view',
  'vitals.record'
);

-- Lab Technician: labs only
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'lab_technician' AND p.name IN (
  'labs.view','labs.manage'
);

-- Accountant: finance, reports
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'accountant' AND p.name IN (
  'payments.view','payments.create','payments.refund',
  'reports.view','reports.export',
  'reports.financial'
);

-- Teacher: attendance, grades, report cards
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'teacher' AND p.name IN (
  'students.view',
  'attendance.view','attendance.record',
  'grades.view','grades.record',
  'report_cards.generate'
);

-- Registrar: students, enrollment, report cards
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'registrar' AND p.name IN (
  'students.view','students.manage',
  'attendance.view',
  'report_cards.generate',
  'fees.view','fees.manage'
);