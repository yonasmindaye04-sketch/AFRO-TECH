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
          <img src="/logo/Untitled_design-removebg-preview.png" alt="AFRO-TECH" className="logo-img" />
          <span className="logo-text">AFRO<span>-TECH</span></span>
        </Link>

        <div className={`nav-links ${menuOpen ? 'open' : ''}`}>
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
        </div>

        <div className="nav-right">
          <button className="theme-toggle" onClick={toggle} aria-label="Toggle theme">
            <i className={dark ? 'fa-solid fa-sun' : 'fa-solid fa-moon'} />
          </button>
          <button className="hamburger" onClick={() => setMenuOpen(o => !o)} aria-label="Menu">
            <i className={menuOpen ? 'fa-solid fa-xmark' : 'fa-solid fa-bars'} />
          </button>
        </div>
      </nav>
      {menuOpen && <div className="nav-overlay" onClick={() => setMenuOpen(false)} />}
    </>
  );
}
