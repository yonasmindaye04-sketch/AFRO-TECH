# Phase 1: Horizontal Layer Extraction

## Problem

**Audit Section 5 (Cross-Vertical Drift)** — Four key capabilities exist in only one vertical each, creating feature inequality and code duplication:

| Capability | Currently In | Missing From |
|---|---|---|
| Department/workflow connectivity (visits, service orders, journey timeline) | Hospital only (`hospitalFlow.ts`, migrations `020-022`) | Pharmacy, Store, School |
| Cash drawer shift reconciliation | Retail only (`retail.ts` lines 730-798, `CashDrawer.tsx`) | Pharmacy (shares engine), Hospital, School |
| Guardian/customer notification pattern | School only (`guardianNotifier.ts`, `Students.tsx`, `Fees.tsx`) | Hospital (appointment reminders, lab results), Retail/Pharmacy (order ready, promotions) |
| Marketing module integration | Exists standalone (`marketing/*` routes, `src/platform/marketing/*`) | Not wired into any vertical dashboard |

**Audit references:** Section 5 items 5.2, 5.3, 5.4, 5.5, 5.6; checklist rows "Workflow & Process Control → Cross-dept handoffs", "CRM → Marketing tools consistency", "Integration → Public API/webhooks"

---

## Proposed Approach

### 1. Shared Workflow Engine (`departments`, `visits`, `service_orders`)

**Core concept:** The Hospital's `visits` + `service_orders` pattern is a generic **cross-role handoff engine** applicable wherever a "thing" moves between roles/departments with tracking.

**New shared tables** (extend existing `020/021/022`):

```sql
-- departments: already exists, add `vertical` column to scope per-vertical defaults
ALTER TABLE departments ADD COLUMN vertical TEXT CHECK (vertical IN ('pharmacy','store','hospital','school','shared'));

-- visits: already exists, add `source_entity_type` + `source_entity_id` for polymorphism
-- (e.g., patient visit, student nurse referral, pharmacy counseling referral, retail return inspection)

-- service_orders: already exists, add `source_visit_id` nullable (orders can exist without a visit)
-- Add `order_type` values per vertical: 'lab_test','injection','procedure','vitals' (hospital)
--                                    'counseling','compounding','verification' (pharmacy)
--                                    'nurse_referral','counseling','screening' (school)
--                                    'return_inspection','repair','special_order' (retail)
```

**API surface:** Single `/api/v1/flow/*` router (already exists as `hospitalFlow.ts`) renamed to `flow.ts` and registered for all verticals. Permission checks use `assertCanProcessDepartment()` which maps department type → required permission.

### 2. Cash Drawer Shifts (Horizontal)

**Current:** `cash_drawer_shifts` table + `/retail/shift*` routes + `CashDrawer.tsx` — Retail only.

**Action:** 
- Keep table as-is (already has `tenant_id`, works for any vertical)
- Create shared routes `/api/v1/cash-drawer/*` in new `cashDrawer.ts` router
- Register for Retail, Pharmacy (same tenant type), Hospital (billing desk), School (fees desk)
- Frontend: `CashDrawer.tsx` → move to `src/platform/shared/CashDrawer.tsx`, import in each vertical's shell

**Vertical scope:**
- Retail/Pharmacy: Full shift lifecycle (open/close/expected/diff)
- Hospital: Billing desk shifts only (no card/mobile split needed)
- School: Fees desk shifts (cash/bank transfer)

### 3. Notification Engine (Horizontal)

**Current:** 
- `alerts.ts` — scheduled per-vertical-type alerts (stock, fees, appointments)
- `hospitalNotify.ts` — order created/completed, long-wait
- `guardianNotifier.ts` — School-only 1-on-1 + broadcast

**Action:** Create `src/services/notificationEngine.ts` with unified API:

```typescript
interface NotificationTarget {
  tenantId: string;
  userIds?: string[];           // direct users
  roleNames?: string[];         // all users with role (e.g., 'lab_technician')
  departmentIds?: string[];     // all staff assigned to department
  channels: ('telegram'|'email')[];
}

async function sendNotification(target: NotificationTarget, template: string, data: Record<string, unknown>): Promise<{sent: number, failed: number}>;
```

**Templates** (stored in DB `notification_templates` table, new):
- `appointment_reminder` (Hospital)
- `lab_result_ready` (Hospital)
- `fee_due` / `fee_receipt` (School)
- `order_ready` / `promotion` (Retail/Pharmacy)
- `low_stock` / `expiring` (Retail/Pharmacy)
- `attendance_alert` (School)

**Delivery:** Uses existing `sendMessage` (Telegram) + Resend (email). Throttling per `tenant:type` (12h) preserved.

