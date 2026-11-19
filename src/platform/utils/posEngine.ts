export interface PosProduct {
  id: string
  name: string
  category: string
  unit: string
  sell_price: string
  cost_price: string
  barcode?: string | null
  sell_by_pill: boolean
  pills_per_unit: number
  default_margin: string
  stock: number
  sellable_stock?: number
  expired_qty?: number
  display_stock: number
  low_stock_threshold?: number
}

export interface PosCartLine {
  product_id: string
  name: string
  category: string
  unit: string
  sold_as_pill: boolean
  pills_per_unit: number
  cost_price: number // per unit, or per pill for pill lines
  margin: number | null // null = list price
  unit_price: number // per unit, or per pill
  units: number // whole packs (pill lines) or quantity (unit lines)
  pills: number // loose pills (pill lines only)
  max_stock: number // display_stock for pill lines, stock for unit lines
}

export type PosOrderType = 'pickup' | 'delivery'
export type PosPaymentMethod = 'cash' | 'telebirr' | 'cbe' | 'mpesa' | 'card' | 'credit'
export type PosDiscountMode = 'fixed' | 'percent'

export interface PosCustomerInfo {
  id?: string
  name: string
  phone: string
  city: string
  location: string
  gender?: 'male' | 'female' | 'other' | ''
  age_group?: 'under-18' | '18-24' | '25-34' | '35-44' | '45-54' | '55+' | ''
  source?: 'walk-in' | 'phone' | 'website'
  referral_code?: string
  notes?: string
}

export interface HeldPosOrder {
  id: string
  label: string
  held_at: string
  order_type: PosOrderType
  customer: PosCustomerInfo
  discount_mode: PosDiscountMode
  discount_value: number
  cart: PosCartLine[]
  subtotal: number
  total: number
  item_count: number
}

export const POS_CITIES = ['Addis Ababa', 'Other Regions', 'Abroad'] as const

export const POS_AGE_GROUPS = [
  { value: 'under-18', label: 'Under 18' },
  { value: '18-24', label: '18 – 24 years' },
  { value: '25-34', label: '25 – 34 years' },
  { value: '35-44', label: '35 – 44 years' },
  { value: '45-54', label: '45 – 54 years' },
  { value: '55+', label: '55+ years' },
] as const

export const POS_CUSTOMER_SOURCES = [
  { value: 'walk-in', label: 'Walk-in' },
  { value: 'phone', label: 'Phone' },
  { value: 'website', label: 'Website' },
] as const

export const POS_COUNTRY_CODES = [
  { f: 'ET', n: 'Ethiopia', c: '+251' },
  { f: 'KE', n: 'Kenya', c: '+254' },
  { f: 'US', n: 'United States', c: '+1' },
  { f: 'GB', n: 'United Kingdom', c: '+44' },
  { f: 'AE', n: 'UAE', c: '+971' },
  { f: 'SA', n: 'Saudi Arabia', c: '+966' },
  { f: 'DE', n: 'Germany', c: '+49' },
  { f: 'DJ', n: 'Djibouti', c: '+253' },
  { f: 'TZ', n: 'Tanzania', c: '+255' },
  { f: 'UG', n: 'Uganda', c: '+256' },
  { f: 'RW', n: 'Rwanda', c: '+250' },
  { f: 'ZA', n: 'South Africa', c: '+27' },
  { f: 'CN', n: 'China', c: '+86' },
  { f: 'IN', n: 'India', c: '+91' },
] as const

export const DEFAULT_POS_CUSTOMER: PosCustomerInfo = {
  name: 'Walk-in Customer',
  phone: '+251 900 000 000',
  city: 'Addis Ababa',
  location: 'In-Store Counter',
  gender: '',
  age_group: '',
  source: 'walk-in',
  referral_code: '',
  notes: '',
}

export interface PosPaymentRailMeta {
  id: PosPaymentMethod
  label: string
  shortLabel: string
  icon: string
  hint: string
}

export const POS_PAYMENT_RAILS: readonly PosPaymentRailMeta[] = [
  { id: 'cash', label: 'Cash (ETB)', shortLabel: 'Cash', icon: 'fa-solid fa-money-bill-wave', hint: 'Drawer cash' },
  { id: 'telebirr', label: 'Telebirr', shortLabel: 'Telebirr', icon: 'fa-solid fa-mobile-screen-button', hint: 'Mobile wallet' },
  { id: 'cbe', label: 'CBE Birr', shortLabel: 'CBE Birr', icon: 'fa-solid fa-building-columns', hint: 'Bank / QR' },
  { id: 'mpesa', label: 'M-Pesa', shortLabel: 'M-Pesa', icon: 'fa-solid fa-sim-card', hint: 'STK / Wallet' },
  { id: 'card', label: 'POS Card', shortLabel: 'Card', icon: 'fa-solid fa-credit-card', hint: 'Debit / Visa' },
  { id: 'credit', label: 'Customer Credit', shortLabel: 'Credit', icon: 'fa-solid fa-file-invoice-dollar', hint: 'Receivable' },
]

