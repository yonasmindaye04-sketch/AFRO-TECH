export type DatasetKey = 'products' | 'sales' | 'purchases' | 'expenses' | 'gl' | 'leads'

export type FieldType = 'string' | 'number' | 'date'

export type FilterOperator = 'contains' | 'equals' | 'gt' | 'gte' | 'lt' | 'lte'

export interface FieldSchema {
  key: string
  label: string
  type: FieldType
  defaultVisible?: boolean
  aggregatable?: boolean
}

export interface ReportFilter {
  field: string
  op: FilterOperator
  value: string
}

export interface CustomReportConfig {
  dataset: DatasetKey
  columns: string[]
  filters: ReportFilter[]
  sortBy: string
  sortDir: 'asc' | 'desc'
  groupBy: string
}

export interface DatasetDefinition {
  key: DatasetKey
  label: string
  icon: string
  fields: FieldSchema[]
}

export const REPORT_DATASETS: Record<DatasetKey, DatasetDefinition> = {
  products: {
    key: 'products',
    label: 'Products & Inventory',
    icon: 'fa-solid fa-boxes-stacked',
    fields: [
      { key: 'name', label: 'Product Name', type: 'string', defaultVisible: true },
      { key: 'category', label: 'Category', type: 'string', defaultVisible: true },
      { key: 'stock', label: 'Stock Qty', type: 'number', defaultVisible: true, aggregatable: true },
      { key: 'low_stock_threshold', label: 'Reorder Level', type: 'number', defaultVisible: true },
      { key: 'cost_price', label: 'Cost Price (ETB)', type: 'number', defaultVisible: true },
      { key: 'sell_price', label: 'Sell Price (ETB)', type: 'number', defaultVisible: true },
      { key: 'stock_value', label: 'Stock Value (ETB)', type: 'number', defaultVisible: true, aggregatable: true },
      { key: 'expiring_soon', label: 'Expiring <=90d', type: 'number', defaultVisible: false, aggregatable: true },
    ],
  },
  sales: {
    key: 'sales',
    label: 'Sales Invoices',
    icon: 'fa-solid fa-cash-register',
    fields: [
      { key: 'invoice_no', label: 'Invoice #', type: 'string', defaultVisible: true },
      { key: 'created_at', label: 'Date', type: 'date', defaultVisible: true },
      { key: 'customer_name', label: 'Customer', type: 'string', defaultVisible: true },
      { key: 'payment_method', label: 'Payment Method', type: 'string', defaultVisible: true },
      { key: 'status', label: 'Status', type: 'string', defaultVisible: true },
      { key: 'discount', label: 'Discount (ETB)', type: 'number', defaultVisible: false, aggregatable: true },
      { key: 'total', label: 'Total (ETB)', type: 'number', defaultVisible: true, aggregatable: true },
      { key: 'cashier', label: 'Cashier', type: 'string', defaultVisible: false },
    ],
  },
  purchases: {
    key: 'purchases',
    label: 'Purchases & Payables',
    icon: 'fa-solid fa-truck-ramp-box',
    fields: [
      { key: 'purchase_no', label: 'Purchase #', type: 'string', defaultVisible: true },
      { key: 'created_at', label: 'Date', type: 'date', defaultVisible: true },
      { key: 'supplier_name', label: 'Supplier', type: 'string', defaultVisible: true },
      { key: 'item_count', label: 'Line Items', type: 'number', defaultVisible: true, aggregatable: true },
      { key: 'total', label: 'Total (ETB)', type: 'number', defaultVisible: true, aggregatable: true },
      { key: 'paid_amount', label: 'Paid (ETB)', type: 'number', defaultVisible: true, aggregatable: true },
      { key: 'balance_due', label: 'Balance Due (ETB)', type: 'number', defaultVisible: true, aggregatable: true },
    ],
  },
  expenses: {
    key: 'expenses',
    label: 'Operating Expenses',
    icon: 'fa-solid fa-receipt',
    fields: [
      { key: 'created_at', label: 'Date', type: 'date', defaultVisible: true },
      { key: 'category', label: 'Category', type: 'string', defaultVisible: true },
      { key: 'description', label: 'Description', type: 'string', defaultVisible: true },
      { key: 'amount', label: 'Amount (ETB)', type: 'number', defaultVisible: true, aggregatable: true },
      { key: 'recorded_by', label: 'Recorded By', type: 'string', defaultVisible: false },
    ],
  },
  gl: {
    key: 'gl',
    label: 'General Ledger',
    icon: 'fa-solid fa-book-open',
    fields: [
      { key: 'posting_date', label: 'Posting Date', type: 'date', defaultVisible: true },
      { key: 'voucher_no', label: 'Voucher #', type: 'string', defaultVisible: true },
      { key: 'voucher_type', label: 'Voucher Type', type: 'string', defaultVisible: true },
      { key: 'account_code', label: 'Account Code', type: 'string', defaultVisible: true },
      { key: 'account_name', label: 'Account Name', type: 'string', defaultVisible: true },
      { key: 'debit', label: 'Debit (ETB)', type: 'number', defaultVisible: true, aggregatable: true },
      { key: 'credit', label: 'Credit (ETB)', type: 'number', defaultVisible: true, aggregatable: true },
    ],
  },
  leads: {
    key: 'leads',
    label: 'CRM Pipeline Leads',
    icon: 'fa-solid fa-bullseye',
    fields: [
      { key: 'name', label: 'Lead Name', type: 'string', defaultVisible: true },
      { key: 'organization', label: 'Organization', type: 'string', defaultVisible: true },
      { key: 'stage', label: 'Stage', type: 'string', defaultVisible: true },
      { key: 'source', label: 'Source', type: 'string', defaultVisible: true },
      { key: 'expected_value', label: 'Expected Value (ETB)', type: 'number', defaultVisible: true, aggregatable: true },
      { key: 'follow_up_date', label: 'Follow-up Date', type: 'date', defaultVisible: false },
    ],
  },
}

