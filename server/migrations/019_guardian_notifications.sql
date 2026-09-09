-- Migration 019: Guardian notification channels (Email + Telegram)

-- 1. Extend students table with guardian email and telegram credentials
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS guardian_email TEXT,
  ADD COLUMN IF NOT EXISTS guardian_telegram_chat_id TEXT,
  ADD COLUMN IF NOT EXISTS guardian_telegram_username TEXT;

CREATE INDEX IF NOT EXISTS idx_students_guardian_email ON students(tenant_id, guardian_email) WHERE guardian_email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_guardian_telegram ON students(tenant_id, guardian_telegram_chat_id) WHERE guardian_telegram_chat_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_code_search ON students(code);

-- 2. Extend announcements table with audience targeting and delivery tracking
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS target_type TEXT NOT NULL DEFAULT 'all' CHECK (target_type IN ('all', 'class', 'staff')),
  ADD COLUMN IF NOT EXISTS class_id UUID REFERENCES classes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sent_email BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sent_telegram BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_stats JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Guardian notifications audit & delivery log
CREATE TABLE IF NOT EXISTS guardian_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id UUID REFERENCES students(id) ON DELETE SET NULL,
  channel TEXT NOT NULL CHECK (channel IN ('email', 'telegram')),
  recipient TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped', 'simulated')),
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_guardian_notif_tenant ON guardian_notifications(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_guardian_notif_student ON guardian_notifications(student_id);
