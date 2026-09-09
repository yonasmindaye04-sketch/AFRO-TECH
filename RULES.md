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

---

*Last updated by agent — September 2026*
