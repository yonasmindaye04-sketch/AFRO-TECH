-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.6 — Tenant-branded Telegram bots (marketing)
-- Each tenant can have their own BotFather bot for promotions,
-- broadcasts and customer engagement.
-- ═══════════════════════════════════════════════════════════

-- The tenant's own bot identity + configuration
CREATE TABLE tenant_bots (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id             UUID NOT NULL UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
  bot_token             TEXT NOT NULL,                       -- BotFather token (never sent to client)
  bot_id                BIGINT,                              -- numeric Telegram bot id
  bot_username          TEXT NOT NULL,
  display_name          TEXT,
  description           TEXT,
  welcome_message       TEXT NOT NULL DEFAULT 'Welcome! Send /start to subscribe to our updates.',
  commands              JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{trigger:'/offer', response:'text'}]
  auto_reply            BOOLEAN NOT NULL DEFAULT true,
  is_active             BOOLEAN NOT NULL DEFAULT false,      -- enabled by owner after entering token
  broadcast_limit_per_day INT NOT NULL DEFAULT 3,
  last_broadcast_at     TIMESTAMPTZ,
  total_subscribers     INT NOT NULL DEFAULT 0,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_tenant_bots_tenant ON tenant_bots(tenant_id);

-- People who have spoken to the tenant's bot — marketing audience
CREATE TABLE bot_subscribers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id          UUID NOT NULL REFERENCES tenant_bots(id) ON DELETE CASCADE,
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  chat_id         BIGINT NOT NULL,                           -- Telegram chat / user id
  username        TEXT,
  first_name      TEXT,
  last_name       TEXT,
  is_active       BOOLEAN NOT NULL DEFAULT true,             -- false after /stop or block
  subscribed_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at    TIMESTAMPTZ,
  UNIQUE(bot_id, chat_id)
);
CREATE INDEX idx_bot_subscribers_bot ON bot_subscribers(bot_id);
CREATE INDEX idx_bot_subscribers_tenant ON bot_subscribers(tenant_id);

-- Broadcast history (each send attempt logged)
CREATE TABLE bot_broadcasts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_id      UUID NOT NULL REFERENCES tenant_bots(id) ON DELETE CASCADE,
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sent_by     UUID REFERENCES users(id) ON DELETE SET NULL,
  message     TEXT NOT NULL,
  recipients  INT NOT NULL DEFAULT 0,                         -- claimed count when sent
  delivered   INT NOT NULL DEFAULT 0,
  failed      INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sending','sent','failed')),
  error       TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bot_broadcasts_bot ON bot_broadcasts(bot_id);

-- Persistent getUpdates offset so restarts don't replay old updates
CREATE TABLE bot_polling_state (
  bot_id        UUID PRIMARY KEY REFERENCES tenant_bots(id) ON DELETE CASCADE,
  last_update_id BIGINT NOT NULL DEFAULT 0,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
