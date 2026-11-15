import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { useLanguage } from '../context/languageCtx'

const SYSTEMS = [
  {
    type: 'pharmacy',
    icon: 'fa-solid fa-pills',
    color: '#34d399',
    name: 'Pharmacy Management',
    tagline: 'Run your pharmacy like a chain — with ERP-grade accounting & stock.',
    features: [
      'POS checkout, thermal receipts & cash drawer shifts',
      'Batch & FEFO expiry alerts + multi-warehouse transfers',
      'Quotations, Sales Orders, Purchase Orders & Stock Ledger',
      'Double-entry Chart of Accounts, P&L & Balance Sheet',
      'Payment Entries, supplier payables & customer credit',
      'CRM leads pipeline, payroll & expense management',
    ],
  },
  {
    type: 'store',
    icon: 'fa-solid fa-store',
    color: '#c8963c',
    name: 'Store & Manufacturing ERP',
    tagline: 'Commerce, BOM production, warehouses, and accounting in one place.',
    features: [
      'Quote-to-Order-to-Invoice & PO-to-Stock Receipt workflows',
      'Multi-warehouse stock ledger & 1-click reorder alerts',
      'Bills of Materials (BOM), Work Orders & Fixed Assets',
      'General Ledger, Journal Entries & Financial Statements',
      'Barcode POS, supplier returns & customer credit limits',
      'Payroll engine, staff RBAC & Telegram bot automation',
    ],
  },
  {
    type: 'hospital',
    icon: 'fa-solid fa-hospital',
    color: '#60a5fa',
    name: 'Hospital / Clinic Management',
    tagline: 'From reception triage to EMR charting and instant billing.',
    features: [
      'Live Patient Flow board across clinical departments',
      'Reception queue, appointments & doctor schedules',
      'Medical records (EMR), prescriptions & lab orders',
      '1-click Bill Visit from clinical notes to patient invoice',
      'Split payments, Payment Entries & Chart of Accounts sync',
      'CRM patient inquiries, pharmacy stock & revenue analytics',
    ],
  },
  {
    type: 'school',
    icon: 'fa-solid fa-graduation-cap',
    color: '#c084fc',
    name: 'School Management',
    tagline: 'Enrollment, timetable, teaching monitor, and accounting.',
    features: [
      'Student files, classes & guardian Telegram notifications',
      'Weekly timetables & live teaching session monitoring',
      'Attendance registers, continuous grades & report cards',
      'Bulk class fee assignment, receipts & part-payments',
      'Double-entry tuition ledger, expenses & staff payroll',
      'Admissions CRM pipeline & academic performance insights',
    ],
  },
] as const

export default function ProductsPage(): JSX.Element {
  const { t } = useLanguage()

  return (
    <>
      {/* The global skip-link lives in index.html — no page-level duplicate here. */}
      <Navbar />
      <main id="main-content" style={{ paddingTop: 90 }}>
        <section style={{ padding: '60px 6%', textAlign: 'center' }}>
          <p style={{ color: 'var(--accent)', fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', fontSize: '.85rem', marginBottom: 14 }}>
            {t('products.eyebrow')}
          </p>
          <h1 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: 'clamp(1.9rem,4.5vw,3rem)', lineHeight: 1.15, maxWidth: 840, margin: '0 auto' }}>
            {t('products.titleStart')}<span style={{ color: 'var(--accent)' }}>{t('products.titleHighlight')}</span>{t('products.titleEnd')}
          </h1>
          <p style={{ color: 'var(--text-dim)', maxWidth: 680, margin: '18px auto 0', fontSize: '1.05rem' }}>
            {t('products.sub')}
          </p>
          <div style={{ display: 'flex', gap: 14, justifyContent: 'center', marginTop: 28, flexWrap: 'wrap' }}>
            <Link to="/app/login" className="btn-primary" style={{ textDecoration: 'none' }}>
              {t('products.openDemo')} <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            </Link>
            <Link to="/app/register" className="btn-ghost" style={{ textDecoration: 'none', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border2)' }}>
              {t('products.startTrial')}
            </Link>
            <Link to="/app/login" className="btn-ghost" style={{ textDecoration: 'none', background: 'transparent', color: 'var(--text)', border: '1px solid var(--border)' }}>
              {t('products.signIn')}
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
                <i className={s.icon} aria-hidden="true" style={{ color: s.color, fontSize: '1.9rem' }} />
                <div>
                  <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1.2rem', marginBottom: 6 }}>{t(`products.sys.${s.type}.name`)}</h2>
                  <p style={{ color: 'var(--text-dim)', fontSize: '.92rem' }}>{t(`products.sys.${s.type}.tagline`)}</p>
                </div>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 9, flex: 1 }}>
                  {s.features.map((f) => (
                    <li key={f} style={{ fontSize: '.92rem', display: 'flex', gap: 10, alignItems: 'baseline' }}>
                      <i className="fa-solid fa-check" aria-hidden="true" style={{ color: s.color, fontSize: '.78rem' }} />
                      {f}
                    </li>
                  ))}
                </ul>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <Link
                    to={`/app/register?type=${s.type}`}
                    className="btn-primary"
                    style={{ textDecoration: 'none', flex: 1, justifyContent: 'center', padding: '12px 16px' }}
                  >
                    {t('products.startFree')}
                  </Link>
                  <Link
                    to="/app/login"
                    className="btn-ghost"
                    style={{ textDecoration: 'none', background: 'transparent', color: 'var(--text)', border: '1px solid var(--border2)', padding: '12px 16px', justifyContent: 'center' }}
                  >
                    {t('products.liveDemo')}
                  </Link>
                </div>
              </article>
            ))}
          </div>

          <div
            style={{
              maxWidth: 960,
              margin: '50px auto 0',
              textAlign: 'center',
              border: '1px solid var(--border)',
              borderRadius: 18,
              padding: '30px clamp(18px, 4vw, 44px)',
              background: 'var(--surface)',
            }}
          >
            <h2 style={{ fontFamily: "'Space Grotesk',sans-serif", fontSize: '1.25rem', marginBottom: 10 }}>
              {t('products.howTitle')}
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
              {([0, 1, 2] as const).map((i) => (
                <li key={i} style={{ maxWidth: 260, textAlign: 'left' }}>
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
                  <strong style={{ display: 'block', marginBottom: 4 }}>{t(`products.how${i}.title`)}</strong>
                  <span style={{ color: 'var(--text-dim)', fontSize: '.88rem' }}>{t(`products.how${i}.desc`)}</span>
                </li>
              ))}
            </ol>
          </div>
        </section>
      </main>
      <footer role="contentinfo" style={{ borderTop: '1px solid var(--border)', padding: '26px 6%', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
        <span style={{ color: 'var(--text-dim)', fontSize: '.88rem' }}>{t('footer.copy')}</span>
        <span style={{ color: 'var(--text-dim)', fontSize: '.88rem' }}>
          +251-910-011-818 · yonasmindaye04@gmail.com
        </span>
      </footer>
    </>
  )
}
