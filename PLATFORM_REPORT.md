# AFRO Suite — Platform Report

**AFRO-TECH · Multi-tenant business systems platform**
Version 1.3 · August 2026

---

## 1. Executive summary

AFRO Suite is a multi-tenant SaaS platform that gives every registering company a **private, isolated workspace** with one of four production-ready business systems:

| System | Who it serves | Core promise |
|---|---|---|
| **Pharmacy Management** | Pharmacies & drug stores | Pill-level dispensing, batch/expiry control, FEFO safety, margin-based POS |
| **Store Management** | Retail shops of any kind | Fast POS, inventory, credit (khata) ledger, supplier management |
| **Hospital / Clinic Management** | Clinics & small hospitals | Patient flow, records, labs, billing — no double bookings, no paper |
| **School Management** | Schools & academies | Enrollment → attendance → grades → report cards → fees |

Each company registers itself, gets a **45-day free trial with full features**, works with its **own real data** (no dummy data), and AFRO-TECH can grant, extend or suspend access from an admin panel. Subscription billing slots in later.

A **Telegram bot + Mini App** keeps users productive away from the desk: push alerts for stock, expiry, fees and appointments; quick commands; and one-tap access to the full workspace already signed in.

Everything ships as **one Node.js process** (marketing site + platform + API) behind Nginx, deployable on any VPS per `DEPLOY.md`.

---

## 2. Architecture — how it all works

```
Browser / Telegram WebView
        │  HTTPS
        ▼
   Nginx :443  ── static files (React SPA: dist/)
        │
        └─ /api/* → Node/Express (pm2, port 4000)
                        │
                        ▼
                  PostgreSQL  (one DB, shared schema,
                   tenant_id column isolates every company)
                        │
                        ▼
              Telegram Bot API (alerts + commands)
```

**Stack**

- **Frontend:** React 19 + TypeScript + Vite + React Router 7. The marketing site and the platform share one build; the platform (`/app/*`) is lazy-loaded and code-split per page. Styling reuses the AFRO-TECH design tokens (dark/light).
- **Backend:** Express + TypeScript (ESM), `pg` connection pool, Zod validation on every write, Helmet security headers, brute-force rate limiting on credential routes.
- **Database:** PostgreSQL. Every business table carries `tenant_id`; **every query is filtered by the tenant derived from the caller's JWT** — cross-tenant leakage is structurally impossible.
- **Auth:** bcrypt(12) password hashing, JWT (7-day) tokens, and the middleware re-loads the user + tenant on **every request**, so suspensions and trial expiries apply instantly.

**Multi-tenancy lifecycle**

1. Visitor opens `/products` (or `/app/register`) and picks a system type (pharmacy / store / hospital / school).
2. `POST /api/v1/auth/register` creates the tenant (unique slug), the owner account, and sets `trial_ends_at = now + 45 days`. Access is **instant** — no approval step.
3. A middleware auto-flips the tenant to `expired` when the trial ends; expired tenants can still sign in (to see the expiry screen and keep their data) but every data endpoint returns `402 TRIAL_EXPIRED`.
4. AFRO-TECH admins (seeded via `npm run seed`) can **grant free access, extend trials by N days, suspend/resume**, and reset any user's password from the admin panel.

**Security model**

- Parameterized SQL everywhere; Zod validates every request body.
- Login/register rate-limited (30 attempts / 15 min → 429).
- Audit log records critical mutations (sales, refunds, returns, adjustments, payments, promotions, password resets) with user + details, viewable by AFRO-TECH admins.
- Telegram Mini App logins use Telegram's signed `initData`, verified server-side with the official HMAC-SHA256 algorithm, a 24-hour freshness window and constant-time comparison. `initDataUnsafe` is never trusted.

---

## 3. Platform-wide features (all four systems)

| Feature | How it works |
|---|---|
| **Workspace settings** | Owner sets business phone, address, receipt footer, currency label, tax %, (schools: academic year; retail: POS margin presets). These flow onto receipts, invoices and report cards. |
| **Team management** | Owners create staff logins (email + temporary password); staff see the same company data; owners can disable staff. |
| **Reports + CSV export** | Every major list and report exports to CSV client-side. |
| **Printing** | Print-optimized layouts for receipts, invoices, customer statements and report cards (`@media print` isolates the print area). |
| **Audit trail** | `audit_logs` capture who did what (sales, refunds, stock moves, payments, link/unlink, promotions). Admin panel shows the latest activity across all tenants. |
| **AFRO-TECH admin panel** | All companies with owner contact, status badges, trial days left; grant access / extend / suspend / resume; reset any owner's password; platform stats by business type. |
| **Telegram assistant** | Push alerts + commands + Mini App (details in §8). |
| **Marketing site** | Landing, services pricing, and a Products page presenting the four systems with trial CTAs. |

