-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.6 — Subscription plan details
-- Adds description + feature list to each plan so customers
-- know exactly what they are subscribing to. One plan per
-- business type; the choice is the billing period
-- (1 / 6 / 12 months), presented as cards in the UI.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT '{}';

-- ── Enrich existing plans (codes + prices unchanged, so active
--    subscriptions are unaffected) ───────────────────────────
UPDATE subscription_plans SET
  description = 'The complete pharmacy workflow — POS, batches & everything else',
  features = ARRAY[
    'POS & pill-level selling',
    'Batch & expiry tracking (FEFO)',
    'Purchase orders & suppliers',
    'Low-stock & expiry alerts',
    'Daily & monthly reports',
    'Telegram notifications'
  ]
WHERE code = 'pharmacy_pro';

UPDATE subscription_plans SET
  description = 'The complete retail workflow — fast POS, stock & reports',
  features = ARRAY[
    'Fast POS checkout',
    'Products & stock tracking',
    'Purchases & supplier tracking',
    'Low-stock alerts',
    'Daily & monthly reports',
    'Telegram notifications'
  ]
WHERE code = 'store_pro';

UPDATE subscription_plans SET
  description = 'The complete clinic workflow — patients, labs & billing',
  features = ARRAY[
    'Patient registration & records',
    'Appointments & scheduling',
    'Lab tests & vitals',
    'Invoices & patient payments',
    'Medical record search',
    'Telegram notifications'
  ]
WHERE code = 'clinic_pro';

UPDATE subscription_plans SET
  description = 'The complete school workflow — students, grades & fees',
  features = ARRAY[
    'Students & classes',
    'Attendance tracking',
    'Fees & payment tracking',
    'Timetable & subjects',
    'Grade reports & report cards',
    'Guardian notifications (SMS / Telegram)'
  ]
WHERE code = 'school_pro';
