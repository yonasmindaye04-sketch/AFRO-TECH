-- ===========================================================
-- AFRO Suite v1.9 - Bot token encryption + tenant mini-app config
--  * tenant_bots.bot_token_enc holds AES-256-GCM ciphertext; the
--    legacy plaintext bot_token column is cleared on the next write
--  * per-tenant mini-app branding (theme colours, logo, currency)
-- Rows written before this migration keep plaintext in bot_token and
-- stay readable via COALESCE(bot_token_enc, bot_token).
-- ===========================================================

ALTER TABLE tenant_bots ADD COLUMN IF NOT EXISTS bot_token_enc TEXT;
ALTER TABLE tenant_bots ALTER COLUMN bot_token DROP NOT NULL;

-- Deep-link slug -> tenant. Lets a Mini App launched with
-- https://t.me/<bot>?startapp=<slug> resolve the store before auth.
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS bot_slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_bot_slug ON tenants(bot_slug) WHERE bot_slug IS NOT NULL;

-- Backfill: existing tenants keep their own slug as the deep-link value.
UPDATE tenants SET bot_slug = slug WHERE bot_slug IS NULL AND slug ~ '^[a-z0-9][a-z0-9-]{1,48}$';

-- Branding the Mini App renders before the user authenticates.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS brand JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS tenant_miniapp_sessions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  telegram_id  BIGINT,
  start_param  TEXT,
  resolved_via TEXT NOT NULL CHECK (resolved_via IN ('bot_token','start_param','fallback')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_miniapp_sessions_tenant ON tenant_miniapp_sessions(tenant_id, created_at DESC);