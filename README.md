# AFRO-TECH Portfolio Website

A modern, high-performance portfolio website for AFRO-TECH, a digital studio based in Addis Ababa, Ethiopia. Built with React, TypeScript, Vite, and modern CSS.

## 🚀 Features

### Performance
- **Lighthouse Score Target**: 95+ across all categories
- **Optimized Loading**: Font preloading, critical CSS inlining, font-display: swap
- **Code Splitting**: Route-based code splitting with React.lazy
- **Image Optimization**: WebP/AVIF formats, proper dimensions, lazy loading
- **Caching**: Proper HTTP cache headers via Vercel configuration

### Accessibility (WCAG 2.1 AA)
- Semantic HTML5 landmarks (header, main, nav, footer, section)
- Skip to content link
- ARIA roles and attributes for dynamic components
- Color contrast ratios ≥ 4.5:1
- Focus management and visible focus indicators
- Reduced motion support
- Form labels and error handling

### Technical Stack
- **React 18** with TypeScript
- **Vite** for fast development and optimized builds
- **React Router v6** for SPA routing
- **Lenis** for smooth scrolling
- **CSS Custom Properties** for theming (dark/light mode)
- **CSS Grid & Flexbox** for layouts

## 📁 Project Structure

```
portfolio-main/
├── public/                 # Static assets
│   ├── logo/               # Logo images
│   ├── favicon.ico         # Favicon
│   ├── *.png              # PWA icons
│   ├── robots.txt         # SEO robots
│   ├── sitemap.xml        # SEO sitemap
│   └── site.webmanifest   # PWA manifest
├── src/
│   ├── components/         # Reusable UI components
│   │   ├── Navbar.tsx     # Navigation with mobile menu
│   │   ├── AfroCoder.tsx  # Animated coding animation
│   │   └── *.css          # Component styles
│   ├── pages/             # Page components
│   │   ├── App.tsx        # Home page (landing)
│   │   └── ServicesPage.tsx # Services & pricing page
│   ├── hooks/             # Custom React hooks
│   │   ├── useCountUp.ts  # Number animation hook
│   │   └── useReveal.ts   # Scroll reveal hook (IntersectionObserver)
│   ├── context/           # React Context providers
│   │   ├── ThemeContext.tsx  # Dark/light theme
│   │   ├── useTheme.ts       # Theme hook
│   │   └── ctx.ts            # Context types
│   ├── data.ts            # Content data (services, testimonials, etc.)
│   ├── index.css          # Global styles & design tokens
│   ├── main.tsx           # App entry point
│   └── app.tsx            # Home page component
├── index.html             # HTML template with SEO meta
├── vite.config.ts         # Vite configuration
├── tsconfig.json          # TypeScript config
└── vercel.json            # Vercel deployment config
```

## 🎨 Design System

### Color Tokens (CSS Custom Properties)

**Dark Mode (default)**
```css
--bg: #100e0a;
--surface: #1e1b16;
--accent: #c8963c;      /* Gold primary */
--accent-h: #d9a84e;    /* Hover state */
--text: #ede8df;
--text-dim: #a89e8e;
--border: #2e2a22;
```

**Light Mode**
```css
--bg: #faf7f2;
--surface: #e8e2d6;
--accent: #8a5c18;
--text: #111008;
```

### Typography
- **Display**: Space Grotesk (400-700)
- **Body**: DM Sans (300-700, italic)

### Spacing & Layout
- Container max-width: 1400px
- Padding: 6% horizontal (responsive)
- Section padding: 70px vertical
- Grid: CSS Grid + Flexbox

## 🛠️ Development

### Prerequisites
- Node.js 18+
- npm 9+

### Commands

```bash
# Install dependencies
npm install

# Development server
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Lint
npm run lint
```

### Environment Variables
None required for development.

## 🚀 Deployment

### Vercel (Recommended)
1. Connect repository to Vercel
2. Framework preset: Vite
3. Build command: `npm run build`
4. Output directory: `dist`
5. Environment variables: None needed

The `vercel.json` handles:
- SPA routing (fallback to index.html)
- Cache headers for static assets
- Security headers

### Build Output
```
dist/
├── index.html
├── assets/
│   ├── index-[hash].js      # Main bundle (code-split)
│   ├── index-[hash].css     # CSS bundle
│   └── [other chunks]       # Lazy-loaded chunks
├── logo/
├── *.png                    # Optimized images
└── ...
```

## ♿ Accessibility Checklist

- [x] Semantic HTML landmarks
- [x] Skip to content link
- [x] ARIA roles for tabs, dialogs, navigation
- [x] Color contrast ≥ 4.5:1 (all text)
- [x] Focus visible on all interactive elements
- [x] Form labels + error messages
- [x] Alt text for all images
- [x] Reduced motion support
- [x] Skip link target exists
- [x] Form field labels + aria-describedby for errors

## 📊 Performance Optimizations

### Implemented
- Font preloading + font-display: swap
- Critical CSS via Vite
- Route-based code splitting
- Image lazy loading + content-visibility
- Lenis smooth scroll (GPU accelerated)
- CSS containment for animated elements
- Preconnect to font origins

### Recommended Additions
- Service Worker for offline caching
- Brotli compression on server
- HTTP/2 or HTTP/3
- Resource hints (prefetch, prerender)

## 📝 Content Management

All content is in `src/data.ts`:
- `services[]` - Service cards with pricing
- `testimonials[]` - Client testimonials
- `process_steps[]` - Process steps
- `whyUs[]` - Why choose us cards
- `whatWeDo[]` - Service categories
- `showcase[]` - Portfolio projects

## 🔧 Configuration Files

| File | Purpose |
|------|---------|
| `vite.config.ts` | Build config, plugins, aliases |
| `tsconfig.json` | TypeScript strict mode |
| `vercel.json` | Deployment, headers, rewrites |
| `eslint.config.js` | ESLint + Prettier |

## 📄 License

Proprietary - AFRO-TECH 2026

---

Built with ❤️ in Addis Ababa, Ethiopia