export type LowStockMode = 'global' | 'per_product'
export type StockHealthLevel = 'out_of_stock' | 'low_stock' | 'in_stock'

export interface StockMonitorInput {
  id: string
  name: string
  category?: string | null
  unit?: string | null
  stock: number
  low_stock_threshold?: number | null
}

export interface EvaluatedStockStatus {
  id: string
  name: string
  category: string
  unit: string
  quantity: number
  threshold: number
  deficit: number
  level: StockHealthLevel
  isBelowThreshold: boolean
  isOutOfStock: boolean
}

export interface LowStockNotificationItem {
  id: string
  productId: string
  productName: string
  quantity: number
  threshold: number
  deficit: number
  unit: string
  severity: 'bad' | 'warn'
  title: string
  detail: string
}

export interface LowStockSummary {
  totalProducts: number
  lowStockCount: number
  outOfStockCount: number
  alertCount: number
  healthyCount: number
  activeThreshold: number
  mode: LowStockMode
  alerts: LowStockNotificationItem[]
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 10

export function normalizeThreshold(value: unknown, fallback = DEFAULT_LOW_STOCK_THRESHOLD): number {
  if (value === null || value === undefined || value === '') return fallback
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(0, Math.floor(n))
}

export function resolveEffectiveThreshold(
  productThreshold: number | null | undefined,
  globalThreshold: number,
  mode: LowStockMode = 'global'
): number {
  const safeGlobal = normalizeThreshold(globalThreshold, DEFAULT_LOW_STOCK_THRESHOLD)
  if (mode === 'per_product' && productThreshold !== null && productThreshold !== undefined) {
    const parsed = Number(productThreshold)
    if (Number.isFinite(parsed) && parsed >= 0) {
      return Math.floor(parsed)
    }
  }
  return safeGlobal
}

export function evaluateProductStock(
  product: StockMonitorInput,
  globalThreshold: number,
  mode: LowStockMode = 'global'
): EvaluatedStockStatus {
  const rawQty = Number(product.stock ?? 0)
  const quantity = Number.isFinite(rawQty) ? Math.max(0, rawQty) : 0
  const threshold = resolveEffectiveThreshold(product.low_stock_threshold, globalThreshold, mode)
  const isBelowThreshold = threshold > 0 && quantity < threshold
  const isOutOfStock = isBelowThreshold && quantity <= 0
  const level: StockHealthLevel = isOutOfStock
    ? 'out_of_stock'
    : isBelowThreshold
      ? 'low_stock'
      : 'in_stock'
  const deficit = isBelowThreshold ? Math.max(0, threshold - quantity) : 0

  return {
    id: product.id,
    name: product.name,
    category: product.category || 'General',
    unit: product.unit || 'pcs',
    quantity,
    threshold,
    deficit,
    level,
    isBelowThreshold,
    isOutOfStock,
  }
}

export function collectLowStockSummary(
  products: StockMonitorInput[],
  globalThreshold: number,
  mode: LowStockMode = 'global'
): LowStockSummary {
  const activeThreshold = normalizeThreshold(globalThreshold, DEFAULT_LOW_STOCK_THRESHOLD)
  const safeList = Array.isArray(products) ? products : []
  const evaluated = safeList.map((p) => evaluateProductStock(p, activeThreshold, mode))

  const alerted = evaluated
    .filter((item) => item.isBelowThreshold)
    .sort((a, b) => {
      if (a.isOutOfStock !== b.isOutOfStock) return a.isOutOfStock ? -1 : 1
      if (b.deficit !== a.deficit) return b.deficit - a.deficit
      return a.name.localeCompare(b.name)
    })

  const outOfStockCount = alerted.filter((item) => item.isOutOfStock).length
  const lowStockCount = alerted.length - outOfStockCount

  const alerts: LowStockNotificationItem[] = alerted.map((item) => ({
    id: `low-stock-${item.id}-${item.quantity}-${item.threshold}`,
    productId: item.id,
    productName: item.name,
    quantity: item.quantity,
    threshold: item.threshold,
    deficit: item.deficit,
    unit: item.unit,
    severity: item.isOutOfStock ? 'bad' : 'warn',
    title: item.isOutOfStock ? `Out of stock: ${item.name}` : `Low stock: ${item.name}`,
    detail: item.isOutOfStock
      ? `0 ${item.unit} remaining — ${item.deficit} below threshold (${item.threshold})`
      : `${item.quantity} ${item.unit} remaining — ${item.deficit} below threshold (${item.threshold})`,
  }))

  return {
    totalProducts: evaluated.length,
    lowStockCount,
    outOfStockCount,
    alertCount: alerted.length,
    healthyCount: evaluated.length - alerted.length,
    activeThreshold,
    mode,
    alerts,
  }
}

export function buildLowStockSignature(summary: LowStockSummary): string {
  return summary.alerts.map((a) => a.id).join('|')
}
