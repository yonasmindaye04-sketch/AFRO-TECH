import { useState, type ReactNode } from 'react'
import { NavLink, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

interface NavItem {
  to: string
  icon: string
  label: string
  end?: boolean
}

const RETAIL_NAV: NavItem[] = [
  { to: '/app', icon: 'fa-solid fa-gauge-high', label: 'Dashboard', end: true },
  { to: '/app/pos', icon: 'fa-solid fa-cash-register', label: 'New Sale' },
  { to: '/app/cashdrawer', icon: 'fa-solid fa-vault', label: 'Cash Drawer' },
  { to: '/app/sales', icon: 'fa-solid fa-receipt', label: 'Sales History' },
  { to: '/app/products', icon: 'fa-solid fa-boxes-stacked', label: 'Products' },
  { to: '/app/purchases', icon: 'fa-solid fa-truck-ramp-box', label: 'Purchases' },
  { to: '/app/stock', icon: 'fa-solid fa-sliders', label: 'Stock Adjustments' },
  { to: '/app/expiry', icon: 'fa-solid fa-hourglass-half', label: 'Expiry' },
  { to: '/app/suppliers', icon: 'fa-solid fa-truck-field', label: 'Suppliers' },
  { to: '/app/customers', icon: 'fa-solid fa-users', label: 'Customers' },
  { to: '/app/credit', icon: 'fa-solid fa-hand-holding-dollar', label: 'Credit (Khata)' },
  { to: '/app/finance', icon: 'fa-solid fa-coins', label: 'Expenses' },
  { to: '/app/reports', icon: 'fa-solid fa-chart-line', label: 'Reports' },
]

const HOSPITAL_NAV: NavItem[] = [
  { to: '/app', icon: 'fa-solid fa-gauge-high', label: 'Dashboard', end: true },
  { to: '/app/queue', icon: 'fa-solid fa-timeline', label: 'Patient Queue' },
  { to: '/app/patients', icon: 'fa-solid fa-hospital-user', label: 'Patients' },
  { to: '/app/appointments', icon: 'fa-solid fa-calendar-check', label: 'Appointments' },
  { to: '/app/records', icon: 'fa-solid fa-file-medical', label: 'Medical Records' },
  { to: '/app/labs', icon: 'fa-solid fa-flask-vial', label: 'Laboratory' },
  { to: '/app/doctors', icon: 'fa-solid fa-user-doctor', label: 'Doctors' },
  { to: '/app/billing', icon: 'fa-solid fa-file-invoice-dollar', label: 'Billing' },
  { to: '/app/hospital-reports', icon: 'fa-solid fa-chart-line', label: 'Reports' },
]

const SCHOOL_NAV: NavItem[] = [
  { to: '/app', icon: 'fa-solid fa-gauge-high', label: 'Dashboard', end: true },
  { to: '/app/students', icon: 'fa-solid fa-user-graduate', label: 'Students' },
  { to: '/app/classes', icon: 'fa-solid fa-chalkboard', label: 'Classes & Teachers' },
  { to: '/app/timetable', icon: 'fa-solid fa-calendar-week', label: 'Timetable' },
  { to: '/app/attendance', icon: 'fa-solid fa-clipboard-check', label: 'Attendance' },
  { to: '/app/grades', icon: 'fa-solid fa-star-half-stroke', label: 'Grades' },
  { to: '/app/report-cards', icon: 'fa-solid fa-award', label: 'Report Cards' },
  { to: '/app/fees', icon: 'fa-solid fa-money-bill-wave', label: 'Fees' },
  { to: '/app/announcements', icon: 'fa-solid fa-bullhorn', label: 'Announcements' },
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
  const [open, setOpen] = useState(false)
  const tenant = me?.tenant
  const items = tenant ? navFor(tenant.business_type) : []
  const initials = (me?.full_name ?? '?')
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const trialLeft = tenant?.status === 'trial' ? (tenant.trial_days_left ?? 0) : null

  return (
    <div className="pl-root">
      <button type="button" className="pl-menu-toggle" onClick={() => setOpen(true)} aria-label="Open menu">
        <i className="fa-solid fa-bars" aria-hidden="true" />
      </button>
      {open && <div className="pl-scrim" onClick={() => setOpen(false)} />}
      <div className={`pl-shell ${open ? 'sidebar-open' : ''}`}>
        <aside className={`pl-sidebar ${open ? 'open' : ''}`}>
          <div className="pl-side-brand">
            AFRO<span>SUITE</span>
          </div>
          <nav className="pl-nav" aria-label="Main">
            {items.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} onClick={() => setOpen(false)}>
                <i className={item.icon} aria-hidden="true" /> {item.label}
              </NavLink>
            ))}
            {(me?.role === 'afrotech_admin') && (
              <NavLink to="/app" end>
                <i className="fa-solid fa-shield-halved" aria-hidden="true" /> Admin Panel
              </NavLink>
            )}
            {me?.role === 'owner' && tenant && (
              <>
                <NavLink to="/app/users" onClick={() => setOpen(false)}>
                  <i className="fa-solid fa-users-gear" aria-hidden="true" /> Team
                </NavLink>
                <NavLink to="/app/settings" onClick={() => setOpen(false)}>
                  <i className="fa-solid fa-gear" aria-hidden="true" /> Settings
                </NavLink>
              </>
            )}
          </nav>
          <div className="pl-side-foot">
            <div className="pl-user-chip">
              <span className="pl-avatar">{initials}</span>
              <div className="pl-user-meta">
                <strong>{me?.full_name}</strong>
                <small>{tenant ? `${me?.role} · ${tenant.name}` : me?.role.replace('_', ' ')}</small>
              </div>
            </div>
            <button
              type="button"
              className="pl-btn pl-btn-ghost pl-btn-sm"
              style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}
              onClick={() => {
                logout()
                navigate('/app/login')
              }}
            >
              <i className="fa-solid fa-arrow-right-from-bracket" aria-hidden="true" /> Sign out
            </button>
          </div>
        </aside>

        <main className="pl-main" id="main-content">
          {trialLeft !== null && (
            <div className="pl-trial-banner">
              <i className="fa-solid fa-hourglass-half" aria-hidden="true" />
              <span>
                Free trial — <strong>{trialLeft} day{trialLeft === 1 ? '' : 's'} left</strong> for {tenant?.name}. Full access until then.
              </span>
              <a href="/" target="_blank" rel="noreferrer">
                Subscribe with AFRO-TECH →
              </a>
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  )
}
