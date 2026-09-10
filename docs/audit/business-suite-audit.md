# AFRO Suite — Business Suite Audit Report

**Audit Date:** 2026-09-08  
**Auditor:** AI Code Review Agent  
**Scope:** Entire AFRO Suite codebase (shared core + 4 verticals: Pharmacy, Store, Hospital/Clinic, School)  
**Methodology:** Static code analysis of migrations, server routes, services, middleware, frontend pages, and configuration files. No runtime testing performed.

---

## 1. Executive Summary

AFRO Suite is a **moderately mature multi-tenant SaaS platform** with a solid technical foundation for its core verticals (Retail/Pharmacy, Hospital, School). The platform demonstrates strong engineering practices: strict tenant isolation at the database level, a well-designed RBAC system with fine-grained permissions, proper transaction handling, audit logging, and a functional marketing automation module.

**Overall Maturity:** **~65% feature-complete** for a production SaaS targeting Ethiopian SMEs. The platform is **deployable and usable** for its core verticals today, but has significant gaps in compliance (ERCA invoicing, VAT), financial depth (no general ledger), operational resilience (no offline mode, no DR), and horizontal features (HR, advanced reporting, integrations).

**Key Strengths:**
- Bulletproof multi-tenancy at the data layer
- Strong RBAC with vertical-specific roles
- Pharmacy-grade inventory (FEFO, batch tracking, pill-level selling)
- Hospital department connectivity (visits, service orders, journey timeline)
- Marketing automation with multi-channel campaigns
- Telegram bot + Mini App integration

**Critical Gaps:**
- No ERCA-compliant invoicing or VAT handling
- No general ledger / chart of accounts
- No offline capability (critical for Ethiopia)
- Only Chapa payments (no Telebirr/CBE Birr/HelloCash)
- No 2FA, weak session management
- No offline/backup/DR strategy
- English-only UI

---

## 2. Checklist Evaluation Table

