-- ===========================================================
-- AFRO Suite v1.8 - Tenant-bot improvements ported from yekis:
--  * per-subscriber language preference (Amharic / English)
--  * lightweight conversation state (pending action per chat)
--  * payment receipt intake (customers submit a payment proof
--    photo to the tenant bot; staff review it in Bot Studio)
-- Existing tables (tenant_bots/bot_subscribers/bot_broadcasts)
-- come from 009_tenant_bots.sql.
-- ===========================================================

ALTER TABLE bot_subscribers
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'am'));

-- Single-slot scene state per subscriber (e.g. 'awaiting_receipt').
-- Freed after the next qualifying message or after expiry.
ALTER TABLE bot_subscribers
  ADD COLUMN IF NOT EXISTS pending_action TEXT;

-- Receipt / proof-of-payment images customers send to the bot
CREATE TABLE IF NOT EXISTS bot_receipt_submissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id       UUID NOT NULL REFERENCES tenant_bots(id) ON DELETE CASCADE,
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chat_id      BIGINT NOT NULL,
  sender_name  TEXT,
  file_id      TEXT NOT NULL,                    -- Telegram file_id (re-downloadable via getFile)
  caption      TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','rejected')),
  reviewed_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  review_note  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bot_receipts_bot ON bot_receipt_submissions(bot_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_receipts_tenant ON bot_receipt_submissions(tenant_id);
