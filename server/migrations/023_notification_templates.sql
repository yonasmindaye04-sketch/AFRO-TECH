
CREATE TABLE notification_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  code            TEXT NOT NULL,
  name            TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('telegram','email','both')),
  subject         TEXT,
  body            TEXT NOT NULL,
  variables       JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_system       BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);
CREATE INDEX idx_notification_templates_tenant ON notification_templates(tenant_id);
CREATE INDEX idx_notification_templates_code ON notification_templates(code);

-- Note: No system templates are inserted here.
-- Actual per-tenant copies will be created on tenant registration via seed script.
-- See server/src/scripts/seed.ts for the per-tenant copy logic.