export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100
}

export function getAvailableStock(product: PosProduct): number {
  if (product.sell_by_pill) return Number(product.display_stock || 0)
  return Number(product.sellable_stock ?? product.stock ?? 0)
}

export function getListUnitPrice(product: PosProduct): number {
  const base = Number(product.sell_price || 0)
  if (product.sell_by_pill) {
    return base / Math.max(1, Number(product.pills_per_unit || 1))
  }
  return base
}

export function extractCategories(products: readonly PosProduct[]): string[] {
  const seen = new Map<string, string>()
  for (const p of products) {
    const raw = (p.category || '').trim()
    if (!raw) continue
    const key = raw.toLowerCase()
    if (!seen.has(key)) seen.set(key, raw)
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b))
}

export function filterPosProducts(
  products: readonly PosProduct[],
  selectedCategory: string,
  searchQuery: string
): PosProduct[] {
  const cat = selectedCategory.trim().toLowerCase()
  const q = searchQuery.trim().toLowerCase()
  return products.filter((p) => {
    if (cat && cat !== 'all' && (p.category || '').trim().toLowerCase() !== cat) {
      return false
    }
    if (!q) return true
    return (
      p.name.toLowerCase().includes(q) ||
      (p.category || '').toLowerCase().includes(q) ||
      (p.unit || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q)
    )
  })
}

export function getCartLineQty(line: PosCartLine): number {
  return line.sold_as_pill ? line.units * line.pills_per_unit + line.pills : line.units
}

export function addProductToCart(cart: readonly PosCartLine[], product: PosProduct): PosCartLine[] {
  const available = getAvailableStock(product)
  if (available <= 0) return [...cart]

  const existingIdx = cart.findIndex((l) => l.product_id === product.id)
  if (existingIdx === -1) {
    const pillsPerUnit = Math.max(1, Number(product.pills_per_unit || 1))
    if (product.sell_by_pill) {
      const perPill = Number(product.sell_price || 0) / pillsPerUnit
      const initialUnits = available >= pillsPerUnit ? 1 : 0
      const initialPills = available >= pillsPerUnit ? 0 : 1
      return [
        ...cart,
        {
          product_id: product.id,
          name: product.name,
          category: product.category,
          unit: product.unit,
          sold_as_pill: true,
          pills_per_unit: pillsPerUnit,
          cost_price: Number(product.cost_price || 0) / pillsPerUnit,
          margin: null,
          unit_price: perPill,
          units: initialUnits,
          pills: initialPills,
          max_stock: available,
        },
      ]
    }
    return [
      ...cart,
      {
        product_id: product.id,
        name: product.name,
        category: product.category,
        unit: product.unit,
        sold_as_pill: false,
        pills_per_unit: 1,
        cost_price: Number(product.cost_price || 0),
        margin: null,
        unit_price: Number(product.sell_price || 0),
        units: 1,
        pills: 0,
        max_stock: available,
      },
    ]
  }

  return cart.map((line, idx) => {
    if (idx !== existingIdx) return line
    if (line.sold_as_pill) {
      const nextPillsTotal = (line.units + 1) * line.pills_per_unit + line.pills
      if (nextPillsTotal > available) return line
      return { ...line, units: line.units + 1, max_stock: available }
    }
    if (line.units + 1 > available) return line
    return { ...line, units: line.units + 1, max_stock: available }
  })
}

export function updateCartLineQuantity(
  cart: readonly PosCartLine[],
  productId: string,
  delta: number,
  maxStockOverride?: number
): PosCartLine[] {
  return cart
    .map((line) => {
      if (line.product_id !== productId) return line
      const limit = maxStockOverride ?? line.max_stock
      if (line.sold_as_pill) {
        let units = line.units
        let pills = line.pills + delta
        while (pills < 0 && units > 0) {
          units -= 1
          pills += line.pills_per_unit
        }
        while (pills >= line.pills_per_unit) {
          units += 1
          pills -= line.pills_per_unit
        }
        const totalPills = units * line.pills_per_unit + pills
        if (limit > 0 && totalPills > limit) return line
        return { ...line, units, pills }
      }
      const nextUnits = line.units + delta
      if (limit > 0 && nextUnits > limit) return line
      return { ...line, units: nextUnits }
    })
    .filter((line) => getCartLineQty(line) > 0)
}

