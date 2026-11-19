import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { useTheme } from '../context/useTheme'
import { api, NOTIFICATIONS_REFRESH_EVENT } from './api'
import {
  countUnreadAlerts,
  filterQuickSearchItems,
  resolvePageTitle,
  type WorkspaceAlert,
} from './utils/topbarHelpers'

interface NavItem {
  to: string
  icon: string
  label: string
  end?: boolean
}

const FIRM_ICONS: Record<string, string> = {
  hospital: 'fa-solid fa-hospital',
  pharmacy: 'fa-solid fa-prescription-bottle-medical',
  school: 'fa-solid fa-graduation-cap',
  store: 'fa-solid fa-store',
}

const RETAIL_NAV: NavItem[] = [
  { to: '/app', icon: 'fa-solid fa-gauge-high', label: 'Dashboard', end: true },
  { to: '/app/pos', icon: 'fa-solid fa-cash-register', label: 'New Sale' },
  { to: '/app/cashdrawer', icon: 'fa-solid fa-vault', label: 'Cash Drawer' },
  { to: '/app/sales', icon: 'fa-solid fa-receipt', label: 'Sales History' },
  { to: '/app/products', icon: 'fa-solid fa-boxes-stacked', label: 'Products' },
  { to: '/app/orders', icon: 'fa-solid fa-file-signature', label: 'Orders & Quotes' },
  { to: '/app/purchases', icon: 'fa-solid fa-truck-ramp-box', label: 'Purchases' },
  { to: '/app/warehouses', icon: 'fa-solid fa-warehouse', label: 'Warehouses & Ledger' },
  { to: '/app/manufacturing', icon: 'fa-solid fa-industry', label: 'Manufacturing & Assets' },
  { to: '/app/stock', icon: 'fa-solid fa-sliders', label: 'Stock Adjustments' },
  { to: '/app/expiry', icon: 'fa-solid fa-hourglass-half', label: 'Expiry' },
  { to: '/app/suppliers', icon: 'fa-solid fa-truck-field', label: 'Suppliers' },
  { to: '/app/customers', icon: 'fa-solid fa-users', label: 'Customers' },
  { to: '/app/crm', icon: 'fa-solid fa-handshake', label: 'CRM Leads' },
  { to: '/app/credit', icon: 'fa-solid fa-hand-holding-dollar', label: 'Credit (Khata)' },
  { to: '/app/expenses', icon: 'fa-solid fa-file-invoice-dollar', label: 'Expenses' },
  { to: '/app/payroll', icon: 'fa-solid fa-money-check-dollar', label: 'Payroll' },
  { to: '/app/accounting', icon: 'fa-solid fa-scale-balanced', label: 'Accounting & GL' },
  { to: '/app/payments', icon: 'fa-solid fa-credit-card', label: 'Payments & Gateways' },
  { to: '/app/reports', icon: 'fa-solid fa-chart-line', label: 'Reports' },
]

const HOSPITAL_NAV: NavItem[] = [
  { to: '/app', icon: 'fa-solid fa-gauge-high', label: 'Dashboard', end: true },
  { to: '/app/reception', icon: 'fa-solid fa-bell-concierge', label: 'Reception' },
  { to: '/app/flow', icon: 'fa-solid fa-code-branch', label: 'Patient Flow' },
  { to: '/app/queue', icon: 'fa-solid fa-timeline', label: 'Appointments' },
  { to: '/app/patients', icon: 'fa-solid fa-hospital-user', label: 'Patients' },
  { to: '/app/crm', icon: 'fa-solid fa-handshake', label: 'CRM Leads' },
  { to: '/app/appointments', icon: 'fa-solid fa-calendar-check', label: 'Bookings' },
  { to: '/app/records', icon: 'fa-solid fa-file-medical', label: 'Medical Records' },
  { to: '/app/labs', icon: 'fa-solid fa-flask-vial', label: 'Laboratory' },
  { to: '/app/doctors', icon: 'fa-solid fa-user-doctor', label: 'Doctors' },
  { to: '/app/billing', icon: 'fa-solid fa-file-invoice-dollar', label: 'Billing' },
  { to: '/app/expenses', icon: 'fa-solid fa-coins', label: 'Expenses' },
  { to: '/app/payroll', icon: 'fa-solid fa-money-check-dollar', label: 'Payroll' },
  { to: '/app/accounting', icon: 'fa-solid fa-scale-balanced', label: 'Accounting & GL' },
  { to: '/app/payments', icon: 'fa-solid fa-credit-card', label: 'Payments & Gateways' },
  { to: '/app/manufacturing', icon: 'fa-solid fa-building-columns', label: 'Fixed Assets' },
  { to: '/app/hospital-reports', icon: 'fa-solid fa-chart-line', label: 'Reports' },
]

