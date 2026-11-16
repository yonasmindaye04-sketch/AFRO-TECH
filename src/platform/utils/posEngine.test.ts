import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_POS_CUSTOMER,
  addProductToCart,
  applyCartLineMargin,
  computeCartTotals,
  computeChangeDue,
  computeDiscountAmount,
  computeQuickTenderAmounts,
  createHeldOrder,
  extractCategories,
  filterPosProducts,
  normalizePosCustomer,
  removeHeldOrder,
  setCartLinePills,
  splitPosPhone,
  updateCartLineQuantity,
  validatePosCustomer,
  type PosProduct,
} from './posEngine.ts'

const MORINGA: PosProduct = {
  id: 'p-1',
  name: 'Moringa Leaf Powder 200g',
  category: 'Herbal Supplements',
  unit: 'pack',
  sell_price: '450',
  cost_price: '280',
  barcode: '6291001001',
  sell_by_pill: false,
  pills_per_unit: 1,
  default_margin: '25',
  stock: 15,
  display_stock: 15,
}

const CAPSULES: PosProduct = {
  id: 'p-2',
  name: 'Amoxicillin 500mg',
  category: 'Antibiotics',
  unit: 'box',
  sell_price: '300',
  cost_price: '200',
  barcode: '6291002002',
  sell_by_pill: true,
  pills_per_unit: 10,
  default_margin: '25',
  stock: 2,
  display_stock: 24,
}

const OUT_OF_STOCK: PosProduct = {
  id: 'p-3',
  name: 'Black Seed Oil 250ml',
  category: 'Oils',
  unit: 'bottle',
  sell_price: '800',
  cost_price: '500',
  barcode: '6291003003',
  sell_by_pill: false,
  pills_per_unit: 1,
  default_margin: '25',
  stock: 0,
  display_stock: 0,
}

describe('posEngine catalog filtering', () => {
  it('extracts unique categories sorted alphabetically', () => {
    const cats = extractCategories([MORINGA, CAPSULES, { ...MORINGA, id: 'p-4', category: 'herbal supplements' }])
    assert.deepEqual(cats, ['Antibiotics', 'Herbal Supplements'])
  })

  it('filters by category and search query across name, category, and barcode', () => {
    const list = [MORINGA, CAPSULES, OUT_OF_STOCK]
    assert.equal(filterPosProducts(list, 'all', '').length, 3)
    assert.deepEqual(filterPosProducts(list, 'Herbal Supplements', '').map((p) => p.id), ['p-1'])
    assert.deepEqual(filterPosProducts(list, 'all', '6291002002').map((p) => p.id), ['p-2'])
    assert.deepEqual(filterPosProducts(list, 'all', 'oil').map((p) => p.id), ['p-3'])
  })
})

describe('posEngine cart & pharmacy pill operations', () => {
  it('prevents adding out-of-stock products and clamps additions to stock', () => {
    let cart = addProductToCart([], OUT_OF_STOCK)
    assert.equal(cart.length, 0)

    const limited: PosProduct = { ...MORINGA, stock: 2, display_stock: 2 }
    cart = addProductToCart(cart, limited)
    cart = addProductToCart(cart, limited)
    cart = addProductToCart(cart, limited)
    assert.equal(cart[0]?.units, 2)
  })

  it('handles sell_by_pill pack rollover and loose pill updates', () => {
    let cart = addProductToCart([], CAPSULES)
    assert.equal(cart[0]?.units, 1)
    assert.equal(cart[0]?.pills, 0)
    assert.equal(cart[0]?.unit_price, 30)

    cart = updateCartLineQuantity(cart, CAPSULES.id, -1)
    assert.equal(cart[0]?.units, 0)
    assert.equal(cart[0]?.pills, 9)

    cart = setCartLinePills(cart, CAPSULES.id, 2, 3, CAPSULES.display_stock)
    assert.equal(cart[0]?.units, 2)
    assert.equal(cart[0]?.pills, 3)

    // Exceeding display_stock (24) keeps prior value
    cart = setCartLinePills(cart, CAPSULES.id, 3, 0, CAPSULES.display_stock)
    assert.equal(cart[0]?.units, 2)
    assert.equal(cart[0]?.pills, 3)
  })

  it('applies cost-plus margin presets and reverts to list price', () => {
    let cart = addProductToCart([], MORINGA)
    cart = applyCartLineMargin(cart, MORINGA.id, 25, Number(MORINGA.sell_price))
    assert.equal(cart[0]?.margin, 25)
    assert.equal(cart[0]?.unit_price, 350) // 280 * 1.25

    cart = applyCartLineMargin(cart, MORINGA.id, null, Number(MORINGA.sell_price))
    assert.equal(cart[0]?.margin, null)
    assert.equal(cart[0]?.unit_price, 450)
  })
})