---

## 4. Pharmacy Management

### 4.1 How medicines are recorded

Products carry pharmacy-specific configuration:

- **Name, category, unit** (box / strip / pcs…), **barcode** (scan-to-sell)
- **Cost price & sell price** per unit
- **Sell-by-pill toggle** with **pills-per-unit** (e.g. 30 capsules per box) — the system then prices and counts in *pills*
- **Default margin %** (e.g. 25) — preselects the POS margin
- **Low-stock threshold** for reorder alerts
- Managed **category list** per tenant

Stock is held in **batches** — every delivery creates batch rows with **batch number, expiry date, quantity, cost price and (optionally) its own selling price**, because pharmacies re-price per delivery.

### 4.2 How pills are counted (the FEFO engine)

This is a faithful port of the original PPR engine, verified by tests:

1. Each product tracks **loose pills** and which batch they came from.
2. Selling pills: loose pills are used **first**; if more are needed, whole packs are broken open (FEFO — first-expiring pack first) and the leftover pills return to the loose pool.
3. Per-pill cost is derived from the actual batches broken, so **profit stays accurate even for loose pills**.
4. **Expired batches are never dispensed** — the POS simply can't reach them; they remain visible on the Expiry page for write-off. (Verified: selling stops at 0 sellable while expired stock still exists.)
5. Product lists show stock the pharmacist way: *"150 pills ≈ 5 packs + 0 loose"*, plus a red **"+N expired (write off)"** hint when applicable.

### 4.3 Point of Sale (New Sale)

- Product grid with instant search + category filter, **barcode scanning** (hardware scanners or phone camera via the input field).
- Cart with per-line **margin dropdown** (List price or presets like 20/25/30 from Settings) — price recalculates as cost × (1 + margin).
- Pill products get **packs + loose pills steppers**; totals show per-pill pricing.
- Discount, payment method (**cash / card / mobile / credit**), change-due calculation.
- **Receipt printing** with business header, items, totals and footer message.
- Every completed sale **feeds the open cash-drawer shift** (cash/card/mobile buckets) and writes an audit entry.

### 4.4 Purchases (receiving stock)

- Multi-line receiving: pick existing products **or create new ones inline**; per line: quantity, unit cost, batch number, expiry, optional new selling price.
- Matching (batch no + expiry) merges into the existing batch; otherwise a new batch is created.
- **Discount and tax** fields; grand total; amount paid now → unpaid balance flows to the supplier's account.
- **Owner-only delete with mandatory reason**: reverses the batch quantities and the supplier balance, keeps an audit trail (soft-deleted, never silently destroyed).

### 4.5 Returns (PPR logic preserved)

- Per-item returns from any completed sale, with a **reason**: `CustomerReturn`, `WrongItem`, `Damaged`, `Expired`, `Other`.
- **Resalable logic**: Damaged/Expired are written off (audit-only); everything else returns to stock — pills go back to the loose pool, units to their original batch.
- Partial returns validated (can never return more than sold minus already returned).
- Refunds reduce the processor's open drawer; a full **returns log** with filters is always available.

### 4.6 Credit (khata) ledger

- Credit sales track the unpaid balance **per customer**.
- Credit page lists everyone who owes money with totals; **collect payments** (FIFO across oldest unpaid invoices); printable **customer statements** with full history.

### 4.7 Cash drawer

- Start a shift with an opening float; sales, expenses and refunds accumulate live.
- **Expected in drawer** = opening + cash sales − expenses, always visible.
- End shift by counting cash → the system shows the **difference** (balanced / over / short) and archives the shift; full shift history with per-shift reconciliation.

### 4.8 Expiry management

- Batches expiring within **30 / 60 / 90 / 180 days** (plus already-expired), with quantity and **value at cost**.
- One-click **write-off** (reason recorded, stock zeroed, audit logged).
- Expiry value totals show exactly how much money is at risk.

### 4.9 Stock adjustments

