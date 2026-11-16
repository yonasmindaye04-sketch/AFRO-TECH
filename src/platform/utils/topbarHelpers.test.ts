import test from 'node:test'
import assert from 'node:assert/strict'
import {
  countUnreadAlerts,
  filterQuickSearchItems,
  resolvePageTitle,
  type TopbarNavItem,
  type WorkspaceAlert,
} from './topbarHelpers'

const SAMPLE_NAV: TopbarNavItem[] = [
  { to: '/app', label: 'Dashboard', icon: 'fa-solid fa-gauge-high', end: true },
  { to: '/app/products', label: 'Products', icon: 'fa-solid fa-boxes-stacked' },
  { to: '/app/orders', label: 'Orders & Quotes', icon: 'fa-solid fa-file-signature' },
  { to: '/app/warehouses', label: 'Warehouses & Ledger', icon: 'fa-solid fa-warehouse' },
]

test('resolvePageTitle matches exact, nested, and static routes cleanly', () => {
  assert.equal(resolvePageTitle('/app', SAMPLE_NAV), 'Dashboard')
  assert.equal(resolvePageTitle('/app/products', SAMPLE_NAV), 'Products')
  assert.equal(resolvePageTitle('/app/orders/123', SAMPLE_NAV), 'Orders & Quotes')
  assert.equal(resolvePageTitle('/app/settings', SAMPLE_NAV), 'Settings')
  assert.equal(resolvePageTitle('/app/unknown-route', SAMPLE_NAV), 'Workspace')
})

test('filterQuickSearchItems filters by label or path case-insensitively', () => {
  assert.equal(filterQuickSearchItems(SAMPLE_NAV, '').length, 4)
  assert.deepEqual(
    filterQuickSearchItems(SAMPLE_NAV, 'ware').map((i) => i.to),
    ['/app/warehouses']
  )
  assert.deepEqual(
    filterQuickSearchItems(SAMPLE_NAV, 'ORDER').map((i) => i.label),
    ['Orders & Quotes']
  )
})

test('countUnreadAlerts excludes read alert IDs accurately', () => {
  const alerts: WorkspaceAlert[] = [
    { id: 'a1', title: 'Low stock', detail: 'Paracetamol (8 left)', severity: 'warn', route: '/app/products', icon: 'fa-solid fa-box' },
    { id: 'a2', title: 'Expiring soon', detail: 'Batch #B201', severity: 'bad', route: '/app/expiry', icon: 'fa-solid fa-hourglass-half' },
    { id: 'a3', title: 'Trial', detail: '14 days left', severity: 'info', route: '/app/subscription', icon: 'fa-solid fa-receipt' },
  ]
  assert.equal(countUnreadAlerts(alerts, []), 3)
  assert.equal(countUnreadAlerts(alerts, ['a1']), 2)
  assert.equal(countUnreadAlerts(alerts, ['a1', 'a2', 'a3']), 0)
})
