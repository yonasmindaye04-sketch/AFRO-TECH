# AFRO-TECH — Marketing Site + AFRO Suite Platform

A monorepo containing two products:

1. **AFRO-TECH marketing site** — the public portfolio/services website (React, TypeScript, Vite)
2. **AFRO Suite** — a multi-tenant SaaS business platform (4 business systems: Pharmacy, Store, Hospital/Clinic, School) with its own API server

---

## What's in this repo

| Path | What it is |
|------|-----------|
| `src/` | Public website + the AFRO Suite web app (SPA) |
| `src/pages/`, `src/app.tsx` | Marketing pages (Home, Services, Products) |
| `src/platform/` | The AFRO Suite app — login, dashboards, POS, patients, students, marketing, admin |
| `server/` | Express + PostgreSQL API server (multi-tenant, JWT + RBAC) |
| `server/migrations/` | Versioned SQL migrations (001–028) |
| `public/` | Static assets, PWA manifest, SEO files |
| `api/` (root) | Legacy Vercel serverless contact form (the real contact endpoint runs on the API server) |

## AFRO Suite — the platform

Every company that registers gets a **private, isolated workspace** (45-day free trial):

- **Pharmacy** — POS with pill-level dispensing, FEFO batches, expiry control, margin pricing
- **Store** — fast POS, inventory, khata credit ledger, supplier dues
- **Hospital / Clinic** — patients, appointments, live queue, labs, billing
- **School** — students, attendance, grades, report cards, fees, guardian notifications

Shared by all: cash drawer shifts, expenses/P&L, RBAC staff roles, audit trail, CSV exports, Telegram alerts + Mini App, marketing campaigns (SMS/email), barcode scanning (camera + hardware), and a platform admin panel.

Sign in with **email/password**, **Google**, or **Telegram** — social sign-in creates the account and, on first login, a one-step workspace setup.

## Technical stack

- **Frontend**: React 18, TypeScript, Vite, React Router v6, plain CSS (custom properties, dark/light)
- **Backend**: Node 20+, Express 4, PostgreSQL, Redis + BullMQ (queues/workers), JWT auth
- **Integrations**: Telegram Bot API, Chapa payments, Resend email, Ethio Telecom SMPP, ZXing (camera barcode), Google OAuth
- **Deploy**: Vercel (web, `/api/*` proxied to the API), Render/VPS (API server)

## Project structure

```
portfolio-main/
├── src/
│   ├── app.tsx                  # Home page
│   ├── pages/                   # ServicesPage, ProductsPage (marketing site)
│   ├── components/              # Navbar etc.
│   ├── hooks/                   # useReveal, useCountUp, usePwaInstall
│   ├── context/                 # Theme context
│   ├── data.ts                  # Marketing site content
│   └── platform/                # AFRO Suite SPA (/app/*)
│       ├── index.tsx            # Routes + auth gate
│       ├── Login/ Register/ SocialAuthCallback
│       ├── AuthContext.tsx, api.ts, Shell.tsx, ui.tsx
│       ├── retail/              # POS, Products, Purchases, Sales, Credit, CashDrawer…
│       ├── hospital/            # Reception, FlowBoard, Patients, Labs, Billing…
│       ├── school/              # Students, Attendance, Grades, Fees, ReportCards…
│       ├── marketing/          # Dashboard, Contacts, Audiences, Templates, Campaigns
│       ├── admin/               # AFRO-TECH platform admin panel
│       └── ui/BarcodeScanner.tsx  # Camera barcode scanning (ZXing)
├── server/
│   ├── src/
│   │   ├── index.ts             # Express app — mounts all routes
│   │   ├── config/              # db pool, BullMQ queue
│   │   ├── middleware/          # authenticate, requirePermission, validateBody
│   │   ├── routes/              # auth, tenant, retail, hospital, school, marketing, billing…
│   │   ├── services/            # telegram, guardianNotifier, marketing engines, alerts
│   │   ├── channels/            # Email (Resend), SMS (Ethio Telecom SMPP)
│   │   ├── workers/             # Queue workers (campaign sends)
│   │   └── scripts/              # migrate, seed, seed-demo, seed-marketing
│   └── migrations/              # 001–028 SQL migrations
└── vercel.json                  # /api/v1/* → Render API; SPA fallback
```

## Development

### Prerequisites
- Node.js 20+, npm 10+
- PostgreSQL 14+ (local or Neon/Supabase)
- Redis (optional — marketing queue; mock channels work without it)

### Frontend

```bash
npm install
npm run dev          # http://localhost:5173 (proxies /api → localhost:4000)
npm run build        # production build (tsc + vite)
npm run lint
```

### API server

```bash
cd server
npm install
cp .env.example .env       # then fill in DB + JWT_SECRET
npm run migrate             # apply SQL migrations
npm run seed                # create the AFRO-TECH platform admin
npm run dev                 # http://localhost:4000

# Demo data (all four business types across existing tenants)
npm run seed:demo
npm run seed:marketing      # marketing contacts/audiences/templates/campaigns
```

### Environment variables (server)

Key variables (see `server/.env.example` for the full list):

| Variable | Purpose |
|----------|---------|
| `DATABASE_URL` | Postgres connection string (or discrete `DB_*` vars) |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Auth token signing (8h max per project rules) |
| `TRIAL_DAYS` | Trial length (default 45) |
| `TELEGRAM_BOT_TOKEN/USERNAME` | Platform Telegram bot (alerts, Mini App, login widget) |
| `GOOGLE_CLIENT_ID/SECRET` | Google sign-in (optional) |
| `RESEND_API_KEY` | Email sending (optional in dev) |
| `UPSTASH_REDIS_URL` | BullMQ queue (optional in dev) |
| `CHAPA_SECRET_KEY` | Subscription payments (mock provider in dev) |

## Deployment

- **Web (Vercel)**: connect repo, build `npm run build`, output `dist`. `vercel.json` rewrites `/api/v1/*` to the API host and handles SPA fallback + cache/security headers.
- **API (Render/VPS)**: `cd server && npm run build && npm start` (or the included `ecosystem.config.cjs` for PM2). Set env vars in the host dashboard; run `npm run migrate` once per release.
- **Android**: the site is a PWA — users can install from the browser menu or the navbar install button (no APK / Play Protect involved). For an APK, see DEPLOY.md §9 (build with `targetSdkVersion 35`).

## Docs

| Doc | Contents |
|-----|----------|
| `FEATURES.md` | Full feature guide per business system |
| `ARCHITECTURE.md` | Stack, data flow, multi-tenancy, auth model |
| `RULES.md` | Development rules for agents & contributors |
| `DEPLOY.md` | Production deployment + Android/Play Protect |
| `PLATFORM_REPORT.md` | Platform status report |
| `docs/USER_MANUAL.md` | End-user operations manual |

## License

Proprietary — AFRO-TECH 2026

---

Built in Addis Ababa, Ethiopia · +251-910-011-818
