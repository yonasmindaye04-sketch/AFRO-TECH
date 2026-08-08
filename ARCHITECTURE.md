# Architecture Documentation

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser                              │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  HTML/CSS   │  │  JavaScript  │  │  Web APIs        │   │
│  │  (SSR/CSR)  │  │  (React 18)  │  │  (Intersection   │   │
│  └──────┬──────┘  └──────┬───────┘  │   Observer,      │   │
│         │               │          │   Lenis, etc.)   │   │
└─────────┼───────────────┼──────────┼──────────────────┘   │
          │               │          │
          ▼               ▼          ▼
┌─────────────────────────────────────────────────────────┐
│                    Vite Dev Server                      │
│  ┌────────────┐  ┌──────────┐  ┌────────────────────┐  │
│  │ HMR        │  │ TypeScript│ │ Build Pipeline    │  │
│  │ (Hot Module│  │ (tsc)    │ │ (Rollup)           │  │
│  │ Replacement)│  └──────────┘  └────────────────────┘  │
│  └────────────┘                                       │
└─────────────────────────────────────────────────────────┘
```

## Component Architecture

### App.tsx (Root Component)
```
App
├── ThemeProvider (Context)
├── BrowserRouter
│   ├── Routes
│   │   ├── Route "/" → App (Home)
│   │   └── Route "/services" → ServicesPage
│   └── Navbar (Global)
├── Main Content (App.tsx)
│   ├── Hero Section
│   ├── ShowcaseSection (Tabs + Panels)
│   ├── ServicesSection (Teaser)
│   ├── ProcessSection (Horizontal map)
│   ├── WhyUsSection
│   ├── AboutSection
│   ├── ReviewsSection
│   └── ContactSection (Form)
├── Footer
└── BackToTop / Toast
```

### ServicesPage.tsx (Separate Route)
```
ServicesPage
├── Lenis (Smooth scroll)
├── Navbar
├── ServicesHero
├── Pricing Section
│   ├── Filter Tabs (All/Starter/Pro/Enterprise)
│   ├── Pricing Grid (PlanCard[])
│   └── Services Footer
├── Comparison Table
├── CTA Section
└── Footer
```

## State Management

### React Context (ThemeContext.tsx)
```typescript
interface ThemeContextType {
  dark: boolean;
  toggle: () => void;
  // Persists to localStorage + applies data-theme to <html>
}
```

### Local State (useState)
| Component | State | Purpose |
|-----------|-------|---------|
| App | scrollPct, showTop | Scroll progress, back-to-top visibility |
| App | formData, fieldErrors, submitting, toast | Contact form |
| ShowcaseSection | active, animKey | Tab selection + animation key |
| ServicesPage | activeFilter | Pricing filter |
| Navbar | menuOpen | Mobile menu |
| All pages | scrollPct, showTop | Scroll tracking |

### Custom Hooks
| Hook | File | Purpose |
|------|------|---------|
| useTheme | useTheme.ts | Theme context consumer |
| useReveal | useReveal.ts | IntersectionObserver for scroll animations |
| useCountUp | useCountUp.ts | Number counting animation |

## Data Flow

### Content Data (src/data.ts)
```typescript
// Static content - all in one file for easy editing
export const services: Service[] = [...];
export const testimonials: Testimonial[] = [...];
export const process_steps: ProcessStep[] = [...];
export const whyUs: WhyUs[] = [...];
export const whatWeDo: WhatWeDo[] = [...];
export const showcase: ShowcaseItem[] = [...];
```

### Props Flow (App.tsx → Components)
```
App.tsx
├── data.ts → ShowcaseSection (showcase[])
├── data.ts → ServicesPage (services[])
├── data.ts → whatWeDo section (whatWeDo[])
├── App local state → process_steps, whyUs, testimonials
└── data.ts → tierLabels, tierColors → ServicesPage
```

## Styling Architecture

### CSS Structure (index.css)
```
1. @import (fonts, lenis)
2. Accessibility (skip link)
3. Performance (content-visibility)
4. Design Tokens (CSS Custom Properties)
   - :root[data-theme="dark"]
   - :root[data-theme="light"]
5. Base Reset
6. Components (in order):
   - Scroll Progress
   - Nav
   - Hero
   - Buttons
   - Ticker
   - Stats
   - Showcase
   - Section Shared
   - Services/Pricing
   - Process Map
   - Why Us
   - About
   - Testimonials
   - Contact
   - Footer
   - Back to Top
   - Toast
