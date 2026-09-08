-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Marketing Campaigns
-- ═══════════════════════════════════════════════════════════

-- Campaigns: multi-channel marketing sends
CREATE TABLE marketing_campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  audience_id     UUID NOT NULL REFERENCES marketing_audiences(id) ON DELETE RESTRICT,
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','scheduled','queued','sending','completed','paused','cancelled','failed')),
  scheduled_at    TIMESTAMPTZ,
  started_at      TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_campaigns_tenant ON marketing_campaigns(tenant_id, status);

-- Channels used in a campaign + which template
CREATE TABLE marketing_campaign_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('sms','email','whatsapp','push')),
  template_id     UUID NOT NULL REFERENCES marketing_templates(id) ON DELETE RESTRICT,
  provider        TEXT,                          -- 'ethiotelecom', 'resend', etc.
  config          JSONB NOT NULL DEFAULT '{}'::jsonb,  -- channel-specific config
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, channel)
);
CREATE INDEX idx_marketing_campaign_channels_campaign ON marketing_campaign_channels(campaign_id);

-- Recipient tracking per campaign (one row per contact per campaign)
CREATE TABLE marketing_campaign_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id     UUID NOT NULL REFERENCES marketing_campaigns(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES marketing_contacts(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('sms','email','whatsapp','push')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','queued','sent','delivered','failed','bounced','unsubscribed')),
  message_id      UUID,                          -- references marketing_messages
  error           TEXT,
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, contact_id, channel)
);
CREATE INDEX idx_marketing_campaign_recipients_campaign ON marketing_campaign_recipients(campaign_id, status);
CREATE INDEX idx_marketing_campaign_recipients_contact ON marketing_campaign_recipients(contact_id);