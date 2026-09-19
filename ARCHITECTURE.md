# Architecture Documentation

This repo is a **monorepo** with two deployed pieces:

1. **The AFRO-TECH marketing site** (public portfolio/services/products pages)
2. **The AFRO Suite platform** — a multi-tenant SaaS web app + API server

```
                       ┌────────────────────────────────┐
                       │           Browser               │
                       │  Marketing site + /app SPA      │
                       └───────────────┬────────────────┘
                                       │ HTTPS
                       ┌───────────────▼────────────────┐
                       │        Vercel (static)          │
                       │  dist/ + vercel.json rewrites   │
                       │  /api/v1/*  ────────────────┐   │
                       └─────────────────────────────┼───┘
                                                     │
                       ┌─────────────────────────────▼───┐
                       │   AFRO Suite API (Render/VPS)   │
                       │   Express 4 · Node 20+          │
                       │   /api/v1/auth, retail, hospital│
                       │   school, marketing, billing,    │
                       │   flow, telegram, admin…        │
                       └───────┬──────────────┬──────────┘
                               │              │
                 ┌─────────────▼───┐   ┌───────▼─────────┐
                 │   PostgreSQL    │   │ Redis + BullMQ  │
                 │ (multi-tenant,  │   │ campaign queue  │
                 │  28 migrations) │   │ + workers       │
                 └─────────────────┘   └─────────────────┘
```

## 1. Frontend (src/)

### Marketing site (`/`, `/services`, `/products`)
- React 18 + TypeScript + Vite; route-level code splitting via `React.lazy`
- Theme via CSS custom properties + `[data-theme]` on `<html>`
- Lenis smooth scrolling; IntersectionObserver reveal animations (`useReveal`, `useCountUp`)
- PWA installable — `usePwaInstall` hook + navbar install button (`beforeinstallprompt`)

### AFRO Suite app (`/app/*` — `src/platform/`)
- `index.tsx` — route table, auth gate (`Gate`), trial/suspension blocking
- `AuthContext.tsx` — JWT persistence, `/auth/me` refresh, 30-min idle logout
- `Shell.tsx` — sidebar nav per business type (`RETAIL_NAV`, `HOSPITAL_NAV`, `SCHOOL_NAV`) with permission-filtered items
- Feature folders: `retail/`, `hospital/`, `school/`, `marketing/`, `admin/`, `pages/` (Team, Settings, BotStudio, Subscription)
- Shared UI kit in `ui.tsx` (PageHeader, DataTable, Modal, Badge, StatCard…) and `ui/BarcodeScanner.tsx` (camera scanning via `@zxing/browser`)

Key flows:
- **Login**: email/password → JWT; **Google** → `/auth/google` OAuth redirect → `/app/social` callback page; **Telegram** → login widget → HMAC-verified `/auth/telegram-login` → `/app/social`. New social users get a one-step workspace creation form (`/auth/complete-social`).
- **All data fetching** goes through `api.ts` (`fetch` wrapper with Bearer token) + `useApiData` hook (loading/error/reload).

## 2. Backend (server/)

