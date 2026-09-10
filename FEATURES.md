# AFRO Suite — Complete Features Guide

**AFRO-TECH · Multi-tenant business platform**
One system, four solutions: **Pharmacy**, **Store**, **Hospital/Clinic**, **School**
This document explains what each part of the system does and how the core engines (inventory, money, users, marketing) actually work.

---

## Contents

1. [What AFRO Suite Is](#1-what-afro-suite-is)
2. [Features Every System Shares](#2-features-every-system-shares)
3. [User Management & Access Control](#3-user-management--access-control)
4. [Product Management](#4-product-management)
5. [Stock & Inventory Management](#5-stock--inventory-management)
6. [Money Flow Control](#6-money-flow-control)
7. [Marketing & Campaign System](#7-marketing--campaign-system)
8. [Pharmacy Management](#8-pharmacy-management)
9. [Store Management](#9-store-management)
10. [Hospital / Clinic Management](#10-hospital--clinic-management)
11. [School Management](#11-school-management)
12. [Telegram Bot + Mini App](#12-telegram-bot--mini-app)
13. [Subscription & Platform Administration](#13-subscription--platform-administration)

---

## 1. What AFRO Suite Is

AFRO Suite is a **multi-tenant SaaS platform**: every company that registers receives a **private, isolated workspace** with one of four business systems (chosen at signup). Each company works with its **own real data** — no shared data, no demo content.

- **45-day free trial** — full access, instant activation, no card required
- **Isolated data** — every record belongs to a tenant; cross-tenant leakage is structurally impossible
- **One login, everything included** — POS, inventory, money, staff, marketing, and Telegram alerts live in one dashboard
- **AFRO-TECH admin panel** — platform owners can grant, extend, suspend, or resume access

---

## 2. Features Every System Shares

These features exist in **all four** business systems (pharmacy, store, hospital, school):

| Feature | What it does |
|---|---|
| **Dashboard** | At-a-glance view of today's activity: revenue, transactions, alerts, and charts specific to the business type |
| **Workspace settings** | Owner sets business name, phone, address, currency label, tax %, receipt footer, and type-specific options (POS margins for retail, academic year for schools) |
| **Team / staff logins** | Owner creates staff accounts; staff see the same workspace; owner can disable them |
| **Role-based permissions (RBAC)** | Predefined roles (owner, admin, manager, cashier, doctor, teacher, accountant…) each with controlled access to specific actions |
| **Reports + CSV export** | Every list, ledger, and report exports to CSV for Excel |
| **Print layouts** | Receipts, invoices, statements, and report cards print with business branding |
| **Audit trail** | Critical actions (sales, refunds, stock changes, payments, deletes) are recorded with who/what/when — visible to AFRO-TECH admins |
| **Telegram alerts** | Push notifications for the failures that cost money silently: low stock, expiring products, unpaid fees, today's appointments |
| **Marketing engine** | Contacts, audiences, templates, and multi-channel campaigns (SMS, email) — see §7 |

---

## 3. User Management & Access Control

### 3.1 How accounts work

1. **Business owner** registers the company → becomes the `owner` of the workspace
2. Owner goes to **Team** → creates staff login (email + temporary password)
3. Staff sign in with those credentials; owner can disable them anytime
4. Every login produces a secure token (JWT) that re-validates the user **on every request** — so disabling an account takes effect instantly

### 3.2 Roles and permissions

The system uses **fine-grained permissions** in `resource.action` format (e.g. `sales.create`, `inventory.manage`, `grades.record`).

**Built-in roles and what they can do:**

| Role | Can access |
|---|---|
| `owner` | Everything — full workspace control including settings and team |
| `admin` | Everything except workspace settings |
| `manager` | Sales, inventory, purchases, payments, reports, team |
| `cashier` | POS, sales, refunds, basic customer view |
| `pharmacist` | Dispensing, inventory, controlled substances, purchases |
| `doctor` | Patients, appointments, records, prescriptions, labs |
| `nurse` | Patients, appointments, queue, vitals |
| `accountant` | Payments, financial reports |
| `teacher` | Attendance, grades, report cards |
| `registrar` | Students, enrollment, fees |
| `marketing_admin` | Campaigns, contacts, audiences, templates, analytics |
| `custom` | Permission set handcrafted by the owner |

Permissions are checked **server-side** on every API call — hiding a button in the UI is cosmetic only.

---

## 4. Product Management

(Applies to **Pharmacy** and **Store** systems.)

### 4.1 What a product contains

Each product holds:

- **Name**, **category**, **unit** (box / strip / pcs / kg…)
- **Barcode** — for scan-to-sell at the POS
- **Cost price** and **sell price** per unit
- **Default margin %** — used to auto-price at the POS (price = cost × (1 + margin))
- **Low-stock threshold** — triggers the reorder alert
- **Sell-by-pill** mode + **pills-per-unit** (pharmacy) — e.g. 30 capsules per box
- Managed **category list** per company

### 4.2 Batch-level tracking

Stock isn't stored as a single number — it's stored in **batches** (each delivery):

- **Batch number** + **expiry date**
- **Quantity** received and remaining
- **Cost price** (can differ per delivery)
- Optional **sell price** for that specific batch
- **Received date**

This is why the system knows exactly *which* medicine is expiring and *what it cost*.

---

## 5. Stock & Inventory Management

### 5.1 How stock flows in and out

```
Purchases  ──►  Batches (increases stock)
                    │
Sales  ────────────►│ (decreases stock, batch by batch)
Returns ───────────►│ (resalable items go back to stock)
Adjustments ───────►│ (manual corrections: damage, theft, count)
Write-offs ────────►│ (expired batches removed from stock)
```

### 5.2 Key inventory operations

| Operation | How it works |
|---|---|
| **Purchases (receiving)** | Pick existing products or create new ones inline; per line: quantity, unit cost, batch no, expiry, optional new sell price. Matching batches merge automatically. |
| **FEFO selling** | First-Expiring, First-Out — the POS always consumes the earliest-expiring batch first, so expiry waste stays minimal |
| **Pill-level selling** (pharmacy) | A pack is "broken open" into loose pills; per-pill cost is derived from the actual batch, so profit math stays exact even for partial packs |
| **Expiry tracking** | Lists batches expiring within 30 / 60 / 90 / 180 days **with value at cost** — you see exactly how much money is at risk |
| **Write-off** | One click removes expired stock with a mandatory reason, zeroes the quantity, and logs it |
| **Stock adjustments** | Manual corrections (physical counts, damage, theft, supplier returns) with a mandatory reason; batch-specific or auto-selected |
| **Low-stock alerts** | Products under their threshold appear in the dashboard reorder list (with suggested quantities) and are pushed to Telegram |

### 5.3 The expired-stock guarantee

**Expired batches can never be sold.** The POS structurally can't reach them — even if total stock looks positive, selling stops when all non-expired units are gone. Expired stock sits on the Expiry page until written off.

### 5.4 Returns

Per-item returns from any sale, with a mandatory reason:

| Reason | Restocked? |
|---|---|
| CustomerReturn, WrongItem, Other | ✅ Yes — back to inventory (pills to loose pool, units to their batch) |
| Damaged, Expired | ❌ No — written off (audit-only) |

Partial returns are validated — you can never return more than was sold minus what's already returned.

---

## 6. Money Flow Control

AFRO Suite tracks money at **every step** — cash, card, mobile, credit (khata), expenses, and income — all feeding the financial reports.

### 6.1 Money in (revenue streams)

```
Cash sales ────┐
Card sales ────┤
Mobile sales ──┼──► Daily revenue ──► P&L ──► Net profit
Credit sales ──┼── (tracked per customer as receivables)
Other income ──┘   e.g. service fees, interest
```

### 6.2 Cash drawer (shift control)

Every cashier shift is tracked independently:

1. **Open shift** — enter the opening cash (float)
2. During the shift, sales/expenses/refunds accumulate live into **cash / card / mobile** buckets
3. **Expected cash** is always visible: `opening + cash sales − expenses − refunds`
4. **Close shift** — count physical cash → system shows the **difference** (balanced / over / short) and archives the shift
5. Full **shift history** with per-shift reconciliation — you can trace who was short and when

### 6.3 Money out (expenses & payments)

| Ledger | What it tracks |
|---|---|
| **Expenses** | Category, description, amount, date — feeds P&L |
| **Supplier payments** | Paying vendors against unpaid purchases; balances update automatically |
| **Customer payments (khata)** | Collecting debt from credit customers, FIFO against oldest unpaid invoices |

### 6.4 Credit (Khata) ledger

- Credit sales show the **unpaid balance per customer**
- The Credit page lists everyone who owes money with totals
- **Collect payments** — applied FIFO across oldest unpaid invoices
- **Printable customer statements** with full transaction history

### 6.5 Financial reports

- **P&L statement**: Revenue → COGS → gross profit → expenses → **net profit**
- Sales by category, by payment method
- **Stock valuation**: total cost value vs retail value on hand
- **Dead stock**: items with zero sales in 30+ days (cash trapped on the shelf)
- Month-over-month comparisons and 14-day revenue charts

---

## 7. Marketing & Campaign System

A built-in, multi-channel marketing engine — no need for Mailchimp or a separate SMS tool.

### 7.1 The campaign flow

```
Contacts → Audiences → Templates → Campaign → Queue → Provider → Delivery → Analytics
```

1. **Contacts** — your audience list with name, phone, email, city, customer type
   - Add one by one, or **bulk import** (deduplicates by email/phone)
   - Each contact has **per-channel preferences** (SMS subscribed, email subscribed, WhatsApp unsubscribed…)
2. **Audiences** — reusable segments
   - **Dynamic**: built from rules (e.g. "city = Addis Ababa AND customer_type = business") — membership updates automatically
   - **Static**: hand-picked members
3. **Templates** — reusable messages with variables like `{{first_name}}` and `{{city}}`
   - Versioned (every edit keeps history), channel-specific, draft/published states
4. **Campaigns** — pick an audience, pick channels (SMS and/or Email), pick the template for each, then schedule or send
5. **Queue + workers** — messages are queued (BullMQ + Redis) and sent by background workers with automatic retries (3 attempts, exponential backoff)
6. **Delivery tracking** — provider webhooks update each message: sent → delivered / failed / bounced / unsubscribed / opened / clicked

### 7.2 Channels

| Channel | Provider | Notes |
|---|---|---|
| **Email** | Resend | Open/click tracking, bounces, unsubscribe |
| **SMS** | Ethio Telecom (SMPP) | Sends via direct SMPP connection; mock mode available for testing |
| **WhatsApp** | (architecture-ready) | Channel layer exists for Phase 2 |
| **Push** | (architecture-ready) | Channel layer exists for Phase 2 |

### 7.3 Analytics

- Campaign stats: recipients / sent / delivered / failed / bounced / unsubscribed
- Channel-level aggregates: SMS delivery rate, email open/click rates
- Message-level history per contact

### 7.4 Consent & compliance

Consent is enforced **before** any message is queued — unsubscribed contacts are skipped automatically.

---

## 8. Pharmacy Management

Everything in §2–§7, plus pharmacy-specific depth:

- **Pill-level dispensing engine** with loose-pill pool and FEFO batch breaking
- **Batch re-pricing** per delivery (medicines change price every shipment)
- **Margin-based pricing** at POS with per-line margin dropdown (20 % / 25 % / 30 % presets)
- **Expiry management** with value-at-risk totals and write-offs
- **Reorder suggestions** (low-stock × typical demand)
- **Barcode scanning** for fast counter selling

*Verified behavior:* buy 10 boxes × 30 pills → sell 45 pills at 50 % margin → per-pill price 3.00 ETB, stock 255 remaining (8 full boxes + 15 loose).

---

## 9. Store Management

Shares the **entire retail engine** with Pharmacy — POS, purchases, inventory, credit, cash drawer, reports — tuned for general retail:

- Pill mode and expiry are optional
- Emphasis on **fast counter billing**, inventory accuracy, khata credit, and supplier dues
- Same dashboards: revenue, profit, stock value, dead stock, reorder lists

One engine, two tuned experiences, chosen at registration.

---

## 10. Hospital / Clinic Management

### 10.1 Patients
- Auto file numbers (`PAT-00001`), demographics, blood type, **allergies highlighted in red**
- 360° patient view: records, appointments, invoices in one place

### 10.2 Appointments & live queue
- Book by patient + doctor + date/time — **double-booking the same doctor is blocked**
- **Live queue board**: Waiting → Call in → In service → Complete (no-shows tracked)
- **Walk-ins** join the queue directly

### 10.3 Consultations & records
- Per-visit records: vitals (BP, temperature, pulse, weight, height, SpO₂), diagnosis, prescription, notes

### 10.4 Laboratory
- Built-in test catalog (CBC, malaria RDT, glucose, urinalysis, Widal…) with normal ranges and prices
- Workflow: ordered → sample collected → resulted

### 10.5 Billing
- Auto-numbered invoices (`INV-00001`) with **part payments** (unpaid → partial → paid)
- Printable invoices with business branding

---

## 11. School Management

### 11.1 Students & classes
- Auto student IDs (`STU-00001`), class assignment, guardian contacts, searchable rosters
- **Year-end promotion**: move the whole class to the next level or graduate them — one action

### 11.2 Timetable
- Weekly grid per class (Mon–Sat): period, subject, teacher — conflicts prevented

### 11.3 Attendance
- Daily register: Present / Late / Absent / Excused, one tap per student
- 30-day summaries flow into report cards and dashboards

### 11.4 Grades & report cards
- **Bulk score entry**: class → subject → assessment → type scores
- Over-max scores blocked automatically
- **Auto-computed report cards**: per-subject averages, total, letter grade, attendance %, **class rank** — printable

### 11.5 Fees
- Assign fees to all students / a class / selected students in one action
- Part payments; **defaulters list** with balances, ready to export

### 11.6 Guardian notifications
- Announcements can be delivered to guardians via **Email and Telegram** with per-student targeting and delivery tracking

---

## 12. Telegram Bot + Mini App

Each company connects **its own Telegram bot** (created with @BotFather in 2 minutes):

- **Push alerts** — low stock, expiring batches, fees due, today's appointments
- **Staff commands** — `/today` (sales/appointments/attendance), `/lowstock`, `/expiring`, `/shift`
- **Customer broadcast** — message all subscribers with offers and announcements
- **Mini App** — the bot's menu button opens the full workspace inside Telegram, already signed in (secure token exchange, no password needed)

---

## 13. Subscription & Platform Administration

- **Subscription plans** (monthly / semi-annual / annual) per business type
- **Chapa payment integration** — online checkout with idempotent webhook callbacks
- **Trial lifecycle** — 45-day trial auto-expires; expired tenants keep their data but see the subscription screen until they pay
- **AFRO-TECH admin panel** — all companies, owner contacts, status badges, trial days left; grant/extend/suspend access; reset passwords; platform-wide stats

---

*AFRO-TECH · Addis Ababa, Ethiopia · +251-910-011-818 · yonasmindaye04@gmail.com*
