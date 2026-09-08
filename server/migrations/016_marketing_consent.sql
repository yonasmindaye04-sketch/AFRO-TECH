-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Marketing Consent & Unsubscribe
-- ═══════════════════════════════════════════════════════════

-- Consent records: auditable opt-in/opt-out per channel
CREATE TABLE marketing_consent_records (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES marketing_contacts(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('sms','email','whatsapp','push')),
  action          TEXT NOT NULL CHECK (action IN ('opt_in','opt_out','verified','unverified')),
  source          TEXT NOT NULL,                 -- 'form','import','api','webhook','unsubscribe_link'
  source_id       TEXT,                          -- form ID, import batch ID, etc.
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_consent_contact ON marketing_consent_records(contact_id, channel);
CREATE INDEX idx_marketing_consent_tenant ON marketing_consent_records(tenant_id, created_at DESC);

-- Unsubscribe events: track each unsubscribe with context
CREATE TABLE marketing_unsubscribe_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES marketing_contacts(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('sms','email','whatsapp','push')),
  campaign_id     UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  message_id      UUID REFERENCES marketing_messages(id) ON DELETE SET NULL,
  reason          TEXT,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_unsubscribe_contact ON marketing_unsubscribe_events(contact_id, channel);
CREATE INDEX idx_marketing_unsubscribe_campaign ON marketing_unsubscribe_events(campaign_id);