export function setCartLinePills(
  cart: readonly PosCartLine[],
  productId: string,
  units: number,
  pills: number,
  maxDisplayStock?: number
): PosCartLine[] {
  return cart.map((line) => {
    if (line.product_id !== productId) return line
    const safeUnits = Math.max(0, Math.floor(units))
    const safePills = Math.max(0, Math.min(Math.max(0, line.pills_per_unit - 1), Math.floor(pills)))
    const totalPills = safeUnits * line.pills_per_unit + safePills
    const limit = maxDisplayStock ?? line.max_stock
    if (totalPills <= 0 || (limit > 0 && totalPills > limit)) return line
    return { ...line, units: safeUnits, pills: safePills }
  })
}

export function applyCartLineMargin(
  cart: readonly PosCartLine[],
  productId: string,
  margin: number | null,
  listSellPrice: number
): PosCartLine[] {
  return cart.map((line) => {
    if (line.product_id !== productId) return line
    if (margin === null) {
      const unitList = line.sold_as_pill
        ? listSellPrice / Math.max(1, line.pills_per_unit)
        : listSellPrice
      return { ...line, margin: null, unit_price: unitList }
    }
    return { ...line, margin, unit_price: line.cost_price * (1 + margin / 100) }
  })
}

export function computeDiscountAmount(
  subtotal: number,
  mode: PosDiscountMode,
  rawValue: number
): number {
  if (!Number.isFinite(subtotal) || subtotal <= 0) return 0
  if (!Number.isFinite(rawValue) || rawValue <= 0) return 0
  if (mode === 'percent') {
    const pct = Math.min(100, Math.max(0, rawValue))
    return round2((subtotal * pct) / 100)
  }
  return round2(Math.min(subtotal, Math.max(0, rawValue)))
}

export interface PosTotalsSummary {
  subtotal: number
  discountAmount: number
  totalPayable: number
  taxIncluded: number
  itemCount: number
  lineCount: number
}

export function computeCartTotals(
  cart: readonly PosCartLine[],
  discountMode: PosDiscountMode,
  discountValue: number,
  taxRatePercent = 0
): PosTotalsSummary {
  const subtotal = round2(
    cart.reduce((sum, line) => sum + getCartLineQty(line) * line.unit_price, 0)
  )
  const discountAmount = computeDiscountAmount(subtotal, discountMode, discountValue)
  const totalPayable = round2(Math.max(0, subtotal - discountAmount))
  const taxIncluded =
    taxRatePercent > 0
      ? round2((totalPayable * taxRatePercent) / (100 + taxRatePercent))
      : 0
  const itemCount = cart.reduce((sum, line) => sum + getCartLineQty(line), 0)
  return {
    subtotal,
    discountAmount,
    totalPayable,
    taxIncluded,
    itemCount,
    lineCount: cart.length,
  }
}

export function computeChangeDue(totalPayable: number, amountReceived: number): {
  changeDue: number
  balanceDue: number
} {
  const paid = Number.isFinite(amountReceived) ? Math.max(0, amountReceived) : 0
  const total = Number.isFinite(totalPayable) ? Math.max(0, totalPayable) : 0
  return {
    changeDue: round2(Math.max(0, paid - total)),
    balanceDue: round2(Math.max(0, total - paid)),
  }
}

export function computeQuickTenderAmounts(totalPayable: number): number[] {
  if (!Number.isFinite(totalPayable) || totalPayable <= 0) return []
  const exact = round2(totalPayable)
  const candidates = [
    exact,
    Math.ceil(exact / 50) * 50,
    Math.ceil(exact / 100) * 100,
    Math.ceil(exact / 500) * 500,
    Math.ceil(exact / 1000) * 1000,
  ]
  const unique: number[] = []
  for (const c of candidates) {
    if (c >= exact && !unique.includes(c)) unique.push(c)
  }
  return unique.slice(0, 4)
}

