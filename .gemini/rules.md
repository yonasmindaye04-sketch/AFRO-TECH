# AFRO SUITE — Agent Rules

These rules apply to all AI agents working in this workspace. They supplement any task-specific instructions.

---

## UI Rules

1. **Zero emojis** — Never use emoji characters anywhere in UI code. Use FontAwesome icons (`<i className="fa-solid fa-..." />`) when an icon is needed.

2. **No background/border on status badges** — `.pl-badge` must use bold colored text only. No pill backgrounds, no borders, no dot pseudo-elements (`::before`).

3. **No decorative tag badges on section headings** — Do not add `<Badge>` components beside section titles. Use descriptive `<p>` text below the heading instead.

## Session & Auth Rules

4. **Short JWT lifetime** — Set `JWT_EXPIRES_IN=8h` in server `.env`. Never use `7d` or longer.

5. **30-minute inactivity timeout** — Implement a silent client-side idle logout (reset on `mousemove`, `keydown`, `click`, `scroll`). No warning popup.

## Design Rules

6. **Report cards** — Must use the formal dual-tone header layout with a linear grade-movement graph across terms/semesters.

7. **Firm color themes** — Use `.pl-firm-{type}` classes and `var(--accent)` / `var(--surface)` CSS variables. Never hardcode hex colors outside `platform.css`.

## Code Quality

8. **Preserve existing comments and docstrings** unrelated to your changes.

9. **Run `tsc --noEmit` and `vite build`** to verify type safety and build success after backend/frontend changes respectively.

10. **Never use `ArtifactMetadata`** when writing project source files (only use it for artifact documents in the brain directory).

11. **Dark & Light Mode Support** — Both Dark Mode (`[data-theme="dark"]`) and Light Mode (`[data-theme="light"]`) must be supported across all firm types. Use CSS variables instead of hardcoded background colors.

12. **Clean Timetable & Indicators** — Never use colored background tints or thick colored indicator stripes for timetable slots or badges. Use clean surface backgrounds and bold text.

## Backend Rules

13. **MAX-based sequential codes** — `nextCode()` (`server/src/utils/helpers.ts`) uses `MAX(trailing digits)+1` per tenant. Never use `count(*)+1` (deleted rows cause duplicate codes), and seed scripts must continue numbering from the existing MAX.

14. **Qualify SQL columns in JOINs** — `WHERE t.tenant_id = $1`, never bare `tenant_id` when the query joins `users` (ambiguity = 500). Count queries must not reference aliases that only exist in the main query.

15. **Wrap async route handlers in `asyncHandler`** — Express 4 does not catch async rejections; an unwrapped handler hangs the request on any DB error.

16. **Migrations** — next unused number, idempotent (`IF NOT EXISTS`), and must be applied to the cloud database before release. CHECK constraints must cover every value the app inserts. Seeds must be re-runnable (skip existing data).

## Layout & Mobile Rules

17. **No icon background tiles** — icons are bare colored glyphs; no rounded tinted squares behind them (`.pl-stat-icon`, dashboard icons, system cards).

18. **Mobile compaction** — KPI stats two-per-row at ≤ 640px, page action buttons share one row, dashboard tiles stay two-across on small phones. Never set inline `gridTemplateColumns` on `.pl-stats`.

19. **Reachability** — every page must be linked from the UI; a route with no navigation entry is considered broken.

20. **Secure-context features** — camera features (barcode scanning) need HTTPS; provide friendly permission errors and a manual typed-input fallback.

---

*Last updated — September 2026*
