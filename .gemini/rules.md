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

---

*Last updated — September 2026*