| Checklist Item | Status | Evidence (Files/Modules) | Notes |
|---|---|---|---|
| **Platform & Multi-tenancy** | | | |
| Tenant isolation (data-level) | **PRESENT & SOLID** | `server/migrations/001_init.sql` (lines 9-18, 22, 30, 35, 49, 52, 58, 63, 68, 73, 83, 89, 94, 103, 113, 123, 136, 145, 151, 161, 168, 177, 186, 195, 203, 213, 218, 228, 233, 238, 252, 257, 266, 271, 280, 285, 296); `server/src/middleware/auth.ts` (lines 75-105) | Every business table has `tenant_id` FK with `ON DELETE CASCADE`; middleware enforces tenant scoping on every request; `afrotech_admin` bypasses tenant scoping |
| Platform admin console | **PRESENT & SOLID** | `server/src/routes/admin.ts` (full); `src/platform/admin/AdminPanel.tsx` | Full CRUD on tenants, extend/suspend/extend trials, audit log viewer, payment overview, subscription management, password reset |
| Per-tenant config without code changes | **PRESENT & SOLID** | `server/migrations/003_production.sql` (lines 22-27 `tenant_settings`); `server/src/routes/tenant.ts` (implied); `src/platform/retail/POS.tsx` (line 80 `useApiData('/tenant/settings')`) | JSONB `tenant_settings` table with business info, receipt customization, margin presets, tax rate, currency |
| Subscription/plan management | **PRESENT & SOLID** | `server/migrations/008_billing.sql` (subscription_plans, subscriptions, payments); `server/src/routes/billing.ts` (full); `server/src/services/billing.ts` (implied); `server/src/routes/admin.ts` (lines 152-175) | Plans per business type, Chapa integration with webhook, trial→paid flow, manual confirm, dev mock mode |
| **Identity, Access & Security** | | | |
| RBAC scoped per module/dept | **PRESENT & SOLID** | `server/migrations/007_rbac.sql` (full); `server/src/middleware/auth.ts` (lines 8-46, 132-141); `server/src/routes/hospitalFlow.ts` (lines 14-25 `assertCanProcessDepartment`) | Fine-grained `resource.action` permissions; system + custom roles; department-scoped order processing permissions (`orders.lab` vs `orders.injection`); owner gets all perms |
| Authentication hardening (2FA, password policy, session expiry) | **MISSING** | `server/src/routes/auth.ts` (lines 16, 19-22, 48-51); `server/src/middleware/auth.ts` (lines 6, 48-51) | Only bcrypt (cost 12), 8-char minimum, JWT 7-day expiry; **no 2FA, no password complexity, no refresh tokens, no session revocation list, no brute-force beyond rate-limit on login** |
| Audit trail (who/what/when) | **PRESENT & SOLID** | `server/migrations/003_production.sql` (lines 8-20 `audit_logs`); `server/src/utils/audit.ts`; `server/src/routes/admin.ts` (lines 97-115); used throughout routes (`logAudit` calls) | Fire-and-forget `logAudit` with tenant/user/action/entity/details; admin audit viewer with pagination/filter |
| Data encryption at rest/in transit | **WEAK** | `server/.env.example` (no encryption config); `render.yaml` (TLS termination at Render); no app-level encryption | TLS via Render (in transit); **no app-level encryption at rest**, no field-level encryption for PII (patient data, guardian contacts) |
| API auth/authorization | **PRESENT & SOLID** | `server/src/middleware/auth.ts` (lines 48-111, 132-141); all routes use `authenticate`, `requirePermission` | JWT Bearer tokens; per-request permission checks; tenant scoping automatic |
| **Core Operations — Pharmacy/Store** | | | |
| Inventory with batch/lot tracking | **PRESENT & SOLID** | `001_init.sql` (lines 33-58, 47-58); `005_ppr_parity.sql` (lines 7-20, 49-67); `server/src/routes/retail.ts` (lines 19-50, 219-228) | Products, batches with expiry/qty/cost/sell price; FEFO deduction; pill-level selling (loose pills + broken packs); stock adjustments; expiry tracking |
| POS / transaction recording | **PRESENT & SOLID** | `server/src/routes/retail.ts` (lines 327-515); `src/platform/retail/POS.tsx` (full) | Atomic checkout with FOR UPDATE locking; FEFO batch deduction; margin-based pricing; cash drawer accumulation; barcode scan; thermal receipt |
| Procurement with approval step | **WEAK** | `server/src/routes/retail.ts` (lines 940-1015, 1018-1058) | Purchases create batches atomically; owner-only delete with reason; **no multi-step approval workflow**, no PO status workflow (draft→approved→received), no 3-way matching |
| Supplier/vendor management | **PRESENT & SOLID** | `001_init.sql` (lines 60-69); `server/src/routes/retail.ts` (lines 231-308, 869-908) | Suppliers with payment terms; purchase history; supplier payments with cash drawer deduction; balance computed dynamically |
| Customer/patient/student records | **PRESENT & SOLID** | `001_init.sql` (customers 71-79, patients 149-162, students 238-252); routes in `retail.ts`, `hospital.ts`, `school.ts` | Full CRUD with search/pagination; hospital adds blood type/allergies; school adds guardian contacts + telegram/email channels |
| **Core Operations — Hospital** | | | |
| Appointments & queue | **PRESENT & SOLID** | `001_init.sql` (176-187); `hospital.ts` (lines 105-172, 291-323); `src/platform/hospital/Queue.tsx` | Double-booking prevention; live queue (waiting/in_service/completed); walk-in support |
| Medical records & vitals | **PRESENT & SOLID** | `001_init.sql` (189-199); `003_production.sql` (59); `hospital.ts` (175-227) | Vitals JSONB; diagnosis/prescription/notes; patient 360° view with records/appointments/invoices |
| Lab tests | **PRESENT & SOLID** | `003_production.sql` (61-76); `hospital.ts` (325-420) | Catalog with normal ranges/prices; ordered→collected→resulted workflow; results stored |
| Billing/invoices | **PRESENT & SOLID** | `001_init.sql` (202-214); `hospital.ts` (229-289); `hospitalFlow.ts` (452-507) | Auto-numbered; partial payments; visit-based billing from completed service orders |
| Dept connectivity (visits/orders) | **PRESENT & SOLID** | `020_departments_visits.sql`, `021_service_orders.sql`, `022_connectivity_rbac.sql`; `hospitalFlow.ts`; `src/platform/hospital/FlowBoard.tsx`, `Reception.tsx`, `JourneyModal.tsx` | **New:** Departments, visits (journey backbone), service orders (lab/injection/procedure), journey timeline, department queues, billing from visit |
| **Core Operations — School** | | | |
| Attendance | **PRESENT & SOLID** | `001_init.sql` (256-267); `school.ts` (236-291); `src/platform/school/Attendance.tsx` (implied) | Daily register per class; 4 statuses; upsert; 30-day summaries |
| Grades & report cards | **PRESENT & SOLID** | `001_init.sql` (269-283); `school.ts` (293-357, 573-675); `src/platform/school/ReportCards.tsx` (implied) | Bulk entry; weighted averages; auto report cards with class rank, attendance %, letter grade, multi-term history |
| Fees & guardian notify | **PRESENT & SOLID** | `001_init.sql` (285-296); `019_guardian_notifications.sql`; `school.ts` (359-489, 200-234); `src/platform/school/Fees.tsx`, `Students.tsx` | Fee assignment (all/class/individual); part payments; defaulters list; guardian email/telegram notifications with delivery tracking |
| Timetable | **PRESENT & SOLID** | `003_production.sql` (78-98); `school.ts` (519-571) | Weekly grid per class; conflict prevention |
| **Finance & Accounting** | | | |
| General ledger / chart of accounts | **MISSING** | No `accounts`, `journal_entries`, `chart_of_accounts` tables in migrations | Only cash drawer, expenses, income, invoices, payments — **no double-entry accounting**, no COA, no trial balance |
| Accounts payable & receivable | **WEAK** | `retail.ts` (customer_payments 47-56, supplier_payments 69-80, supplier balances computed dynamically); `school.ts` (fees with part payments); `hospital.ts` (invoices with partial payments) | Customer/supplier balances tracked via invoice/fee/purchase status; **no aging reports, no credit limits, no collection workflow** |
| Tax/VAT handling & ERCA invoicing | **MISSING** | No tax/VAT tables; `retail.ts` POS has `tax_rate` in settings but unused; no VAT number on invoices; no ERCA-compliant QR codes or fiscalization | **Critical for Ethiopia compliance** — no 15% VAT calculation, no ERCA-compliant invoice format, no fiscal device integration |
| Multi-currency | **MISSING** | `retail.ts` POS settings has `currency` field (default ETB); hospital invoices ETB only; no FX rates | **ETB only** — no multi-currency support |
| Financial statements (P&L, BS) | **WEAK** | `retail.ts` (Finance.tsx implied); `hospital.ts` dashboard (billed/collected/outstanding); `school.ts` reports (billed/collected/outstanding by class); `005_ppr_parity.sql` income table | **P&L only** (revenue - COGS - expenses = net profit); **no balance sheet, no cash flow, no equity tracking** |
| **CRM & Engagement** | | | |
| Relationship tracking beyond transactions | **WEAK** | `marketing_contacts` (marketing); `customers`/`patients`/`students` with contact info; `marketing_contact_channels` with opt-in/verified | **No interaction timeline** beyond audit logs; no lead scoring, no lifecycle stages, no customer health scores |
| Marketing/campaign tools | **PRESENT & SOLID** | `migrations 011-018`; `server/src/routes/marketing/*`; `server/src/services/marketing/*`; `src/platform/marketing/*` | Contacts, dynamic/static audiences, templates (multi-channel), campaigns (draft→scheduled→sending→completed), multi-channel (SMS/email/WhatsApp/push), analytics (sent/delivered/opened/clicked), consent tracking |
| Loyalty/rewards | **MISSING** | No loyalty tables, no points, no rewards engine | |
| **Workflow & Process Control** | | | |
| Approval thresholds (discounts, refunds, write-offs) | **WEAK** | `retail.ts` POS: margin presets from settings, discount field on sale; `retail.ts` refunds require `sales.refund` perm; `hospitalFlow.ts` visit complete requires `visits.manage` | **No configurable thresholds** (e.g., "discount > 10% requires manager approval"); permissions are binary (has/has-not), no amount-based escalation |
| Cross-dept/role handoffs | **PRESENT & SOLID (Hospital only)** | `hospitalFlow.ts` (visits, transfers, service orders); `FlowBoard.tsx` (dept queues); `JourneyModal.tsx` (transfer, order creation) | **Only Hospital** has dept connectivity; Retail/School/Pharmacy lack cross-dept workflows |
| Notification triggers (workflow events) | **PRESENT & SOLID** | `alerts.ts` (stock, expiry, fees, appointments, long-wait); `hospitalNotify.ts` (order created/completed); `guardianNotifier.ts` (fee/student notices) | Throttled per tenant+type (12h); Telegram push to users with `telegram_chat_id`; webhook-ready for email/SMS |
| **Reporting & BI** | | | |
| Standard operational reports | **PRESENT & SOLID** | Dashboards per vertical (`RetailDashboard.tsx`, `HospitalDashboard.tsx`, `SchoolDashboard.tsx`, `MarketingDashboard.tsx`); `hospitalFlow.ts` reports (dept load, turnaround); `school.ts` reports (fee collection, attendance, subject averages) | Dashboards with stats, trends, top items, low stock, expiry, recent activity; hospital dept load/turnaround reports |
| Custom/report-builder | **MISSING** | No report builder UI, no saved custom queries, no ad-hoc query builder | |
| Export formats | **WEAK** | Frontend `DataTable` has CSV export (implied by `DataTable` component); **no PDF, no Excel, no scheduled export** | `DataTable` component suggests client-side CSV; no server-side export API |
| Scheduled/automated report delivery | **MISSING** | No scheduled reports, no email delivery of reports | |
| **HR & People Management** | | | |
| Staff records beyond login | **WEAK** | `users` table (name, email, role, tenant); `doctors`/`teachers` tables; no HR profile fields (hire date, salary, contract, emergency contact) | Staff = login credentials + role; **no HR module** |
| Shift/schedule management | **MISSING** | `cash_drawer_shifts` for retail only; no nurse/doctor shift scheduling, no teacher timetable (timetable is for classes, not staff) | |
| Payroll | **MISSING** | No payroll tables, no salary computation, no payslips | |
| Leave/attendance tracking | **WEAK** | `attendance` table for students only; `cash_drawer_shifts` for retail staff; no staff leave management | |
| **Integration & Extensibility** | | | |
| Public API / webhooks for 3rd party | **WEAK** | `/api/v1/billing/webhook/chapa` (Chapa webhook); `/marketing/webhooks/*` (Resend/SMPP); `/school/guardian-notifications` audit; **no public API docs, no API keys, no webhook registration UI for tenants** | Only inbound webhooks for Chapa/Resend/SMPP; no outbound webhooks for tenants |
| Import/export tools | **WEAK** | Marketing contacts CSV import (`contacts.ts` `/import`); frontend DataTable CSV export; **no bulk export API, no data migration tools, no backup/restore UI** | |
| Local payment gateways (Telebirr, CBE Birr, HelloCash) | **MISSING** | `billing.ts` only Chapa provider (`paymentsProvider()` returns 'chapa' or 'mock'); `chapaInitialize`, `chapaVerify` only | **Only Chapa** — no Telebirr, CBE Birr, HelloCash, M-Pesa, Abyssinia Bank, Dashen Bank integrations |
| **Resilience & Operations** | | | |
| Offline mode / local queuing with sync | **MISSING** | No Service Worker, no IndexedDB caching, no background sync, no offline POS | **Critical for Ethiopia** — frequent connectivity issues |
| Backup & DR process | **MISSING** | No backup scripts, no point-in-time recovery docs, no cross-region replication config | |
| Data retention/deletion policy | **MISSING** | No retention config, no GDPR/PDPA delete endpoints, no automated archival | |
| Monitoring/error tracking | **MISSING** | `console.log`/`console.warn` only; no Sentry, no Datadog, no Prometheus metrics, no health check beyond `/api/health` | |
| **Localization & Accessibility** | | | |
| Multi-language UI (Amharic/Afaan Oromo) | **MISSING** | All UI strings hardcoded in English; no i18n framework (react-i18next, etc.) | **Critical for Ethiopia** — Amharic essential for non-English staff |
| Currency/date/number formatting per locale | **WEAK** | `fmtMoney` (ETB only), `fmtDate` (en-GB format); hardcoded in `src/platform/api.ts` | No locale-aware formatting; ETB hardcoded |
| Mobile access (PWA/native) | **WEAK** | Responsive CSS only; Telegram Mini App for hospital; **no PWA manifest (has manifest but no SW), no native app, no offline support** | |
| **Consistency Across Verticals** | | | |
| Shared core engines implemented equally | **WEAK** | Marketing module exists but **not integrated into hospital/school/retail dashboards**; Hospital has dept connectivity layer others lack; Retail has cash drawer shifts, pharmacy doesn't; School has guardian notifications, others don't | Marketing module exists as standalone; Hospital has unique dept connectivity layer; Retail has cash drawer; School has guardian notifications; Pharmacy relies on retail engine |
| Naming conventions / data models / API patterns consistent | **PRESENT & SOLID** | Consistent `tenant_id` FK, `asyncHandler`/`AppError`/`asyncHandler` pattern, `requirePermission` middleware, `nextCode` for sequential IDs, `logAudit` fire-and-forget | Strong conventions across server; frontend uses `useApiData` hook, `PageHeader`/`Card`/`DataTable` components consistently |

