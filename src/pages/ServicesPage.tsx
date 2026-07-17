import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import Lenis from 'lenis';
import Navbar from '../components/Navbar';
import { useReveal } from '../hooks/useReveal';
import { services, tierLabels, tierColors } from '../data';
import '../index.css';

export default function ServicesPage() {
  const [activeFilter, setActiveFilter] = useState('all');
  const [scrollPct, setScrollPct] = useState(0);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const lenis = new Lenis({ duration: 1.2, easing: (t: number) => Math.min(1, 1.001 - Math.pow(2, -10 * t)) });
    const raf = (time: number) => { lenis.raf(time); requestAnimationFrame(raf); };
    requestAnimationFrame(raf);
    return () => lenis.destroy();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      const pct = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * 100;
      setScrollPct(pct);
      setShowTop(el.scrollTop > 500);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (document.getElementById('fa-cdn')) return;
    const l = document.createElement('link');
    l.id = 'fa-cdn'; l.rel = 'stylesheet';
    l.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css';
    document.head.appendChild(l);
  }, []);

  useReveal();

  const filters = ['all', 'starter', 'pro', 'enterprise'];
  const filtered = activeFilter === 'all' ? services : services.filter(s => s.tier === activeFilter || (activeFilter === 'pro' && s.featured));

  const scrollTo = (id: string) => { document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' }); };

  const comparisonFeatures = [
    { name: 'Responsive Design', starter: true, pro: true, enterprise: true },
    { name: 'SEO Optimization', starter: true, pro: true, enterprise: true },
    { name: 'Admin Dashboard', starter: false, pro: true, enterprise: true },
    { name: 'Custom Design', starter: true, pro: true, enterprise: true },
    { name: 'CMS Integration', starter: false, pro: true, enterprise: true },
    { name: 'API Integration', starter: false, pro: false, enterprise: true },
    { name: 'Multi-user Roles', starter: false, pro: false, enterprise: true },
    { name: 'Analytics & Reporting', starter: false, pro: true, enterprise: true },
    { name: 'Training & Support', starter: true, pro: true, enterprise: true },
    { name: 'Post-Launch Maintenance', starter: false, pro: true, enterprise: true },
  ];

  return (
    <>
      <div className="scroll-progress" style={{ width: `${scrollPct}%` }} />
      <Navbar />

      {/* ── HERO BANNER ────────────────────────────────────── */}
      <section className="services-hero">
        <div className="services-hero-inner">
          <Link to="/" className="services-hero-back">
            <i className="fa-solid fa-arrow-left" /> Back to Home
          </Link>
          <h1 className="services-hero-title">Services & Pricing</h1>
          <p className="services-hero-sub">
            From simple landing pages to full enterprise platforms — transparent pricing, no hidden fees.
          </p>
        </div>
      </section>

      {/* ── FILTER + PRICING GRID ──────────────────────────── */}
      <div className="section-wrap" id="pricing-top">
        <div className="section-header-row">
          <div className="filter-tabs">
            {filters.map(f => (
              <button key={f} className={`filter-tab ${activeFilter === f ? 'active' : ''}`} onClick={() => setActiveFilter(f)}>
                {f === 'all' ? 'All' : tierLabels[f]}
              </button>
            ))}
          </div>
        </div>

        <div className="pricing-grid">
          {filtered.map(s => (
            <div key={s.id} className={`plan-card ${s.featured ? 'featured' : ''}`} data-reveal="fade-up" style={{ '--tier-color': tierColors[s.tier] } as React.CSSProperties}>
              <div className="plan-card-top">
                <div className="plan-icon-wrap" style={{ color: tierColors[s.tier] }}>
                  <i className={s.icon} style={{ color: tierColors[s.tier] }} />
                </div>
                <div className="plan-tier-badge" style={{ color: tierColors[s.tier], background: `${tierColors[s.tier]}10`, border: `1px solid ${tierColors[s.tier]}24` }}>
                  {s.featured && <i className="fa-solid fa-crown" />} {tierLabels[s.tier]}
                </div>
              </div>
              <div className="plan-type">{s.type}</div>
              <div className="plan-best">{s.best}</div>
              <div className="plan-features">
                {s.features.map(f => (
                  <div key={f} className="plan-feature">
                    <i className="fa-solid fa-check" style={{ color: tierColors[s.tier] }} /> {f}
                  </div>
                ))}
              </div>
              <div className="plan-footer">
                <div>
                  <div className="price-range">{s.price} <span>ETB</span></div>
                </div>
                <button className="btn-plan-card" onClick={() => scrollTo('services-cta')}>
                  Get a Quote <i className="fa-solid fa-arrow-right" />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="services-footer">
          <span className="services-footer-text">All projects include:</span>
          <div className="services-footer-tags">
            {['Responsive Design', 'SEO', 'Admin Dashboard', 'Security', 'Training & Support'].map(t => (
              <span key={t} className="tag"><i className="fa-solid fa-check" /> {t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* ── FEATURE COMPARISON TABLE ───────────────────────── */}
      <div className="comparison-wrap">
        <div className="comparison-inner">
          <div className="section-title">What's Included</div>
          <div className="comparison-table">
            <div className="comparison-header">
              <div className="comparison-col comp-feature">Feature</div>
              <div className="comparison-col comp-tier">Starter</div>
              <div className="comparison-col comp-tier comp-popular">Professional</div>
              <div className="comparison-col comp-tier">Enterprise</div>
            </div>
            {comparisonFeatures.map((f, i) => (
              <div key={f.name} className="comparison-row" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="comparison-col comp-feature">{f.name}</div>
                <div className="comparison-col comp-tier">
                  {f.starter ? <i className="fa-solid fa-check comp-check" style={{ color: tierColors.starter }} /> : <i className="fa-solid fa-minus comp-dash" />}
                </div>
                <div className="comparison-col comp-tier comp-popular">
                  {f.pro ? <i className="fa-solid fa-check comp-check" style={{ color: tierColors.pro }} /> : <i className="fa-solid fa-minus comp-dash" />}
                </div>
                <div className="comparison-col comp-tier">
                  {f.enterprise ? <i className="fa-solid fa-check comp-check" style={{ color: tierColors.enterprise }} /> : <i className="fa-solid fa-minus comp-dash" />}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── CTA ────────────────────────────────────────────── */}
      <div className="services-cta-wrap" id="services-cta">
        <div className="services-cta-inner">
          <h2 className="services-cta-title">Ready to start?</h2>
          <p className="services-cta-sub">Tell us about your project and we'll send you a detailed proposal within 24 hours.</p>
          <div className="services-cta-actions">
            <Link to="/#contact-section" className="btn-primary">
              Start a Project <i className="fa-solid fa-arrow-right" />
            </Link>
            <a href="https://wa.me/251910011818" target="_blank" rel="noopener noreferrer" className="btn-ghost">
              <i className="fa-brands fa-whatsapp" /> WhatsApp Us
            </a>
          </div>
        </div>
      </div>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer>
          <div className="footer-brand">
          <img src="/portfolio/logo/Untitled_design-removebg-preview.png" alt="AFRO-TECH" className="logo-img" />
          <span className="logo-text">AFRO<span>-TECH</span></span>
        </div>
        <div className="footer-copy">&copy; 2026 &middot; Made in Addis Ababa</div>
        <div className="footer-links">
          {[
            ['mailto:yonasmindaye04@gmail.com', 'fa-solid fa-envelope'],
            ['https://t.me/yona64', 'fa-brands fa-telegram'],
            ['https://wa.me/251910011818', 'fa-brands fa-whatsapp'],
          ].map(([href, icon]) => (
            <a key={icon} href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noopener noreferrer">
              <i className={icon} />
            </a>
          ))}
        </div>
      </footer>

      {showTop && (
        <button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} aria-label="Back to top">
          <i className="fa-solid fa-chevron-up" />
        </button>
      )}
    </>
  );
}
