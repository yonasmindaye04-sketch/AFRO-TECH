# AFRO SUITE — Development Rules

These rules apply to **all agents and contributors** working on this codebase. Read before making any changes.

---

## 1. No Emojis in the UI

**Never use emoji characters anywhere in the user interface.** This includes JSX/TSX files, CSS content, HTML strings, tooltips, labels, modals, notifications, or any text rendered to the user.

- Use **FontAwesome icons** (e.g. `<i className="fa-solid fa-envelope" />`) if an icon is needed.
- If no icon is needed, use plain text.
- This rule applies to ALL firm types: school, pharmacy, store, hospital.

---

## 2. No Background or Border on Status Badges

Status indicators (`.pl-badge`) must use **bold colored text only**. No backgrounds, no borders, no padding beyond what is needed for inline flow, no dot pseudo-element (`::before`).

- Correct: bold green text for "paid", bold red text for "unpaid"
- Wrong: pill-shaped badge with background color and a colored dot

---

## 3. No Decorative Tag Badges on Section Headings

Do not place `<Badge>` components or similar decorative tag-style elements on section or page titles/headings. For example:

- Wrong: `<h2>Receipt Preview <Badge tone="good">Latest Live Transaction</Badge></h2>`
- Right: `<h2>Receipt Preview</h2>` with a descriptive `<p>` below it.

---

## 4. Session Security

All authenticated sessions must:

- Use short-lived JWT tokens (`JWT_EXPIRES_IN=8h` in `.env`).
- Implement a **30-minute client-side inactivity timeout** that silently logs the user out (no warning popup needed).
- Handle `401` responses from the API by clearing auth state and redirecting to login.

---

## 5. Component & Style Guidelines

- Keep firm-specific color theming inside `.pl-firm-{type}` CSS classes.
- Use CSS custom properties (`var(--accent)`, `var(--surface)`, etc.) for all theme-aware colors.
- Do not hardcode hex colors outside of `platform.css`.
- Maintain consistent spacing using the existing `pl-*` utility classes.

---

## 6. Print / Report Card Design

Report cards must follow the formal multi-column layout (dual-tone header, boxed student info, grading table, attendance, comments, signatures). Include a linear graph showing grade movement across terms/semesters.

## 7. Dark Mode, Light Mode & Clean Indicators

- Both **Dark Mode** (`[data-theme="dark"]`) and **Light Mode** (`[data-theme="light"]`) must be fully supported across all firm types (hospital, pharmacy, store, school).
- Never hardcode `#ffffff` card/panel/table backgrounds in dark mode — always use CSS variables `var(--card)`, `var(--border)`, and `var(--bg-alt)`.
- Timetable slots and status indicators must **never** use colored background tints or thick colored indicator borders — use clean surface backgrounds with bold typography.

---

*Last updated by agent — September 2026*

---

## 8. Dashboard Design System

All dashboards (retail, pharmacy, hospital, school) must follow the **1-primary + 3-secondary hierarchy**:

- **Primary tile** (`pl-dash-primary`): Full-width hero card with box-shadow (`0 8px 32px rgba(0,0,0,.18)`), `border-radius: 20px`, SVG spiral decoration, large tabular-numeral value.
- **Secondary tiles** (`pl-dash-secondary` grid): 3 tiles in a row, `border-radius: 14px`, **no box-shadow** — they do not float.
- **Shadow only on floating elements**: modals, the primary hero tile, dropdowns. Cards and tables get border-only, no shadow.
- **Tighter radius on small parts**: buttons/inputs = `8–10px`, table rows = no individual radius, cards = `14px`, hero tile = `20px`.
- **Spiral SVG decoration** on stat tiles — no icon-in-circle badge graphics.
- **Tabular digits**: all monetary and numeric values on dashboards must use `font-variant-numeric: tabular-nums`.

---

## 9. Theme Toggle Placement

- The theme toggle (moon/sun icon) exists **only** in the top-right of the sidebar brand bar (`pl-theme-toggle` class).
- **No second theme toggle** in the sidebar footer or anywhere else on the page.

---

## 10. No Trial Banners or Comparison Bars

- Do not render trial banners, free-trial notices, or "this month vs last month" comparison bars to end users.
- If subscription status is needed, direct users to the Subscription page via the sidebar nav link.

---

## 11. Compact Date Range Filters

All date-range filter inputs (`type="date"`) inside `.pl-toolbar` must be wrapped in a flex group with explicit `width: 150px` on each input to prevent them from stretching full-width:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <input className="pl-input" type="date" style={{ width: 150 }} ... />
  <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>to</span>
  <input className="pl-input" type="date" style={{ width: 150 }} ... />
</div>
```
