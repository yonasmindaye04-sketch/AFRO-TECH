-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Marketing Templates
-- ═══════════════════════════════════════════════════════════

-- Templates: reusable message content per channel
CREATE TABLE marketing_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('sms','email','whatsapp','push')),
  subject         TEXT,                          -- for email/push
  content         TEXT NOT NULL,                 -- template with {{variables}}
  variables       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- ["first_name","last_name","city"]
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_templates_tenant ON marketing_templates(tenant_id, channel);

-- Template versions for audit/history
CREATE TABLE marketing_template_versions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     UUID NOT NULL REFERENCES marketing_templates(id) ON DELETE CASCADE,
  subject         TEXT,
  content         TEXT NOT NULL,
  variables       JSONB NOT NULL DEFAULT '[]'::jsonb,
  version         INT NOT NULL,
  changed_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  change_note     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_template_versions_template ON marketing_template_versions(template_id, version DESC);