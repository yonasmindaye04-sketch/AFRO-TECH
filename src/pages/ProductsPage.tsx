import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'

const SYSTEMS = [
  {
    type: 'pharmacy',
    icon: 'fa-solid fa-pills',
    color: '#34d399',
    name: 'Pharmacy Management',
    tagline: 'Run your pharmacy like a chain — from day one.',
    features: ['Point-of-sale with receipt printing', 'Batch & expiry tracking (FEFO)', 'Purchases & supplier balances', 'Sales history with refunds', 'Profit, low-stock & expiry alerts', 'Cash drawer & expenses'],
  },
  {
    type: 'store',
    icon: 'fa-solid fa-store',
    color: '#c8963c',
    name: 'Store Management',
    tagline: 'Inventory and sales for shops of any size.',
    features: ['Fast POS checkout', 'Product catalog & categories', 'Stock receiving via purchases', 'Suppliers & customers', 'Expenses tracking', 'Daily & monthly reports'],
  },
  {
    type: 'hospital',
    icon: 'fa-solid fa-hospital',
    color: '#60a5fa',
    name: 'Hospital / Clinic Management',
    tagline: 'Patients, doctors and billing in one place.',
    features: ['Patient files with auto IDs', 'Appointment scheduling', 'Medical records & prescriptions', 'Doctor directory & fees', 'Invoices with part payments', 'Daily schedule dashboard'],
  },
  {
    type: 'school',
    icon: 'fa-solid fa-graduation-cap',
    color: '#c084fc',
    name: 'School Management',
    tagline: 'From enrollment to report cards.',
    features: ['Student registration & classes', 'Attendance registers', 'Grade recording per subject', 'Fee assignment to whole classes', 'Payment tracking', 'Attendance trend dashboard'],
  },
] as const

export default function ProductsPage(): JSX.Element {
  return (
    <>
      <a href="#main-content" className="skip-to-content">
        Skip to main content
      </a>
      <Navbar />
      <main id="main-content" style={{ paddingTop: 90 }}>
        <section style={{ padding: '60px 6%', textAlign: 'center' }}>
          <p style={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', fontSize: '.85rem', marginBottom: 14 }}>
            AFRO Suite · Ready-to-use business systems
          </p>
          <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(1.9rem,4.5vw,3rem)', lineHeight: 1.15, maxWidth: 820, margin: '0 auto' }}>
            Don't just see our work — <span style={{ color: 'var(--accent)' }}>use it</span> in your own company today
          </h1>
          <p style={{ color: 'var(--text-dim)', maxWidth: 640, margin: '18px auto 0', fontSize: '1.05rem' }}>
            Register your company, invite your team, and start working with your own real data in minutes. Free for{' '}
            <strong style={{ color: 'var(--text)' }}>45 days</strong>, full features. Each company gets a private, isolated workspace.
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
            <Link to="/app/register" className="btn-primary" style={{ textDecoration: 'none' }}>
              Start free trial <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            </Link>
            <Link to="/app/login" className="btn-ghost" style={{ textDecoration: 'none', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border2)' }}>
              Sign in
            </Link>
          </div>
        </section>

        <section style={{ padding: '20px 6% 80px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, maxWidth: 1400, margin: '0 auto' }}>
            {SYSTEMS.map((s) => (
              <article
                key={s.type}
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 18,
                  padding: '26px 24px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                }}
              >
                <span
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    display: 'grid',
                    placeItems: 'center',
                    background: `${s.color}1c`,
                    color: s.color,
                    fontSize: '1.35rem',
                  }}
                >
                  <i className={s.icon} aria-hidden="true" />
                </span>
                <div>
                  <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1.2rem', marginBottom: 6 }}>{s.name}</h2>
                  <p style={{ color: 'var(--text-dim)', fontSize: '.92rem' }}>{s.tagline}</p>
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
                  {s.features.map((f) => (
                    <li key={f} style={{ fontSize: '.92rem', display: 'flex', gap: 10, alignItems: 'baseline' }}>
                      <i className="fa-solid fa-check" aria-hidden="true" style={{ color: s.color, fontSize: '.78rem' }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  to={`/app/register?type=${s.type}`}
                  className="pl-btn pl-btn-primary"
                  style={{ justifyContent: 'center', textDecoration: 'none', width: '100%' }}
                >
                  Try {s.name.split(' ')[0]} free
                </Link>
              </article>
            ))}
          </div>

          <div
            style={{
              maxWidth: 900,
              margin: '50px auto 0',
              textAlign: 'center',
              border: '1px solid var(--border)',
              borderRadius: 18,
              padding: '30px clamp(18px, 4vw, 44px)',
              background: 'var(--surface)',
            }}
          >
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1.25rem', marginBottom: 10 }}>
              How the free trial works
            </h2>
            <ol
              style={{
                display: 'flex',
                gap: 22,
                justifyContent: 'center',
                flexWrap: 'wrap',
                listStyle: 'none',
                counterReset: 'step',
                marginTop: 16,
              }}
            >
              {[
                ['Register your company', 'Pick your system type and create your workspace — instant access, no credit card.'],
                ['Enter your real data', 'Add your products / patients / students. No dummy data — this becomes your live system.'],
                ['Decide after 45 days', 'Love it? Subscribe with AFRO-TECH and keep everything. Your data is always yours.'],
              ].map(([title, desc], i) => (
                <li key={title} style={{ maxWidth: 250, textAlign: 'left' }}>
                  <span
                    style={{
                      display: 'inline-grid',
                      placeItems: 'center',
                      width: 30,
                      height: 30,
                      borderRadius: '50%',
                      background: 'rgba(var(--accent-rgb), .15)',
                      color: 'var(--accent)',
                      fontWeight: 700,
                      marginBottom: 8,
                    }}
                  >
                    {i + 1}
                  </span>
                  <strong style={{ display: 'block', marginBottom: 4 }}>{title}</strong>
                  <span style={{ color: 'var(--text-dim)', fontSize: '.88rem' }}>{desc}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <footer role="contentinfo" style={{ borderTop: '1px solid var(--border)', padding: '26px 6%', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '.88rem' }}>&copy; 2026 AFRO-TECH · Addis Ababa, Ethiopia</span>
        <span style={{ color: 'var(--text-dim)', fontSize: '.88rem' }}>
          +251-910-011-818 · yonasmindaye04@gmail.com
        </span>
      </footer>
    </>
  )
}
