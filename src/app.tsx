import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Lenis from 'lenis';
import Navbar from './components/Navbar';
import { AfroCoder } from './components/AfroCoder';
import { ServicePayNow } from './components/ServicePayNow';
import { useReveal } from './hooks/useReveal';
import { whatWeDo } from './data';
import { useLanguage } from './context/languageCtx';
import {
  type ContactFieldErrors,
  type ContactFieldName,
  validateContactField,
  validateContactForm,
} from './utils/contactValidation';
import './index.css';

/* ─── DATA (landing-page only) ──────────────────────────────── */
const process_steps = [
  { num:'01', title:'Discovery Call',       desc:'We start with a free call to understand your goals, your customers, and what success looks like for you.' },
  { num:'02', title:'Design & Prototype',   desc:'We craft wireframes and a visual prototype for your approval before writing a single line of code.' },
  { num:'03', title:'Development',          desc:'We build your project with clean, fast, secure and scalable code.' },
  { num:'04', title:'Launch & Support',     desc:'We launch it, show you how it works, and stick around.' },
];

const whyUs = [
  { icon:'fa-solid fa-bolt',        title:'Fast Delivery',      desc:'Most projects delivered in 2–6 weeks with daily progress updates.' },
  { icon:'fa-solid fa-shield-halved',title:'Secure by default',  desc:'SSL, security hardening, and backups on every project.' },
  { icon:'fa-solid fa-headset',     title:'Honest pricing',     desc:'Fixed quotes. No hidden fees, ever.' },
  { icon:'fa-solid fa-chart-line',  title:'Growth focused',     desc:'We build for performance, SEO and conversions — not just looks.' },
  { icon:'fa-solid fa-palette',     title:'Custom design',      desc:'No templates. Every project is designed uniquely for your brand.' },
  { icon:'fa-solid fa-handshake',   title:'We stick around',    desc:'Dedicated support channel after launch — we don\'t disappear.' },
];

const testimonials = [
  { text:'They delivered our corporate website on time and it looks premium. Our sales increased 3x after launch!',       name:'Nahom Eshetu',     title:'CEO, Asella Organic',      initials:'NE' },
  { text:'Best e-commerce platform we ever had. Clean design, blazing fast performance, and outstanding support.',        name:'Selamawit Tesfaye',title:'Founder, Selam Fashion',       initials:'ST' },
  { text:'Our hotel booking system was built perfectly — intuitive, beautiful, and exactly what our guests needed.',      name:'Dawit Mekonnen',   title:'General Manager, Addis Hotel', initials:'DM' },
];

