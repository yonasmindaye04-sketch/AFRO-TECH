import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../context/useTheme';
import { useLanguage } from '../context/languageCtx';
import { usePwaInstall } from '../hooks/usePwaInstall';
import { LANGUAGES, type TranslationKey } from '../utils/i18n';

export default function Navbar() {
  const { dark, toggle } = useTheme();
  const { lang, setLang, t } = useLanguage();
  const [menuOpen, setMenuOpen] = useState(false);
  const [langOpen, setLangOpen] = useState(false);
  const langWrapRef = useRef<HTMLDivElement>(null);
  const location = useLocation();
  const isHome = location.pathname === '/';
  const { canInstall, promptInstall } = usePwaInstall();

  useEffect(() => {
    const h = () => { if (window.innerWidth > 1024) setMenuOpen(false); };
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  useEffect(() => {
    if (!langOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      if (langWrapRef.current && !langWrapRef.current.contains(e.target as Node)) {
        setLangOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLangOpen(false);
    };
    document.addEventListener('mousedown', onMouseDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [langOpen]);

  const scrollTo = (id: string) => {
    if (!isHome) {
      window.location.assign(`/#${id}`);
      setMenuOpen(false);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMenuOpen(false);
  };

  const navItems: [string, TranslationKey][] = [
    ['hero', 'nav.home'],
    ['showcase-section', 'nav.showcase'],
    ['process-section', 'nav.process'],
    ['about-section', 'nav.about'],
    ['reviews-section', 'nav.reviews'],
    ['contact-section', 'nav.contact'],
  ];

  const activeLang = LANGUAGES.find(l => l.code === lang) ?? LANGUAGES[0];

  return (
    <>
      <nav>
        <Link to="/" className="logo" style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <img src="/logo/Untitled_design-removebg-preview.png" alt="AFRO-TECH logo" className="logo-img" width="40" height="40" />
          <span className="logo-text">AFRO<span>-TECH</span></span>
        </Link>

        <div id="nav-links" className={`nav-links ${menuOpen ? 'open' : ''}`} role="navigation" aria-label="Main navigation">
          {navItems.map(([id, key]) => (
            <a key={id} href={`#${id}`} onClick={() => scrollTo(id)}>{t(key)}</a>
          ))}
          <Link
            to="/services"
            className={location.pathname.includes('/services') ? 'active' : ''}
            onClick={() => setMenuOpen(false)}
          >
            {t('nav.services')}
          </Link>
          <Link
            to="/products"
            className={location.pathname === '/products' ? 'active' : ''}
            onClick={() => setMenuOpen(false)}
          >
            {t('nav.products')}
          </Link>
        </div>

        <div className="nav-right">
          <div className="lang-switcher" ref={langWrapRef}>
            <button
              type="button"
              className="lang-btn"
              onClick={() => setLangOpen(o => !o)}
              aria-label={t('nav.languageLabel')}
              aria-haspopup="listbox"
              aria-expanded={langOpen}
              data-testid="lang-switcher-btn"
            >
              <i className="fa-solid fa-globe" aria-hidden="true" />
              <span>{activeLang.shortLabel}</span>
              <i className="fa-solid fa-chevron-down" aria-hidden="true" />
            </button>

            {langOpen && (
              <ul className="lang-menu" role="listbox" aria-label={t('nav.languageLabel')}>
                {LANGUAGES.map(opt => (
                  <li key={opt.code} role="option" aria-selected={opt.code === lang}>
                    <button
                      type="button"
                      className={`lang-option ${opt.code === lang ? 'active' : ''}`}
                      onClick={() => {
                        setLang(opt.code);
                        setLangOpen(false);
                      }}
                    >
                      <span>{opt.nativeLabel}</span>
                      <span className="lang-option-sub">{opt.englishName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {canInstall && (
            <button
              className="theme-toggle"
              onClick={() => void promptInstall()}
              title="Install AFRO-TECH as an app"
              aria-label="Install app"
            >
              <i className="fa-solid fa-download" aria-hidden="true" />
            </button>
          )}
          <button className="theme-toggle" onClick={toggle} aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}>
            <i className={dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon'} aria-hidden="true" />
          </button>
          <button className="hamburger" onClick={() => setMenuOpen(o => !o)} aria-label={menuOpen ? 'Close menu' : 'Open menu'} aria-expanded={menuOpen} aria-controls="nav-links">
            <i className={menuOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars'} aria-hidden="true" />
          </button>
        </div>
      </nav>
      {menuOpen && <div className="nav-overlay" onClick={() => setMenuOpen(false)} aria-hidden="true" />}
    </>
  );
}
