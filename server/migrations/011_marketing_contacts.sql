-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Marketing Contacts & Channel Preferences
-- ═══════════════════════════════════════════════════════════

-- Contacts: marketing audience for a tenant
CREATE TABLE marketing_contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  email           TEXT,
  phone           TEXT,
  country         TEXT,
  city            TEXT,
  customer_type   TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','unsubscribed','bounced','complained')),
  metadata        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_contacts_tenant ON marketing_contacts(tenant_id);
CREATE UNIQUE INDEX idx_marketing_contacts_tenant_email ON marketing_contacts(tenant_id, email) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX idx_marketing_contacts_tenant_phone ON marketing_contacts(tenant_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX idx_marketing_contacts_status ON marketing_contacts(tenant_id, status);

-- Channel preferences per contact
CREATE TABLE marketing_contact_channels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES marketing_contacts(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel         TEXT NOT NULL CHECK (channel IN ('sms','email','whatsapp','push')),
  address         TEXT NOT NULL,                 -- phone for sms/whatsapp, email for email, token for push
  subscribed      BOOLEAN NOT NULL DEFAULT true,
  verified        BOOLEAN NOT NULL DEFAULT false,
  unsubscribed_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(contact_id, channel)
);
CREATE INDEX idx_marketing_contact_channels_contact ON marketing_contact_channels(contact_id);
CREATE INDEX idx_marketing_contact_channels_tenant ON marketing_contact_channels(tenant_id);
CREATE INDEX idx_marketing_contact_channels_channel ON marketing_contact_channels(tenant_id, channel);