export function defaultConfigForDataset(dataset: DatasetKey): CustomReportConfig {
  const def = REPORT_DATASETS[dataset]
  return {
    dataset,
    columns: def.fields.filter((f) => f.defaultVisible !== false).map((f) => f.key),
    filters: [],
    sortBy: def.fields[0].key,
    sortDir: 'desc',
    groupBy: '',
  }
}

export interface ParsedNaturalQuery {
  matched: boolean
  explanation: string
  config: CustomReportConfig
}

/**
 * Deterministic plain-English query parser (zero external/LLM calls).
 * Translates natural business questions into structured CustomReportConfig.
 */
export function parseReportQuery(rawQuery: string): ParsedNaturalQuery {
  const q = rawQuery.trim().toLowerCase()
  if (!q) {
    return {
      matched: false,
      explanation: 'Showing default Sales Invoices view.',
      config: defaultConfigForDataset('sales'),
    }
  }

  // Extract numeric thresholds like "over 1000", "> 500", "above 200", "under 10", "below 20"
  const gtMatch = q.match(/(?:over|above|greater than|more than|>)\s*(\d+(?:\.\d+)?)/)
  const ltMatch = q.match(/(?:under|below|less than|<)\s*(\d+(?:\.\d+)?)/)

  // Low stock / stockout / reorder
  if (/(low stock|reorder|out of stock|running low|shortage)/.test(q)) {
    const cfg = defaultConfigForDataset('products')
    cfg.filters = q.includes('out of stock')
      ? [{ field: 'stock', op: 'lte', value: '0' }]
      : [{ field: 'stock', op: 'lte', value: '15' }]
    cfg.sortBy = 'stock'
    cfg.sortDir = 'asc'
    return {
      matched: true,
      explanation: q.includes('out of stock')
        ? 'Filtered Products & Inventory where Stock Qty <= 0, sorted lowest first.'
        : 'Filtered Products & Inventory for low stock (<= 15 units), sorted lowest stock first.',
      config: cfg,
    }
  }

  // Expiring stock
  if (/(expir|batch)/.test(q)) {
    const cfg = defaultConfigForDataset('products')
    cfg.columns = ['name', 'category', 'stock', 'expiring_soon', 'stock_value']
    cfg.filters = [{ field: 'expiring_soon', op: 'gt', value: '0' }]
    cfg.sortBy = 'expiring_soon'
    cfg.sortDir = 'desc'
    return {
      matched: true,
      explanation: 'Filtered Products & Inventory for items with batches expiring within 90 days.',
      config: cfg,
    }
  }

  // Expenses
  if (/(expense|cost|spending|rent|utility|utilities)/.test(q)) {
    const cfg = defaultConfigForDataset('expenses')
    if (gtMatch) {
      cfg.filters.push({ field: 'amount', op: 'gt', value: gtMatch[1] })
    } else if (ltMatch) {
      cfg.filters.push({ field: 'amount', op: 'lt', value: ltMatch[1] })
    }
    if (q.includes('by category') || q.includes('group')) {
      cfg.groupBy = 'category'
    }
    cfg.sortBy = 'amount'
    cfg.sortDir = 'desc'
    return {
      matched: true,
      explanation: `Loaded Operating Expenses${gtMatch ? ` > ${gtMatch[1]} ETB` : ''}${cfg.groupBy ? ' grouped by Category' : ''}.`,
      config: cfg,
    }
  }

  // Unpaid purchases / supplier payable
  if (/(unpaid purchase|supplier|payable|due|owe)/.test(q)) {
    const cfg = defaultConfigForDataset('purchases')
    cfg.filters = [{ field: 'balance_due', op: 'gt', value: '0' }]
    cfg.sortBy = 'balance_due'
    cfg.sortDir = 'desc'
    return {
      matched: true,
      explanation: 'Filtered Purchases & Payables for unpaid supplier balances (> 0 ETB).',
      config: cfg,
    }
  }

  // Purchases general
  if (/(purchase|procurement|stock receipt)/.test(q)) {
    const cfg = defaultConfigForDataset('purchases')
    if (gtMatch) cfg.filters.push({ field: 'total', op: 'gt', value: gtMatch[1] })
    cfg.sortBy = 'total'
    cfg.sortDir = 'desc'
    return {
      matched: true,
      explanation: `Loaded Purchases & Payables${gtMatch ? ` over ${gtMatch[1]} ETB` : ''}.`,
      config: cfg,
    }
  }

  // Credit / unpaid sales
  if (/(credit sale|unpaid order|unpaid invoice|credit)/.test(q)) {
    const cfg = defaultConfigForDataset('sales')
    cfg.filters = [{ field: 'payment_method', op: 'equals', value: 'credit' }]
    cfg.sortBy = 'total'
    cfg.sortDir = 'desc'
    return {
      matched: true,
      explanation: 'Filtered Sales Invoices for Credit payment method.',
      config: cfg,
    }
  }

  // General ledger / journal
  if (/(ledger|journal|voucher|debit|credit entry|gl)/.test(q)) {
    const cfg = defaultConfigForDataset('gl')
    if (gtMatch) cfg.filters.push({ field: 'debit', op: 'gt', value: gtMatch[1] })
    if (q.includes('by account')) cfg.groupBy = 'account_name'
    cfg.sortBy = 'posting_date'
    cfg.sortDir = 'desc'
    return {
      matched: true,
      explanation: `Loaded General Ledger entries${gtMatch ? ` with debit > ${gtMatch[1]} ETB` : ''}.`,
      config: cfg,
    }
  }

  // CRM Leads / pipeline
  if (/(lead|crm|pipeline|deal|prospect|won|qualified)/.test(q)) {
    const cfg = defaultConfigForDataset('leads')
    if (q.includes('won')) cfg.filters.push({ field: 'stage', op: 'equals', value: 'won' })
    else if (q.includes('qualified')) cfg.filters.push({ field: 'stage', op: 'equals', value: 'qualified' })
    if (q.includes('by stage')) cfg.groupBy = 'stage'
    cfg.sortBy = 'expected_value'
    cfg.sortDir = 'desc'
    return {
      matched: true,
      explanation: 'Loaded CRM Pipeline Leads sorted by Expected Value.',
      config: cfg,
    }
  }

  // Sales / revenue / payment method breakdown
  if (/(sale|revenue|invoice|cash|telebirr|bank|payment)/.test(q)) {
    const cfg = defaultConfigForDataset('sales')
    if (gtMatch) cfg.filters.push({ field: 'total', op: 'gt', value: gtMatch[1] })
    if (q.includes('cash')) cfg.filters.push({ field: 'payment_method', op: 'equals', value: 'cash' })
    if (q.includes('by payment') || q.includes('by method') || q.includes('group')) cfg.groupBy = 'payment_method'
    cfg.sortBy = 'total'
    cfg.sortDir = 'desc'
    return {
      matched: true,
      explanation: `Loaded Sales Invoices${cfg.groupBy ? ' grouped by Payment Method' : ''}${gtMatch ? ` over ${gtMatch[1]} ETB` : ''}.`,
      config: cfg,
    }
  }

  // Fallback keyword search across products
  const cfg = defaultConfigForDataset('products')
  cfg.filters = [{ field: 'name', op: 'contains', value: q }]
  return {
    matched: false,
    explanation: `No preset intent matched — searched Products & Inventory for "${rawQuery.trim()}".`,
    config: cfg,
  }
}

