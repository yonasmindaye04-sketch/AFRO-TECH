-- ═══════════════════════════════════════════════════════════
-- AFRO Suite v1.2 — full PPR (Pharmacy ERP) feature parity
-- Pill-level selling, margins, structured returns, cash drawer
-- shifts, supplier payments, purchase reversal, income.
-- ═══════════════════════════════════════════════════════════

-- ── Pill selling on products (how medicines are counted) ────
ALTER TABLE products ADD COLUMN IF NOT EXISTS pills_per_unit INTEGER NOT NULL DEFAULT 1;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sell_by_pill BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN IF NOT EXISTS default_margin NUMERIC(5,2) NOT NULL DEFAULT 25;
-- Loose pill tracking (pills broken out of packs, FEFO)
ALTER TABLE products ADD COLUMN IF NOT EXISTS loose_pills INTEGER NOT NULL DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS loose_pills_batch_id UUID REFERENCES product_batches(id) ON DELETE SET NULL;

ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS margin_used NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS sold_as_pills BOOLEAN NOT NULL DEFAULT false;

-- Batch-level pricing + received date (prices can change per delivery)
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS selling_price NUMERIC(12,2);
ALTER TABLE product_batches ADD COLUMN IF NOT EXISTS received_date TIMESTAMPTZ NOT NULL DEFAULT now();

-- Purchase linkage to batches (needed for reversal on delete)
ALTER TABLE purchase_items ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES product_batches(id) ON DELETE SET NULL;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS discount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS tax NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS record_status TEXT NOT NULL DEFAULT 'Active';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS delete_reason TEXT;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS payment_terms INTEGER NOT NULL DEFAULT 30;

-- ── Structured returns (per PPR: reason + resalable logic) ──
CREATE TABLE sale_returns (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sale_id       UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id    UUID REFERENCES products(id) ON DELETE SET NULL,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  quantity      INTEGER NOT NULL,
  sold_as_pills BOOLEAN NOT NULL DEFAULT false,
  reason        TEXT NOT NULL CHECK (reason IN ('Damaged','Expired','WrongItem','CustomerReturn','Other')),
  refund_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  is_resalable  BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sale_returns_tenant ON sale_returns(tenant_id, created_at DESC);
CREATE INDEX idx_sale_returns_sale ON sale_returns(sale_id);

-- ── Cash drawer shifts (per PPR) ────────────────────────────
CREATE TABLE cash_drawer_shifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opening_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
  cash_sales      NUMERIC(12,2) NOT NULL DEFAULT 0,
  card_sales      NUMERIC(12,2) NOT NULL DEFAULT 0,
  mobile_sales    NUMERIC(12,2) NOT NULL DEFAULT 0,
  expenses        NUMERIC(12,2) NOT NULL DEFAULT 0,
  counted_cash    NUMERIC(12,2),
  expected_cash   NUMERIC(12,2),
  difference      NUMERIC(12,2),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opened_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at       TIMESTAMPTZ
);
CREATE INDEX idx_shifts_tenant ON cash_drawer_shifts(tenant_id, opened_at DESC);
CREATE INDEX idx_shifts_open ON cash_drawer_shifts(tenant_id, user_id, status);

-- ── Supplier payments ───────────────────────────────────────
CREATE TABLE supplier_payments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  supplier_id   UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  amount        NUMERIC(12,2) NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'cash',
  notes         TEXT,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_supplier_payments ON supplier_payments(tenant_id, supplier_id);

-- ── Other income (per PPR finance module) ───────────────────
CREATE TABLE income (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  category     TEXT NOT NULL DEFAULT 'General',
  description  TEXT,
  amount       NUMERIC(12,2) NOT NULL,
  income_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  user_id      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_income_tenant ON income(tenant_id, income_date DESC);

-- ── Managed categories (per PPR masters) ────────────────────
CREATE TABLE product_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id  UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, name)
);