/* ─── SHOWCASE DATA ─────────────────────────────────────────── */
const showcase = [
  {
    name:'ERP & Accounting', icon:'fa-solid fa-layer-group',
    color:'#c8963c',
    sidebar:[
      { label:'Dashboard', icon:'fa-solid fa-gauge-high' },
      { label:'Chart of Accounts', icon:'fa-solid fa-sitemap' },
      { label:'Financial Statements', icon:'fa-solid fa-scale-balanced' },
      { label:'Journal Entries', icon:'fa-solid fa-book' },
      { label:'Payment Entries', icon:'fa-solid fa-money-check-dollar' },
      { label:'CRM Pipeline', icon:'fa-solid fa-handshake' },
    ],
    stats:[{ l:'Net Revenue', v:'ETB 2.4M', c:'+18%' },{ l:'GL Entries', v:'1,482', c:'Balanced' },{ l:'Net Assets', v:'ETB 4.1M', c:'+9%' }],
    bars:[65,45,80,55,90,70,85],
    rows:[
      { id:'JE-2041', detail:'Double-entry P&L & Balance Sheet sync', status:'Posted', sc:'#34d399' },
      { id:'PE-2042', detail:'Customer receipt — Commercial Bank', status:'Reconciled', sc:'#c8963c' },
      { id:'SO-2043', detail:'Quote converted to Sales Order', status:'Billed', sc:'#60a5fa' },
    ],
  },
  {
    name:'POS System', icon:'fa-solid fa-cash-register',
    color:'#34d399',
    sidebar:[
      { label:'POS Terminal', icon:'fa-solid fa-cash-register' },
      { label:'Cash Drawer', icon:'fa-solid fa-vault' },
      { label:'Sales History', icon:'fa-solid fa-receipt' },
      { label:'Quotations', icon:'fa-solid fa-file-signature' },
      { label:'Credit & Loyalty', icon:'fa-solid fa-hand-holding-dollar' },
      { label:'Receipts', icon:'fa-solid fa-print' },
    ],
    stats:[{ l:'Today\'s Sales', v:'ETB 48.2K', c:'+24%' },{ l:'Transactions', v:'156', c:'+8%' },{ l:'Avg Ticket', v:'ETB 309', c:'+3%' }],
    bars:[40,70,55,85,65,90,75],
    rows:[
      { id:'TXN-8091', detail:'Bole Flagship — Cash + Telebirr split', status:'Paid', sc:'#34d399' },
      { id:'TXN-8092', detail:'Addis Mart — Thermal receipt printed', status:'Paid', sc:'#34d399' },
      { id:'TXN-8093', detail:'Hawassa Store — Partial credit invoice', status:'Credit', sc:'#c8963c' },
    ],
  },
  {
    name:'Inventory & Warehouse', icon:'fa-solid fa-warehouse',
    color:'#60a5fa',
    sidebar:[
      { label:'Warehouses', icon:'fa-solid fa-warehouse' },
      { label:'Stock Ledger', icon:'fa-solid fa-clipboard-list' },
      { label:'Transfers', icon:'fa-solid fa-right-left' },
      { label:'Reorder Alerts', icon:'fa-solid fa-bell' },
      { label:'Purchase Orders', icon:'fa-solid fa-truck-ramp-box' },
      { label:'FEFO Expiry', icon:'fa-solid fa-hourglass-half' },
    ],
    stats:[{ l:'Total SKUs', v:'3,847', c:'+120' },{ l:'Reorder Alerts', v:'6', c:'1-Click PO' },{ l:'Warehouses', v:'4', c:'Synced' }],
    bars:[80,60,45,70,55,85,65],
    rows:[
      { id:'SLE-4401', detail:'Main Warehouse -> Bole Branch transfer', status:'Posted', sc:'#34d399' },
      { id:'PO-4402', detail:'Auto-generated PO from low stock alert', status:'Ordered', sc:'#c8963c' },
      { id:'FEFO-4403', detail:'Batch expiring in 30 days flagged', status:'Alert', sc:'#60a5fa' },
    ],
  },
  {
    name:'Manufacturing & Assets', icon:'fa-solid fa-industry',
    color:'#f59e0b',
    sidebar:[
      { label:'Work Orders', icon:'fa-solid fa-industry' },
      { label:'Bills of Materials', icon:'fa-solid fa-cubes' },
      { label:'Fixed Assets', icon:'fa-solid fa-building-columns' },
      { label:'Depreciation', icon:'fa-solid fa-chart-area' },
      { label:'Stock Ledger', icon:'fa-solid fa-boxes-stacked' },
      { label:'GL Posting', icon:'fa-solid fa-scale-balanced' },
    ],
    stats:[{ l:'Active WOs', v:'14', c:'On Schedule' },{ l:'BOMs', v:'28', c:'Ready' },{ l:'Fixed Assets', v:'ETB 1.8M', c:'Tracked' }],
    bars:[60,72,58,84,76,90,82],
    rows:[
      { id:'MFG-1001', detail:'BOM Kit Assembly — 25 units completed', status:'Completed', sc:'#34d399' },
      { id:'AST-1001', detail:'Monthly straight-line depreciation GL', status:'Posted', sc:'#c8963c' },
      { id:'MFG-1002', detail:'Raw material reservation verified', status:'In Progress', sc:'#60a5fa' },
    ],
  },
  {
    name:'Hospital Management', icon:'fa-solid fa-hospital',
    color:'#ef4444',
    sidebar:[
      { label:'Flow Board', icon:'fa-solid fa-code-branch' },
      { label:'Reception Queue', icon:'fa-solid fa-bell-concierge' },
      { label:'Patients & EMR', icon:'fa-solid fa-hospital-user' },
      { label:'Labs & Rx', icon:'fa-solid fa-flask-vial' },
      { label:'1-Click Billing', icon:'fa-solid fa-file-invoice-dollar' },
      { label:'Doctors', icon:'fa-solid fa-user-doctor' },
    ],
    stats:[{ l:'Patients', v:'4,280', c:'+320' },{ l:'Today\'s Visits', v:'67', c:'+12' },{ l:'Billed EMRs', v:'98%', c:'Auto GL' }],
    bars:[60,80,50,75,65,45,85],
    rows:[
      { id:'APT-901', detail:'Dr. Abebe — Consultation -> Pharmacy Flow', status:'In Progress', sc:'#c8963c' },
      { id:'EMR-902', detail:'Clinical record converted to Invoice', status:'Billed', sc:'#34d399' },
      { id:'LAB-903', detail:'CBC Panel — Result released to chart', status:'Completed', sc:'#60a5fa' },
    ],
  },
  {
    name:'School Management', icon:'fa-solid fa-graduation-cap',
    color:'#c084fc',
    sidebar:[
      { label:'Students', icon:'fa-solid fa-user-graduate' },
      { label:'Timetable', icon:'fa-solid fa-calendar-week' },
      { label:'Teaching Monitor', icon:'fa-solid fa-person-chalkboard' },
      { label:'Attendance', icon:'fa-solid fa-clipboard-check' },
      { label:'Report Cards', icon:'fa-solid fa-award' },
      { label:'Fees & Ledger', icon:'fa-solid fa-money-bill-wave' },
    ],
    stats:[{ l:'Students', v:'1,240', c:'+80' },{ l:'Teachers', v:'64', c:'+4' },{ l:'Pass Rate', v:'94%', c:'+2%' }],
    bars:[55,75,60,80,70,50,85],
    rows:[
      { id:'STU-301', detail:'Grade 10A — Term 2 Report Card PDF', status:'Published', sc:'#34d399' },
      { id:'CLS-104', detail:'Period 3 Physics — Teaching check-in', status:'Live', sc:'#c8963c' },
      { id:'FEE-882', detail:'Guardian Telegram receipt dispatched', status:'Sent', sc:'#60a5fa' },
    ],
  },
  {
    name:'Custom Dashboard', icon:'fa-solid fa-chart-line',
    color:'#06b6d4',
    sidebar:[
      { label:'Analytics', icon:'fa-solid fa-chart-line' },
      { label:'CRM Leads', icon:'fa-solid fa-handshake' },
      { label:'Campaigns', icon:'fa-solid fa-bullhorn' },
      { label:'Payroll', icon:'fa-solid fa-money-check-dollar' },
      { label:'Expenses', icon:'fa-solid fa-coins' },
      { label:'Settings', icon:'fa-solid fa-gear' },
    ],
    stats:[{ l:'Active Users', v:'12.4K', c:'+18%' },{ l:'Conversion', v:'34%', c:'+6%' },{ l:'Audit Trail', v:'100%', c:'RBAC' }],
    bars:[45,75,60,90,55,80,70],
    rows:[
      { id:'CRM-101', detail:'Lead converted to Customer account', status:'Won', sc:'#34d399' },
      { id:'PAY-102', detail:'Ethiopian tax & pension payroll run', status:'Approved', sc:'#c8963c' },
      { id:'BOT-103', detail:'Tenant Telegram bot receipt verified', status:'Verified', sc:'#60a5fa' },
    ],
  },
  {
    name:'E-Commerce Store', icon:'fa-solid fa-cart-shopping',
    color:'#ec4899',
    sidebar:[
      { label:'Products', icon:'fa-solid fa-boxes-stacked' },
      { label:'Orders', icon:'fa-solid fa-bag-shopping' },
      { label:'Customers', icon:'fa-solid fa-users' },
      { label:'Marketing', icon:'fa-solid fa-bullhorn' },
      { label:'Analytics', icon:'fa-solid fa-chart-pie' },
      { label:'Settings', icon:'fa-solid fa-gear' },
    ],
    stats:[{ l:'Revenue', v:'ETB 890K', c:'+32%' },{ l:'Orders', v:'612', c:'+45' },{ l:'Conv. Rate', v:'3.8%', c:'+0.6%' }],
    bars:[70,55,85,60,75,50,90],
    rows:[
      { id:'PRT-701', detail:'Ethiopian Coffee Set — Premium', status:'In Stock', sc:'#34d399' },
      { id:'PRT-702', detail:'Handwoven Basket — Large', status:'Low Stock', sc:'#c8963c' },
      { id:'PRT-703', detail:'Spice Collection — Gift Box', status:'In Stock', sc:'#34d399' },
    ],
  },
];