export interface ReportResult {
  columns: { key: string; label: string; type: FieldType }[]
  rows: Record<string, unknown>[]
  totalCount: number
  sums: Record<string, number>
}

function matchesFilter(rowVal: unknown, filter: ReportFilter, type: FieldType): boolean {
  if (!filter.value.trim()) return true
  if (type === 'number') {
    const num = Number(rowVal ?? 0)
    const target = Number(filter.value)
    if (Number.isNaN(target)) return true
    if (filter.op === 'gt') return num > target
    if (filter.op === 'gte') return num >= target
    if (filter.op === 'lt') return num < target
    if (filter.op === 'lte') return num <= target
    if (filter.op === 'equals') return Math.abs(num - target) < 0.001
    return String(rowVal ?? '').toLowerCase().includes(filter.value.toLowerCase())
  }
  const str = String(rowVal ?? '').toLowerCase()
  const needle = filter.value.trim().toLowerCase()
  if (filter.op === 'equals') return str === needle
  return str.includes(needle)
}

export function runCustomReport(rawRows: Record<string, unknown>[], config: CustomReportConfig): ReportResult {
  const def = REPORT_DATASETS[config.dataset]
  const fieldMap = new Map(def.fields.map((f) => [f.key, f]))

  // Filter rows
  const filtered = rawRows.filter((row) =>
    config.filters.every((flt) => {
      const schema = fieldMap.get(flt.field)
      return matchesFilter(row[flt.field], flt, schema?.type ?? 'string')
    })
  )

  // Compute sums for aggregatable fields
  const sums: Record<string, number> = {}
  for (const f of def.fields) {
    if (f.aggregatable) {
      sums[f.key] = Math.round(filtered.reduce((acc, r) => acc + (Number(r[f.key] || 0)), 0) * 100) / 100
    }
  }

  // Group-by mode
  if (config.groupBy && fieldMap.has(config.groupBy)) {
    const grpField = fieldMap.get(config.groupBy)!
    const aggFields = def.fields.filter((f) => f.aggregatable && (config.columns.includes(f.key) || config.columns.length === 0))
    const buckets = new Map<string, Record<string, unknown>>()
    for (const r of filtered) {
      const key = String(r[config.groupBy] ?? 'Unspecified')
      const existing = buckets.get(key) ?? { [config.groupBy]: key, count: 0 }
      existing.count = Number(existing.count) + 1
      for (const af of aggFields) {
        existing[af.key] = Math.round((Number(existing[af.key] ?? 0) + Number(r[af.key] || 0)) * 100) / 100
      }
      buckets.set(key, existing)
    }
    const groupedRows = Array.from(buckets.values()).sort((a, b) => Number(b.count) - Number(a.count))
    return {
      columns: [
        { key: grpField.key, label: grpField.label, type: grpField.type },
        { key: 'count', label: 'Records', type: 'number' },
        ...aggFields.map((af) => ({ key: af.key, label: `Total ${af.label}`, type: 'number' as const })),
      ],
      rows: groupedRows,
      totalCount: filtered.length,
      sums,
    }
  }

  // Sort flat rows
  const sortSchema = fieldMap.get(config.sortBy)
  const sorted = [...filtered].sort((a, b) => {
    const va = a[config.sortBy]
    const vb = b[config.sortBy]
    let cmp = 0
    if (sortSchema?.type === 'number') {
      cmp = Number(va ?? 0) - Number(vb ?? 0)
    } else {
      cmp = String(va ?? '').localeCompare(String(vb ?? ''))
    }
    return config.sortDir === 'asc' ? cmp : -cmp
  })

  const visibleCols = config.columns
    .map((k) => fieldMap.get(k))
    .filter((f): f is FieldSchema => Boolean(f))
    .map((f) => ({ key: f.key, label: f.label, type: f.type }))

  return {
    columns: visibleCols.length ? visibleCols : def.fields.slice(0, 4).map((f) => ({ key: f.key, label: f.label, type: f.type })),
    rows: sorted,
    totalCount: sorted.length,
    sums,
  }
}
