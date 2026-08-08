# Contributing to AFRO-TECH Portfolio

Thank you for your interest in contributing! This document outlines the process and standards for contributing to the AFRO-TECH portfolio website.

## 📋 Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Code Standards](#code-standards)
- [Commit Guidelines](#commit-guidelines)
- [Pull Request Process](#pull-request-process)
- [Testing](#testing)
- [Accessibility Requirements](#accessibility-requirements)
- [Performance Requirements](#performance-requirements)

## 🤝 Code of Conduct

This project follows the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you agree to uphold this code.

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ (use `nvm` or `fnm` for version management)
- npm 9+
- Git 2.30+

### Setup

```bash
# Fork and clone
git clone https://github.com/YOUR_USERNAME/portfolio-main.git
cd portfolio-main

# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:5173
```

### IDE Setup (VS Code Recommended)

Install recommended extensions:
```json
{
  "recommendations": [
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "bradlc.vscode-tailwindcss",
    "formulahendry.auto-rename-tag",
    "christian-kohler.path-intellisense",
    "usernamehw.errorlens"
  ]
}
```

Enable format on save:
```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": "explicit"
  }
}
```

## 🔄 Development Workflow

### Branch Strategy

```
main (protected)
  │
  ├── feature/xxx-description (new features)
  ├── fix/xxx-description (bug fixes)
  ├── refactor/xxx-description (code improvements)
  ├── docs/xxx-description (documentation)
  └── chore/xxx-description (maintenance)
```

### Feature Development

```bash
# 1. Create feature branch
git checkout -b feature/add-new-service-card

# 2. Make changes with atomic commits
git add -A
git commit -m "feat: add new service card component

- Add ServiceCard component with tier support
- Include pricing, features, CTA
- Add hover/focus states"

# 3. Push and create PR
git push origin feature/add-new-service-card
```

### Local Development Loop

```bash
# Terminal 1: Dev server
npm run dev

# Terminal 2: Type checking (optional)
npm run typecheck

# Terminal 3: Linting (optional)
npm run lint
```

## 📝 Code Standards

### TypeScript

```typescript
// ✅ DO: Explicit types for props and state
interface ServiceCardProps {
  service: Service;
  tierColor: string;
  onSelect: (id: number) => void;
}

export function ServiceCard({ service, tierColor, onSelect }: ServiceCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  // ...
}

// ❌ DON'T: Use any, implicit any, or missing types
function BadComponent({ data }: any) { } // ❌
```

### React Patterns

```typescript
// ✅ DO: Functional components with hooks
export function ServiceCard({ service }: ServiceCardProps) {
  const [isHovered, setIsHovered] = useState(false);
  
  return (
    <article className="plan-card" onMouseEnter={() => setIsHovered(true)}>
      {/* ... */}
    </article>
  );
}

// ✅ DO: Early returns for guards
function ContactForm() {
  if (!formData.name) return <ErrorMessage />;
  
  return <form>...</form>;
}

// ❌ DON'T: Class components (unless absolutely necessary)
class BadComponent extends React.Component { } // ❌
```

### CSS/Styling

```css
/* ✅ DO: Use CSS custom properties */
.card {
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: var(--spacing-lg);
}

/* ✅ DO: Mobile-first responsive */
.container {
  padding: 16px;
}
@media (min-width: 768px) {
  .container { padding: 24px; }
}

/* ✅ DO: Logical properties */
.element {
  margin-inline-start: 16px;
  padding-block: 16px;
}

/* ❌ DON'T: Hardcoded values, !important */
.bad { color: #c8963c !important; } /* ❌ */
```

### Accessibility

```tsx
// ✅ DO: Semantic HTML + ARIA
<button 
  className="btn-primary"
  aria-label="Start a project"
  onClick={handleClick}
>
  Start Project <i className="fa-solid fa-arrow-right" aria-hidden="true" />
</button>

// ✅ DO: Form labels + error association
<label htmlFor="email">Email <span className="req">*</span></label>
<input 
  id="email" 
  type="email" 
  aria-describedby={fieldErrors.email ? 'email-error' : undefined}
  aria-invalid={!!fieldErrors.email}
/>
{fieldErrors.email && (
  <span id="email-error" className="field-error" role="alert">
    {fieldErrors.email}
  </span>
)}

// ✅ DO: Focus management
<div className="skip-to-content">
  <a href="#main-content">Skip to main content</a>
</div>

// ❌ DON'T: Remove focus styles
*:focus { outline: none; } /* ❌ */
```

### File Naming

```
components/
├── Navbar.tsx           # PascalCase for components
├── Navbar.css           # Same name for styles
├── ServiceCard.tsx      # Descriptive, singular
├── ServiceCard.css
└── index.ts             # Barrel exports (optional)

hooks/
├── useReveal.ts         # camelCase, use prefix
├── useCountUp.ts

pages/
├── ServicesPage.tsx     # Page suffix
└── ServicesPage.css

data.ts                  # Data files: lowercase
types.ts                 # Type definitions
```

## 📋 Commit Guidelines

### Conventional Commits

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types

| Type | Description |
|------|-------------|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring (no behavior change) |
| `perf` | Performance improvement |
| `docs` | Documentation only |
| `style` | Formatting, missing semi-colons, etc. |
| `test` | Adding/updating tests |
| `chore` | Maintenance, deps, build config |
| `ci` | CI/CD changes |
| `revert` | Revert previous commit |

### Examples

```bash
# Feature
git commit -m "feat(showcase): add animated tab panel transitions

- Add fade/scale animation on tab switch
- Use animKey for proper React reconciliation
- Reduce motion support via prefers-reduced-motion"

# Fix
git commit -m "fix(contact): prevent form submission on Enter in textarea

- Add keydown handler to prevent default on Enter
- Only submit on button click"

# Performance
git commit -m "perf(images): add WebP/AVIF formats for hero logo

- Generate WebP (85% quality) and AVIF (70% quality)
- Add picture element with type fallbacks
- Reduce hero image from 189KB to 42KB"

# Documentation
git commit -m "docs(readme): add architecture documentation

- Add ARCHITECTURE.md with component diagram
- Document data flow and state management
- Add performance optimization section"
```

## 🔍 Pull Request Process

### PR Checklist

Before opening a PR, ensure:

- [ ] All TypeScript errors resolved (`npm run typecheck`)
- [ ] No ESLint errors (`npm run lint`)
- [ ] Build succeeds (`npm run build`)
- [ ] Accessibility audit passes (axe-core)
- [ ] Performance budget met (< 200KB JS, < 50KB CSS initial)
- [ ] Responsive tested (320px, 768px, 1024px, 1440px)
- [ ] Dark/light mode both work
- [ ] Reduced motion tested
- [ ] Cross-browser tested (Chrome, Firefox, Safari)

### PR Template

```markdown
## Description
Brief summary of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update
- [ ] Performance improvement
- [ ] Refactor

## Testing
- [ ] Unit tests pass
- [ ] Manual testing completed
- [ ] Accessibility tested (axe, keyboard, screen reader)
- [ ] Performance tested (Lighthouse)

## Screenshots
| Before | After |
|--------|-------|
| ![before](url) | ![after](url) |

## Checklist
- [ ] Code follows style guidelines
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No console.log/debugger left
- [ ] Dependencies justified (if added)
```

### Review Process

1. **Automated Checks**: CI runs typecheck, lint, build, accessibility
2. **Code Review**: At least 1 approval required
3. **Manual Testing**: Reviewer tests locally
4. **Merge**: Squash and merge to main

## 🧪 Testing

### Test Types

| Type | Tool | Command | Coverage Target |
|------|------|---------|-----------------|
| Unit | Vitest | `npm run test` | 80% |
| E2E | Playwright | `npm run test:e2e` | Critical paths |
| Accessibility | axe-core | `npm run test:a11y` | 0 violations |
| Visual | Playwright | `npm run test:visual` | Key pages |

### Running Tests

```bash
# Unit tests
npm run test

# E2E tests
npm run test:e2e

# Accessibility
npm run test:a11y

# Visual regression
npm run test:visual

# All tests
npm run test:all
```

### Writing Tests

```typescript
// Component test example
import { render, screen, fireEvent } from '@testing-library/react';
import { ServiceCard } from './ServiceCard';

describe('ServiceCard', () => {
  const mockService = {
    id: 1,
    type: 'Landing Page',
    price: '10,000 – 18,000',
    tier: 'starter',
    icon: 'fa-solid fa-rocket'
  };

  it('renders service details', () => {
    render(<ServiceCard service={mockService} tierColor="#60a5fa" onSelect={vi.fn()} />);
    
    expect(screen.getByText('Landing Page')).toBeInTheDocument();
    expect(screen.getByText('10,000 – 18,000')).toBeInTheDocument();
  });

  it('calls onSelect when clicked', () => {
    const handleSelect = vi.fn();
    render(<ServiceCard service={mockService} tierColor="#60a5fa" onSelect={handleSelect} />);
    
    fireEvent.click(screen.getByRole('button'));
    expect(handleSelect).toHaveBeenCalledWith(1);
  });
});
```

## ♿ Accessibility Requirements

### Must Pass (Automated)
- [ ] axe-core: 0 violations
- [ ] Color contrast ≥ 4.5:1 (AA)
- [ ] Color contrast ≥ 3:1 (large text)
- [ ] No duplicate IDs
- [ ] All images have alt text
- [ ] Form inputs have labels
- [ ] Heading hierarchy (h1-h6)

### Must Pass (Manual)
- [ ] Keyboard navigation (Tab, Shift+Tab, Enter, Escape, Arrow keys)
- [ ] Focus indicators visible
- [ ] Focus order logical
- [ ] Screen reader (NVDA/JAWS/VoiceOver) announces correctly
- [ ] Skip link works
- [ ] Focus trap in modals/menus
- [ ] Live regions announce changes
- [ ] Reduced motion respected

### Testing Tools

```bash
# Automated accessibility
npx @axe-core/cli http://localhost:5173

# In CI
npx @axe-core/playwright test:e2e

# Screen readers
# Windows: NVDA (free)
# Mac: VoiceOver (built-in)
# iOS: VoiceOver
# Android: TalkBack
```

## ⚡ Performance Requirements

### Budgets (Enforced in CI)

| Metric | Budget | Tool |
|--------|--------|------|
| Total JS | < 200 KB gzipped | webpack-bundle-analyzer |
| Total CSS | < 50 KB gzipped | - |
| LCP | < 2.5s | Lighthouse |
| FID | < 100ms | Lighthouse |
| CLS | < 0.1 | Lighthouse |
| TBT | < 200ms | Lighthouse |
| FCP | < 1.8s | Lighthouse |

### Performance Checklist

- [ ] Images: WebP/AVIF, proper dimensions, lazy loaded
- [ ] Fonts: Preload, font-display: swap, subset
- [ ] CSS: Critical inlined, non-critical async
- [ ] JS: Code split by route, tree-shaken
- [ ] Third-party: Minimal, async, preconnect
- [ ] Caching: Immutable assets, long max-age

## 📚 Resources

### Documentation
- [React Docs](https://react.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vite Guide](https://vite.dev/guide/)
- [WCAG 2.1 Guidelines](https://www.w3.org/WAI/WCAG21/quickref/)
- [ARIA Authoring Practices](https://www.w3.org/WAI/ARIA/apg/)

### Tools
- [axe DevTools](https://www.deque.com/axe/devtools/)
- [Lighthouse CI](https://github.com/GoogleChrome/lighthouse-ci)
- [WebPageTest](https://www.webpagetest.org/)
- [Bundle Analyzer](https://github.com/webpack-contrib/webpack-bundle-analyzer)

---

Thank you for contributing! 🎉