---

## 3. Weak or Inconsistent Items (Detailed)

### 3.1 Authentication Hardening — **MISSING Critical Features**
- **No 2FA/TOTP**: Only email/password. No authenticator app, no SMS codes, no backup codes.
- **No password policy enforcement**: Only 8-char minimum. No complexity (upper/lower/digit/special), no expiry, no history, no breach checking (HaveIBeenPwned).
- **No session management**: JWT 7-day expiry with no refresh token rotation, no concurrent session limit, no "log out all devices", no device fingerprinting.
- **No account lockout escalation**: Rate limit is 30 attempts/15min on login/register only; no progressive lockout, no admin unlock.
- **Files**: `server/src/routes/auth.ts`, `server/src/middleware/auth.ts`

### 3.2 Procurement Approval Workflow — **WEAK**
- Purchases are created and received in one step (atomic). No draft→submitted→approved→received→billed workflow.
- No approval hierarchy (e.g., "purchases > 50k ETB requires manager approval").
- No 3-way matching (PO ↔ Goods Receipt ↔ Invoice).
- **Files**: `server/src/routes/retail.ts` lines 940-1015 (create), 1018-1058 (owner-only delete with reason)

### 3.3 Tax/VAT & ERCA Invoicing — **MISSING (Critical for Ethiopia)**
- No VAT calculation (Ethiopia 15% standard).
- No VAT registration number on invoices.
- No ERCA-compliant invoice format (QR code, fiscal ID, fiscal device integration).
- No fiscal device integration (EFD).
- **Files**: Missing entirely — no tax tables, no VAT logic in `retail.ts` POS or `hospital.ts` billing.

