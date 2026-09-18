-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.6 — Three-tier subscription plans
-- Adds description + feature list to every plan and seeds a
-- Starter / Pro / Premium ladder for each business type, so
-- customers see 3 clear choices with details when subscribing.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE subscription_plans
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS features TEXT[] NOT NULL DEFAULT '{}';

-- ── Enrich existing Pro plans (kept: codes + prices unchanged,
--    so active subscriptions are unaffected) ─────────────────
UPDATE subscription_plans SET
  description = 'For growing pharmacies that need the full workflow',
  features = ARRAY[
    'Everything in Starter',
    'Batch & expiry tracking (FEFO)',
    'Purchase orders & suppliers',
    'Up to 10 users',
    'Low-stock & expiry alerts',
    'Telegram notifications'
  ]
WHERE code = 'pharmacy_pro';

UPDATE subscription_plans SET
  description = 'For growing stores that need the full workflow',
  features = ARRAY[
    'Everything in Starter',
    'Purchases & supplier tracking',
    'Up to 10 users',
    'Low-stock alerts',
    'Daily & monthly reports',
    'Telegram notifications'
  ]
WHERE code = 'store_pro';

UPDATE subscription_plans SET
  description = 'For clinics that need the full patient workflow',
  features = ARRAY[
    'Everything in Starter',
    'Lab tests & vitals',
    'Invoices & patient payments',
    'Up to 10 users',
    'Medical record search',
    'Telegram notifications'
  ]
WHERE code = 'clinic_pro';

UPDATE subscription_plans SET
  description = 'For schools that need the full academic workflow',
  features = ARRAY[
    'Everything in Starter',
    'Fees & payment tracking',
    'Timetable & subjects',
    'Up to 10 users',
    'Grade reports & report cards',
    'Guardian notifications (SMS / Telegram)'
  ]
WHERE code = 'school_pro';

-- ── Seed Starter + Premium tiers around each Pro plan ────────
INSERT INTO subscription_plans
  (code, name, business_types, price_monthly, price_semiannual, price_annual, sort, description, features) VALUES
  -- Pharmacy
  ('pharmacy_starter', 'Pharmacy Starter', '{pharmacy}', 900.00, 4800.00, 8600.00, 9,
    'Everything a small pharmacy needs to get started',
    ARRAY[
      'POS & pill-level selling',
      'Products & stock basics',
      'Up to 3 users',
      'Daily sales reports',
      'Email support'
    ]),
  ('pharmacy_premium', 'Pharmacy Premium', '{pharmacy}', 2400.00, 12900.00, 23000.00, 11,
    'The complete suite for high-volume pharmacies',
    ARRAY[
      'Everything in Pro',
      'Multi-location & stock transfers',
      'Marketing suite (SMS, email, WhatsApp)',
      'Unlimited users',
      'Priority support'
    ]),
  -- Store
  ('store_starter', 'Store Starter', '{store}', 550.00, 3000.00, 5400.00, 19,
    'Everything a small shop needs to get started',
    ARRAY[
      'Fast POS checkout',
      'Products & stock basics',
      'Up to 3 users',
      'Daily sales reports',
      'Email support'
    ]),
  ('store_premium', 'Store Premium', '{store}', 1450.00, 7800.00, 13900.00, 21,
    'The complete suite for growing retail businesses',
    ARRAY[
      'Everything in Pro',
      'Multi-location & stock transfers',
      'Marketing suite (SMS, email, WhatsApp)',
      'Unlimited users',
      'Priority support'
    ]),
  -- Clinic / Hospital
  ('clinic_starter', 'Clinic Starter', '{hospital}', 1500.00, 8100.00, 14500.00, 29,
    'Everything a small clinic needs to get started',
    ARRAY[
      'Patient registration',
      'Appointments & scheduling',
      'Up to 3 users',
      'Basic visit reports',
      'Email support'
    ]),
  ('clinic_premium', 'Clinic Premium', '{hospital}', 4000.00, 21600.00, 38500.00, 31,
    'The complete suite for busy clinics & hospitals',
    ARRAY[
      'Everything in Pro',
      'Departments, visits & service orders',
      'Marketing suite (SMS, email, WhatsApp)',
      'Unlimited users',
      'Priority support'
    ]),
  -- School
  ('school_starter', 'School Starter', '{school}', 1100.00, 5900.00, 10500.00, 39,
    'Everything a small school needs to get started',
    ARRAY[
      'Students & classes',
      'Attendance tracking',
      'Up to 3 users',
      'Basic academic reports',
      'Email support'
    ]),
  ('school_premium', 'School Premium', '{school}', 2900.00, 15600.00, 27700.00, 41,
    'The complete suite for institutions that want it all',
    ARRAY[
      'Everything in Pro',
      'Announcements & guardian portal',
      'Marketing suite (SMS, email, WhatsApp)',
      'Unlimited users',
      'Priority support'
    ])
ON CONFLICT (code) DO NOTHING;