### Entry & middleware
- `index.ts` mounts: `auth`, `tenant`, `users`, `admin`, `retail`, `hospital`, `flow`, `school`, `telegram`, `tenant-bot`, `billing`, `marketing`
- `middleware/auth.ts` — verifies JWT, reloads user/tenant/**permissions on every request** (owner ⇒ all permissions; staff ⇒ role permissions), auto-expires trials
- `middleware/validate.ts` — zod body validation + central error handler
- Route handlers are wrapped in `asyncHandler` (Express 4 doesn't catch async rejections natively)

### Multi-tenancy
- Every business table carries `tenant_id`; **all queries filter by the caller's tenant from the JWT** — there is no cross-tenant path
- Sequential per-tenant codes (`PAT-00001`, `STU-00001`, `INV-00001`) via `nextCode()` — **MAX-based** (`MAX(trailing digits) + 1`), so deleted rows can never cause duplicate codes
- Workspace creation (`/auth/register`, `/auth/complete-social`) also seeds default departments per business type

### Route modules (server/src/routes/)
| Module | Scope |
|--------|-------|
| `auth.ts` | register, login, `/me`, change-password, **social login** (providers/google/telegram-login/complete-social) |
| `retail.ts` | products (+ barcode lookup), purchases, sales (FEFO, pill mode), returns, stock adjustments, expiry, credit khata, cash drawer, reports |
| `hospital.ts` | patients, doctors, appointments (double-book guard), medical records, invoices, lab tests, queue |
| `hospitalFlow.ts` | departments, visits (patient journey), service orders, visit billing |
| `school.ts` | students, classes, attendance, grades, fees, timetable, report cards, announcements, guardian notifications, promotion |
| `marketing/` | contacts, audiences (dynamic rules/static), templates (versioned), campaigns (multi-channel), webhooks, analytics |
| `billing.ts` | subscription plans + Chapa checkout/webhooks (mock provider in dev) |
| `telegram.ts`, `tenant-bots.ts` | platform bot, per-tenant bots, Mini App signed-initData auth |
| `admin.ts` | AFRO-TECH admin: tenants, grants, suspensions, stats |

### Services & workers
- `services/marketing/*` — template variable engine, audience rule engine, campaign queueing
- `channels/` — `ResendEmailChannel`, `EthioTelecomSmppChannel` (mock mode for dev) behind a common `MarketingChannel` interface
- `workers/` — BullMQ workers send queued campaign messages with retries
- `services/alerts.ts` — scheduled low-stock/expiry/fee/appointment pushes
- `services/guardianNotifier.ts`, `hospitalNotify.ts` — email + Telegram delivery

### Database (server/migrations/ 001–028)
Highlights: core tenancy (001), retail batches (002), labs + telegram (003/006), RBAC (007), departments/visits/orders (020–024), marketing stack (011–017), cash drawer (025), RBAC extension (026), inventory data model (027a), **social login** identity columns (027b), **departments type CHECK fix** (028 — workspace creation for pharmacy/store/school previously failed on constrained types).

Migrations are plain SQL, tracked by filename, idempotent (`IF NOT EXISTS`), applied with `npm run migrate`.

### Demo/seed data
- `seed.ts` — platform admin account
- `seed-demo.ts` — full demo data for all four business types (patients, students, products, sales, visits, grades…); codes continue from existing MAX so re-runs never duplicate
- `seed-marketing.ts` — idempotent marketing demo data (contacts + channels, templates, dynamic/static audiences, completed + draft campaigns with delivery analytics)

## 3. Security model

- Short-lived JWTs (`JWT_EXPIRES_IN=8h`), permissions reloaded from DB on every request — disabling an account takes effect immediately
- OAuth state (signed JWT, 10-min) for Google; HMAC-SHA256 verification + 24h freshness for Telegram login widget and Mini App initData
- Social accounts: `users.google_id` / `users.telegram_id` (unique, nullable); email match links an existing password account; social-only users get random passwords
- Security headers in `vercel.json`; rate limiting on credential endpoints; zod validation on all writes
- `RULES.md` constraints: no emojis in UI, badge/indicator styling discipline, firm theming via CSS variables

## 4. Build & deploy

```
git push ─▶ Vercel (web: npm run build → dist)
        └─▶ Render (API: server/ npm run build → dist/index.js, migrations on release)
```

- Vercel rewrites `/api/v1/*` → API host; SPA fallback to `index.html`
- Camera features (barcode scanning) require HTTPS — production qualifies
- PWA: `site.webmanifest` + install prompt; Android APK guidance in `DEPLOY.md` §9 (targetSdkVersion 35 to avoid Play Protect blocks)

## 5. Documentation map

| Doc | Contents |
|-----|----------|
| `FEATURES.md` | Feature guide per system (retail engines, hospital, school, marketing) |
| `RULES.md` / `.gemini/rules.md` | Agent + contributor rules (UI, SQL, migrations, codes) |
| `DEPLOY.md` | Deployment, Telegram bot setup, Android/Play Protect |
| `docs/USER_MANUAL.md` | End-user operations manual |
