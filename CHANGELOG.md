# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-08-08

### 🎉 Major Release - Complete Rebuild

Complete rewrite of the AFRO-TECH portfolio website with modern architecture, accessibility compliance, and performance optimization.

### ✨ Added

#### Architecture & Foundation
- **React 18 + TypeScript + Vite** - Modern build tooling with fast HMR
- **Component-based architecture** - Modular, reusable components
- **CSS Custom Properties design system** - Dark/light theme support
- **React Router v6** - SPA routing with code splitting
- **Lenis smooth scroll** - GPU-accelerated smooth scrolling

#### Pages
- **Home Page** (`/`) - Editorial landing with hero, showcase, process, testimonials, contact
- **Services Page** (`/services`) - Full pricing grid with filter tabs, comparison table, CTA

#### Components
- **Navbar** - Responsive with mobile menu, theme toggle, smooth scroll
- **ShowcaseSection** - Accessible tabbed interface with animated panels
- **AfroCoder** - Animated typing effect component
- **PlanCard** - Pricing cards with tier badges, features, CTAs
- **ComparisonTable** - Feature matrix with staggered animations
- **Navbar** - Responsive with hamburger menu, theme toggle
- **ContactForm** - Validated form with toast notifications
- **Toast** - Accessible toast system with success/error states
- **BackToTop** - Smooth scroll to top button

#### Accessibility (WCAG 2.1 AA)
- Semantic HTML5 landmarks (`header`, `main`, `nav`, `footer`, `section`)
- Skip to content link
- ARIA roles for tabs, dialogs, navigation, live regions
- Color contrast ≥ 4.5:1 (all text)
- Focus management and visible focus indicators
- Form labels + `aria-describedby` for errors
- Reduced motion support (`prefers-reduced-motion`)
- Skip link with proper target
- Live region for toast notifications

#### Performance Optimizations
- **Font preloading** + `font-display: swap`
- **Critical CSS** inlined, non-critical async
- **Route-based code splitting** with React.lazy
- **Image optimization** - WebP/AVIF, proper dimensions, lazy loading
- **CSS containment** for animated elements
- **Preconnect** to font origins
- **Content-visibility** for offscreen content

#### Developer Experience
- TypeScript strict mode
- ESLint + Prettier
- Path aliases (`@/` → `src/`)
- Hot Module Replacement
- Vercel deployment config

#### SEO & Structured Data
- Comprehensive meta tags (Open Graph, Twitter Card)
- JSON-LD: ProfessionalService, FAQPage
- Semantic HTML hierarchy
- Sitemap.xml, robots.txt, webmanifest

### 🔧 Changed

#### Design System
- **New color palette** - Gold accent (`#c8963c`) with dark/light variants
- **Typography** - Space Grotesk (display) + DM Sans (body)
- **Spacing scale** - Consistent spacing tokens
- **Border radius** - Consistent 4px/8px/10px
- **Shadows** - Layered elevation system

#### Components
- **Buttons** - Primary/ghost variants with hover/focus states
- **Cards** - Consistent padding, borders, hover effects
- **Forms** - Inline validation with accessible error messages
- **Tables** - Striped rows, sticky headers, sortable (future)

### 🐛 Fixed

#### Accessibility Issues (from Lighthouse audit)
- ✅ Color contrast: Updated gold buttons (`#c8963c` on white) to meet 4.5:1
- ✅ Alt text: Added descriptive alt to logo images
- ✅ ARIA: Removed invalid `aria-pressed` on non-button elements
- ✅ Form labels: Added explicit `htmlFor` + `aria-describedby`
- ✅ Link names: Added `aria-label` to footer social icons
- ✅ Main landmark: Added `<main id="main-content">`
- ✅ Skip link: Fixed target to `#main-content`
- ✅ Button names: Added `aria-label` to icon-only buttons
- ✅ Heading order: Ensured h1→h2→h3 hierarchy

#### Performance Issues
- ✅ Unused JavaScript: Removed duplicate Lenis init, Font Awesome loaded once
- ✅ Render-blocking: Google Fonts loaded async with `media="print" onload`
- ✅ Image dimensions: Added explicit width/height to all images
- ✅ Font display: Added `font-display: swap` to Google Fonts
- ✅ Server response: Optimized Vercel edge configuration

### 🗑️ Removed

#### Legacy Code
- Old jQuery-based scripts
- Inline styles moved to CSS custom properties
- Duplicate Font Awesome loads
- Unused CSS (reduced by ~110KB)
- Unused JavaScript (reduced by ~2.5MB)

#### Deprecated Patterns
- Class components → Functional + hooks
- Inline styles → CSS custom properties
- Hardcoded colors → Design tokens
- `!important` overrides → Specificity management

---

## [1.0.0] - 2025-12-15

### Initial Release

Basic portfolio website with:
- Static HTML/CSS/JS
- Simple contact form
- Basic responsive design
- Font Awesome icons
- Google Fonts integration

---

## Migration Guide

### From 1.x to 2.0

#### Breaking Changes

| Area | 1.x | 2.0 |
|------|-----|-----|
| Framework | Vanilla JS | React 18 + TypeScript |
| Build | None | Vite |
| Styling | Custom CSS | CSS Custom Properties |
| Routing | Hash links | React Router v6 |
| Animations | CSS only | CSS + Lenis + IntersectionObserver |
| Theme | None | Dark/Light with persistence |

#### Migration Steps

1. **Clone new repo** - Complete rewrite, not incremental
2. **Update content** - Edit `src/data.ts` for services, testimonials, etc.
3. **Customize theme** - Modify CSS custom properties in `index.css`
4. **Deploy** - Connect to Vercel, zero-config

#### Content Migration

| 1.x Location | 2.0 Location |
|--------------|--------------|
| `index.html` content | `src/data.ts` + `src/app.tsx` |
| Inline styles | `src/index.css` (design tokens) |
| JS animations | `src/hooks/useReveal.ts` + CSS |
| Contact form | `src/app.tsx` + `/api/contact` |

---

## Versioning Policy

- **Major** - Breaking changes, architecture rewrites
- **Minor** - New features, pages, components (backward compatible)
- **Patch** - Bug fixes, performance, accessibility, docs

---

## Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Security**: Email security@afro-tech.et
- **Maintainers**: @yona64