- Manual corrections (physical count, damage, theft, supplier returns) with mandatory reason, per batch or auto-selected FEFO batch. Fully audited.

### 4.10 Reports & dashboard

- **P&L statement**: revenue → COGS → gross profit → discounts → expenses by category (+ other income) → **net profit**.
- Sales by category and by payment method; top products with per-product profit.
- **Stock health**: total cost/retail valuation, **dead stock** (no sale in 30+ days), **reorder suggestions** with suggested quantities.
- Dashboard: today's sales & transactions, month revenue/profit/expenses, **this-month vs last-month %**, 14-day revenue chart, top products, low-stock and expiring alerts, recent sales.

---

## 5. Store Management

Shares the entire retail engine with Pharmacy (products, POS, purchases, credit, drawer, adjustments, reports) — minus pharmacy-only emphases:

- Pill-selling is available but off by default; expiry fields are optional.
- Emphasis: fast counter billing, inventory accuracy, khata credit tracking, supplier dues.
- Same dashboards/reports, so a shop owner sees revenue, profit, stock value, dead stock and reorder lists immediately.

In practice: one engine, two tuned experiences, chosen at registration.

---

## 6. Hospital / Clinic Management

### 6.1 Patients

- Registration with **auto file numbers** (`PAT-00001`), demographics, phone, address, blood type and **allergies** (highlighted in red everywhere).
- Patient 360° view: records, appointments, invoices in one place.

### 6.2 Appointments & live queue

- Book by patient + doctor + date/time with reason; **double-booking a doctor at the same instant is blocked** (verified).
- **Live queue board**: Waiting → *Call in* → In service → Complete; no-shows and cancellations tracked. **Walk-in** patients enter the queue directly.
- Today's schedule surfaces on the dashboard and via Telegram.

### 6.3 Consultations & records

- Medical records per visit: seen-by, **vitals** (BP, temperature, pulse, weight, height, SpO₂), diagnosis, prescription, notes — vitals render inline in the record list.

### 6.4 Laboratory

- Built-in catalog of common tests (CBC, malaria RDT, glucose, urinalysis, Widal, LFT/KFT, lipid profile, etc.) with **normal ranges and typical prices**, plus custom test names.
- Workflow: **ordered → sample collected → resulted** (or cancelled); results stored against the patient; lab revenue feeds reports.

### 6.5 Billing

- Invoices with **auto numbers** (`INV-00001`), patient, description, amount; **part payments** supported with automatic `unpaid → partial → paid` status.
- Printable invoice with business details and footer.

### 6.6 Reports & dashboard

- Appointment totals/completion rate/cancellations/no-shows; billing billed/collected/outstanding; new patients; **top diagnoses** (exportable); doctor workload; lab orders/results/revenue.
- Dashboard: total patients, today's appointments, upcoming, month collections, outstanding balances, today's schedule, newest patients.

---

## 7. School Management

### 7.1 Students & classes

- Students with **auto IDs** (`STU-00001`), demographics, class assignment, guardian name/phone, status (active/graduated/withdrawn); search + class filters.
- Classes per academic year with homeroom teacher; live student counts.
- **Subjects master** managed on the Classes page; used consistently in grades and timetables.
- **Year-end promotion**: move an entire class to the next level, or **graduate** them out — one confirmed action, audited.

### 7.2 Timetable

- Weekly grid per class (Mon–Sat): period start/end, subject, teacher. Add/remove periods inline; conflicts prevented per class+day+start time.

### 7.3 Attendance

- Daily register per class: **Present / Late / Absent / Excused** with one tap per student; saving upserts (re-marking the same day is safe).
- Live "% present · N absent" while marking; 30-day per-status summaries; attendance feeds dashboards, report cards and reports.

### 7.4 Grades & report cards

- **Bulk score entry**: pick class → subject → assessment (test/assignment/mid/final) → term → out-of; type a score per student; re-saving updates.
- Scores can never exceed the maximum (validated server-side).
- **Report cards computed automatically** per class + term: per-subject average %, total, overall average, **letter grade**, attendance %, and **class rank** — printable one-per-page or the whole class.

### 7.5 Fees

- Assign a fee (title, amount, due date) to **all students, a class, or selected students** in one action.
- Part payments with `unpaid → partial → paid`; **defaulters list** with balances (exportable for follow-up).

### 7.6 Announcements

- Staff notice board with pinning — parents'/staff meetings, holidays, exam notices.

### 7.7 Reports & dashboard

