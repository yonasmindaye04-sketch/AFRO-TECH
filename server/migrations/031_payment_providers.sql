-- ===========================================================
-- AFRO Suite v1.7 - Payment providers ported from yekis:
-- Telebirr, M-Pesa (Safaricom ET) and CBE Birr alongside Chapa.
-- The payments.provider / payments.provider_ref columns already
-- exist (008_billing.sql); this migration only documents the new
-- provider values and adds indexes used by the Telebirr webhook
-- (merch_order_id -> payment) and the reconciliation sweep.
-- ===========================================================

COMMENT ON COLUMN payments.provider IS 'chapa | telebirr | mpesa | cbe | manual | mock';

-- Webhook lookup: Telebirr notifies with merch_order_id stored in provider_ref
CREATE INDEX IF NOT EXISTS idx_payments_provider_ref ON payments(provider_ref) WHERE provider_ref IS NOT NULL;

-- Reconciliation sweep scans pending telebirr/mpesa rows
CREATE INDEX IF NOT EXISTS idx_payments_pending_provider ON payments(provider, created_at) WHERE status = 'pending';