**Vertical integration:**
- Hospital: wire into `hospitalFlow.ts` (order created/completed, long-wait) + `alerts.ts` (appointment reminders)
- School: replace `guardianNotifier.ts` calls with `notificationEngine.sendNotification()`
- Retail/Pharmacy: add low-stock/expiry alerts via `alerts.ts`; order-ready via POS checkout

### 4. Marketing Module Integration

**Current:** Marketing routes (`/marketing/*`) and frontend (`src/platform/marketing/*`) exist but **zero entry points** from vertical dashboards.

**Action:** Add "Create campaign" affordances in each vertical's list views:

| Vertical | List View | Action Added |
|---|---|---|
| Hospital | Patients (`Patients.tsx`) | "Create campaign" → pre-filters audience to selected patients |
| Hospital | Appointments (`Appointments.tsx`) | "Campaign to no-shows" |
| School | Students (`Students.tsx`) | "Fee reminder campaign" |
| School | Fees (`Fees.tsx`) | "Defaulters campaign" |
| Retail | Customers (`Customers.tsx` — add page) | "Re-engagement campaign" |
| Retail | Products (`Products.tsx`) | "Promotion campaign" |
| Pharmacy | same as Retail | same |

**Implementation:** Each "Create campaign" button opens `MarketingCampaignModal` (new shared component) pre-filled with audience filter (contact IDs) and suggested templates.

### 5. Shared Frontend Components

Move to `src/platform/shared/`:
- `CashDrawer.tsx` (from Retail)
- `JourneyModal.tsx` (from Hospital, generalize for any entity with visit-like timeline)
- `FlowBoard.tsx` → `DepartmentBoard.tsx` (generic department queue)
- `MarketingCampaignModal.tsx` (new)
- `NotificationBell.tsx` (unified notification center)

---

## Backward Compatibility

| Existing Feature | Impact | Mitigation |
|---|---|---|
| Hospital `hospitalFlow.ts` routes | Renamed to `/api/v1/flow/*` | Keep `hospitalFlow.ts` as alias that re-exports; add deprecation notice |
| Retail `/retail/shift/*` routes | Moved to `/api/v1/cash-drawer/*` | Keep old routes as aliases redirecting to new |
| School `guardianNotifier.ts` | Internal refactor to use `notificationEngine` | Same function signatures, internal impl changes |
| Marketing routes | Unchanged | New entry points only |
| `visit_status_history` | Extended with `source_entity_type` | Nullable, default 'visit' for existing rows |

**Database:** All new columns nullable with sensible defaults. Existing Hospital data unchanged.

---

## Open Questions

1. **Department seeding per vertical:** Should default departments be seeded per-vertical-type on tenant creation (like current `022_connectivity_rbac.sql` does for Hospital), or managed entirely via UI?
   - *My lean:* Seed defaults in migration per `business_type` (Pharmacy→Counseling/Dispensing, Store→Returns/Repair, School→Nurse/Office), but allow custom via UI.

2. **Permission mapping for new order types:** 
   - New `order_type` values need corresponding permissions (e.g., `orders.counseling`, `orders.return_inspection`).
   - Should these be auto-created in migration `022` extension, or added on-demand when department type is created?

3. **Notification template storage:** DB table vs. code constants?
   - *Lean:* DB table `notification_templates` (tenant-scoped, editable by owner) with code defaults seeded.

4. **Marketing "create campaign" UX:** 
   - Inline modal in each list view, or redirect to `/marketing/campaigns/new?audience=...`?
   - *Lean:* Inline modal (`MarketingCampaignModal`) for speed; deep-link for complex flows.

5. **Cash drawer for Hospital/School:** 
   - Hospital billing desk needs shift tracking but different payment methods (cash/card/insurance).
   - School fees desk: cash + bank transfer.
   - Should we keep single `cash_drawer_shifts` table with vertical-specific `payment_method` enums, or separate tables?

---

## Implementation Order (within Phase 1)

1. **Migrations** — Extend `020/021/022` + new `023_notification_templates.sql` + `024_cash_drawer_horizontal.sql`
2. **Shared services** — `notificationEngine.ts`, extend `hospitalNotify.ts` → `flowNotify.ts`
3. **Routes** — `flow.ts` (replaces `hospitalFlow.ts`), `cashDrawer.ts`, `notifications.ts`
4. **Frontend shared** — `CashDrawer.tsx`, `DepartmentBoard.tsx`, `JourneyModal.tsx` (generalized), `MarketingCampaignModal.tsx`
5. **Vertical wiring** — Update each vertical's routes, pages, nav
6. **Notifications** — Wire `alerts.ts` + `hospitalFlow` → `notificationEngine`; School → `notificationEngine`; Retail/Pharmacy low-stock/order-ready
7. **Marketing integration** — Add "Create campaign" buttons + `MarketingCampaignModal`

---

**Ready for review.** Please confirm the approach, especially on open questions 1–5, before I start implementation.