const DAY_MS = 86400000;

export function parseExpiryTimestamp(expiryDate) {
  if (!expiryDate) return null;
  const str = String(expiryDate).trim();
  if (!str) return null;
  // Treat YYYY-MM-DD as end of that UTC day so a batch expiring today is still valid until day closes,
  // unless an explicit ISO timestamp was provided.
  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(str);
  const ts = isoDateOnly ? Date.parse(`${str}T23:59:59.999Z`) : Date.parse(str);
  return Number.isFinite(ts) ? ts : null;
}

export function isBatchExpired(batch, nowMs = Date.now()) {
  const expTs = parseExpiryTimestamp(batch?.expiry_date);
  return expTs !== null && expTs < nowMs;
}

export function computeDaysRemaining(expiryDate, nowMs = Date.now()) {
  const expTs = parseExpiryTimestamp(expiryDate);
  if (expTs === null) return null;
  return Math.ceil((expTs - nowMs) / DAY_MS);
}

export function enrichBatchCompliance(batch, nowMs = Date.now(), windowDays = 90) {
  const qty = Math.max(0, Number(batch?.quantity || 0));
  const unitCost = Math.max(0, Number(batch?.cost_price || 0));
  const daysRemaining = computeDaysRemaining(batch?.expiry_date, nowMs);
  const expired = daysRemaining !== null && daysRemaining < 0;
  const expiringSoon =
    daysRemaining !== null && !expired && daysRemaining <= Math.max(1, Number(windowDays || 90));

  let urgency = 'healthy';
  if (expired) urgency = 'expired';
  else if (daysRemaining !== null && daysRemaining <= 30) urgency = 'critical_30';
  else if (daysRemaining !== null && daysRemaining <= 60) urgency = 'warning_60';
  else if (daysRemaining !== null && daysRemaining <= 90) urgency = 'watch_90';

  return {
    ...batch,
    quantity: qty,
    days_remaining: daysRemaining,
    value_at_cost: Number((qty * unitCost).toFixed(2)),
    expired,
    expiring_soon: expiringSoon,
    urgency,
  };
}

export function recomputeProductBatchMetrics(product, allBatches, nowMs = Date.now()) {
  if (!product) return product;
  const prodBatches = (allBatches || []).filter(
    (b) => b.product_id === product.id && Number(b.quantity || 0) > 0
  );

  if (prodBatches.length === 0) {
    const cleanStock = Math.max(0, Number(product.stock || 0));
    product.stock = cleanStock;
    product.sellable_stock = cleanStock;
    product.expired_qty = 0;
    product.expiring_soon = 0;
    product.display_stock = product.sell_by_pill
      ? cleanStock * Math.max(1, Number(product.pills_per_unit || 1))
      : cleanStock;
    return product;
  }

  let sellableUnits = 0;
  let expiredUnits = 0;
  let expiringSoonUnits = 0;

  for (const b of prodBatches) {
    const q = Math.max(0, Number(b.quantity || 0));
    const days = computeDaysRemaining(b.expiry_date, nowMs);
    if (days !== null && days < 0) {
      expiredUnits += q;
    } else {
      sellableUnits += q;
      if (days !== null && days <= 90) {
        expiringSoonUnits += q;
      }
    }
  }

  product.stock = sellableUnits;
  product.sellable_stock = sellableUnits;
  product.expired_qty = expiredUnits;
  product.expiring_soon = expiringSoonUnits;
  product.display_stock = product.sell_by_pill
    ? sellableUnits * Math.max(1, Number(product.pills_per_unit || 1))
    : sellableUnits;
  return product;
}

export function allocateFefoBatches(allBatches, productId, neededUnits, nowMs = Date.now()) {
  const qtyNeeded = Math.max(0, Math.ceil(Number(neededUnits || 0)));
  if (qtyNeeded === 0) {
    return { ok: true, allocations: [], totalDeducted: 0, hasTrackedBatches: false };
  }

  const productBatches = (allBatches || []).filter(
    (b) => b.product_id === productId && Number(b.quantity || 0) > 0
  );

  if (productBatches.length === 0) {
    return { ok: true, allocations: [], totalDeducted: 0, hasTrackedBatches: false };
  }

  const nonExpired = productBatches
    .filter((b) => !isBatchExpired(b, nowMs))
    .sort((a, b) => {
      const tsA = parseExpiryTimestamp(a.expiry_date);
      const tsB = parseExpiryTimestamp(b.expiry_date);
      if (tsA !== null && tsB !== null && tsA !== tsB) return tsA - tsB;
      if (tsA !== null && tsB === null) return -1;
      if (tsA === null && tsB !== null) return 1;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });

  const sellableAvailable = nonExpired.reduce((sum, b) => sum + Number(b.quantity || 0), 0);
  const expiredAvailable = productBatches
    .filter((b) => isBatchExpired(b, nowMs))
    .reduce((sum, b) => sum + Number(b.quantity || 0), 0);

  if (sellableAvailable < qtyNeeded) {
    return {
      ok: false,
      error:
        expiredAvailable > 0
          ? `Only ${sellableAvailable} non-expired unit(s) available (${expiredAvailable} expired unit(s) blocked by FEFO guard — write off expired batches first).`
          : `Insufficient batch stock (${sellableAvailable} available, ${qtyNeeded} requested).`,
      sellableAvailable,
      expiredAvailable,
      allocations: [],
      totalDeducted: 0,
      hasTrackedBatches: true,
    };
  }

  let remaining = qtyNeeded;
  const allocations = [];
  for (const batch of nonExpired) {
    if (remaining <= 0) break;
    const take = Math.min(remaining, Number(batch.quantity || 0));
    if (take > 0) {
      batch.quantity = Number(batch.quantity) - take;
      remaining -= take;
      allocations.push({
        batch_id: batch.id,
        batch_no: batch.batch_no,
        expiry_date: batch.expiry_date || null,
        qty: take,
      });
    }
  }

  return {
    ok: true,
    allocations,
    totalDeducted: qtyNeeded,
    hasTrackedBatches: true,
  };
}
