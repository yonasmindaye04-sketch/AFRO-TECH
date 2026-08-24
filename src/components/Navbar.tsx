import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTheme } from '../context/useTheme';

export default function Navbar() {
  const { dark, toggle } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const isHome = location.pathname === '/';

  useEffect(() => {
    const h = () => { if (window.innerWidth > 768) setMenuOpen(false); };
    window.addEventListener('resize', h);
    return () => window.removeEventListener('resize', h);
  }, []);

  const scrollTo = (id: string) => {
    if (!isHome) {
      window.location.assign(`/#${id}`);
      setMenuOpen(false);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    setMenuOpen(false);
  };

  const navItems: [string, string][] = [
    ['hero', 'Home'],
    ['showcase-section', 'Showcase'],
    ['process-section', 'Process'],
    ['about-section', 'About'],
    ['reviews-section', 'Reviews'],
    ['contact-section', 'Contact'],
  ];

  return (
    <>
      <nav>
        <Link to="/" className="logo" style={{ textDecoration: 'none', cursor: 'pointer' }}>
          <img src="/logo/Untitled_design-removebg-preview.png" alt="AFRO-TECH logo" className="logo-img" width="40" height="40" />
          <span className="logo-text">AFRO<span>-TECH</span></span>
        </Link>

        <div id="nav-links" className={`nav-links ${menuOpen ? 'open' : ''}`} role="navigation" aria-label="Main navigation">
          {navItems.map(([id, label]) => (
            <a key={id} href={`#${id}`} onClick={() => scrollTo(id)}>{label}</a>
          ))}
          <Link
            to="/services"
            className={location.pathname.includes('/services') ? 'active' : ''}
            onClick={() => setMenuOpen(false)}
          >
            Services
          </Link>
          <Link
            to="/products"
            className={location.pathname === '/products' ? 'active' : ''}
            onClick={() => setMenuOpen(false)}
          >
            Products
          </Link>
        </div>

        <div className="nav-right">
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