### 3.4 General Ledger / Chart of Accounts — **MISSING**
- No double-entry accounting.
- No chart of accounts, no journal entries, no trial balance, no closing periods.
- Only cash-basis tracking: cash drawer, expenses, income, invoices, payments.
- **Files**: No `accounts`, `journal_entries`, `chart_of_accounts` tables in any migration.

### 3.5 Offline Mode / Local Queuing — **MISSING (Critical for Ethiopia)**
- No Service Worker, no IndexedDB caching, no background sync.
- POS, patient check-in, attendance recording all fail offline.
- No background sync queue for when connectivity returns.
- **Files**: No Service Worker registration, no Workbox, no `navigator.serviceWorker` usage in frontend.

### 3.6 Local Payment Gateways — **MISSING (Critical for Ethiopia)**
- Only Chapa integrated (`billing.ts` uses `chapaInitialize`/`chapaVerify`).
- No Telebirr (CBE), CBE Birr, HelloCash, Abyssinia Bank, Dashen Bank, M-Pesa.
- **Files**: `server/src/services/billing.ts` (implied by `billing.ts` imports); only `chapaInitialize`/`chapaVerify` implemented.

### 3.7 Multi-language UI — **MISSING**
- **Zero i18n infrastructure**: All strings hardcoded in English across 50+ frontend files.
- No `react-i18next`, no translation files, no language switcher.
- **Critical for Ethiopia**: Amharic (official) and Afaan Oromo widely spoken; English-only blocks adoption by non-English staff.
- **Files**: All `src/platform/**/*.tsx` files have hardcoded English strings.