7. Animations
8. Motion System (data-reveal)
9. Hero Load Sequence
10. Reduced Motion
11. Responsive Breakpoints
12. Form Validation
13. What We Do Teaser
14. Services Page Hero
14. Comparison Table
15. Services CTA
```

### CSS Custom Properties Strategy
- All colors, spacing, transitions as custom properties
- Theme switching via `[data-theme]` on `<html>`
- Component-scoped variables via inline styles (`--tier-color`)
- System fonts as fallbacks

## Routing

### React Router v6
```typescript
<BrowserRouter>
  <Routes>
    <Route path="/" element={<App />} />
    <Route path="/services" element={<ServicesPage />} />
  </Routes>
</BrowserRouter>
```

### Navigation Patterns
- **Home page**: Hash links (`#section-id`) via Navbar
- **Services page**: Own routing, links to home via `<Link to="/">`
- **Cross-page**: Navbar handles external navigation via `window.location.assign()`

## Performance Architecture

### Code Splitting
```
dist/
├── index-[hash].js          # Main chunk (App + Navbar + shared)
├── ServicesPage-[hash].js   # Lazy-loaded via React.lazy (if implemented)
└── vendor-[hash].js         # React, Router, Lenis
```

### Bundle Optimization (vite.config.ts)
```typescript
build: {
  rollupOptions: {
    output: {
      manualChunks: {
        vendor: ['react', 'react-dom', 'react-router-dom', 'lenis'],
        // UI components could be separate
      }
    }
  }
}
```

### Asset Handling
- Images: `content-visibility: auto`, `loading="lazy"`, proper dimensions
- Fonts: Preload + `font-display: swap` + local fallback
- CSS: Critical inlined, rest async via `media="print" onload`

## Accessibility Architecture

### ARIA Implementation
| Component | ARIA Pattern |
|-----------|--------------|
| Showcase Tabs | `role="tablist"` + `role="tab"` + `role="tabpanel"` |
| Mobile Menu | `aria-expanded`, `aria-controls`, `aria-label` |
| Theme Toggle | `aria-label` with dynamic text |
| Form Fields | `htmlFor` + `aria-describedby` for errors |
| Skip Link | `href="#main-content"` |
| Live Regions | Toast uses `role="alert"` |

### Focus Management
- Visible focus rings on all interactive elements
- Focus trap in mobile menu (via CSS)
- Back-to-top button focusable
- Form error focus management

## Build & Deploy Pipeline

```
┌─────────────┐
│  git push   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  Vercel Build   │
│  npm run build  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Vite Build     │
│  1. tsc         │
│  2. Rollup      │
│  3. CSS Extract │
│  4. Minify      │
│  5. Hash        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Vercel Deploy  │
│  Edge Network   │
│  Cache Headers  │
│  HTTPS/HTTP2    │
└─────────────────┘
```

## Security Considerations

### Headers (vercel.json)
```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        {"key": "X-Content-Type-Options", "value": "nosniff"},
        {"key": "X-Frame-Options", "value": "DENY"},
        {"key": "Referrer-Policy", "value": "strict-origin-when-cross-origin"}
      ]
    }
  ]
}
```

### Content Security
- No inline scripts (except structured data JSON-LD)
- Font Awesome loaded from CDN with integrity
- No `dangerouslySetInnerHTML` used
- Form submission to `/api/contact` (serverless function)

## Monitoring & Analytics

### Recommended Additions
- **Web Vitals**: `web-vitals` library + send to analytics
- **Error Boundary**: React Error Boundary + Sentry
- **Performance**: Lighthouse CI in CI/CD
- **Real User Monitoring**: Vercel Analytics or Plausible

## Future Extensibility

### Planned Features
- [ ] Blog/News section (MDX + Contentlayer)
- [ ] Client Portal (Authentication + Dashboard)
- [ ] Multi-language (i18n with react-i18next)
- [ ] CMS Integration (Sanity/Contentful)
- [ ] Automated SEO audits in CI/CD

### Component Library Extraction
Potential shared components for reuse:
- Button, Card, Modal, Toast, FormField, Table
- Theme provider + hooks
- Animation utilities (reveal, countUp)