-- ═══════════════════════════════════════════════════════════
-- AFRO Suite — Marketing Audiences & Segmentation
-- ═══════════════════════════════════════════════════════════

-- Audiences: named segments defined by rules
CREATE TABLE marketing_audiences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  type            TEXT NOT NULL DEFAULT 'dynamic' CHECK (type IN ('dynamic','static','imported')),
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_audiences_tenant ON marketing_audiences(tenant_id);

-- Rules that define dynamic audiences
-- Example: field='city', operator='=', value='Addis Ababa'
-- field: column in marketing_contacts or marketing_contact_channels
-- operator: =, !=, IN, NOT IN, >, <, >=, <=, LIKE, ILIKE, IS NULL, IS NOT NULL
CREATE TABLE marketing_audience_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audience_id     UUID NOT NULL REFERENCES marketing_audiences(id) ON DELETE CASCADE,
  field           TEXT NOT NULL,
  operator        TEXT NOT NULL CHECK (operator IN ('=','!=','IN','NOT IN','>','<','>=','<=','LIKE','ILIKE','IS NULL','IS NOT NULL')),
  value           JSONB NOT NULL,                -- scalar or array for IN/NOT IN
  logical_op      TEXT NOT NULL DEFAULT 'AND' CHECK (logical_op IN ('AND','OR')),
  sort_order      INT NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_marketing_audience_rules_audience ON marketing_audience_rules(audience_id, sort_order);

-- Materialized audience members (for static/imported audiences or cached dynamic)
CREATE TABLE marketing_audience_members (
  audience_id     UUID NOT NULL REFERENCES marketing_audiences(id) ON DELETE CASCADE,
  contact_id      UUID NOT NULL REFERENCES marketing_contacts(id) ON DELETE CASCADE,
  added_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (audience_id, contact_id)
);
CREATE INDEX idx_marketing_audience_members_contact ON marketing_audience_members(contact_id);