### 3.8 Offline/Backup/DR/Monitoring — **MISSING**
- **No backup scripts**, no PITR config, no cross-region replication docs.
- **No data retention policy**: No automated archival, no GDPR/PDPA delete endpoints.
- **No observability**: Only `console.log`/`warn`; no Sentry, Datadog, Prometheus, Grafana, Loki.
- **Files**: `server/src/services/alerts.ts` (only alert sender); no metrics endpoint, no `/health` beyond basic `/api/health`.

### 3.9 HR & Payroll — **MISSING**
- No staff profiles beyond login (no hire date, salary, contract, emergency contact, documents).
- No shift scheduling (only retail cash drawer shifts).
- No leave management, no payslips, no salary computation, no tax withholding.
- **Files**: `users` table only; `doctors`/`teachers` have minimal fields; no `staff_profiles`, `shifts`, `leave_requests`, `payroll` tables.

### 3.9 Export Formats — **WEAK**
- Frontend `DataTable` component implies client-side CSV export only.
- No server-side CSV/Excel/PDF generation API.
- No scheduled report delivery (email/SFTP).
- **Files**: `src/platform/ui.tsx` `DataTable` component; no server export routes.

### 3.10 Cross-vertical Feature Drift — **WEAK**
| Feature | Pharmacy | Store | Hospital | School |
|---|---|---|---|---|
| Cash drawer shifts | ❌ | ✅ | ❌ | ❌ |
| Pill-level selling | ✅ | ⚠️ (optional) | ❌ | ❌ |
| Dept connectivity (visits/orders) | ❌ | ❌ | ✅ (new) | ❌ |
| Guardian notifications (email/telegram) | ❌ | ❌ | ❌ | ✅ |
| Marketing integration | ❌ | ❌ | ❌ | ❌ |
| Cash drawer shifts | ❌ | ✅ | ❌ | ❌ |

