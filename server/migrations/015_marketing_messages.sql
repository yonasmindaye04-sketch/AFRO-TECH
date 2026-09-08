-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Marketing Messages & Events
-- ═══════════════════════════════════════════════════════════

-- Messages: individual message sends (queued by workers)
CREATE TABLE marketing_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  campaign_id     UUID REFERENCES marketing_campaigns(id) ON DELETE SET NULL,
  automation_id   UUID REFERENCES marketing_automations(id) ON DELETE SET NULL,
  contact_id      UUID NOT NULL REFERENCES marketing_contacts(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('sms','email','whatsapp','push')),
  template_id     UUID REFERENCES marketing_templates(id) ON DELETE SET NULL,
  subject         TEXT,
  content         TEXT NOT NULL,                 -- fully rendered
  provider        TEXT NOT NULL,                 -- 'ethiotelecom', 'resend', etc.
  provider_msg_id TEXT,                          -- ID returned by provider
  status          TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','delivered','failed','bounced','unsubscribed')),
  error           TEXT,
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  queued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_messages_tenant ON marketing_messages(tenant_id, status);
CREATE INDEX idx_marketing_messages_campaign ON marketing_messages(campaign_id);
CREATE INDEX idx_marketing_messages_contact ON marketing_messages(contact_id, channel);
CREATE INDEX idx_marketing_messages_provider_msg ON marketing_messages(provider_msg_id) WHERE provider_msg_id IS NOT NULL;

-- Message events: webhook callbacks for delivery tracking
CREATE TABLE marketing_message_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID NOT NULL REFERENCES marketing_messages(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL CHECK (event_type IN ('queued','sent','delivered','failed','bounced','opened','clicked','unsubscribed','complained')),
  provider        TEXT NOT NULL,
  provider_event_id TEXT,                        -- unique ID from provider webhook
  payload         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_message_events_message ON marketing_message_events(message_id);
CREATE INDEX idx_marketing_message_events_type ON marketing_message_events(event_type);
CREATE INDEX idx_marketing_message_events_provider ON marketing_message_events(provider, provider_event_id) WHERE provider_event_id IS NOT NULL;