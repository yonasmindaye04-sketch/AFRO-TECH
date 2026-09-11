-- ════════════════════════════════════════════════════════════
-- AFRO Suite — Notification Templates (DB-stored, editable)
-- Template rendering uses simple {{variable}} substitution
-- ════════════════════════════════════════════════════════════

CREATE TABLE notification_templates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  code            TEXT NOT NULL,              -- e.g., 'appointment_reminder', 'lab_result_ready', 'fee_due'
  name            TEXT NOT NULL,              -- human-readable
  channel         TEXT NOT NULL CHECK (channel IN ('telegram','email','both')),
  subject         TEXT,                       -- for email
  body            TEXT NOT NULL,              -- template with {{variable}} placeholders
  variables       JSONB NOT NULL DEFAULT '[]'::jsonb,  -- documented variable names: ['patient_name','appointment_time',...]
  is_system       BOOLEAN NOT NULL DEFAULT false,  -- system templates cannot be deleted
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, code)
);
CREATE INDEX idx_notification_templates_tenant ON notification_templates(tenant_id);
CREATE INDEX idx_notification_templates_code ON notification_templates(code);

-- ── Seed system templates (is_system=true) ──
INSERT INTO notification_templates (id, tenant_id, code, name, channel, subject, body, variables, is_system, is_active) VALUES
  -- Hospital: appointment reminder
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'appointment_reminder', 'Appointment Reminder', 'both',
   'Appointment Reminder — {{patient_name}}',
   'Dear {{patient_name}},\n\nReminder: You have an appointment with Dr. {{doctor_name}} on {{appointment_date}} at {{appointment_time}}.\nReason: {{reason}}\n\nPlease arrive 10 minutes early.\n\n{{clinic_name}}',
   '["patient_name","doctor_name","appointment_date","appointment_time","reason","clinic_name"]'::jsonb, true, true),

  -- Hospital: lab result ready
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'lab_result_ready', 'Lab Result Ready', 'both',
   'Lab Result Available — {{patient_name}}',
   'Dear {{patient_name}},\n\nYour {{test_name}} result is ready.\nResult: {{result_value}}\nNormal range: {{normal_range}}\n\nPlease consult your doctor for interpretation.\n\n{{clinic_name}}',
   '["patient_name","test_name","result_value","normal_range","clinic_name"]'::jsonb, true, true),

  -- School: fee due reminder
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'fee_due', 'Fee Due Reminder', 'both',
   'Fee Due Reminder — {{student_name}}',
   'Dear {{guardian_name}},\n\nThis is a reminder that the fee "{{fee_title}}" for {{student_name}} is due.\nAmount: {{amount}} ETB\nPaid: {{paid_amount}} ETB\nOutstanding: {{outstanding}} ETB\nDue date: {{due_date}}\n\nPlease arrange payment at your earliest convenience.\n\n{{school_name}}',
   '["guardian_name","student_name","fee_title","amount","paid_amount","outstanding","due_date","school_name"]'::jsonb, true, true),

  -- School: fee payment receipt
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'fee_receipt', 'Fee Payment Receipt', 'both',
   'Payment Receipt — {{student_name}}',
   'Dear {{guardian_name}},\n\nThank you for your payment of {{amount_paid}} ETB towards "{{fee_title}}" for {{student_name}}.\nTotal: {{total_amount}} ETB\nPaid: {{paid_amount}} ETB\nBalance: {{balance}} ETB\nDate: {{payment_date}}\n\n{{school_name}}',
   '["guardian_name","student_name","fee_title","total_amount","paid_amount","amount_paid","balance","payment_date","school_name"]'::jsonb, true, true),

  -- Retail/Pharmacy: order ready for pickup
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'order_ready', 'Order Ready for Pickup', 'both',
   'Your Order is Ready — {{customer_name}}',
   'Hi {{customer_name}},\n\nYour order #{{order_number}} is ready for pickup.\nItems: {{items_summary}}\nTotal: {{total_amount}} ETB\n\nPlease collect at {{store_name}} during business hours.\n\n{{store_name}}',
   '["customer_name","order_number","items_summary","total_amount","store_name"]'::jsonb, true, true),

  -- Retail/Pharmacy: low stock alert
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'low_stock_alert', 'Low Stock Alert', 'telegram',
   '⚠️ Low Stock Alert',
   '⚠️ <b>{{business_name}} — Low Stock</b>\n\n{{#each items}}\n• {{name}} — {{sellable}} left (min {{threshold}})\n{{/each}}\n\nOpen the app to reorder or write off.',
   '["business_name","items"]'::jsonb, true, true),

  -- Retail/Pharmacy: expiring soon alert
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'expiring_alert', 'Expiring Soon Alert', 'telegram',
   '⏳ Expiring Soon Alert',
   '⏳ <b>{{business_name}} — Expiring Soon</b>\n\n{{#each items}}\n• {{name}} — {{quantity}} units, expires {{expiry_date}}\n{{/each}}\n\nOpen the app to write off or discount.',
   '["business_name","items"]'::jsonb, true, true),

  -- Generic: order created (for internal staff)
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'order_created', 'New Service Order', 'telegram',
   '📋 New {{order_type}} Order',
   'A new {{order_type}} order has been created for <b>{{patient_name}}</b>.\nDepartment: {{department_name}}\nDetails: {{details}}\n\nOpen the department queue to process.',
   '["order_type","patient_name","department_name","details"]'::jsonb, true, true),

  -- Generic: order completed (notify ordering doctor)
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'order_completed', 'Service Order Completed', 'telegram',
   '✅ Order Completed — {{patient_name}}',
   'The {{order_type}} order for <b>{{patient_name}}</b> has been completed.\nResult: {{result_summary}}\n\nReview in the patient journey.',
   '["order_type","patient_name","result_summary"]'::jsonb, true, true),

  -- Generic: long wait escalation
  (gen_random_uuid(), '00000000-0000-0000-0000-000000000000', 'long_wait_escalation', 'Long Wait Escalation', 'telegram',
   '⏳ Long Wait Alert',
   'Patient <b>{{patient_name}}</b> has been waiting {{minutes}} minutes in {{department_name}}.\n\nPlease attend.',
   '["patient_name","minutes","department_name"]'::jsonb, true, true)
ON CONFLICT (tenant_id, code) DO NOTHING;

-- Note: The above seeds use a dummy tenant_id '00000000-0000-0000-0000-000000000000'
-- Actual per-tenant copies will be created on tenant registration via seed script.
-- See server/src/scripts/seed.ts for the per-tenant copy logic.