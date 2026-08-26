import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './AuthContext'
import Shell from './Shell'
import Login from './Login'
import Register from './Register'
import Spinner from './pages/Spinner'
import './platform.css'

const RetailDashboard = lazy(() => import('./retail/RetailDashboard'))
const Products = lazy(() => import('./retail/Products'))
const POS = lazy(() => import('./retail/POS'))
const SalesHistory = lazy(() => import('./retail/SalesHistory'))
const Purchases = lazy(() => import('./retail/Purchases'))
const Partners = lazy(() => import('./retail/Partners'))
const Finance = lazy(() => import('./retail/Finance'))
const StockAdjustments = lazy(() => import('./retail/StockAdjustments'))
const Expiry = lazy(() => import('./retail/Expiry'))
const Credit = lazy(() => import('./retail/Credit'))
const RetailReports = lazy(() => import('./retail/Reports'))
const CashDrawer = lazy(() => import('./retail/CashDrawer'))

const HospitalDashboard = lazy(() => import('./hospital/HospitalDashboard'))
const Patients = lazy(() => import('./hospital/Patients'))
const Appointments = lazy(() => import('./hospital/Appointments'))
const Records = lazy(() => import('./hospital/Records'))
const Doctors = lazy(() => import('./hospital/Doctors'))
const Billing = lazy(() => import('./hospital/Billing'))
const Queue = lazy(() => import('./hospital/Queue'))
const Labs = lazy(() => import('./hospital/Labs'))
const HospitalReports = lazy(() => import('./hospital/HospitalReports'))

const SchoolDashboard = lazy(() => import('./school/SchoolDashboard'))
const Students = lazy(() => import('./school/Students'))
const Classes = lazy(() => import('./school/Classes'))
const Attendance = lazy(() => import('./school/Attendance'))
const Grades = lazy(() => import('./school/Grades'))
const Fees = lazy(() => import('./school/Fees'))
const Timetable = lazy(() => import('./school/Timetable'))
const ReportCards = lazy(() => import('./school/ReportCards'))
const Announcements = lazy(() => import('./school/Announcements'))
const SchoolReports = lazy(() => import('./school/SchoolReports'))

const AdminPanel = lazy(() => import('./admin/AdminPanel'))
const Team = lazy(() => import('./pages/Team'))
const Settings = lazy(() => import('./pages/Settings'))

function Blocked({ icon, title, body }: { icon: string; title: string; body: string }): JSX.Element {
  const { logout } = useAuth()
  return (
    <div className="pl-auth">
      <div className="pl-blocked">
        <div>
          <i className={icon} aria-hidden="true" />
          <h1>{title}</h1>
          <p>{body}</p>
          <p style={{ marginTop: 4 }}>
            <strong style={{ color: 'var(--text)' }}>AFRO-TECH</strong> · +251-910-011-818 · yonasmindaye04@gmail.com
          </p>
          <button
            type="button"
            className="pl-btn pl-btn-primary"
            onClick={() => {
              logout()
              window.location.href = '/app/login'
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}

/** Guards everything under /app — auth + tenant health checks. */
function Gate({ children }: { children: JSX.Element }): JSX.Element {
  const { me, ready } = useAuth()
  const location = useLocation()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  if (!ready) return <Spinner label="Loading your workspace…" />
  if (!me) return <Navigate to="/app/login" replace />

  if (location.pathname === '/app/login' || location.pathname === '/app/register') return <Navigate to="/app" replace />
  return children
}

function Inner(): JSX.Element {
  const { me } = useAuth()
  const isAdminRoute = me?.role === 'afrotech_admin'

  if (me && me.tenant && (me.tenant.status === 'expired' || me.tenant.status === 'suspended')) {
    return me.tenant.status === 'expired' ? (
      <Blocked
        icon="fa-solid fa-hourglass-end"
        title="Your free trial has ended"
        body={`The 45-day trial for ${me.tenant.name} is complete. Your data is safe — contact AFRO-TECH to subscribe and pick up right where you left off.`}
      />
    ) : (
      <Blocked
        icon="fa-solid fa-lock"
        title="Workspace suspended"
        body={`Access to ${me.tenant.name} has been suspended by AFRO-TECH. Please contact support to resolve this.`}
      />
    )
  }

  return (
    <Shell>
      <Suspense fallback={<Spinner />}>
        {isAdminRoute ? (
          <Routes>
            <Route path="*" element={<AdminPanel />} />
          </Routes>
        ) : (
          <Routes>
            <Route index element={<TypeRouter me={me} />} />
            {/* retail */}
            <Route path="pos" element={<POS />} />
            <Route path="sales" element={<SalesHistory />} />
            <Route path="products" element={<Products />} />
            <Route path="purchases" element={<Purchases />} />
            <Route path="suppliers" element={<Partners kind="suppliers" />} />
            <Route path="customers" element={<Partners kind="customers" />} />
            <Route path="finance" element={<Finance />} />
            <Route path="stock" element={<StockAdjustments />} />
            <Route path="expiry" element={<Expiry />} />
            <Route path="credit" element={<Credit />} />
            <Route path="cashdrawer" element={<CashDrawer />} />
            <Route path="reports" element={<RetailReports />} />
            {/* hospital */}
            <Route path="queue" element={<Queue />} />
            <Route path="patients" element={<Patients />} />
            <Route path="appointments" element={<Appointments />} />
            <Route path="records" element={<Records />} />
            <Route path="doctors" element={<Doctors />} />
            <Route path="labs" element={<Labs />} />
            <Route path="billing" element={<Billing />} />
            <Route path="hospital-reports" element={<HospitalReports />} />
            {/* school */}
            <Route path="students" element={<Students />} />
            <Route path="classes" element={<Classes />} />
            <Route path="timetable" element={<Timetable />} />
            <Route path="attendance" element={<Attendance />} />
            <Route path="grades" element={<Grades />} />
            <Route path="report-cards" element={<ReportCards />} />
            <Route path="fees" element={<Fees />} />
            <Route path="announcements" element={<Announcements />} />
            <Route path="school-reports" element={<SchoolReports />} />
            {/* shared */}
            <Route path="users" element={me?.role === 'owner' ? <Team /> : <Navigate to="/app" replace />} />
            <Route path="settings" element={me?.role === 'owner' ? <Settings /> : <Navigate to="/app" replace />} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        )}
      </Suspense>
    </Shell>
  )
}

function TypeRouter({ me }: { me: ReturnType<typeof useAuth>['me'] }): JSX.Element {
  const type = me?.tenant?.business_type
  if (type === 'hospital') return <HospitalDashboard />
  if (type === 'school') return <SchoolDashboard />
  return <RetailDashboard />
}

export default function PlatformRoot(): JSX.Element {
  return (
    <AuthProvider>
      <Routes>
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Register />} />
        <Route
          path="*"
          element={
            <Gate>
              <Inner />
            </Gate>
          }
        />
      </Routes>
    </AuthProvider>
  )
}
