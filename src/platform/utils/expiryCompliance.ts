export type ExpiryUrgency = 'expired' | 'critical_30' | 'warning_60' | 'watch_90' | 'healthy'
export type ExpiryStatusFilter = 'all' | 'expired' | 'critical_30' | 'soon'

export interface ExpiryBatchItem {
  id: string
  batch_no: string
  expiry_date: string
  quantity: number
  cost_price: string | number
  product_id: string
  product_name: string
  category: string
  expired: boolean
  expiring_soon: boolean
  days_remaining?: number | null
  value_at_cost?: number
  urgency?: ExpiryUrgency
}

export const EXPIRY_WRITE_OFF_REASONS = [
  'Expired — disposed',
  'EFDA Batch Recall',
  'Damaged in storage',
  'Returned to supplier',
  'Other',
] as const

export function computeDaysRemaining(expiryDate: string | null | undefined, nowMs = Date.now()): number | null {
  if (!expiryDate) return null
  const clean = expiryDate.trim()
  if (!clean) return null
  const isoDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(clean)
  const ts = isoDateOnly ? Date.parse(`${clean}T23:59:59.999Z`) : Date.parse(clean)
  if (!Number.isFinite(ts)) return null
  return Math.ceil((ts - nowMs) / 86400000)
}

export function formatExpiryCountdown(
  batch: Pick<ExpiryBatchItem, 'expired' | 'expiry_date' | 'days_remaining'>,
  nowMs = Date.now()
): { label: string; tone: 'bad' | 'warn' | 'neutral' } {
  const days =
    typeof batch.days_remaining === 'number'
      ? batch.days_remaining
      : computeDaysRemaining(batch.expiry_date, nowMs)

  if (days === null) {
    return { label: batch.expired ? 'Expired' : 'No expiry date', tone: batch.expired ? 'bad' : 'neutral' }
  }
  if (days < 0) {
    const ago = Math.abs(days)
    return { label: `Expired ${ago}d ago`, tone: 'bad' }
  }
  if (days === 0) {
    return { label: 'Expires today', tone: 'bad' }
  }
  if (days <= 30) {
    return { label: `${days}d left (Critical)`, tone: 'warn' }
  }
  return { label: `${days}d left`, tone: days <= 90 ? 'warn' : 'neutral' }
}

export function filterExpiryBatches<T extends ExpiryBatchItem>(
  batches: readonly T[],
  options: { statusFilter: ExpiryStatusFilter; search: string },
  nowMs = Date.now()
): T[] {
  const q = options.search.trim().toLowerCase()
  return batches.filter((b) => {
    const days =
      typeof b.days_remaining === 'number'
        ? b.days_remaining
        : computeDaysRemaining(b.expiry_date, nowMs)

    if (options.statusFilter === 'expired' && !b.expired) return false
    if (options.statusFilter === 'critical_30' && (b.expired || days === null || days > 30)) return false
    if (options.statusFilter === 'soon' && b.expired) return false

    if (!q) return true
    return (
      b.product_name.toLowerCase().includes(q) ||
      b.batch_no.toLowerCase().includes(q) ||
      (b.category || '').toLowerCase().includes(q)
    )
  })
}

export interface ExpiryRiskSummary {
  totalBatches: number
  expiredCount: number
  critical30Count: number
  expiredUnits: number
  atRiskUnits: number
  expiredValue: number
  atRiskValue: number
}

export function summarizeExpiryRisk(
  batches: readonly ExpiryBatchItem[],
  nowMs = Date.now()
): ExpiryRiskSummary {
  let expiredCount = 0
  let critical30Count = 0
  let expiredUnits = 0
  let atRiskUnits = 0
  let expiredValue = 0
  let atRiskValue = 0

  for (const b of batches) {
    const qty = Math.max(0, Number(b.quantity || 0))
    const val =
      typeof b.value_at_cost === 'number'
        ? b.value_at_cost
        : qty * Math.max(0, Number(b.cost_price || 0))
    const days =
      typeof b.days_remaining === 'number'
        ? b.days_remaining
        : computeDaysRemaining(b.expiry_date, nowMs)

    if (b.expired) {
      expiredCount += 1
      expiredUnits += qty
      expiredValue += val
    } else {
      atRiskUnits += qty
      atRiskValue += val
      if (days !== null && days <= 30) {
        critical30Count += 1
      }
    }
  }

  return {
    totalBatches: batches.length,
    expiredCount,
    critical30Count,
    expiredUnits,
    atRiskUnits,
    expiredValue: Number(expiredValue.toFixed(2)),
    atRiskValue: Number(atRiskValue.toFixed(2)),
  }
}