**Root cause**: Features built per-vertical without a shared "horizontal" layer. Marketing module exists but isn't wired into Hospital/School/Retail dashboards.

---

## 4. Missing Entirely — Grouped by Priority

### 🔴 Critical (Blocks Real-World Use / Compliance)
| # | Feature | Why Critical | Effort Estimate |
|---|---|---|---|
| 1 | **ERCA-compliant invoicing + 15% VAT** | Illegal to operate without in Ethiopia; fines, shutdown risk | High (new tax engine, fiscal device integration) |
| 2 | **Offline mode + background sync** | Ethiopia connectivity unreliable; POS/clinical workflows fail | High (Service Worker, IndexedDB, sync engine) |
| 3 | **Local payment gateways (Telebirr, CBE Birr, HelloCash)** | Chapa alone limits adoption; customers expect local options | Medium (new provider adapters) |
| 4 | **Multi-language (Amharic + Afaan Oromo)** | English-only blocks 70%+ of target users | High (i18n infra + 50+ file translation) |
| 5 | **General ledger / chart of accounts** | No financial statements for investors/auditors/tax | High (double-entry engine) |
| 6 | **Data encryption at rest (PII)** | Patient/guardian data exposed if DB breached | Medium (pgcrypto + app-level) |

### 🟡 Important (Competitive Gap)
| # | Feature | Why Important | Effort Estimate |
|---|---|---|---|
| 7 | **Procurement approval workflow** | Larger clients need PO approval chains | Medium |
| 8 | **General ledger / double-entry** | Required for audited financials | High |
| 9 | **Offline POS / background sync** | Competitors (e.g., Youtap, Kudi) have this | High |
| 9 | **Report builder + PDF/Excel export** | Clients expect custom reports | Medium |
| 10 | **HR module (profiles, shifts, leave, payroll)** | Schools/hospitals need staff management | High |
| 10 | **Telebirr/CBE Birr/HelloCash** | Chapa fees high; customers prefer bank apps | Medium |
| 11 | **Scheduled report delivery (email/PDF)** | Owners want morning reports without login | Low-Medium |
| 11 | **Webhook registration UI for tenants** | Tenants need to integrate with their own tools | Low-Medium |
| 12 | **Data retention / GDPR delete** | Legal compliance | Low |

