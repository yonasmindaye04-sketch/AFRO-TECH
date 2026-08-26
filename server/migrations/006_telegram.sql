-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.3 — Telegram bot + Mini App integration
-- ═══════════════════════════════════════════════════════════

ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_linked_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_telegram ON users(telegram_chat_id) WHERE telegram_chat_id IS NOT NULL;

-- Short-lived codes that link a Telegram chat to a platform user
CREATE TABLE IF NOT EXISTS telegram_link_codes (
  code       TEXT PRIMARY KEY,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
