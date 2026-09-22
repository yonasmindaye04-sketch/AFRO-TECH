# AFRO SUITE — Development Rules

These rules apply to **all agents and contributors** working on this codebase. Read before making any changes.

---

## 1. No Emojis in the UI

**Never use emoji characters anywhere in the user interface.** This includes JSX/TSX files, CSS content, HTML strings, tooltips, labels, modals, notifications, or any text rendered to the user.

- Use **FontAwesome icons** (e.g. `<i className="fa-solid fa-envelope" />`) if an icon is needed.
- If no icon is needed, use plain text.
- This rule applies to ALL firm types: school, pharmacy, store, hospital.

---

## 2. No Background or Border on Indicators & Badges

All indicators, tags, and status badges (e.g., `.pl-badge`, "save X%" labels) must use **bold colored text only**. No low-opacity background colors, no backgrounds at all, no borders, no padding beyond what is needed for inline flow, and no dot pseudo-element (`::before`).

- Correct: bold green text for "paid", bold red text for "unpaid", bold green text for "save 9%"
- Wrong: pill-shaped badge with a light background color (e.g., `rgba(x, x, x, 0.12)`) and a colored dot

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

---

## 7. Dark Mode, Light Mode & Clean Indicators

- Both **Dark Mode** (`[data-theme="dark"]`) and **Light Mode** (`[data-theme="light"]`) must be fully supported across all firm types (hospital, pharmacy, store, school).
- Never hardcode `#ffffff` card/panel/table backgrounds in dark mode — always use CSS variables `var(--card)`, `var(--border)`, and `var(--bg-alt)`.
- Timetable slots and status indicators must **never** use colored background tints or thick colored indicator borders — use clean surface backgrounds with bold typography.

---

## 8. Theme Toggle Placement

- The theme toggle (moon/sun icon) exists **only** in the top-right of the sidebar brand bar (`pl-theme-toggle` class).
- **No second theme toggle** in the sidebar footer or anywhere else on the page.

---

## 9. No Trial Banners or Comparison Bars

- Do not render trial banners, free-trial notices, or "this month vs last month" comparison bars to end users.
- If subscription status is needed, direct users to the Subscription page via the sidebar nav link.

---

## 10. Compact Date Range Filters

All date-range filter inputs (`type="date"`) inside `.pl-toolbar` must be wrapped in a flex group with explicit `width: 150px` on each input to prevent them from stretching full-width:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <input className="pl-input" type="date" style={{ width: 150 }} ... />
  <span style={{ color: 'var(--text-dim)', whiteSpace: 'nowrap' }}>to</span>
  <input className="pl-input" type="date" style={{ width: 150 }} ... />
</div>
```

---

## 11. Sequential Codes Are MAX-Based

Human-facing codes (`PAT-00001`, `STU-00001`, `INV-00001`) must be generated with `nextCode()` (`server/src/utils/helpers.ts`), which uses **`MAX(trailing digits) + 1` per tenant**.

- **Never** use `count(*) + 1` — deleting a row would hand that code to the next insert and create duplicates.
- Seed scripts must **continue numbering from the existing MAX** in the table, never restart at 0001.
- Both `PAT0042` and `PAT-00042` formats must parse (extract digits; never assume fixed positions).

---

## 12. SQL Column Discipline

Two production 500s came from sloppy SQL — do not repeat them:

- **Qualify every column** when a query has a JOIN: `WHERE t.tenant_id = $1`, not `WHERE tenant_id = $1` (the `users` table also has a `tenant_id` column, so ambiguity errors crash the route).
- **Count/summary queries must not reference aliases** defined only in the main query — `SELECT COUNT(*) FROM marketing_campaigns WHERE c.tenant_id = $1` fails because `c` doesn't exist there.
- Exercise list endpoints (including their COUNT side-queries and filter variants) against a real database before shipping.

---

## 13. No Icon Background Tiles

Icons render as **bare colored glyphs** — no rounded background squares, no tinted tiles, no shadows behind icons (`.pl-stat-icon`, `.pl-dash-primary-icon`, product/system cards). This extends the badge rule (§2) to icon containers.

---

## 14. Mobile Compaction Rules

Pages must stay dense and usable on phones:

- KPI stats (`.pl-stats`): **two per row** at ≤ 640px with compact padding/type — never one giant card per row.
- Page action buttons (`.pl-page-actions`): share one row (`flex: 1`) at mobile sizes.
- Dashboard tiles stay **two-across** down to small phones — don't collapse to one column and don't hide icons to "save space".
- Never set inline `gridTemplateColumns` on `.pl-stats` — it defeats the responsive CSS.

---

## 15. Migrations & Seeds

- New migrations get the **next unused number** (check the folder first) and must be idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`).
- Every schema-changing migration must also be applied to the **cloud database** before release — local-only migrations cause production 500s.
- Seed scripts must be **re-runnable**: skip when data already exists, and continue code numbering from existing MAX values.
- CHECK constraints must cover every value the application inserts (the original `departments.type` constraint broke workspace creation for pharmacy/store/school).

---

## 16. Async Route Handlers

Express 4 does **not** catch async rejections. Every async route handler must be wrapped in `asyncHandler` — an unwrapped handler turns any DB error into a hung request or a crashed process.

---

## 17. Reachability Rule

Every feature page must be **reachable from the UI**. Routes that exist but have no navigation entry (marketing sub-pages before the tab bar, for example) are considered broken — when adding a page, add its navigation too.

---

## 18. Secure-Context Features

Camera features (barcode scanning, video) require **HTTPS** (or localhost). Ship friendly error messages for permission denial / insecure context, and always offer a manual fallback (typed input).

---

*Last updated — September 2026*
