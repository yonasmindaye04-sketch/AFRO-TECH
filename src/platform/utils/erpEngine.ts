export type RootType = 'Asset' | 'Liability' | 'Equity' | 'Income' | 'Expense'

export interface CoaAccount {
  code: string
  name: string
  root_type: RootType
  account_type: string
  balance: number
}

export interface GlEntryRow {
  account_code: string
  debit: number
  credit: number
}

export interface FinancialStatements {
  assets: CoaAccount[]
  liabilities: CoaAccount[]
  equity: CoaAccount[]
  income: CoaAccount[]
  expenses: CoaAccount[]
  totalAssets: number
  totalLiabilities: number
  totalEquity: number
  totalIncome: number
  totalExpenses: number
  netProfit: number
  liabilitiesAndEquity: number
  trialDebit: number
  trialCredit: number
  trialBalanced: boolean
}

export interface JournalLineInput {
  account_code: string
  debit: number
  credit: number
}

export interface BomComponentInput {
  product_id: string
  qty_per_unit: number
  unit_cost: number
  available_stock: number
}

export interface FixedAssetInput {
  purchase_cost: number
  salvage_value: number
  useful_life_months: number
  accumulated_depreciation: number
}

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100
}

export function computeFinancialStatements(accounts: CoaAccount[], glEntries: GlEntryRow[] = []): FinancialStatements {
  const byType = (t: RootType) => accounts.filter((a) => a.root_type === t)
  const sum = (list: CoaAccount[]) => round2(list.reduce((s, a) => s + Number(a.balance || 0), 0))

  const assets = byType('Asset')
  const liabilities = byType('Liability')
  const equity = byType('Equity')
  const income = byType('Income')
  const expenses = byType('Expense')

  const totalAssets = sum(assets)
  const totalLiabilities = sum(liabilities)
  const totalEquity = sum(equity)
  const totalIncome = sum(income)
  const totalExpenses = sum(expenses)
  const netProfit = round2(totalIncome - totalExpenses)
  const liabilitiesAndEquity = round2(totalLiabilities + totalEquity + netProfit)

  const trialDebit = round2(glEntries.reduce((s, e) => s + Number(e.debit || 0), 0))
  const trialCredit = round2(glEntries.reduce((s, e) => s + Number(e.credit || 0), 0))

  return {
    assets,
    liabilities,
    equity,
    income,
    expenses,
    totalAssets,
    totalLiabilities,
    totalEquity,
    totalIncome,
    totalExpenses,
    netProfit,
    liabilitiesAndEquity,
    trialDebit,
    trialCredit,
    trialBalanced: Math.abs(trialDebit - trialCredit) < 0.01,
  }
}

export function validateJournalEntry(lines: JournalLineInput[]): { valid: boolean; totalDebit: number; totalCredit: number; error: string | null } {
  if (lines.length < 2) {
    return { valid: false, totalDebit: 0, totalCredit: 0, error: 'At least two account lines are required.' }
  }
  const totalDebit = round2(lines.reduce((s, l) => s + Math.max(0, Number(l.debit || 0)), 0))
  const totalCredit = round2(lines.reduce((s, l) => s + Math.max(0, Number(l.credit || 0)), 0))
  if (totalDebit <= 0) {
    return { valid: false, totalDebit, totalCredit, error: 'Total amount must be greater than zero.' }
  }
  if (Math.abs(totalDebit - totalCredit) >= 0.01) {
    return { valid: false, totalDebit, totalCredit, error: 'Total Debit must equal Total Credit.' }
  }
  return { valid: true, totalDebit, totalCredit, error: null }
}

export function evaluateBom(components: BomComponentInput[]): { unitMaterialCost: number; maxBuildableUnits: number } {
  if (!components.length) return { unitMaterialCost: 0, maxBuildableUnits: 0 }
  let unitMaterialCost = 0
  let maxBuildable = Infinity
  for (const c of components) {
    const req = Math.max(0, Number(c.qty_per_unit || 0))
    const cost = Math.max(0, Number(c.unit_cost || 0))
    const avail = Math.max(0, Number(c.available_stock || 0))
    unitMaterialCost += req * cost
    if (req > 0) {
      maxBuildable = Math.min(maxBuildable, Math.floor(avail / req))
    }
  }
  return {
    unitMaterialCost: round2(unitMaterialCost),
    maxBuildableUnits: maxBuildable === Infinity ? 0 : maxBuildable,
  }
}

export function computeMonthlyDepreciation(asset: FixedAssetInput): { monthlyAmount: number; nextAccumulated: number; netBookValue: number; isFullyDepreciated: boolean } {
  const cost = Math.max(0, Number(asset.purchase_cost || 0))
  const salvage = Math.min(cost, Math.max(0, Number(asset.salvage_value || 0)))
  const life = Math.max(1, Number(asset.useful_life_months || 1))
  const acc = Math.min(cost - salvage, Math.max(0, Number(asset.accumulated_depreciation || 0)))
  const remainingDepreciable = round2(Math.max(0, cost - salvage - acc))

  if (remainingDepreciable <= 0.005) {
    return {
      monthlyAmount: 0,
      nextAccumulated: round2(acc),
      netBookValue: round2(cost - acc),
      isFullyDepreciated: true,
    }
  }

  const rawMonthly = round2((cost - salvage) / life)
  const monthlyAmount = Math.min(remainingDepreciable, rawMonthly)
  const nextAccumulated = round2(acc + monthlyAmount)
  const netBookValue = round2(cost - nextAccumulated)

  return {
    monthlyAmount,
    nextAccumulated,
    netBookValue,
    isFullyDepreciated: round2(cost - salvage - nextAccumulated) <= 0.005,
  }
}