describe('posEngine discounts, tax, totals, and tender', () => {
  it('calculates fixed and percentage discounts clamped safely', () => {
    assert.equal(computeDiscountAmount(1000, 'fixed', 1500), 1000)
    assert.equal(computeDiscountAmount(1000, 'fixed', -20), 0)
    assert.equal(computeDiscountAmount(1000, 'percent', 15), 150)
    assert.equal(computeDiscountAmount(1000, 'percent', 140), 1000)
  })

  it('computes cart totals with VAT-inclusive breakdown and change due', () => {
    let cart = addProductToCart([], MORINGA)
    cart = updateCartLineQuantity(cart, MORINGA.id, 1) // 2 * 450 = 900
    const totals = computeCartTotals(cart, 'percent', 10, 15) // 900 - 90 = 810
    assert.equal(totals.subtotal, 900)
    assert.equal(totals.discountAmount, 90)
    assert.equal(totals.totalPayable, 810)
    assert.equal(totals.taxIncluded, 105.65)
    assert.equal(totals.itemCount, 2)

    const tender = computeChangeDue(810, 1000)
    assert.equal(tender.changeDue, 190)
    assert.equal(tender.balanceDue, 0)

    const quick = computeQuickTenderAmounts(810)
    assert.deepEqual(quick, [810, 850, 900, 1000])
  })
})

describe('posEngine customer normalization & hold/resume queue', () => {
  it('normalizes legacy swapped city/location and splits +251 phones', () => {
    const normalized = normalizePosCustomer({
      id: 'c-1',
      name: 'Abebe Bikila',
      phone: '+251 0911223344',
      city: 'Bole',
      location: 'Addis Ababa',
      gender: 'M',
      age_group: '26-30',
    })
    assert.equal(normalized.city, 'Addis Ababa')
    assert.equal(normalized.location, 'Bole')
    assert.equal(normalized.gender, 'male')
    assert.equal(normalized.age_group, '25-34')

    const split = splitPosPhone(normalized.phone)
    assert.deepEqual(split, { code: '+251', local: '911223344' })
  })

  it('validates customer profile without browser alerts', () => {
    assert.equal(validatePosCustomer({ ...DEFAULT_POS_CUSTOMER, name: '   ' }), 'Please enter customer full name')
    assert.equal(validatePosCustomer({ ...DEFAULT_POS_CUSTOMER, phone: '123' }), 'Please enter a valid phone number')
    assert.equal(validatePosCustomer(DEFAULT_POS_CUSTOMER), null)
  })

  it('parks and restores held POS orders cleanly', () => {
    const cart = addProductToCart([], MORINGA)
    const held = createHeldOrder({
      cart,
      customer: { ...DEFAULT_POS_CUSTOMER, name: 'Selam Tadesse' },
      orderType: 'delivery',
      discountMode: 'fixed',
      discountValue: 50,
    })
    assert.equal(held.total, 400)
    assert.equal(held.label, 'Selam Tadesse')

    const { target, remaining } = removeHeldOrder([held], held.id)
    assert.equal(target?.id, held.id)
    assert.equal(remaining.length, 0)
  })
})