const SCHOOL_NAV: NavItem[] = [
  { to: '/app', icon: 'fa-solid fa-gauge-high', label: 'Dashboard', end: true },
  { to: '/app/students', icon: 'fa-solid fa-user-graduate', label: 'Students' },
  { to: '/app/crm', icon: 'fa-solid fa-handshake', label: 'Admissions CRM' },
  { to: '/app/classes', icon: 'fa-solid fa-chalkboard', label: 'Classes & Teachers' },
  { to: '/app/timetable', icon: 'fa-solid fa-calendar-week', label: 'Timetable' },
  { to: '/app/attendance', icon: 'fa-solid fa-clipboard-check', label: 'Attendance' },
  { to: '/app/teaching', icon: 'fa-solid fa-person-chalkboard', label: 'My Teaching' },
  { to: '/app/teaching-performance', icon: 'fa-solid fa-chalkboard-user', label: 'Teaching Activity' },
  { to: '/app/grades', icon: 'fa-solid fa-star-half-stroke', label: 'Grades' },
  { to: '/app/report-cards', icon: 'fa-solid fa-award', label: 'Report Cards' },
  { to: '/app/fees', icon: 'fa-solid fa-money-bill-wave', label: 'Fees' },
  { to: '/app/announcements', icon: 'fa-solid fa-bullhorn', label: 'Announcements' },
  { to: '/app/expenses', icon: 'fa-solid fa-coins', label: 'Expenses' },
  { to: '/app/payroll', icon: 'fa-solid fa-money-check-dollar', label: 'Payroll' },
  { to: '/app/accounting', icon: 'fa-solid fa-scale-balanced', label: 'Accounting & GL' },
  { to: '/app/payments', icon: 'fa-solid fa-credit-card', label: 'Payments & Gateways' },
  { to: '/app/manufacturing', icon: 'fa-solid fa-building-columns', label: 'Fixed Assets' },
  { to: '/app/school-reports', icon: 'fa-solid fa-chart-line', label: 'Reports' },
]

function navFor(type: string): NavItem[] {
  if (type === 'hospital') return HOSPITAL_NAV
  if (type === 'school') return SCHOOL_NAV
  return RETAIL_NAV
}

