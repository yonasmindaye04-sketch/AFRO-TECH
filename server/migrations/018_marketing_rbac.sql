-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Marketing RBAC Permissions
-- ═══════════════════════════════════════════════════════════

-- Seed marketing permissions
INSERT INTO permissions (id, name, description) VALUES
  -- Contacts
  (gen_random_uuid(), 'marketing.contacts.view', 'View marketing contacts'),
  (gen_random_uuid(), 'marketing.contacts.create', 'Create marketing contacts'),
  (gen_random_uuid(), 'marketing.contacts.update', 'Update marketing contacts'),
  (gen_random_uuid(), 'marketing.contacts.delete', 'Delete marketing contacts'),
  (gen_random_uuid(), 'marketing.contacts.import', 'Import marketing contacts (CSV/API)'),
  -- Audiences
  (gen_random_uuid(), 'marketing.audiences.view', 'View marketing audiences'),
  (gen_random_uuid(), 'marketing.audiences.create', 'Create marketing audiences'),
  (gen_random_uuid(), 'marketing.audiences.update', 'Update marketing audiences'),
  (gen_random_uuid(), 'marketing.audiences.delete', 'Delete marketing audiences'),
  -- Templates
  (gen_random_uuid(), 'marketing.templates.view', 'View marketing templates'),
  (gen_random_uuid(), 'marketing.templates.create', 'Create marketing templates'),
  (gen_random_uuid(), 'marketing.templates.update', 'Update marketing templates'),
  (gen_random_uuid(), 'marketing.templates.delete', 'Delete marketing templates'),
  -- Campaigns
  (gen_random_uuid(), 'marketing.campaigns.view', 'View marketing campaigns'),
  (gen_random_uuid(), 'marketing.campaigns.create', 'Create marketing campaigns'),
  (gen_random_uuid(), 'marketing.campaigns.update', 'Update marketing campaigns'),
  (gen_random_uuid(), 'marketing.campaigns.delete', 'Delete marketing campaigns'),
  (gen_random_uuid(), 'marketing.campaigns.send', 'Send/pause/cancel marketing campaigns'),
  -- Analytics
  (gen_random_uuid(), 'marketing.analytics.view', 'View marketing analytics'),
  -- Settings
  (gen_random_uuid(), 'marketing.settings.manage', 'Manage marketing providers and settings')
ON CONFLICT (name) DO NOTHING;

-- Assign marketing permissions to owner and admin roles
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name IN ('owner', 'admin') AND p.name LIKE 'marketing.%';

-- Create marketing_admin system role (platform-level, like afrotech_admin but for marketing)
INSERT INTO roles (id, name, description, is_system) VALUES
  (gen_random_uuid(), 'marketing_admin', 'Full access to marketing campaigns, contacts, audiences, templates, and analytics across all tenants', true)
ON CONFLICT (name) DO NOTHING;

-- Assign all marketing permissions to marketing_admin
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'marketing_admin' AND p.name LIKE 'marketing.%';