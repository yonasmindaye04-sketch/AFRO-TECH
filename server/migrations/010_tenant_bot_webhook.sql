-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.7 — Tenant bot webhook mode (free-tier friendly)
-- Render/free-tier services sleep when idle, so long-polling stops.
-- Webhook mode: Telegram POSTs updates to our URL → wakes the service.
-- ═══════════════════════════════════════════════════════════

-- Perbot webhook secret — each tenant bot gets its own path segment,
-- so a leaked token only affects that one bot.
ALTER TABLE tenant_bots ADD COLUMN IF NOT EXISTS webhook_secret TEXT;
UPDATE tenant_bots SET webhook_secret = encode(gen_random_bytes(24), 'hex') WHERE webhook_secret IS NULL;
ALTER TABLE tenant_bots ALTER COLUMN webhook_secret SET DEFAULT encode(gen_random_bytes(24), 'hex');
ALTER TABLE tenant_bots ALTER COLUMN webhook_secret SET NOT NULL;

-- Track whether the bot is registered via webhook (vs. polling)
ALTER TABLE tenant_bots ADD COLUMN IF NOT EXISTS transport TEXT NOT NULL DEFAULT 'polling'
  CHECK (transport IN ('polling','webhook'));