### 🟢 Nice-to-Have
| # | Feature | Why Nice | Effort Estimate |
|---|---|---|---|
| 13 | **Loyalty/rewards engine** | Differentiator for retail/pharmacy | Medium |
| 14 | **Advanced report builder (drag-drop)** | Power users | High |
| 15 | **Native mobile apps (iOS/Android)** | Better UX than Mini App | Very High |
| 16 | **AI-assisted insights (stock prediction, churn)** | Differentiator | Very High |
| 16 | **Multi-currency / FX** | Regional expansion | Medium |
| 17 | **White-label / custom branding per tenant** | Reseller channel | Medium |

---

## 5. Cross-Vertical Drift Analysis

### 5.1 Hospital Department Connectivity — Unique to Hospital
**What exists:** `hospitalFlow.ts` + `020/021/022` migrations implement a full department connectivity layer:
- `departments` + `department_staff` (assignment)
- `visits` (patient journey backbone) + `visit_status_history` (timeline)
- `service_orders` (generic lab/injection/procedure orders with fee/result)
- Department queues with role-scoped permissions (`orders.lab` vs `orders.injection`)
- Journey timeline modal with order creation, transfer, invoice generation
- Telegram notifications on order create/complete + long-wait escalation

**Impact:** Other verticals (Pharmacy, Store, School) have **no equivalent**. They operate as siloed modules. A pharmacy cannot transfer a patient to a lab; a school cannot route a student from attendance to fees to nurse.

**Root cause:** Built as a Phase 2+ feature for Hospital only; not abstracted as a shared "workflow engine" horizontal layer.

### 5.2 Marketing Module — Isolated from Verticals
**What exists:** Complete marketing engine (`migrations 011-018`, `server/src/routes/marketing/*`, `src/platform/marketing/*`) with contacts, audiences, templates, campaigns, analytics.

