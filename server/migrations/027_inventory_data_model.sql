-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.3 — Multi-tenant inventory & product data model
-- Variant-aware inventory with locations, batches (FEFO), stock
-- ledger (stock_movements), purchasing, transfers, adjustments,
-- and short-lived checkout reservations.
--
-- RLS: ENABLE + FORCE + tenant-isolation policy applied to every
-- NEW table below. Legacy tables are covered separately by
-- 028_legacy_table_rls.sql.disabled — rename it to .sql ONLY after
-- the request middleware sets app.tenant_id via set_config(),
-- otherwise every legacy query will return zero rows (FORCE
-- applies RLS even to the table owner role).
--
-- Policy note: current_setting('app.tenant_id', true) returns NULL
-- when the setting is absent instead of erroring; NULL comparison
-- simply filters all rows out, which is the safe failure mode.
-- ═══════════════════════════════════════════════════════════

-- ── Extend existing tables ──────────────────────────────────

-- Per-vertical feature flag (batch/FEFO module on/off)
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS batch_tracking_enabled BOOLEAN NOT NULL DEFAULT false;

-- products: add spec columns. `sku` stays nullable because existing
-- rows have no SKU; the partial unique index below still guarantees
-- no duplicate (tenant_id, sku) once SKUs are backfilled.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS sku TEXT,
  ADD COLUMN IF NOT EXISTS uom TEXT NOT NULL DEFAULT 'unit',
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reorder_level NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS attrs JSONB NOT NULL DEFAULT '{}';

CREATE UNIQUE INDEX IF NOT EXISTS products_tenant_sku_uq
  ON products (tenant_id, sku)
  WHERE sku IS NOT NULL;

-- product_categories: hierarchical support
ALTER TABLE product_categories
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES product_categories(id);

-- ── New tables ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS product_variants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  sku        TEXT,
  barcode    TEXT,
  options    JSONB NOT NULL DEFAULT '{}',
  UNIQUE (tenant_id, sku)
);

CREATE TABLE IF NOT EXISTS locations (
  id        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name      TEXT NOT NULL,
  type      TEXT NOT NULL DEFAULT 'default'
);

-- stock_adjustments (existing, from 003): align with the new
-- location-aware, itemized adjustment model. Must run after
-- locations exists because of the FK.
ALTER TABLE stock_adjustments
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES locations(id),
  ADD COLUMN IF NOT EXISTS created_by UUID;

-- variant_id is nullable (products without variants). A plain UNIQUE
-- constraint would NOT protect against duplicate rows when
-- variant_id IS NULL (Postgres treats NULL <> NULL in uniqueness
-- checks), so two partial unique indexes close the gap.
CREATE TABLE IF NOT EXISTS inventory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id  UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  on_hand     NUMERIC(14,2) NOT NULL DEFAULT 0,
  reserved    NUMERIC(14,2) NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_no_variant_uq
  ON inventory (tenant_id, location_id, product_id)
  WHERE variant_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS inventory_with_variant_uq
  ON inventory (tenant_id, location_id, product_id, variant_id)
  WHERE variant_id IS NOT NULL;

-- batch_id on stock_movements is what makes FEFO joins possible
-- (expiry_date lives on batches, not on movement rows).
CREATE TABLE IF NOT EXISTS batches (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_number TEXT NOT NULL,
  expiry_date  DATE,
  mfg_date     DATE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, product_id, batch_number)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id    UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id     UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  batch_id       UUID REFERENCES batches(id) ON DELETE SET NULL,
  quantity       NUMERIC(14,2) NOT NULL,  -- signed: +receipt, -sale
  movement_type  TEXT NOT NULL,           -- PURCHASE_RECEIPT, SALE, TRANSFER_IN, TRANSFER_OUT, ADJUSTMENT_IN, ADJUSTMENT_OUT, EXPIRED, DAMAGE
  reference_type TEXT,                    -- ORDER, PURCHASE_RECEIPT, TRANSFER, ADJUSTMENT
  reference_id   UUID,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS purchase_orders (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  status      TEXT NOT NULL DEFAULT 'draft', -- draft, submitted, partially_received, received, cancelled
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- qty_received enables partial-fulfillment tracking across
-- multiple receipts against a single PO.
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id          UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id  UUID NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  product_id         UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  qty_ordered        NUMERIC(14,2) NOT NULL,
  qty_received       NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost          NUMERIC(12,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_order_id UUID REFERENCES purchase_orders(id) ON DELETE SET NULL,
  location_id       UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by        UUID
);

CREATE TABLE IF NOT EXISTS purchase_receipt_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  purchase_receipt_id  UUID NOT NULL REFERENCES purchase_receipts(id) ON DELETE CASCADE,
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  batch_id             UUID REFERENCES batches(id) ON DELETE SET NULL,
  qty_received         NUMERIC(14,2) NOT NULL,
  unit_cost            NUMERIC(12,2)
);