export function normalizePosCustomer(raw: Record<string, unknown> | null | undefined): PosCustomerInfo {
  if (!raw) return { ...DEFAULT_POS_CUSTOMER }
  let city = String(raw.city ?? 'Addis Ababa').trim()
  let location = String(raw.location ?? '').trim()

  const isLocationRegion = POS_CITIES.some((r) => r.toLowerCase() === location.toLowerCase())
  const isCityRegion = POS_CITIES.some((r) => r.toLowerCase() === city.toLowerCase())

  if (isLocationRegion && !isCityRegion && city.length > 0) {
    const tmp = city
    city = location
    location = tmp
  } else if (!isCityRegion && city.length > 0 && !location) {
    location = city
    city = 'Addis Ababa'
  }

  if (city.toLowerCase() === 'addis ababa') city = 'Addis Ababa'
  else if (city.toLowerCase().includes('other')) city = 'Other Regions'
  else if (city.toLowerCase() === 'abroad') city = 'Abroad'
  else city = 'Addis Ababa'

  let gender: PosCustomerInfo['gender'] = ''
  const g = String(raw.gender ?? '').trim().toLowerCase()
  if (g === 'male' || g === 'm') gender = 'male'
  else if (g === 'female' || g === 'f') gender = 'female'
  else if (g === 'other') gender = 'other'

  let ageGroup: PosCustomerInfo['age_group'] = ''
  const ag = String(raw.age_group ?? '').trim().toLowerCase().replace(/\s+/g, '-')
  if (ag.includes('under') || ag === '<18' || ag === 'under-18') ageGroup = 'under-18'
  else if (ag === '18-24' || ag === '19-25') ageGroup = '18-24'
  else if (ag === '25-34' || ag === '26-30' || ag === '31-36') ageGroup = '25-34'
  else if (ag === '35-44' || ag === '37-41' || ag === '42-48') ageGroup = '35-44'
  else if (ag === '45-54') ageGroup = '45-54'
  else if (ag === '55+' || ag.includes('55')) ageGroup = '55+'

  const src = String(raw.source ?? 'walk-in').trim().toLowerCase()
  const source: PosCustomerInfo['source'] =
    src === 'phone' || src === 'website' ? src : 'walk-in'

  return {
    id: raw.id ? String(raw.id) : raw.customer_id ? String(raw.customer_id) : undefined,
    name: String(raw.name ?? '').trim(),
    phone: String(raw.phone ?? '').trim(),
    city,
    location,
    gender,
    age_group: ageGroup,
    source,
    referral_code: String(raw.referral_code ?? '').trim(),
    notes: String(raw.notes ?? '').trim(),
  }
}

export function splitPosPhone(rawPhone: string): { code: string; local: string } {
  let matchedCode = '+251'
  let localNum = (rawPhone || '').trim()
  for (const item of POS_COUNTRY_CODES) {
    if (localNum.startsWith(item.c)) {
      matchedCode = item.c
      localNum = localNum.slice(item.c.length).trim()
      break
    }
  }
  localNum = localNum.replace(/^0+/, '').trim()
  return { code: matchedCode, local: localNum }
}

export function validatePosCustomer(customer: PosCustomerInfo): string | null {
  if (!customer.name.trim()) return 'Please enter customer full name'
  if (!customer.phone.trim() || customer.phone.replace(/\D/g, '').length < 6) {
    return 'Please enter a valid phone number'
  }
  return null
}

export function createHeldOrder(params: {
  cart: readonly PosCartLine[]
  customer: PosCustomerInfo
  orderType: PosOrderType
  discountMode: PosDiscountMode
  discountValue: number
  label?: string
}): HeldPosOrder {
  const totals = computeCartTotals(params.cart, params.discountMode, params.discountValue)
  const customerLabel =
    params.customer.name && params.customer.name !== DEFAULT_POS_CUSTOMER.name
      ? params.customer.name
      : `${params.orderType === 'delivery' ? 'Delivery' : 'Walk-in'} (${totals.itemCount} items)`
  return {
    id: `hold-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    label: (params.label || customerLabel).trim(),
    held_at: new Date().toISOString(),
    order_type: params.orderType,
    customer: { ...params.customer },
    discount_mode: params.discountMode,
    discount_value: params.discountValue,
    cart: params.cart.map((c) => ({ ...c })),
    subtotal: totals.subtotal,
    total: totals.totalPayable,
    item_count: totals.itemCount,
  }
}

export function removeHeldOrder(
  heldOrders: readonly HeldPosOrder[],
  id: string
): { target: HeldPosOrder | null; remaining: HeldPosOrder[] } {
  const target = heldOrders.find((h) => h.id === id) ?? null
  return {
    target,
    remaining: heldOrders.filter((h) => h.id !== id),
  }
}