- Fee collection totals + **6-month collection chart** + collection by class; **defaulters**; attendance % per class; subject averages.
- Dashboard: active students, classes, teachers, today's attendance %, fees collected this month vs outstanding, 14-day attendance trend, class sizes, newest students.

---

## 8. Telegram bot + Mini App

**Why:** the research phase showed the costliest real-life failures are *silent* — stockouts noticed too late, medicine expiring on shelves, fees quietly becoming bad debt, patients missing appointments. The bot pushes those events to the people who can act.

**Linking:** web app → Settings → Telegram → generate a 6-character code (15-min expiry) → tap through to the bot → `/link CODE`. The chat is now bound to the work account.

**Push alerts** (max one message per category per 12h per company):

| Tenant type | Alerts |
|---|---|
| Pharmacy / Store | Low stock (with reorder list), batches expiring ≤ 30 days with value |
| School | Fees due within 7 days + outstanding total |
| Hospital | Today's appointment schedule with times and doctors |

**Commands:** `/today` (sales · appointments · attendance, matched to the tenant type), `/lowstock`, `/expiring`, `/shift` (open drawer status), `/help`, `/unlink`.

**Mini App:** the bot's menu button opens the full workspace inside Telegram **already authenticated** — Telegram's signed `initData` is verified server-side (HMAC-SHA256 + 24h freshness + constant-time compare) and exchanged for a platform JWT. No password inside Telegram.

**Operations:** long-polling in development; in production a webhook with Telegram's secret-token header (setup commands in `DEPLOY.md` §7). The polling loop has failure backoff and self-stops after repeated failures so a bad token can never degrade the server.

---

## 9. Data model overview

Core: `tenants`, `users`, `tenant_settings`, `audit_logs`, `telegram_link_codes`
Retail: `products` (+ pill/loose-pill fields), `product_batches`, `product_categories`, `suppliers`, `customers`, `purchases`/`purchase_items` (batch-linked, soft-deletable), `sales`/`sale_items` (margin + pill-aware), `sale_returns`, `stock_adjustments`, `customer_payments`, `supplier_payments`, `expenses`, `income`, `cash_drawer_shifts`
Hospital: `patients`, `doctors`, `appointments`, `medical_records` (+ vitals), `lab_tests`, `invoices`
School: `students`, `classes`, `teachers`, `subjects`, `timetable_slots`, `attendance`, `grades`, `fees`, `announcements`

Migrations live in `server/migrations/` and are applied with `npm run migrate` (tracked in `schema_migrations`).

---

## 10. Quality verification

All of the following were executed against the running system (not just compiled):

- **Pill math:** buy 10 packs × 30 pills → sell 45 pills at 50 % margin → per-pill price 3.00 ETB, stock 255, 15 loose ✓
- **Expired-batch guard:** 50 sellable + 30 expired pills → sell 50 OK, 51st **blocked** ✓
- **Returns:** 15-pill resalable return → refund 45 ETB, loose stock restored ✓
- **Cash drawer:** 500 opening + 135 sale − 45 refund = 590 expected; close with 600 → +10 difference recorded ✓
- **Supplier ledger:** unpaid purchase raises balance; payment lowers it; purchase deletion reverses stock and balance ✓
- **Hospital flow:** patient → appointment → **double-booking blocked** → queue walk-in → complete → record with vitals → lab order → result → invoice → part payment → paid ✓
- **School flow:** class → students → attendance upsert → bulk grades → **overscore blocked** → report card with rank → fee assignment → payment → promotion ✓
- **Telegram:** link code → `/link` → linked ✓ → `/today`, `/lowstock` handled ✓ → bad `initData` rejected ✓ → unlink ✓
- **Platform:** tenant isolation (second company sees zero data), trial expiry → 402 + admin re-grant, rate limiting (429s), admin password reset with re-login ✓
- Server TypeScript build, frontend build and ESLint: clean.

---

## 11. Roadmap (post-trial monetization hooks)

The trial/admin plumbing is subscription-ready: `tenants.status` + `trial_ends_at` are all a billing webhook needs to flip. Planned next steps: online payments (Telebirr/Chapa) for subscriptions and school fees, parent/patient-facing Telegram notifications, SMS fallback, and multi-branch support.

---

*AFRO-TECH · Addis Ababa, Ethiopia · +251-910-011-818 · yonasmindaye04@gmail.com · Telegram @yona64*