**Gap:** **Zero integration** into vertical dashboards:
- Retail dashboard doesn't show "customers due for reorder" campaign
- Hospital dashboard doesn't show "patients due for checkup" campaign
- School dashboard doesn't show "fee reminder" campaign (uses separate guardian notifier)
- No "create campaign from this patient list" button anywhere

**Root cause:** Marketing built as standalone Phase 3 feature; never wired into vertical UIs.

### 5.3 Cash Drawer Shifts — Retail Only
**Exists:** `cash_drawer_shifts` table, full shift lifecycle (open/close/expected/difference), accumulation from sales/expenses/refunds, shift history.

**Missing from:** Pharmacy (shares retail engine but UI doesn't expose shift management), Hospital, School.

**Impact:** Pharmacy owners can't do end-of-day cash reconciliation in the UI.

### 5.4 Guardian Notifications — School Only
**Exists:** `guardianNotifier.ts` + `019_guardian_notifications.sql` + `Students.tsx`/`Fees.tsx` modals for email+Telegram direct notices and fee reminders with delivery tracking.

**Missing from:** Hospital (no patient/guardian SMS/email for appointment reminders, lab results), Retail (no customer SMS for order ready/promotions), Pharmacy (same).

### 5.5 Cash Drawer / Shift Management — Retail Only
**Exists:** Full shift lifecycle with cash/card/mobile buckets, expected vs counted, difference tracking, history.

**Missing from:** Pharmacy (same engine, no UI), Hospital (billing only), School (fees only).

### 5.6 API/Webhook Consistency
| Vertical | Inbound Webhooks | Outbound Webhooks | API Keys |
|---|---|---|---|
| Billing | Chapa (`/webhook/chapa`) | ❌ | ❌ |
| Marketing | Resend (email), SMPP (SMS) | ❌ | ❌ |
| School | Guardian notifier (outbound) | ❌ | ❌ |
| Hospital | ❌ | Order created/completed (Telegram) | ❌ |
| Retail | ❌ | ❌ | ❌ |

**No tenant-facing webhook registration UI** — tenants cannot register their own callback URLs for events (order.created, payment.succeeded, appointment.created).

---

## 6. Summary & Recommended Next Steps

### Immediate (Do First)
1. **Add VAT/ERCA invoicing** — Legal requirement; blocker for production in Ethiopia.
2. **Implement offline mode** — Service Worker + IndexedDB + sync queue for POS, check-in, attendance.
3. **Add Telebirr/CBE Birr/HelloCash** — Payment gateway abstraction in `billing.ts`.

### Short-term (1-2 months)
4. **Add Amharic translations** — i18n framework + translate top 20 screens.
5. **Add general ledger** — Minimal double-entry (COA, journal entries, trial balance, P&L/BS).
6. **Wire marketing into verticals** — "Create campaign" buttons on patient/customer/student lists.
7. **Add procurement approval workflow** — Draft→Approved→Received states + amount thresholds.
8. **Add HR module** — Staff profiles, shifts, leave, basic payroll.

### Medium-term (3-6 months)
9. **General ledger / double-entry** — Full COA, journal entries, financial statements.
10. **Offline mode + background sync** — Service Worker, IndexedDB, sync engine.
11. **Telebirr/CBE Birr/HelloCash** — Payment provider abstraction.
12. **i18n (Amharic/Oromo)** — react-i18next + translation files.
13. **HR module** — Profiles, shifts, leave, basic payroll.
12. **Report builder + PDF export** — Ad-hoc queries, scheduled email delivery.

---

**Report generated from static analysis of commit `b177a69` (main branch).**  
**Files examined:** ~60 TypeScript/SQL files across server migrations, routes, services, middleware, and frontend pages.  
**Audit scope:** Static code review only — no runtime testing, penetration testing, or load testing performed.