export default function Shell({ children }: { children: ReactNode }): JSX.Element {
  const { me, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('afro-sidebar-collapsed') === '1'
    } catch {
      return false
    }
  })
  const [notifOpen, setNotifOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [alerts, setAlerts] = useState<WorkspaceAlert[]>([])
  const [readIds, setReadIds] = useState<string[]>([])
  const topbarActionsRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const tenant = me?.tenant
  const firmType = tenant?.business_type || 'store'
  const baseItems = tenant ? navFor(tenant.business_type) : []
  const initials = (me?.full_name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const { dark, toggle: toggleTheme } = useTheme()

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem('afro-sidebar-collapsed', next ? '1' : '0')
      } catch {
        // Ignore storage errors
      }
      return next
    })
  }

  useEffect(() => {
    document.documentElement.setAttribute('data-firm', firmType)
    return () => {
      document.documentElement.removeAttribute('data-firm')
    }
  }, [firmType])

  useEffect(() => {
    if (!me) return
    let cancelled = false
    const fetchFeed = (): void => {
      api
        .get<{ alerts: WorkspaceAlert[] }>('/notifications/feed')
        .then((res) => {
          if (!cancelled) setAlerts(Array.isArray(res.alerts) ? res.alerts : [])
        })
        .catch(() => {
          if (!cancelled) setAlerts([])
        })
    }
    fetchFeed()
    const onRefresh = (): void => fetchFeed()
    window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, onRefresh)
    return () => {
      cancelled = true
      window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, onRefresh)
    }
  }, [me, location.pathname])

  useEffect(() => {
    if (!notifOpen && !searchOpen) return
    const onMouseDown = (e: MouseEvent) => {
      if (topbarActionsRef.current && !topbarActionsRef.current.contains(e.target as Node)) {
        setNotifOpen(false)
        setSearchOpen(false)
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setNotifOpen(false)
        setSearchOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [notifOpen, searchOpen])

  useEffect(() => {
    if (searchOpen) {
      requestAnimationFrame(() => searchInputRef.current?.focus())
    }
  }, [searchOpen])

  // Function to determine if a nav item should be shown based on user permissions and role
  const shouldShowNavItem = (item: NavItem): boolean => {
    // Owner and afrotech_admin see everything
    if (me?.role === 'owner' || me?.role === 'afrotech_admin') return true

    const permissions = me?.permissions ?? []

    // Define permission requirements for each nav item
    switch (item.to) {
      case '/app/reception':
        // Reception: visits.manage OR appointments.manage
        return permissions.includes('visits.manage') || permissions.includes('appointments.manage')
      case '/app/flow':
        // Patient Flow: visits.view
        return permissions.includes('visits.view')
      case '/app/labs':
        // Laboratory: orders.lab OR orders.create
        return permissions.includes('orders.lab') || permissions.includes('orders.create')
      case '/app/billing':
        // Billing: billing.view OR cash_drawer.view
        return permissions.includes('billing.view') || permissions.includes('cash_drawer.view')
      case '/app/doctors':
        // Team/Doctors: owner OR users.manage (team management)
        return permissions.includes('users.manage')
      case '/app/users':
        // Team page (from owner menu): owner OR users.manage
        return permissions.includes('users.manage')
      case '/app/settings':
        // Settings: owner OR settings.manage
        return permissions.includes('settings.manage')
      case '/app/marketing':
        // Marketing: owner OR marketing.manage (assuming we have such a permission)
        return permissions.includes('marketing.manage')
      case '/app/bot-studio':
        // Telegram Bot Studio: owner OR telegram.manage (assuming)
        return permissions.includes('telegram.manage')
      case '/app/subscription':
        // Subscription: owner OR billing.manage (for subscription management)
        return permissions.includes('billing.manage')
      case '/app':
        // Dashboard: always show (at least one permission should allow dashboard view)
        return true
      case '/app/pos':
        // New Sale: sales.create
        return permissions.includes('sales.create')
      case '/app/cashdrawer':
        // Cash Drawer: cash_drawer.view
        return permissions.includes('cash_drawer.view')
      case '/app/sales':
        // Sales History: sales.view
        return permissions.includes('sales.view')
      case '/app/products':
        // Products: inventory.manage
        return permissions.includes('inventory.manage')
      case '/app/orders':
        return permissions.includes('sales.view') || permissions.includes('purchases.view')
      case '/app/warehouses':
        return permissions.includes('inventory.view') || permissions.includes('inventory.manage')
      case '/app/manufacturing':
        return permissions.includes('inventory.manage') || permissions.includes('billing.view') || permissions.includes('payments.view')
      case '/app/purchases':
        // Purchases: purchases.create
        return permissions.includes('purchases.create')
      case '/app/stock':
        // Stock Adjustments: inventory.adjust
        return permissions.includes('inventory.adjust')
      case '/app/expiry':
        // Expiry: inventory.view (to view expiring items)
        return permissions.includes('inventory.view')
      case '/app/suppliers':
        // Suppliers: purchases.view
        return permissions.includes('purchases.view')
      case '/app/customers':
        // Customers: customers.view (assuming we have such a permission)
        return permissions.includes('customers.view')
      case '/app/crm':
        return permissions.includes('customers.view') || permissions.includes('patients.view') || permissions.includes('students.view')
      case '/app/credit':
        // Credit (Khata): payments.view
        return permissions.includes('payments.view')
      case '/app/finance':
        // Expenses: payments.view OR payments.create
        return permissions.includes('payments.view') || permissions.includes('payments.create')
      case '/app/accounting':
        return permissions.includes('payments.view') || permissions.includes('billing.view') || permissions.includes('reports.view')
      case '/app/payments':
        return permissions.includes('payments.view') || permissions.includes('billing.view') || permissions.includes('fees.view')
      case '/app/reports':
        // Reports: reports.view
        return permissions.includes('reports.view')
      case '/app/queue':
        // Appointments: appointments.view
        return permissions.includes('appointments.view')
      case '/app/patients':
        // Patients: patients.view
        return permissions.includes('patients.view')
      case '/app/records':
        // Medical Records: records.view
        return permissions.includes('records.view')
      case '/app/hospital-reports':
        // Hospital Reports: reports.view
        return permissions.includes('reports.view')
      case '/app/classes':
        // Classes & Teachers: students.view
        return permissions.includes('students.view')
      case '/app/timetable':
        // Timetable: timetable.view
        return permissions.includes('timetable.view')
      case '/app/attendance':
        // Attendance: attendance.view
        return permissions.includes('attendance.view')
      case '/app/teaching':
        // My Teaching (teacher self-service): teaching.own
        return permissions.includes('teaching.own')
      case '/app/teaching-performance':
        // Teaching Activity dashboard: teaching.view
        return permissions.includes('teaching.view')
      case '/app/grades':
        // Grades: grades.view
        return permissions.includes('grades.view')
      case '/app/report-cards':
        // Report Cards: report_cards.generate
        return permissions.includes('report_cards.generate')
      case '/app/fees':
        // Fees: fees.view
        return permissions.includes('fees.view')
      case '/app/announcements':
        // Announcements: announcements.view
        return permissions.includes('announcements.view')
      case '/app/school-reports':
        // School Reports: reports.view
        return permissions.includes('reports.view')
      default:
        // For any other item, show by default (or we could hide)
        return true
    }
  }

  // Filter the base items based on permissions
  const items = baseItems.filter(shouldShowNavItem)
  const ownerMenuItems: NavItem[] =
    me?.role === 'owner' && tenant
      ? [
          { to: '/app/users', icon: 'fa-solid fa-users-gear', label: 'Team' },
          { to: '/app/settings', icon: 'fa-solid fa-gear', label: 'Settings' },
          { to: '/app/bot-studio', icon: 'fa-solid fa-robot', label: 'My Telegram Bot' },
          { to: '/app/marketing', icon: 'fa-solid fa-bullhorn', label: 'Marketing' },
          { to: '/app/subscription', icon: 'fa-solid fa-receipt', label: 'Subscription' },
        ]
      : []
  const searchableItems = [...items, ...ownerMenuItems]
  const filteredSearchItems = filterQuickSearchItems(searchableItems, searchQuery)
  const currentPageTitle = resolvePageTitle(location.pathname, searchableItems)
  const unreadCount = countUnreadAlerts(alerts, readIds)
  const canOpenSettings =
    me?.role === 'owner' || me?.role === 'afrotech_admin' || (me?.permissions ?? []).includes('settings.manage')
  const canOpenBotStudio =
    me?.role === 'owner' || me?.role === 'afrotech_admin' || (me?.permissions ?? []).includes('telegram.manage')

  return (
    <div className={`pl-root pl-firm-${firmType}`} data-firm={firmType}>
      {open && <div className="pl-scrim" onClick={() => setOpen(false)} />}
      <div className={`pl-shell ${open ? 'sidebar-open' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
        <aside className={`pl-sidebar ${open ? 'open' : ''} ${collapsed ? 'collapsed' : ''}`}>
          <div className="pl-side-brand">
            <div className="pl-brand-wordmark">AFRO<span>SUITE</span></div>
            <div className="pl-side-actions">
              {tenant && (
                <span className={`pl-firm-pill ${firmType}`}>
                  <i className={FIRM_ICONS[firmType] || 'fa-solid fa-building'} aria-hidden="true" />
                  {firmType}
                </span>
              )}
              <button
                type="button"
                className="pl-theme-toggle pl-collapse-btn"
                onClick={toggleCollapsed}
                title={collapsed ? 'Expand sidebar' : 'Minimize sidebar'}
                aria-label={collapsed ? 'Expand sidebar' : 'Minimize sidebar'}
                aria-expanded={!collapsed}
                data-testid="sidebar-collapse-btn"
              >
                <i className={collapsed ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left'} aria-hidden="true" />
              </button>
            </div>
          </div>
          <nav className="pl-nav" aria-label="Main">
            {items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setOpen(false)}
                title={item.label}
                aria-label={item.label}
              >
                <i className={item.icon} aria-hidden="true" />
                <span className="pl-nav-label">{item.label}</span>
              </NavLink>
            ))}
            {(me?.role === 'afrotech_admin') && (
              <NavLink to="/app" end title="Admin Panel" aria-label="Admin Panel">
                <i className="fa-solid fa-shield-halved" aria-hidden="true" />
                <span className="pl-nav-label">Admin Panel</span>
              </NavLink>
            )}
            {ownerMenuItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setOpen(false)}
                title={item.label}
                aria-label={item.label}
              >
                <i className={item.icon} aria-hidden="true" />
                <span className="pl-nav-label">{item.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="pl-side-foot">
            <div className="pl-user-chip" title={me?.full_name || 'User'}>
              <span className="pl-avatar">{initials}</span>
              <div className="pl-user-meta">
                <strong>{me?.full_name}</strong>
                <small>{tenant ? `${me?.role} · ${tenant.name}` : me?.role.replace('_', ' ')}</small>
              </div>
            </div>

            <button
              type="button"
              className="pl-btn pl-btn-ghost pl-btn-sm pl-signout-btn"
              style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
              title="Sign out"
              aria-label="Sign out"
              onClick={() => {
                logout()
                navigate('/app/login')
              }}
            >
              <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" />
              <span className="pl-nav-label">Sign out</span>
            </button>
          </div>
        </aside>

        <div className="pl-content-col">
          <header className="pl-topbar" role="banner">
            <div className="pl-topbar-left">
              <button
                type="button"
                className="pl-menu-toggle"
                onClick={() => setOpen(true)}
                aria-label="Open menu"
              >
                <i className="fa-solid fa-bars" aria-hidden="true" />
              </button>
              <div className="pl-topbar-title-wrap">
                <span className="pl-topbar-title">{currentPageTitle}</span>
                {tenant && <span className="pl-topbar-tenant">{tenant.name}</span>}
              </div>
            </div>

            <div className="pl-topbar-actions" ref={topbarActionsRef}>
              <div className="pl-topbar-item">
                <button
                  type="button"
                  className="pl-topbar-icon-btn"
                  onClick={() => {
                    setSearchOpen((o) => !o)
                    setNotifOpen(false)
                  }}
                  title="Quick search"
                  aria-label="Quick search"
                  aria-expanded={searchOpen}
                  data-testid="topbar-search-btn"
                >
                  <i className="fa-solid fa-magnifying-glass" aria-hidden="true" />
                </button>

                {searchOpen && (
                  <div className="pl-top-popover pl-search-popover" role="dialog" aria-label="Quick navigation">
                    <div className="pl-popover-head">
                      <span>Quick Jump</span>
                    </div>
                    <input
                      ref={searchInputRef}
                      type="search"
                      className="pl-input pl-popover-search"
                      placeholder="Jump to module..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      aria-label="Search modules"
                    />
                    <div className="pl-popover-list">
                      {filteredSearchItems.length === 0 ? (
                        <div className="pl-popover-empty">No matching module</div>
                      ) : (
                        filteredSearchItems.slice(0, 8).map((item) => (
                          <button
                            key={item.to}
                            type="button"
                            className="pl-popover-row"
                            onClick={() => {
                              navigate(item.to)
                              setSearchOpen(false)
                              setSearchQuery('')
                            }}
                          >
                            <i className={item.icon} aria-hidden="true" />
                            <span>{item.label}</span>
                          </button>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <div className="pl-topbar-item">
                <button
                  type="button"
                  className="pl-topbar-icon-btn"
                  onClick={() => {
                    setNotifOpen((o) => !o)
                    setSearchOpen(false)
                  }}
                  title="Notifications"
                  aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
                  aria-expanded={notifOpen}
                  data-testid="topbar-notifications-btn"
                >
                  <i className="fa-solid fa-bell" aria-hidden="true" />
                  {unreadCount > 0 && (
                    <span className="pl-bell-badge" aria-hidden="true">
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {notifOpen && (
                  <div className="pl-top-popover pl-notif-popover" role="dialog" aria-label="Workspace notifications">
                    <div className="pl-popover-head">
                      <span>Notifications</span>
                      {alerts.length > 0 && unreadCount > 0 && (
                        <button
                          type="button"
                          className="pl-popover-action"
                          onClick={() => setReadIds(alerts.map((a) => a.id))}
                        >
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div className="pl-popover-list">
                      {alerts.length === 0 ? (
                        <div className="pl-popover-empty">All caught up — no active alerts</div>
                      ) : (
                        alerts.map((alert) => {
                          const isRead = readIds.includes(alert.id)
                          return (
                            <button
                              key={alert.id}
                              type="button"
                              className={`pl-notif-row ${isRead ? 'read' : 'unread'}`}
                              onClick={() => {
                                setReadIds((prev) => (prev.includes(alert.id) ? prev : [...prev, alert.id]))
                                setNotifOpen(false)
                                navigate(alert.route)
                              }}
                            >
                              <i className={`${alert.icon} severity-${alert.severity}`} aria-hidden="true" />
                              <div className="pl-notif-text">
                                <strong>{alert.title}</strong>
                                <small>{alert.detail}</small>
                              </div>
                            </button>
                          )
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {canOpenBotStudio && (
                <button
                  type="button"
                  className="pl-topbar-icon-btn"
                  onClick={() => navigate('/app/bot-studio')}
                  title="Telegram Bot Studio"
                  aria-label="Telegram Bot Studio"
                  data-testid="topbar-bot-btn"
                >
                  <i className="fa-solid fa-robot" aria-hidden="true" />
                </button>
              )}

              {canOpenSettings && (
                <button
                  type="button"
                  className="pl-topbar-icon-btn"
                  onClick={() => navigate('/app/settings')}
                  title="Workspace Settings"
                  aria-label="Workspace Settings"
                  data-testid="topbar-settings-btn"
                >
                  <i className="fa-solid fa-gear" aria-hidden="true" />
                </button>
              )}

              <button
                type="button"
                className="pl-theme-toggle pl-topbar-icon-btn"
                onClick={toggleTheme}
                title={dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                aria-label={dark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
                data-testid="topbar-theme-toggle"
              >
                <i className={dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon'} aria-hidden="true" />
              </button>
            </div>
          </header>

          <main className="pl-main" id="main-content">
            {children}
          </main>
        </div>
      </div>
    </div>
  )
}