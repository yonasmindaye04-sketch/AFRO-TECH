-- sale_items needs the batch reference for FEFO refunds
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS batch_id UUID REFERENCES product_batches(id) ON DELETE SET NULL;
