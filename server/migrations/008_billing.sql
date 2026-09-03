-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.5 — Subscription billing (plans, payments, webhooks)
-- ═══════════════════════════════════════════════════════════

-- ── Catalog of subscription plans ────────────────────────────
CREATE TABLE subscription_plans (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code             TEXT NOT NULL UNIQUE,            -- 'pharmacy_pro'
  name             TEXT NOT NULL,
  business_types   TEXT[] NOT NULL DEFAULT '{}',    -- systems this plan covers ('{}' = all)
  price_monthly    NUMERIC(12,2) NOT NULL,
  price_semiannual NUMERIC(12,2) NOT NULL,
  price_annual     NUMERIC(12,2) NOT NULL,
  is_active        BOOLEAN NOT NULL DEFAULT true,
  sort             INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── One current subscription row per tenant (history lives in payments) ──
CREATE TABLE subscriptions (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id              UUID NOT NULL REFERENCES subscription_plans(id),
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('active','expired','cancelled')),
  current_period_start TIMESTAMPTZ NOT NULL DEFAULT now(),
  current_period_end   TIMESTAMPTZ NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_subscriptions_tenant ON subscriptions(tenant_id);

-- ── Payment attempts (idempotent via tx_ref / idempotency_key) ──
CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id         UUID REFERENCES subscription_plans(id),
  idempotency_key TEXT UNIQUE,                        -- client-supplied; prevents double checkout
  tx_ref          TEXT NOT NULL UNIQUE,               -- reference sent to provider (idempotency anchor)
  provider        TEXT NOT NULL DEFAULT 'chapa',      -- 'chapa' | 'manual' | 'mock'
  amount          NUMERIC(12,2) NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'ETB',
  period_months   INT NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','success','failed','refunded')),
  provider_ref    TEXT,                               -- provider's transaction id
  payer_email     TEXT,
  failure_reason  TEXT,
  meta            JSONB NOT NULL DEFAULT '{}'::jsonb,
  paid_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_tenant ON payments(tenant_id);
CREATE INDEX idx_payments_status ON payments(status);

-- ── Webhook inbox (accept-and-dedupe, never trust payload) ──────────────
CREATE TABLE payment_webhook_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider    TEXT NOT NULL,
  event_ref   TEXT,                                   -- best-effort provider event/tx reference
  payload     JSONB NOT NULL,
  processed   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Permissions for platform subscription billing ────────────
INSERT INTO permissions (id, name, description) VALUES
  (gen_random_uuid(), 'subscription.view',   'View subscription, plans and payment history'),
  (gen_random_uuid(), 'subscription.manage', 'Checkout, renew and manage the workspace subscription')
ON CONFLICT (name) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE r.name = 'owner' AND p.name IN ('subscription.view','subscription.manage')
ON CONFLICT DO NOTHING;

-- ── Seed plans per business system ───────────────────────────
INSERT INTO subscription_plans (code, name, business_types, price_monthly, price_semiannual, price_annual, sort) VALUES
  ('pharmacy_pro', 'Pharmacy Pro', '{pharmacy}', 1500.00,  8100.00, 14400.00, 10),
  ('store_pro',    'Store Pro',    '{store}',     900.00,  4800.00,  8600.00, 20),
  ('clinic_pro',   'Clinic Pro',   '{hospital}', 2500.00, 13500.00, 24000.00, 30),
  ('school_pro',   'School Pro',   '{school}',   1800.00,  9700.00, 17300.00, 40)
ON CONFLICT (code) DO NOTHING;