/* ─── SHOWCASE SECTION ──────────────────────────────────────── */
function ShowcaseSection() {
  const { t } = useLanguage();
  const [active, setActive] = useState(0);
  const [activeNav, setActiveNav] = useState(0);
  const [sidebarMinimized, setSidebarMinimized] = useState(false);
  const [animKey, setAnimKey] = useState(0);
  const panel = showcase[active];

  const handleTab = (i: number) => {
    if (i === active) return;
    setActive(i);
    setActiveNav(0);
    setAnimKey(k => k + 1);
  };

  return (
    <div className="showcase-wrap" role="region" aria-label="Project showcase">
      <div className="showcase-inner">
        <h2 className="section-title" data-reveal="fade-up">{t('showcase.title')}</h2>

        <div className="showcase-tabs" role="tablist" aria-label="Project categories">
          {showcase.map((p, i) => (
            <button
              key={p.name}
              role="tab"
              aria-selected={i === active}
              aria-controls={`panel-${p.name.replace(/\s+/g, '-')}`}
              id={`tab-${p.name.replace(/\s+/g, '-')}`}
              className={`showcase-tab ${i === active ? 'active' : ''}`}
              onClick={() => handleTab(i)}
            >
              <i className={p.icon} aria-hidden="true" /> {p.name}
            </button>
          ))}
        </div>

        <div
          className="showcase-panel"
          key={animKey}
          role="tabpanel"
          id={`panel-${panel.name.replace(/\s+/g, '-')}`}
          aria-labelledby={`tab-${panel.name.replace(/\s+/g, '-')}`}
        >
          <div className="panel-chrome">
            <div className="panel-dots" aria-hidden="true">
              <span /><span /><span />
            </div>
            <div className="panel-title">{panel.name} — AFRO Suite</div>
          </div>
          <div className={`panel-body ${sidebarMinimized ? 'sidebar-minimized' : ''}`}>
            <aside
              className={`ui-sidebar ${sidebarMinimized ? 'minimized' : ''}`}
              aria-label={`${panel.name} sidebar`}
            >
              <div className="ui-sidebar-top">
                <span className="ui-sidebar-caption">Navigation</span>
                <button
                  type="button"
                  className="ui-sidebar-toggle"
                  onClick={() => setSidebarMinimized(m => !m)}
                  aria-label={sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'}
                  aria-expanded={!sidebarMinimized}
                  title={sidebarMinimized ? 'Expand sidebar' : 'Minimize sidebar'}
                  data-testid="showcase-sidebar-toggle"
                >
                  <i
                    className={sidebarMinimized ? 'fa-solid fa-angles-right' : 'fa-solid fa-angles-left'}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {panel.sidebar.map((item, j) => (
                <button
                  key={item.label}
                  type="button"
                  className={`ui-nav-item ${j === activeNav ? 'active' : ''}`}
                  onClick={() => setActiveNav(j)}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={j === activeNav ? 'page' : undefined}
                >
                  <i
                    className={item.icon}
                    style={{ color: j === activeNav ? panel.color : undefined }}
                    aria-hidden="true"
                  />
                  <span className="ui-nav-label">{item.label}</span>
                </button>
              ))}
            </aside>
            <div className="ui-main">
              <div className="ui-stats-row">
                {panel.stats.map((s, j) => (
                  <div key={s.l} className="ui-stat-card" style={{ animationDelay: `${j * 80}ms` }}>
                    <div className="ui-stat-label">{s.l}</div>
                    <div className="ui-stat-value">{s.v}</div>
                    <div className="ui-stat-change" style={{ color: panel.color }}>{s.c}</div>
                  </div>
                ))}
              </div>
              <div className="ui-chart-area">
                <div className="ui-chart-label">{t('showcase.monthlyOverview')}</div>
                <div className="ui-chart" role="img" aria-label={`${panel.name} monthly chart`}>
                  {panel.bars.map((h, j) => (
                    <div key={j} className="ui-bar-col">
                      <div className="ui-bar" style={{ height: `${h}%`, background: panel.color, animationDelay: `${j * 60}ms` }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="ui-table-area">
                <div className="ui-table-header">{t('showcase.recentActivity')}</div>
                {panel.rows.map((r, j) => (
                  <div key={r.id} className="ui-table-row" style={{ animationDelay: `${j * 100 + 200}ms` }}>
                    <span className="ui-row-id">{r.id}</span>
                    <span className="ui-row-detail">{r.detail}</span>
                    <span className="ui-row-status" style={{ color: r.sc }}>{r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', gap: 14, flexWrap: 'wrap', marginTop: 28 }}>
          <Link to="/app/login" className="btn-primary" style={{ textDecoration: 'none' }}>
            {t('showcase.ctaLaunch')} <i className="fa-solid fa-arrow-right" aria-hidden="true" />
          </Link>
          <Link to="/products" className="btn-ghost" style={{ textDecoration: 'none', background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border2)' }}>
            {t('showcase.ctaCompare')}
          </Link>
        </div>
      </div>
    </div>
  );
}

/* ─── APP ────────────────────────────────────────────────────── */
export default function App() {
  const { t } = useLanguage();
  const [scrollPct, setScrollPct] = useState(0);
  const [showTop, setShowTop]     = useState(false);
  const [formData, setFormData]     = useState({ name:'', email:'', phone:'', message:'' });
  const [fieldErrors, setFieldErrors] = useState<ContactFieldErrors>({});
  const [touched, setTouched]       = useState<Partial<Record<ContactFieldName, boolean>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [contactTab, setContactTab] = useState<'inquiry' | 'pay'>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('tx_ref') || window.location.hash === '#pay-now' ? 'pay' : 'inquiry';
  });
  const [toast, setToast]           = useState<{ type:'success'|'error'; msg:string }|null>(null);

  const showToast = (type:'success'|'error', msg:string) => {
    setToast({ type, msg }); setTimeout(() => setToast(null), 5500);
  };

  /* Lenis */
  useEffect(() => {
    const lenis = new Lenis({ duration:1.2, easing:(t:number)=>Math.min(1,1.001-Math.pow(2,-10*t)) });
    let rafId: number;
    const raf = (time:number) => { lenis.raf(time); rafId = requestAnimationFrame(raf); };
    rafId = requestAnimationFrame(raf);
    return () => { lenis.destroy(); cancelAnimationFrame(rafId); };
  }, []);



  /* Scroll progress + back-to-top */
  useEffect(() => {
    const onScroll = () => {
      const el  = document.documentElement;
      const pct = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100;
      setScrollPct(pct);
      setShowTop(el.scrollTop > 500);
    };
    window.addEventListener('scroll', onScroll, { passive:true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Scroll reveal */
  useReveal();

  const scrollTo = (id:string) => { document.getElementById(id)?.scrollIntoView({ behavior:'smooth' }); };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>) => {
    const name = e.target.name as ContactFieldName;
    const { value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setTouched(prev => (prev[name] ? prev : { ...prev, [name]: true }));
    const err = validateContactField(name, value);
    setFieldErrors(prev => ({ ...prev, [name]: err }));
  };

  const handleBlur = (e: React.FocusEvent<HTMLInputElement|HTMLTextAreaElement>) => {
    const name = e.target.name as ContactFieldName;
    const { value } = e.target;
    setTouched(prev => ({ ...prev, [name]: true }));
    const err = validateContactField(name, value);
    setFieldErrors(prev => ({ ...prev, [name]: err }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validateContactForm(formData);
    setTouched({ name: true, email: true, phone: true, message: true });
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      const firstInvalid = (['name', 'email', 'phone', 'message'] as ContactFieldName[]).find(k => errs[k]);
      if (firstInvalid) document.getElementById(firstInvalid)?.focus();
      showToast('error', 'Please fix the highlighted fields before sending.');
      return;
    }
    setFieldErrors({});
    setSubmitting(true);
    try {
      const res  = await fetch('/api/contact', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(formData) });
      const data = await res.json();
      if (data.success) {
        showToast('success', 'Message sent! We\'ll reply within 24 hours.');
        setFormData({ name:'', email:'', phone:'', message:'' });
        setFieldErrors({});
        setTouched({});
      } else {
        showToast('error', data.message || 'Send failed. Please try again.');
      }
    } catch {
      showToast('error', 'Server offline — reach us on Telegram @yona64 or WhatsApp.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      {/* ── SCROLL PROGRESS ──────────────────────────────────── */}
      <div className="scroll-progress" style={{ width:`${scrollPct}%` }} />

      {/* ── NAV ──────────────────────────────────────────────── */}
      <Navbar />

      <main id="main-content">

      {/* ── HERO — editorial, one column ─────────────────────── */}
      <section id="hero">
        <div className="hero-left">
          <h1 className="fade-up">
            {t('hero.titleLine1')}<br />{t('hero.titleLine2')}
          </h1>
          <p className="hero-sub">
            {t('hero.sub')}
          </p>
          <div className="hero-actions">
            <button type="button" className="btn-primary" onClick={() => scrollTo('contact-section')}>
              {t('hero.ctaStart')} <i className="fa-solid fa-arrow-right" aria-hidden="true" />
            </button>
            <button type="button" className="btn-ghost" onClick={() => scrollTo('showcase-section')}>
              {t('hero.ctaWork')} <i className="fa-solid fa-arrow-down" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Floating animated dashboard 1 — bar chart */}
        <div className="hero-dashboard-anim hero-dash-1" aria-hidden="true">
          <svg viewBox="0 0 200 120" fill="none">
            <path d="M 10 20 L 190 20" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
            <path d="M 10 50 L 190 50" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
            <path d="M 10 80 L 190 80" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 4" />
            <rect x="30" y="50" width="16" height="30" rx="2" fill="var(--accent)" className="dash-bar-1" />
            <rect x="60" y="30" width="16" height="50" rx="2" fill="var(--text-dim)" className="dash-bar-2" opacity="0.4" />
            <rect x="90" y="60" width="16" height="20" rx="2" fill="var(--accent)" className="dash-bar-3" />
            <rect x="120" y="20" width="16" height="60" rx="2" fill="var(--text-dim)" className="dash-bar-4" opacity="0.4" />
            <rect x="150" y="40" width="16" height="40" rx="2" fill="var(--accent)" className="dash-bar-5" />
            <path d="M 38 65 L 68 45 L 98 70 L 128 35 L 158 55" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="dash-line" />
          </svg>
        </div>

        {/* Floating animated dashboard 2 — donut chart */}
        <div className="hero-dashboard-anim hero-dash-2" aria-hidden="true">
          <svg viewBox="0 0 160 120" fill="none">
            {/* Donut segments */}
            <circle cx="80" cy="55" r="35" stroke="var(--border)" strokeWidth="10" fill="none" opacity="0.2" />
            <circle cx="80" cy="55" r="35" stroke="var(--accent)" strokeWidth="10" fill="none"
              strokeDasharray="80 140" strokeLinecap="round" className="dash-donut-1" />
            <circle cx="80" cy="55" r="35" stroke="var(--text-dim)" strokeWidth="10" fill="none"
              strokeDasharray="50 170" strokeDashoffset="-80" strokeLinecap="round" className="dash-donut-2" opacity="0.5" />
            {/* Center label */}
            <text x="80" y="58" textAnchor="middle" fill="var(--text)" fontSize="12" fontWeight="600" fontFamily="DM Sans, sans-serif">78%</text>
            {/* Legend dots */}
            <circle cx="30" cy="105" r="4" fill="var(--accent)" />
            <text x="40" y="109" fill="var(--text-dim)" fontSize="8" fontFamily="DM Sans, sans-serif">Revenue</text>
            <circle cx="95" cy="105" r="4" fill="var(--text-dim)" opacity="0.5" />
            <text x="105" y="109" fill="var(--text-dim)" fontSize="8" fontFamily="DM Sans, sans-serif">Costs</text>
          </svg>
        </div>

        {/* Floating animated dashboard 3 — mini table / KPI cards */}
        <div className="hero-dashboard-anim hero-dash-3" aria-hidden="true">
          <svg viewBox="0 0 180 120" fill="none">
            {/* Card backgrounds */}
            <rect x="8" y="10" width="75" height="45" rx="6" fill="var(--accent)" opacity="0.12" />
            <rect x="97" y="10" width="75" height="45" rx="6" fill="var(--text-dim)" opacity="0.08" />
            {/* KPI values */}
            <text x="45" y="30" textAnchor="middle" fill="var(--accent)" fontSize="8" fontFamily="DM Sans, sans-serif" fontWeight="500">Users</text>
            <text x="45" y="46" textAnchor="middle" fill="var(--text)" fontSize="14" fontFamily="DM Sans, sans-serif" fontWeight="700" className="dash-counter-1">2,847</text>
            <text x="134" y="30" textAnchor="middle" fill="var(--text-dim)" fontSize="8" fontFamily="DM Sans, sans-serif" fontWeight="500">Orders</text>
            <text x="134" y="46" textAnchor="middle" fill="var(--text)" fontSize="14" fontFamily="DM Sans, sans-serif" fontWeight="700" className="dash-counter-2">1,204</text>
            {/* Mini sparkline rows */}
            <rect x="8" y="65" width="164" height="1" fill="var(--border)" opacity="0.5" />
            <path d="M 15 85 L 35 78 L 55 82 L 75 72 L 95 80 L 115 70 L 135 76 L 155 68" stroke="var(--accent)" strokeWidth="1.5" fill="none" strokeLinecap="round" className="dash-spark" />
            <rect x="8" y="95" width="164" height="1" fill="var(--border)" opacity="0.5" />
            <path d="M 15 108 L 35 104 L 55 110 L 75 100 L 95 106 L 115 98 L 135 103 L 155 96" stroke="var(--text-dim)" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity="0.4" className="dash-spark-2" />
          </svg>
        </div>

        <AfroCoder />
      </section>

      {/* ── SHOWCASE ─────────────────────────────────────────── */}
      <section id="showcase-section" aria-label="Project showcase">
        <ShowcaseSection />
      </section>

      {/* ── WHAT WE DO — teaser ──────────────────────────────── */}
      <section id="services-section" className="section-wrap" aria-label="Our services">
        <h2 className="section-title" data-reveal="fade-up">{t('whatWeDo.title')}</h2>
        <p className="what-we-do-intro" data-reveal="fade-up">
          {t('whatWeDo.intro')}
        </p>
        <div className="what-we-do-grid" data-stagger>
          {whatWeDo.map((item, idx) => (
            <div key={item.title} className="category-card" data-reveal="fade-up">
              <div className="category-card-icon" style={{ color:item.color }} aria-hidden="true">
                <i className={item.icon} style={{ color:item.color }} aria-hidden="true" />
              </div>
              <div className="category-card-title">{t(`whatWeDo.${idx as 0 | 1 | 2}.title`)}</div>
              <div className="category-card-desc">{t(`whatWeDo.${idx as 0 | 1 | 2}.desc`)}</div>
            </div>
          ))}
        </div>
        <div className="what-we-do-cta" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Link to="/services" className="btn-primary">
            {t('whatWeDo.ctaAll')} <i className="fa-solid fa-arrow-right" aria-hidden="true" />
          </Link>
          <button
            type="button"
            className="btn-ghost"
            style={{ background: 'transparent', color: 'var(--accent)', border: '1px solid var(--border2)' }}
            onClick={() => {
              setContactTab('pay');
              scrollTo('contact-section');
            }}
          >
            <i className="fa-solid fa-shield-halved" aria-hidden="true" /> {t('whatWeDo.ctaPay')}
          </button>
        </div>
      </section>

      {/* ── HOW WE WORK — horizontal map ──────────────────────── */}
      <section id="process-section" className="process-wrap" aria-label="Our process">
        <h2 className="section-title" data-reveal="fade-up">{t('process.title')}</h2>
        <div className="process-map">

          {/* SVG string connecting the boxes directly */}
          <svg className="pm-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <path
              className="pm-path"
              d="M 12.5 25 
                 C 25 25, 25 75, 37.5 75 
                 C 50 75, 50 25, 62.5 25 
                 C 75 25, 75 75, 87.5 75"
            />
          </svg>

          {/* TOP: steps 01 and 03 sit above the line */}
          <div className="pm-row pm-top">
            <div className="pm-card" data-reveal="scale-in">
              <div className="pm-icon" aria-hidden="true"><i className="fa-solid fa-comments" aria-hidden="true" /></div>
              <div className="pm-num">{process_steps[0].num}</div>
              <div className="pm-title">{t('process.0.title')}</div>
              <div className="pm-desc">{t('process.0.desc')}</div>
            </div>
            <div className="pm-spacer" />
            <div className="pm-card" data-reveal="scale-in">
              <div className="pm-icon" aria-hidden="true"><i className="fa-solid fa-code" aria-hidden="true" /></div>
              <div className="pm-num">{process_steps[2].num}</div>
              <div className="pm-title">{t('process.2.title')}</div>
              <div className="pm-desc">{t('process.2.desc')}</div>
            </div>
            <div className="pm-spacer" />
          </div>

          {/* BOTTOM: steps 02 and 04 sit below the line */}
          <div className="pm-row pm-bottom">
            <div className="pm-spacer" />
            <div className="pm-card" data-reveal="scale-in">
              <div className="pm-icon" aria-hidden="true"><i className="fa-solid fa-pen-ruler" aria-hidden="true" /></div>
              <div className="pm-num">{process_steps[1].num}</div>
              <div className="pm-title">{t('process.1.title')}</div>
              <div className="pm-desc">{t('process.1.desc')}</div>
            </div>
            <div className="pm-spacer" />
            <div className="pm-card" data-reveal="scale-in">
              <div className="pm-icon" aria-hidden="true"><i className="fa-solid fa-rocket" aria-hidden="true" /></div>
              <div className="pm-num">{process_steps[3].num}</div>
              <div className="pm-title">{t('process.3.title')}</div>
              <div className="pm-desc">{t('process.3.desc')}</div>
            </div>
          </div>

        </div>
      </section>

      {/* ── WHY US ──────────────────────────────────────────── */}
      <section id="whyus-section" className="section-wrap" aria-label="Why choose us">
        <h2 className="section-title" data-reveal="fade-up">{t('whyus.title')}</h2>
        <div className="whyus-grid" data-stagger>
          {whyUs.map((w, idx) => (
            <div key={w.title} className="whyus-card" data-reveal="fade-up">
              <div className="whyus-card-icon" aria-hidden="true"><i className={w.icon} aria-hidden="true" /></div>
              <div className="whyus-card-title">{t(`whyus.${idx as 0 | 1 | 2 | 3 | 4 | 5}.title`)}</div>
              <div className="whyus-card-desc">{t(`whyus.${idx as 0 | 1 | 2 | 3 | 4 | 5}.desc`)}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── ABOUT ────────────────────────────────────────────── */}
      <section id="about-section" aria-label="About us">
        <h2 className="section-title" data-reveal="fade-up">{t('about.title')}</h2>
        <div className="about-inner">
          <p className="about-quote">
            {t('about.quote')}
          </p>
          <div className="about-meta">
            {t('about.meta')}
          </div>
        </div>
      </section>

      {/* ── REVIEWS ──────────────────────────────────────────── */}
      <section id="reviews-section" className="section-wrap" aria-label="Client testimonials">
        <h2 className="section-title" data-reveal="fade-up">{t('reviews.title')}</h2>
        <div className="testimonials-grid" data-stagger>
          {testimonials.map(tm => (
            <div key={tm.name} className="testimonial-card" data-reveal="fade-up">
              <p className="testimonial-text">"{tm.text}"</p>
              <div className="testimonial-author">
                <div className="author-avatar" aria-hidden="true">{tm.initials}</div>
                <div>
                  <div className="author-name">{tm.name}</div>
                  <div className="author-title">{tm.title}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ── CONTACT ──────────────────────────────────────────── */}
      <section id="contact-section" aria-label="Contact us">
        <div className="contact-inner" data-reveal="fade-up">
          <div className="contact-info">
            <h2 className="section-title">{t('contact.title')}</h2>
            <p>{t('contact.sub')}</p>

            {[
              { href:'tel:+251910011818',                cls:'phone-icon',    icon:'fa-solid fa-phone',     label:t('contact.phone'),    val:'0910 011 818',              ext:false },
              { href:'https://wa.me/251910011818',       cls:'whatsapp-icon', icon:'fa-brands fa-whatsapp', label:t('contact.whatsapp'), val:'+251-910011818',           ext:true  },
              { href:'https://t.me/yona64',              cls:'telegram-icon', icon:'fa-brands fa-telegram', label:t('contact.telegram'), val:'@yona64',                  ext:true  },
              { href:'mailto:yonasmindaye04@gmail.com',  cls:'email-icon',    icon:'fa-solid fa-envelope',  label:t('contact.email'),    val:'yonasmindaye04@gmail.com', ext:false },
            ].map(c => (
              <a key={c.href} href={c.href} target={c.ext?'_blank':undefined} rel="noopener noreferrer" className="contact-detail">
                <div className={`contact-detail-icon ${c.cls}`} aria-hidden="true"><i className={c.icon} aria-hidden="true" /></div>
                <div className="contact-detail-text"><strong>{c.label}</strong><span>{c.val}</span></div>
              </a>
            ))}
            <div className="contact-detail no-link">
              <div className="contact-detail-icon location-icon" aria-hidden="true"><i className="fa-solid fa-location-dot" aria-hidden="true" /></div>
              <div className="contact-detail-text"><strong>{t('contact.location')}</strong><span>{t('contact.locationVal')}</span></div>
            </div>
          </div>

          <div className="contact-form-wrap">
            <div className="contact-mode-tabs" role="tablist" aria-label="Contact or pay for service">
              <button
                type="button"
                role="tab"
                aria-selected={contactTab === 'inquiry'}
                className={`contact-mode-tab ${contactTab === 'inquiry' ? 'active' : ''}`}
                onClick={() => setContactTab('inquiry')}
              >
                <i className="fa-solid fa-paper-plane" aria-hidden="true" /> {t('contact.tabInquiry')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={contactTab === 'pay'}
                className={`contact-mode-tab ${contactTab === 'pay' ? 'active' : ''}`}
                onClick={() => setContactTab('pay')}
                data-testid="contact-tab-pay"
              >
                <i className="fa-solid fa-lock" aria-hidden="true" /> {t('contact.tabPay')}
              </button>
            </div>

            {contactTab === 'pay' ? (
              <ServicePayNow returnPath="/" onStatusToast={showToast} />
            ) : (
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-row">
                <div className={`form-group ${fieldErrors.name ? 'has-error' : ''}`}>
                  <label htmlFor="name">{t('contact.nameLabel')} <span className="req">*</span></label>
                  <input
                    id="name"
                    type="text"
                    name="name"
                    placeholder="Nahom Eshetu"
                    value={formData.name}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    aria-invalid={Boolean(fieldErrors.name)}
                    aria-describedby={fieldErrors.name ? 'name-error' : undefined}
                    className={fieldErrors.name ? 'input-error' : (touched.name && formData.name.trim() ? 'input-valid' : '')}
                  />
                  {fieldErrors.name ? (
                    <span id="name-error" className="field-error" role="alert">
                      <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {fieldErrors.name}
                    </span>
                  ) : touched.name && formData.name.trim() ? (
                    <span className="field-valid">
                      <i className="fa-solid fa-circle-check" aria-hidden="true" /> {t('contact.looksGood')}
                    </span>
                  ) : null}
                </div>
                <div className={`form-group ${fieldErrors.email ? 'has-error' : ''}`}>
                  <label htmlFor="email">{t('contact.emailLabel')} <span className="req">*</span></label>
                  <input
                    id="email"
                    type="email"
                    name="email"
                    placeholder="you@example.com"
                    value={formData.email}
                    onChange={handleChange}
                    onBlur={handleBlur}
                    aria-invalid={Boolean(fieldErrors.email)}
                    aria-describedby={fieldErrors.email ? 'email-error' : undefined}
                    className={fieldErrors.email ? 'input-error' : (touched.email && formData.email.trim() ? 'input-valid' : '')}
                  />
                  {fieldErrors.email ? (
                    <span id="email-error" className="field-error" role="alert">
                      <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {fieldErrors.email}
                    </span>
                  ) : touched.email && formData.email.trim() ? (
                    <span className="field-valid">
                      <i className="fa-solid fa-circle-check" aria-hidden="true" /> {t('contact.validEmail')}
                    </span>
                  ) : null}
                </div>
              </div>
              <div className={`form-group ${fieldErrors.phone ? 'has-error' : ''}`}>
                <label htmlFor="phone">{t('contact.phoneLabel')} <span style={{ color:'var(--text-dim)', fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:'.78rem' }}>{t('contact.optional')}</span></label>
                <input
                  id="phone"
                  type="tel"
                  name="phone"
                  placeholder="+251 910 011 818"
                  value={formData.phone}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  aria-invalid={Boolean(fieldErrors.phone)}
                  aria-describedby={fieldErrors.phone ? 'phone-error' : undefined}
                  className={fieldErrors.phone ? 'input-error' : (touched.phone && formData.phone.trim() ? 'input-valid' : '')}
                />
                {fieldErrors.phone && (
                  <span id="phone-error" className="field-error" role="alert">
                    <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {fieldErrors.phone}
                  </span>
                )}
              </div>
              <div className={`form-group ${fieldErrors.message ? 'has-error' : ''}`}>
                <label htmlFor="message">{t('contact.messageLabel')} <span className="req">*</span></label>
                <textarea
                  id="message"
                  name="message"
                  rows={5}
                  placeholder={t('contact.messagePlaceholder')}
                  value={formData.message}
                  onChange={handleChange}
                  onBlur={handleBlur}
                  aria-invalid={Boolean(fieldErrors.message)}
                  aria-describedby={fieldErrors.message ? 'message-error' : undefined}
                  className={fieldErrors.message ? 'input-error' : (touched.message && formData.message.trim() ? 'input-valid' : '')}
                />
                {fieldErrors.message ? (
                  <span id="message-error" className="field-error" role="alert">
                    <i className="fa-solid fa-triangle-exclamation" aria-hidden="true" /> {fieldErrors.message}
                  </span>
                ) : touched.message && formData.message.trim() ? (
                  <span className="field-valid">
                    <i className="fa-solid fa-circle-check" aria-hidden="true" /> {t('contact.readyToSend')}
                  </span>
                ) : null}
              </div>
              <button type="submit" className="btn-primary btn-full" disabled={submitting} style={{ opacity:submitting?0.7:1 }}>
                {submitting ? <>{t('contact.sending')}</> : <>{t('contact.submit')}</>}
              </button>
            </form>
            )}
          </div>
        </div>
      </section>

      </main>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer data-reveal="fade-up" role="contentinfo">
        <div className="footer-brand">
          <img src="/logo/Untitled_design-removebg-preview.png" alt="AFRO-TECH logo" className="logo-img" width="40" height="40" loading="lazy" />
          <span className="logo-text">AFRO<span>-TECH</span></span>
        </div>
        <div className="footer-copy">{t('footer.copy')}</div>
        <div className="footer-links">
          {[['mailto:yonasmindaye04@gmail.com','fa-solid fa-envelope','Email us'],['https://t.me/yona64','fa-brands fa-telegram','Telegram'],['https://wa.me/251910011818','fa-brands fa-whatsapp','WhatsApp']].map(([href,icon,label]) => (
            <a key={icon} href={href} target={href.startsWith('http')?'_blank':undefined} rel="noopener noreferrer" aria-label={label}><i className={icon} /></a>
          ))}
        </div>
      </footer>

      {/* ── BACK TO TOP ──────────────────────────────────────── */}
      {showTop && (
        <button type="button" className="back-to-top" onClick={() => window.scrollTo({ top:0, behavior:'smooth' })} aria-label="Back to top">
          <i className="fa-solid fa-chevron-up" aria-hidden="true" />
        </button>
      )}

      {/* ── TOAST ────────────────────────────────────────────── */}
      {toast && (
        <div className={`toast toast-${toast.type}`} role="status" aria-live="polite">
          <i className={toast.type==='success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'} aria-hidden="true" />
          <span>{toast.msg}</span>
          <button type="button" className="toast-close" onClick={() => setToast(null)} aria-label="Dismiss notification"><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
        </div>
      )}
    </>
  );
}
