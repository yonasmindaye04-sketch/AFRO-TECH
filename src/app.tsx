import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Lenis from 'lenis';
import Navbar from './components/Navbar';
import { AfroCoder } from './components/AfroCoder';
import { useReveal } from './hooks/useReveal';
import { whatWeDo } from './data';
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
    name:'ERP System', icon:'fa-solid fa-layer-group',
    color:'#c8963c',
    sidebar:['Dashboard','Inventory','Finance','HR','Reports','Settings'],
    stats:[{ l:'Revenue', v:'ETB 2.4M', c:'+18%' },{ l:'Orders', v:'284', c:'+12%' },{ l:'Items', v:'1,204', c:'+5%' }],
    bars:[65,45,80,55,90,70,85],
    rows:[
      { id:'ORD-2041', detail:'Raw materials — supplier A', status:'Completed', sc:'#34d399' },
      { id:'ORD-2042', detail:'Packaging supplies', status:'Processing', sc:'#c8963c' },
      { id:'ORD-2043', detail:'Office equipment', status:'Pending', sc:'#6b6358' },
    ],
  },
  {
    name:'POS System', icon:'fa-solid fa-cash-register',
    color:'#34d399',
    sidebar:['Sales','Products','Customers','Payments','Reports','Settings'],
    stats:[{ l:'Today\'s Sales', v:'ETB 48.2K', c:'+24%' },{ l:'Transactions', v:'156', c:'+8%' },{ l:'Avg Ticket', v:'ETB 309', c:'+3%' }],
    bars:[40,70,55,85,65,90,75],
    rows:[
      { id:'TXN-8091', detail:'Bahir Dar Cafe — 3 items', status:'Paid', sc:'#34d399' },
      { id:'TXN-8092', detail:'Addis Mart — 7 items', status:'Paid', sc:'#34d399' },
      { id:'TXN-8093', detail:'Hawassa Store — 2 items', status:'Refunded', sc:'#f87171' },
    ],
  },
  {
    name:'Inventory & Warehouse', icon:'fa-solid fa-warehouse',
    color:'#60a5fa',
    sidebar:['Overview','Stock','Warehouses','Suppliers','Transfers','Reports'],
    stats:[{ l:'Total SKUs', v:'3,847', c:'+120' },{ l:'Low Stock', v:'23', c:'-5' },{ l:'In Transit', v:'156', c:'+34' }],
    bars:[80,60,45,70,55,85,65],
    rows:[
      { id:'SKU-4401', detail:'Cotton fabric — 2,400m', status:'In Stock', sc:'#34d399' },
      { id:'SKU-4402', detail:'Packaging boxes — 800 units', status:'Low Stock', sc:'#c8963c' },
      { id:'SKU-4403', detail:'Labels — 5,000 pcs', status:'In Transit', sc:'#60a5fa' },
    ],
  },
  {
    name:'School Management', icon:'fa-solid fa-graduation-cap',
    color:'#c084fc',
    sidebar:['Students','Teachers','Classes','Grades','Attendance','Fees'],
    stats:[{ l:'Students', v:'1,240', c:'+80' },{ l:'Teachers', v:'64', c:'+4' },{ l:'Pass Rate', v:'94%', c:'+2%' }],
    bars:[55,75,60,80,70,50,85],
    rows:[
      { id:'STU-301', detail:'Grade 10 — Section A', status:'Active', sc:'#34d399' },
      { id:'STU-302', detail:'Grade 8 — Section B', status:'Active', sc:'#34d399' },
      { id:'STU-303', detail:'Grade 12 — Section A', status:'Graduated', sc:'#6b6358' },
    ],
  },
  {
    name:'Hotel / PMS', icon:'fa-solid fa-hotel',
    color:'#f59e0b',
    sidebar:['Rooms','Bookings','Guests','Billing','Calendar','Reports'],
    stats:[{ l:'Occupancy', v:'78%', c:'+5%' },{ l:'Bookings', v:'42', c:'+8' },{ l:'Revenue', v:'ETB 1.1M', c:'+15%' }],
    bars:[70,50,85,60,75,90,65],
    rows:[
      { id:'RM-201', detail:'Deluxe Suite — 3 nights', status:'Occupied', sc:'#34d399' },
      { id:'RM-105', detail:'Standard Room — 1 night', status:'Checkout Today', sc:'#c8963c' },
      { id:'RM-308', detail:'Family Suite — 5 nights', status:'Reserved', sc:'#60a5fa' },
    ],
  },
  {
    name:'Hospital Management', icon:'fa-solid fa-hospital',
    color:'#ef4444',
    sidebar:['Patients','Appointments','Doctors','Billing','Pharmacy','Reports'],
    stats:[{ l:'Patients', v:'4,280', c:'+320' },{ l:'Today\'s Visits', v:'67', c:'+12' },{ l:'Beds Free', v:'18', c:'-2' }],
    bars:[60,80,50,75,65,45,85],
    rows:[
      { id:'APT-901', detail:'Dr. Abebe — Follow-up', status:'Scheduled', sc:'#60a5fa' },
      { id:'APT-902', detail:'Dr. Hanna — Consultation', status:'In Progress', sc:'#c8963c' },
      { id:'APT-903', detail:'Dr. Tesfaye — Surgery', status:'Completed', sc:'#34d399' },
    ],
  },
  {
    name:'Custom Dashboard', icon:'fa-solid fa-chart-line',
    color:'#06b6d4',
    sidebar:['Analytics','Users','Revenue','Traffic','Reports','Settings'],
    stats:[{ l:'Active Users', v:'12.4K', c:'+18%' },{ l:'Page Views', v:'847K', c:'+22%' },{ l:'Bounce Rate', v:'32%', c:'-4%' }],
    bars:[45,75,60,90,55,80,70],
    rows:[
      { id:'USR-101', detail:'Addis Ababa — Desktop', status:'Active', sc:'#34d399' },
      { id:'USR-102', detail:'Dire Dawa — Mobile', status:'Active', sc:'#34d399' },
      { id:'USR-103', detail:'Hawassa — Tablet', status:'Idle', sc:'#6b6358' },
    ],
  },
  {
    name:'Mobile App', icon:'fa-solid fa-mobile-screen',
    color:'#8b5cf6',
    sidebar:['Home','Orders','Profile','Notifications','Settings','Help'],
    stats:[{ l:'Downloads', v:'8,400', c:'+340' },{ l:'DAU', v:'2,100', c:'+15%' },{ l:'Rating', v:'4.7', c:'+0.2' }],
    bars:[50,65,80,55,70,85,60],
    rows:[
      { id:'ORD-501', detail:'Delivery — Bole Area', status:'En Route', sc:'#c8963c' },
      { id:'ORD-502', detail:'Pickup — Piassa', status:'Ready', sc:'#34d399' },
      { id:'ORD-503', detail:'Delivery — Kazanchis', status:'Delivered', sc:'#6b6358' },
    ],
  },
  {
    name:'E-Commerce Store', icon:'fa-solid fa-cart-shopping',
    color:'#ec4899',
    sidebar:['Products','Orders','Customers','Marketing','Analytics','Settings'],
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
  const [active, setActive] = useState(0);
  const [animKey, setAnimKey] = useState(0);
  const panel = showcase[active];

  const handleTab = (i:number) => {
    if (i === active) return;
    setActive(i);
    setAnimKey(k => k + 1);
  };

  return (
    <div className="showcase-wrap">
      <div className="showcase-inner">
        <div className="section-title" data-reveal="fade-up">What we've built</div>

        <div className="showcase-tabs">
          {showcase.map((p,i) => (
            <button key={p.name} className={`showcase-tab ${i===active?'active':''}`} onClick={() => handleTab(i)}>
              <i className={p.icon} /> {p.name}
            </button>
          ))}
        </div>

        <div className="showcase-panel" key={animKey}>
          <div className="panel-chrome">
            <div className="panel-dots">
              <span /><span /><span />
            </div>
            <div className="panel-title">{panel.name} — AFRO-TECH</div>
          </div>
          <div className="panel-body">
            <div className="ui-sidebar">
              {panel.sidebar.map((item,j) => (
                <div key={item} className={`ui-nav-item ${j===0?'active':''}`}>
                  <span className="ui-nav-dot" style={{ background:j===0?panel.color:'var(--border)' }} />
                  {item}
                </div>
              ))}
            </div>
            <div className="ui-main">
              <div className="ui-stats-row">
                {panel.stats.map((s,j) => (
                  <div key={s.l} className="ui-stat-card" style={{ animationDelay:`${j*80}ms` }}>
                    <div className="ui-stat-label">{s.l}</div>
                    <div className="ui-stat-value">{s.v}</div>
                    <div className="ui-stat-change" style={{ color:panel.color }}>{s.c}</div>
                  </div>
                ))}
              </div>
              <div className="ui-chart-area">
                <div className="ui-chart-label">Monthly Overview</div>
                <div className="ui-chart">
                  {panel.bars.map((h,j) => (
                    <div key={j} className="ui-bar-col">
                      <div className="ui-bar" style={{ height:`${h}%`, background:panel.color, animationDelay:`${j*60}ms` }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="ui-table-area">
                <div className="ui-table-header">Recent Activity</div>
                {panel.rows.map((r,j) => (
                  <div key={r.id} className="ui-table-row" style={{ animationDelay:`${j*100+200}ms` }}>
                    <span className="ui-row-id">{r.id}</span>
                    <span className="ui-row-detail">{r.detail}</span>
                    <span className="ui-row-status" style={{ color:r.sc }}>{r.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── APP ────────────────────────────────────────────────────── */
export default function App() {
  const [scrollPct, setScrollPct] = useState(0);
  const [showTop, setShowTop]     = useState(false);
  const [formData, setFormData]     = useState({ name:'', email:'', phone:'', message:'' });
  const [fieldErrors, setFieldErrors] = useState<Record<string,string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast]           = useState<{ type:'success'|'error'; msg:string }|null>(null);

  const showToast = (type:'success'|'error', msg:string) => {
    setToast({ type, msg }); setTimeout(() => setToast(null), 5500);
  };

  const validate = () => {
    const errs: Record<string,string> = {};
    if (!formData.name.trim())    errs.name    = 'Please enter your name.';
    if (!formData.email.trim())   errs.email   = 'Please enter your email.';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email)) errs.email = 'Enter a valid email address.';
    if (!formData.message.trim()) errs.message = 'Please describe your project.';
    return errs;
  };

  /* Lenis */
  useEffect(() => {
    const lenis = new Lenis({ duration:1.2, easing:(t:number)=>Math.min(1,1.001-Math.pow(2,-10*t)) });
    const raf = (time:number) => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    return () => lenis.destroy();
  }, []);

  /* FontAwesome */
  useEffect(() => {
    if(document.getElementById('fa-cdn')) return;
    const l = document.createElement('link');
    l.id='fa-cdn'; l.rel='stylesheet';
    l.href='https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    document.head.appendChild(l);
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
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    if (fieldErrors[name]) setFieldErrors(prev => ({ ...prev, [name]: '' }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      showToast('error', 'Please fill in all required fields.');
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

      {/* ── HERO — editorial, one column ─────────────────────── */}
      <section id="hero">
        <div className="hero-left">
          <h1 className="fade-up">
            We build digital systems<br />that run your business.
          </h1>
          <p className="hero-sub">
            Based in Addis Ababa. From websites to full ERP platforms — we design and build the tools that help Ethiopian businesses grow, automate, and compete.
          </p>
          <div className="hero-actions">
            <button className="btn-primary" onClick={() => scrollTo('contact-section')}>
              Start a Project <i className="fa-solid fa-arrow-right" />
            </button>
            <button className="btn-ghost" onClick={() => scrollTo('showcase-section')}>
              See Our Work <i className="fa-solid fa-arrow-down" />
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
      <div id="showcase-section">
        <ShowcaseSection />
      </div>

      {/* ── WHAT WE DO — teaser ──────────────────────────────── */}
      <div id="services-section" className="section-wrap">
        <div className="section-title" data-reveal="fade-up">What We Do</div>
        <p className="what-we-do-intro" data-reveal="fade-up">
          We design, build, and launch digital systems — from marketing sites to full enterprise platforms.
        </p>
        <div className="what-we-do-grid" data-stagger>
          {whatWeDo.map(item => (
            <div key={item.title} className="category-card" data-reveal="fade-up">
              <div className="category-card-icon" style={{ color:item.color }}>
                <i className={item.icon} style={{ color:item.color }} />
              </div>
              <div className="category-card-title">{item.title}</div>
              <div className="category-card-desc">{item.desc}</div>
            </div>
          ))}
        </div>
        <div className="what-we-do-cta">
          <Link to="/services" className="btn-primary">
            View All Services & Pricing <i className="fa-solid fa-arrow-right" />
          </Link>
        </div>
      </div>

      {/* ── HOW WE WORK — horizontal map ──────────────────────── */}
      <div id="process-section" className="process-wrap">
        <div className="section-title" data-reveal="fade-up">Our Process</div>
        <div className="process-map">

          {/* SVG string connecting the boxes directly */}
          <svg className="pm-svg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
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
              <div className="pm-icon"><i className="fa-solid fa-comments" /></div>
              <div className="pm-num">01</div>
              <div className="pm-title">{process_steps[0].title}</div>
              <div className="pm-desc">{process_steps[0].desc}</div>
            </div>
            <div className="pm-spacer" />
            <div className="pm-card" data-reveal="scale-in">
              <div className="pm-icon"><i className="fa-solid fa-code" /></div>
              <div className="pm-num">03</div>
              <div className="pm-title">{process_steps[2].title}</div>
              <div className="pm-desc">{process_steps[2].desc}</div>
            </div>
            <div className="pm-spacer" />
          </div>

          {/* BOTTOM: steps 02 and 04 sit below the line */}
          <div className="pm-row pm-bottom">
            <div className="pm-spacer" />
            <div className="pm-card" data-reveal="scale-in">
              <div className="pm-icon"><i className="fa-solid fa-pen-ruler" /></div>
              <div className="pm-num">02</div>
              <div className="pm-title">{process_steps[1].title}</div>
              <div className="pm-desc">{process_steps[1].desc}</div>
            </div>
            <div className="pm-spacer" />
            <div className="pm-card" data-reveal="scale-in">
              <div className="pm-icon"><i className="fa-solid fa-rocket" /></div>
              <div className="pm-num">04</div>
              <div className="pm-title">{process_steps[3].title}</div>
              <div className="pm-desc">{process_steps[3].desc}</div>
            </div>
          </div>



        </div>
      </div>

      {/* ── WHY US ──────────────────────────────────────────── */}
      <div id="whyus-section" className="section-wrap">
        <div className="section-title" data-reveal="fade-up">We're not a template shop.</div>
        <div className="whyus-grid" data-stagger>
          {whyUs.map(w => (
            <div key={w.title} className="whyus-card" data-reveal="fade-up">
              <div className="whyus-card-icon"><i className={w.icon} /></div>
              <div className="whyus-card-title">{w.title}</div>
              <div className="whyus-card-desc">{w.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── ABOUT ────────────────────────────────────────────── */}
      <div id="about-section">
        <div className="section-title" data-reveal="fade-up">About Us</div>
        <div className="about-inner">
          <p className="about-quote">
            We're a small studio from Addis Ababa. We've been building websites since 2020 — not because it's trending, but because we believe Ethiopian businesses deserve quality digital tools, not rushed templates.
          </p>
          <div className="about-meta">
            With years of expertise, we build high-performance websites and apps that help businesses grow locally and globally.
          </div>
        </div>
      </div>

      {/* ── REVIEWS ──────────────────────────────────────────── */}
      <div id="reviews-section" className="section-wrap">
        <div className="section-title" data-reveal="fade-up">What Our Clients Say</div>
        <div className="testimonials-grid" data-stagger>
          {testimonials.map(t => (
            <div key={t.name} className="testimonial-card" data-reveal="fade-up">
              <p className="testimonial-text">"{t.text}"</p>
              <div className="testimonial-author">
                <div className="author-avatar">{t.initials}</div>
                <div>
                  <div className="author-name">{t.name}</div>
                  <div className="author-title">{t.title}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CONTACT ──────────────────────────────────────────── */}
      <div id="contact-section">
        <div className="contact-inner" data-reveal="fade-up">
          <div className="contact-info">
            <div className="section-title">Let's talk.</div>
            <p>We reply within 24 hours — usually faster.</p>

            {[
              { href:'tel:+251910011818',                cls:'phone-icon',    icon:'fa-solid fa-phone',     label:'Phone',    val:'0910 011 818',              ext:false },
              { href:'https://wa.me/251910011818',       cls:'whatsapp-icon', icon:'fa-brands fa-whatsapp', label:'WhatsApp', val:'+251-910011818',           ext:true  },
              { href:'https://t.me/yona64',              cls:'telegram-icon', icon:'fa-brands fa-telegram', label:'Telegram', val:'@yona64',                  ext:true  },
              { href:'mailto:yonasmindaye04@gmail.com',  cls:'email-icon',    icon:'fa-solid fa-envelope',  label:'Email',    val:'yonasmindaye04@gmail.com', ext:false },
            ].map(c => (
              <a key={c.label} href={c.href} target={c.ext?'_blank':undefined} rel="noopener noreferrer" className="contact-detail">
                <div className={`contact-detail-icon ${c.cls}`}><i className={c.icon} /></div>
                <div className="contact-detail-text"><strong>{c.label}</strong><span>{c.val}</span></div>
              </a>
            ))}
            <div className="contact-detail no-link">
              <div className="contact-detail-icon location-icon"><i className="fa-solid fa-location-dot" /></div>
              <div className="contact-detail-text"><strong>Location</strong><span>Addis Ababa, Ethiopia</span></div>
            </div>
          </div>

          <div className="contact-form-wrap">
            <form onSubmit={handleSubmit} noValidate>
              <div className="form-row">
                <div className={`form-group ${fieldErrors.name ? 'has-error' : ''}`}>
                  <label htmlFor="name">Full Name <span className="req">*</span></label>
                  <input id="name" type="text" name="name" placeholder="Nahom Eshetu" value={formData.name} onChange={handleChange} className={fieldErrors.name ? 'input-error' : ''} />
                  {fieldErrors.name && <span className="field-error"><i className="fa-solid fa-triangle-exclamation" /> {fieldErrors.name}</span>}
                </div>
                <div className={`form-group ${fieldErrors.email ? 'has-error' : ''}`}>
                  <label htmlFor="email">Email <span className="req">*</span></label>
                  <input id="email" type="email" name="email" placeholder="you@example.com" value={formData.email} onChange={handleChange} className={fieldErrors.email ? 'input-error' : ''} />
                  {fieldErrors.email && <span className="field-error"><i className="fa-solid fa-triangle-exclamation" /> {fieldErrors.email}</span>}
                </div>
              </div>
              <div className="form-group">
                <label htmlFor="phone">Phone Number <span style={{ color:'var(--text-dim)', fontWeight:400, textTransform:'none', letterSpacing:0, fontSize:'.78rem' }}>(optional)</span></label>
                <input id="phone" type="tel" name="phone" placeholder="+251 910 011 818" value={formData.phone} onChange={handleChange} />
              </div>
              <div className={`form-group ${fieldErrors.message ? 'has-error' : ''}`}>
                <label htmlFor="message">What are you building? <span className="req">*</span></label>
                <textarea id="message" name="message" rows={5} placeholder="Tell us about your project, goals, and timeline..." value={formData.message} onChange={handleChange} className={fieldErrors.message ? 'input-error' : ''} />
                {fieldErrors.message && <span className="field-error"><i className="fa-solid fa-triangle-exclamation" /> {fieldErrors.message}</span>}
              </div>
              <button type="submit" className="btn-primary btn-full" disabled={submitting} style={{ opacity:submitting?0.7:1 }}>
                {submitting ? <>Sending…</> : <>Send Message</>}
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* ── FOOTER ───────────────────────────────────────────── */}
      <footer data-reveal="fade-up">
        <div className="footer-brand">
          <img src="/logo/Untitled_design-removebg-preview.png" alt="AFRO-TECH" className="logo-img" />
          <span className="logo-text">AFRO<span>-TECH</span></span>
        </div>
        <div className="footer-copy">&copy; 2026 &middot; Made in Addis Ababa</div>
        <div className="footer-links">
          {[['mailto:yonasmindaye04@gmail.com','fa-solid fa-envelope'],['https://t.me/yona64','fa-brands fa-telegram'],['https://wa.me/251910011818','fa-brands fa-whatsapp']].map(([href,icon]) => (
            <a key={icon} href={href} target={href.startsWith('http')?'_blank':undefined} rel="noopener noreferrer"><i className={icon} /></a>
          ))}
        </div>
      </footer>

      {/* ── BACK TO TOP ──────────────────────────────────────── */}
      {showTop && (
        <button className="back-to-top" onClick={() => window.scrollTo({ top:0, behavior:'smooth' })} aria-label="Back to top">
          <i className="fa-solid fa-chevron-up" />
        </button>
      )}

      {/* ── TOAST ────────────────────────────────────────────── */}
      {toast && (
        <div className={`toast toast-${toast.type}`}>
          <i className={toast.type==='success' ? 'fa-solid fa-circle-check' : 'fa-solid fa-circle-xmark'} />
          <span>{toast.msg}</span>
          <button className="toast-close" onClick={() => setToast(null)}><i className="fa-solid fa-xmark" /></button>
        </div>
      )}
    </>
  );
}