CREATE TABLE IF NOT EXISTS stock_transfers (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id        UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  from_location_id UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  to_location_id   UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  status           TEXT NOT NULL DEFAULT 'requested', -- requested, approved, in_transit, received, cancelled
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stock_transfer_id UUID NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id        UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id        UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  batch_id          UUID REFERENCES batches(id) ON DELETE SET NULL,
  quantity          NUMERIC(14,2) NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustment_items (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id            UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  stock_adjustment_id  UUID NOT NULL REFERENCES stock_adjustments(id) ON DELETE CASCADE,
  product_id           UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id           UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  batch_id             UUID REFERENCES batches(id) ON DELETE SET NULL,
  qty_before           NUMERIC(14,2) NOT NULL,
  qty_after            NUMERIC(14,2) NOT NULL
);

-- Short-lived holds during checkout for Pharmacy/Store POS or
-- online ordering. Expired holds are swept by the expiry job.
CREATE TABLE IF NOT EXISTS stock_reservations (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  location_id    UUID NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  variant_id     UUID REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity       NUMERIC(14,2) NOT NULL,
  status         TEXT NOT NULL DEFAULT 'active', -- active, consumed, released, expired
  reference_type TEXT,                           -- ORDER
  reference_id   UUID,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_inventory_lookup
  ON inventory (tenant_id, product_id, location_id);

CREATE INDEX IF NOT EXISTS idx_movements_lookup
  ON stock_movements (tenant_id, product_id, location_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_movements_batch
  ON stock_movements (batch_id) WHERE batch_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_batches_expiry
  ON batches (product_id, expiry_date) WHERE expiry_date IS NOT NULL;

-- Partial index: keeps the reservation expiry-sweep cheap at scale
-- (only ever scans active holds).
CREATE INDEX IF NOT EXISTS idx_reservations_expiry
  ON stock_reservations (expires_at) WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_products_reorder
  ON products (tenant_id) WHERE is_active;

-- ── Row-Level Security (new tables only) ────────────────────
-- FORCE matters: without it the table owner (often the app's DB
-- role) bypasses RLS entirely.

ALTER TABLE product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_variants FORCE ROW LEVEL SECURITY;
CREATE POLICY product_variants_tenant_iso ON product_variants
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE locations FORCE ROW LEVEL SECURITY;
CREATE POLICY locations_tenant_iso ON locations
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory FORCE ROW LEVEL SECURITY;
CREATE POLICY inventory_tenant_iso ON inventory
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE batches FORCE ROW LEVEL SECURITY;
CREATE POLICY batches_tenant_iso ON batches
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_movements FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_movements_tenant_iso ON stock_movements
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_orders FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_tenant_iso ON purchase_orders
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE purchase_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_order_items FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_order_items_tenant_iso ON purchase_order_items
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE purchase_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_receipts_tenant_iso ON purchase_receipts
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE purchase_receipt_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE purchase_receipt_items FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_receipt_items_tenant_iso ON purchase_receipt_items
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_transfers_tenant_iso ON stock_transfers
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_transfer_items FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_transfer_items_tenant_iso ON stock_transfer_items
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE stock_adjustment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_adjustment_items FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_adjustment_items_tenant_iso ON stock_adjustment_items
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);

ALTER TABLE stock_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_reservations_tenant_iso ON stock_reservations
  USING (tenant_id = current_setting('app.tenant_id', true)::UUID);
