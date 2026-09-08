-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Marketing Provider Configuration
-- ═══════════════════════════════════════════════════════════

-- Providers: configured SMS/Email/WhatsApp/Push providers per tenant
CREATE TABLE marketing_providers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('sms','email','whatsapp','push')),
  provider        TEXT NOT NULL,                 -- 'ethiotelecom', 'resend', 'twilio', 'africastalking', etc.
  name            TEXT NOT NULL,                 -- human-readable name
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- API keys, endpoints, sender IDs, etc.
  is_default      BOOLEAN NOT NULL DEFAULT false,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, channel, provider, name)
);
CREATE INDEX idx_marketing_providers_tenant ON marketing_providers(tenant_id, channel);

-- Automation system (for Phase 2+)
CREATE TABLE marketing_automations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('event','schedule','api')),
  trigger_config  JSONB NOT NULL DEFAULT '{}'::jsonb,  -- event name, cron, etc.
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','paused','archived')),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_automations_tenant ON marketing_automations(tenant_id);

ALTER TABLE marketing_messages
  ADD CONSTRAINT fk_marketing_messages_automation
  FOREIGN KEY (automation_id) REFERENCES marketing_automations(id) ON DELETE SET NULL;

CREATE TABLE marketing_automation_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id   UUID NOT NULL REFERENCES marketing_automations(id) ON DELETE CASCADE,
  step_order      INT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('wait','condition','action','split')),
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- wait duration, condition rules, action details
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_automation_steps_automation ON marketing_automation_steps(automation_id, step_order);

CREATE TABLE marketing_automation_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  automation_id   UUID NOT NULL REFERENCES marketing_automations(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES marketing_contacts(id) ON DELETE CASCADE,
  current_step    INT NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','failed','cancelled')),
  context         JSONB NOT NULL DEFAULT '{}'::jsonb,  -- runtime variables
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ
);
CREATE INDEX idx_marketing_automation_runs_automation ON marketing_automation_runs(automation_id, status);
CREATE INDEX idx_marketing_automation_runs_contact ON marketing_automation_runs(contact_id);