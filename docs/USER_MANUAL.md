# AFRO Suite — Comprehensive Customer User Manual & Operations Guide

**AFRO-TECH Business Solutions**  
*The Unified Operating System for Pharmacies, Retail Stores, Clinics, and Educational Institutions*

---

## Document Overview & Target Audience

This user manual is the definitive operational handbook for business owners, operational managers, cashiers, healthcare practitioners, and school administrators using the **AFRO Suite** platform. 

Whether your organization is deployed on **Pharmacy**, **Retail Store**, **Hospital / Clinic**, or **School**, this guide walks you through every workflow step-by-step—from first-day hardware configuration to daily shift closing, automated inventory auditing, student grading, patient triaging, and multi-channel marketing campaigns.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             AFRO SUITE ECOSYSTEM                            │
├───────────────────┬───────────────────┬───────────────────┬─────────────────┤
│     PHARMACY      │   RETAIL STORE    │ CLINIC / HOSPITAL │     SCHOOL      │
│   • Pill Dispense │   • Fast POS Bar  │   • Patient Queue │   • Class Roster│
│   • FEFO Batches  │   • Khata Credit  │   • Consultations │   • Gradebook   │
│   • Expiry Alert  │   • Stock Ledger  │   • Lab Workflows │   • Report Cards│
│   • Dynamic Margin│   • Shift Control │   • Medical Bills │   • Term Fees   │
├───────────────────┴───────────────────┴───────────────────┴─────────────────┤
│                               SHARED FOUNDATION                             │
│   Multi-Tenant DB • RBAC Security • Cash Drawer • Audit Trail • Telegram Bot│
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Table of Contents

1. [Platform Overview & Getting Started](#1-platform-overview--getting-started)
   - 1.1 Architecture & Data Security
   - 1.2 Accessing Your Workspace (Web & Telegram Mini App)
   - 1.3 Workspace Setup Checklist
   - 1.4 Hardware Setup (Barcode Scanners & Thermal Printers)
2. [Team Management & Role-Based Access Control (RBAC)](#2-team-management--role-based-access-control-rbac)
   - 2.1 Predefined Roles & Permissions Matrix
   - 2.2 Adding and Provisioning Staff
   - 2.3 Instant Access Revocation & Password Policies
3. [Retail & Pharmacy Operations Engine](#3-retail--pharmacy-operations-engine)
   - 3.1 Product Catalog Architecture (Standard vs. Sell-by-Pill)
   - 3.2 Barcode Configuration & Scanning
   - 3.3 Stock Receiving & Batch Creation (Purchases)
   - 3.4 Point of Sale (POS) Counter Operation
   - 3.5 Checkout, Payment Types & Partial Settlements
   - 3.6 Receipt Printing & Receipt Customization
   - 3.7 Returns, Exchanges, and Restocking Rules
4. [Inventory Governance & Expiry Control](#4-inventory-governance--expiry-control)
   - 4.1 First-Expiring, First-Out (FEFO) Automated Engine
   - 4.2 Expiry Risk Monitoring (30 / 60 / 90 / 180 Days)
   - 4.3 Expired Stock Write-offs & Audit Trails
   - 4.4 Stock Adjustments (Physical Audits, Damage, Breakage)
   - 4.5 Low-Stock Reorder Triggers & Suggested Quantities
5. [Cash Drawer & Financial Auditing](#5-cash-drawer--financial-auditing)
   - 5.1 Shift Lifecycle: Opening Float Declaration
   - 5.2 Mid-Shift Petty Cash & Operational Expenses
   - 5.3 Shift Closing & End-of-Day Balancing (Over / Short)
   - 5.4 Customer Credit (Khata) Ledger & FIFO Debt Collection
   - 5.5 Supplier Payable Tracking & Purchase Settlement
   - 5.6 Executive Financial Reports (P&L, Margins, Dead Stock)
6. [Hospital & Clinic Management Workflow](#6-hospital--clinic-management-workflow)
   - 6.1 Patient Registration & Medical Record Number (MRN) Assignment
   - 6.2 Appointment Booking & Double-Booking Prevention
   - 6.3 Live Patient Queue Board & Triage
   - 6.4 Doctor Consultation Suite (Vitals, Clinical Notes, Prescriptions)
   - 6.5 Laboratory Workflow (Catalog, Orders, Samples, Results)
   - 6.6 Clinic Billing, Co-Pays & Partial Payments
7. [School Administration Workflow](#7-school-administration-workflow)
   - 7.1 Student Roster & Class Assignment
   - 7.2 Weekly Timetable Master Grid
   - 7.3 Daily Attendance Register
   - 7.4 Gradebook & Bulk Assessment Score Entry
   - 7.5 Automated Report Cards (Grades, Attendance, Class Rank)
   - 7.6 Term Fee Billing & Defaulter Tracking
   - 7.7 Annual Promotion & Graduation Engine
8. [Marketing, Campaigns & Telegram Bot](#8-marketing-campaigns--telegram-bot)
   - 8.1 Contact Management & Dynamic Audience Segmentation
   - 8.2 Template Design with Dynamic Merge Tags
   - 8.3 Multi-Channel Dispatch (Ethio Telecom SMPP SMS & Resend Email)
   - 8.4 Delivery Webhooks & Analytics
   - 8.5 Connecting Your Business Telegram Bot
   - 8.6 Staff Telegram Commands & Telegram Mini App Access
9. [Subscription, Billing & Platform Support](#9-subscription-billing--platform-support)
   - 9.1 Trial Period Details (45-Day Full Feature Trial)
   - 9.2 Plan Selection & Chapa Online Payment Integration
   - 9.3 Getting Technical Support
10. [Troubleshooting & Frequently Asked Questions (FAQ)](#10-troubleshooting--frequently-asked-questions-faq)

---

## 1. Platform Overview & Getting Started

### 1.1 Architecture & Data Security
AFRO Suite is built on a multi-tenant cloud architecture. When your business registers, an isolated, encrypted tenant environment is allocated for your workspace.
* **Strict Tenant Isolation:** Structurally, no query or API call can access another business's inventory, financial data, or patient/student records.
* **Continuous Cloud Sync:** All transactions are committed in real-time. If a device loses power or disconnects, all previously completed sales, patient consults, or inventory entries remain safe.

### 1.2 Accessing Your Workspace
You can access your workspace through two official channels:
1. **Desktop / Tablet Web Browser:** Modern Chromium-based browsers (Chrome, Edge, Brave) or Safari. Recommended screen resolution: 1280×720 or higher.
2. **Telegram Mini App:** Access your workspace directly within Telegram on mobile or desktop via your registered company bot without needing to re-enter your password.

### 1.2.1 Signing In & Creating an Account
* **Email + password** — the standard sign-in form on the login page.
* **Continue with Google** — a one-tap Google account sign-in (appears automatically when the platform has Google sign-in configured). If your Google email matches an existing account, the two link together.
* **Telegram login widget** — sign in with your Telegram account, verified securely by the platform's bot.
* **First-time social users:** after a Google or Telegram sign-in, you complete a one-step workspace setup — choose your business type and company name — and go straight to your dashboard.
* **Install as an app:** on Android/iOS your browser's menu offers *Install app / Add to Home screen*, which installs AFRO Suite as a full-screen app icon (PWA). No APK download needed.

### 1.3 Workspace Setup Checklist
Upon first sign-in as the **Owner**, complete this 10-minute setup checklist:
- [ ] **Navigate to Settings:** Open the navigation bar and select `Settings`.
- [ ] **Business Identity:** Enter your trade name, legal business registration name, TIN (Tax Identification Number), and VAT number.
- [ ] **Contact Details:** Enter the phone number and physical address displayed on customer receipts.
- [ ] **Currency & Localization:** Set your standard currency symbol (e.g., `ETB`, `USD`) and standard tax percentage (e.g., `15%`).
- [ ] **Receipt Customization:** Write custom header announcements (e.g., *"Thank you for shopping at Metro Pharmacy"*) and footer notes (e.g., *"Goods once sold cannot be returned without receipt within 48 hours"*).
- [ ] **Margin Presets (Retail/Pharmacy):** Set your quick-margin buttons (e.g., `20, 25, 30, 50`) for dynamic counter pricing.

### 1.4 Hardware Setup (Barcode Scanners & Thermal Printers)

#### Barcode Scanners — Hardware
AFRO Suite supports standard 1D and 2D USB/Bluetooth barcode scanners operating in **HID Keyboard Emulation Mode**:
* Plug the scanner into your PC/POS terminal via USB or pair via Bluetooth.
* Ensure the scanner is configured to send an **Enter (Carriage Return / `CR` or `CR+LF`)** suffix after every scan. Most scanners come factory-configured this way.
* When using the POS screen, the scanner will automatically populate the barcode input and immediately trigger item lookup and addition to cart.

#### Barcode Scanners — Phone / Laptop Camera
No hardware needed — the POS and the product form include a **camera scanner** (button with the camera icon):
* Tap the camera button, point the rear camera at the product barcode, and it scans automatically — a short beep confirms, and the item is added to the cart (POS) or the code fills the Barcode field (product form).
* Supported formats: **EAN-13, EAN-8, UPC-A/E, Code 128, Code 39, ITF, Codabar, and QR**.
* A **flashlight toggle** appears in dim conditions on supported devices.
* Requirements: camera permission granted, and the app must be opened over **HTTPS** (the production site always qualifies). If access is denied, the app explains how to fix it, and you can always type the barcode manually.

*Tip for pharmacists:* scan each product's manufacturer barcode once into its product record (Products → edit → camera icon next to Barcode). After that, every POS scan rings it up instantly.

#### Thermal Receipt Printers
Supports ESC/POS compatible thermal printers (58mm and 80mm roll widths):
1. Connect printer via USB, Ethernet/LAN, or Bluetooth.
2. Install the manufacturer's printer driver in Windows/macOS.
3. Set the default paper size to `58mm * 210mm` or `80mm * 297mm`.
4. In browser print options, set margins to **None** or **Minimum** and uncheck "Headers and Footers" to ensure crisp thermal receipts.

---

## 2. Team Management & Role-Based Access Control (RBAC)

### 2.1 Predefined Roles & Permissions Matrix
AFRO Suite implements strict server-side Role-Based Access Control. Each user account can only view and perform actions permitted by their role:

| Role | Target Department | POS / Billing | Inventory & Purchases | Financial Reports | Settings & Team | Clinical / Academic Records |
|---|---|:---:|:---:|:---:|:---:|:---:|
| **Owner** | Executive / Proprietor | Full | Full | Full | Full | Full |
| **Admin** | General Manager | Full | Full | Full | Read/Write (No Billing) | Full |
| **Manager** | Store / Branch Supervisor | Full | Full | Limited | View Only | View Only |
| **Cashier** | Counter Sales Staff | Full | View Stock Only | Shift Ledger Only | No Access | No Access |
| **Pharmacist** | Dispensary Staff | Full | Batches & Expiry | Shift Ledger Only | No Access | Rx Dispense Only |
| **Doctor** | Medical Practitioner | View Fees | No Access | No Access | No Access | Full (Patients, EMR, Labs) |
| **Nurse** | Clinical Support | View Queue | No Access | No Access | No Access | Triage, Vitals, Queue |
| **Teacher** | Academic Staff | No Access | No Access | No Access | No Access | Attendance, Grades |
| **Registrar** | School Admin | Fee Collection | No Access | Fee Ledgers Only | No Access | Student Enrollment |
| **Accountant** | Finance Office | Read Invoices | Read Invoices | Full (P&L, Ledgers) | View Only | Fee / Patient Invoicing |

### 2.2 Adding and Provisioning Staff
1. Go to the **Team** menu.
2. Click the **Add Staff Member** button.
3. Fill out the dialog:
   * **Full Name:** Official employee name.
   * **Email Address:** Used as their unique login identifier.
   * **Role:** Select the appropriate operational role from the dropdown.
   * **Temporary Password:** Assign a secure temporary password (minimum 8 characters).
4. Share the credentials securely with the staff member. They will be prompted to log in at your workspace URL.

### 2.3 Instant Access Revocation & Password Policies
* **Terminating / Suspending Access:** If an employee departs or changes shifts, go to **Team**, locate the user, and click **Disable User**. Their active session token is immediately invalidated server-side—they will be locked out on their next click.
* **Password Resets:** The workspace Owner or Admin can click **Reset Password** on any user profile at any time to set a new password.

---

## 3. Retail & Pharmacy Operations Engine

### 3.1 Product Catalog Architecture (Standard vs. Sell-by-Pill)
Products in AFRO Suite accommodate both traditional packaged retail items and unit-dispensed pharmaceuticals:

```
                  ┌─────────────────────────────────────────┐
                  │              PRODUCT RECORD             │
                  │  Name, Category, Barcode, Minimum Stock │
                  └────────────────────┬────────────────────┘
                                       │
                ┌──────────────────────┴──────────────────────┐
                ▼                                             ▼
     [Standard Retail Item]                         [Sell-by-Pill Unit Pack]
   • Sold as whole unit (pcs, bottle, kg)         • Tracks whole packs & loose pills
   • Stock measured in whole units                • Example: Box of 30 tablets
   • Direct sell price per piece                  • Supports split-box dispensing
```

#### Creating a Product
1. Go to **Products** and click **+ New Product**.
2. Complete the mandatory fields:
   * **Product Name:** Standard brand and generic name (e.g., *Amoxicillin 500mg* or *Bottled Water 500ml*).
   * **Category:** Group items (e.g., *Antibiotics*, *Beverages*, *Cosmetics*).
   * **Base Unit:** Select `pcs`, `box`, `bottle`, `strip`, `kg`, etc.
   * **Cost Price:** Default supplier acquisition cost per unit.
   * **Selling Price:** Retail counter price per whole unit.
   * **Low-Stock Alert Threshold:** Minimum units before the system marks the item as critical and sends a reorder alert.
   * **Barcode:** Scan the product's manufacturer barcode or type a custom store SKU.
3. **Pharmacy Sell-by-Pill Toggle (Optional):**
   * Check **Sell by Pill / Capsule / Ampoule**.
   * Enter **Pills Per Pack** (e.g., `30` for a box containing 3 strips of 10).
   * The system will automatically compute per-pill prices, loose-pill inventory, and pack breakdown math.

### 3.2 Barcode Configuration & Scanning
* **Product Setup:** Ensure the barcode in the product record matches the printed physical barcode on the packaging. Use the **camera icon** beside the Barcode field to capture it from the physical package in one tap.
* **Scanning at POS:**
  * Click into or focus on the **Scan barcode...** input box at the top left of the POS — then scan with your hardware scanner, **or tap the camera button** to scan with the phone/laptop camera.
  * Scan the physical item.
  * The system validates whether stock is available:
    * **If In Stock:** The product is instantly added to the cart, or the existing quantity is incremented by 1.
    * **If Out of Stock:** A clear red error notice appears stating `"[Product Name]" is out of stock`, and the cursor remains focused for the next scan.

### 3.3 Stock Receiving & Batch Creation (Purchases)
Stock is never entered as an arbitrary number. To guarantee audit compliance and expiry protection, inventory enters the system exclusively through **Purchases (Receiving)**.

1. Navigate to **Purchases** and click **+ Receive Purchase Order**.
2. Select your **Supplier** (or create a new vendor profile inline).
3. Add line items:
   * Select the product from the dropdown.
   * Enter **Quantity** received (e.g., `50 boxes`).
   * Enter the **Batch Number** (printed on the packaging, e.g., `BT-2026-09A`).
   * Enter the **Expiry Date** (`YYYY-MM-DD`).
   * Verify or update the **Unit Cost Price** for this specific delivery.
4. Set the payment status:
   * **Paid:** Deducts immediately from today's cash drawer or bank ledger.
   * **Credit (Payable):** Logs an accounts payable balance owed to the supplier.
5. Click **Confirm & Receive Stock**.
   * Batches are immediately created in the database.
   * Inventory levels update instantly across the POS and inventory reports.

### 3.4 Point of Sale (POS) Counter Operation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ [Scan barcode...         ] [|||]  [Search by name or category...          ] │
├─────────────────────────────────────────┬───────────────────────────────────┤
│ PRODUCT GRID                            │ CURRENT CART                      │
│ ┌──────────────┐  ┌──────────────┐     │ 1. Paracetamol 500mg              │
│ │Amoxicillin   │  │Mineral Water │     │    2 packs × 45.00 ETB = 90.00    │
│ │45 ETB        │  │15 ETB        │     │ 2. Amoxicillin (Pills: 10)        │
│ │120 in stock  │  │85 in stock   │     │    10 pills × 1.50 ETB = 15.00    │
│ └──────────────┘  └──────────────┘     ├───────────────────────────────────┤
│ ┌──────────────┐  ┌──────────────┐     │ Subtotal:              105.00 ETB │
│ │Bandage 10cm  │  │Baby Milk 400g│     │ Discount:                0.00 ETB │
│ │30 ETB        │  │420 ETB       │     │ TOTAL:                 105.00 ETB │
│ │[OUT OF STOCK]│  │12 in stock   │     ├───────────────────────────────────┤
│ └──────────────┘  └──────────────┘     │ [Cash] [Card] [Mobile] [Credit]   │
│                                         │ [   COMPLETE CHECKOUT (F4)   ]   │
└─────────────────────────────────────────┴───────────────────────────────────┘
```

#### Step-by-Step Sale Walkthrough
1. Open **POS** from the navigation bar.
2. **Add Products to Cart:**
   * **Method A (Barcode):** Scan the physical barcode.
   * **Method B (Search):** Type product name or category into the search field.
   * **Method C (Visual Grid):** Tap the product card in the visual catalog.
3. **Adjust Quantities & Pill Breakdown:**
   * For standard items: Click `+` or `-` to modify unit counts.
   * For pharmacy items: Enter whole packs in the **Units** field and/or enter individual loose units in the **Pills** field.
4. **Dynamic Profit Margin Override (Optional):**
   * If authorized, click the **Margin %** dropdown on any line item to apply a preset margin (e.g., `25%`, `30%`, `50%`) based on acquisition cost, or leave as `List Price`.
5. **Apply Discounts (Optional):**
   * Enter a lump-sum discount amount in the **Discount** field. The system recalculates the final payable total.

### 3.5 Checkout, Payment Types & Partial Settlements
Select the appropriate payment method:
* **Cash:** Enter the amount tendered by the customer. The system calculates and displays the exact **Change Due**.
* **Card (POS Terminal):** For credit/debit card transactions processed via external POS card machines.
* **Mobile (Telebirr / CBE Birr / M-Pesa):** Record mobile wallet transaction references for daily bank reconciliation.
* **Credit (Khata / Customer Account):**
  * Select an existing credit customer profile.
  * The invoice is finalized with `amount_paid = 0` (or partial cash deposit).
  * The remaining balance is automatically assigned to the customer's credit ledger.
* Click **Checkout** (or press Enter). The transaction commits atomically.

### 3.6 Receipt Printing & Receipt Customization
Immediately upon checkout completion, a **Sale Completed** modal appears:
* Click **Print Thermal Receipt** to trigger the ESC/POS print dialog.
* Receipts include:
  * Company logo and header details.
  * Date, timestamp, and unique invoice number (`INV-XXXXX`).
  * Cashier name.
  * Itemized product breakdown (Units, Pills, Line Total).
  * Subtotal, discounts, VAT summary, and final total.
  * Payment method and change provided.
  * Custom footer return policies.
* Automatic print triggers can be configured under `Settings -> Auto-Print Receipts`.

### 3.7 Returns, Exchanges, and Restocking Rules
Returns must always be referenced against an original invoice to preserve inventory and financial balance integrity.

1. Go to **Sales History**.
2. Locate the transaction using the invoice number, date, or customer name.
3. Click **View Sale Details -> Initiate Return**.
4. Select the specific item(s) and quantities being returned.
5. **Select Return Reason:**
   * `Customer Return / Wrong Item`: **Restocked.** Units return to the active batch; loose pills return to the loose pill pool.
   * `Damaged / Defective`: **Not Restocked.** Item is written off to damage expense; inventory is decremented.
   * `Expired`: **Not Restocked.** Item is routed to expired holding quarantine.
6. Specify refund method (Cash from current drawer or Store Credit).
7. Confirm return. A credit receipt is generated and cash drawer balances update.

---

## 4. Inventory Governance & Expiry Control

### 4.1 First-Expiring, First-Out (FEFO) Automated Engine
In retail and pharmacy environments, selling older stock first is critical to eliminating shrinkage:
* AFRO Suite enforces **FEFO (First-Expiring, First-Out)** automatically at the database level.
* When a cashier adds a product to the cart, the system does not pick arbitrary stock; it automatically allocates inventory from the batch with the **closest valid expiry date**.
* When that batch is depleted, the system seamlessly transitions to the next earliest batch.

> [!IMPORTANT]
> **The Expired-Stock Guarantee:**
> Expired batches can *never* be sold at the POS. Even if total physical inventory reads positive, the system stops sales the instant non-expired units reach zero.

### 4.2 Expiry Risk Monitoring (30 / 60 / 90 / 180 Days)
Navigate to **Expiry Tracking** to view items approaching expiration:
* **Filter Tiers:**
  * **Critical (< 30 Days):** High risk of total loss. Prioritize for immediate counter promotion or supplier return.
  * **Urgent (31 – 60 Days):** Flagged for discounted counter dispensing.
  * **Warning (61 – 90 Days):** Standard monitoring window.
  * **Upcoming (91 – 180 Days):** Long-term planning.
* **Value at Risk Calculation:**
  * The screen calculates the exact **Capital Value at Cost** trapped in near-expiry batches (`Quantity × Purchase Cost`).
  * Export this list to Excel/CSV to provide supplier sales reps with proof for credit notes or exchanges.

### 4.3 Expired Stock Write-offs & Audit Trails
When a batch crosses its expiration date:
1. Open **Expiry Tracking**.
2. Locate the expired batch row.
3. Click **Write-off Batch**.
4. Enter the required **Disposal Reason** (e.g., *Expired on shelf - regulatory destruction*).
5. Confirm write-off:
   * Remaining quantity is zeroed out.
   * Financial value is moved to the **Inventory Shrinkage / Loss** expense account.
   * An audit log entry is recorded with employee timestamp.

### 4.4 Stock Adjustments (Physical Audits, Damage, Breakage)
Conduct physical inventory audits regularly to reconcile actual shelf counts with system records:

```
Step 1: Open Inventory Adjustments  ──►  Step 2: Select Product & Batch
                                                      │
Step 4: Audit Trail Updated         ◄──  Step 3: Enter Physical Count & Reason
(Auto-logs delta in P&L)                 (Damage / Theft / Count Correction)
```

1. Go to **Stock Adjustments**.
2. Click **+ New Adjustment**.
3. Select the product and specific batch number.
4. Enter the **Counted Physical Quantity**.
5. The system computes the discrepancy:
   * **Positive Delta (Surplus):** System stock increases; logged as inventory gain.
   * **Negative Delta (Shortage):** System stock decreases; logged as shrinkage.
6. Select the mandatory reason code: `Annual Physical Audit`, `Damaged in Handling`, `Theft / Unaccounted`, or `Supplier Short-shipment`.
7. Click **Apply Adjustment**.

### 4.5 Low-Stock Reorder Triggers & Suggested Quantities
* When a product's sellable inventory dips below its configured **Low-Stock Threshold**, it is immediately flagged on the **Dashboard Reorder List**.
* **Suggested Reorder Formula:**
  $$\text{Suggested Order} = (\text{Threshold} \times 2) - \text{Current Stock}$$
* If Telegram notifications are connected, the system automatically dispatches an alert message to the store manager at 08:00 AM every morning with all products requiring replenishment.

---

## 5. Cash Drawer & Financial Auditing

### 5.1 Shift Lifecycle: Opening Float Declaration
To prevent cashier theft and ensure daily accountability, AFRO Suite isolates cash handling by **Cashier Shifts**.

1. When a cashier logs in, navigate to **Cash Drawer**.
2. Click **Open Shift**.
3. Count the physical banknotes in the register drawer (the "opening float" or change fund).
4. Enter the amount (e.g., `500.00 ETB`) and click **Confirm Open Shift**.
5. The register is now live. All cash sales processed will accumulate into this shift's ledger.

### 5.2 Mid-Shift Petty Cash & Operational Expenses
If money is taken out of the till during the day to pay for petty expenses (e.g., store cleaning supplies, tea/coffee, emergency delivery fees):
1. Go to **Cash Drawer**.
2. Click **Record Expense / Cash Out**.
3. Enter the **Amount** withdrawn.
4. Select the **Expense Category** (e.g., *Utilities*, *Supplies*, *Transport*).
5. Enter a brief description and receipt voucher number.
6. Click **Save Expense**.
7. The expected cash in the drawer decreases accordingly, keeping the evening balance exact.

### 5.3 Shift Closing & End-of-Day Balancing (Over / Short)
At the end of a cashier's working shift:
1. Navigate to **Cash Drawer** and click **Close Shift**.
2. The cashier does a "blind count" of all cash physically inside the drawer.
3. Enter the total counted cash into the **Closing Physical Cash** field.
4. Click **Calculate Reconciliation**.
5. The system displays the comprehensive shift summary:
   * **Opening Float:** Initial cash fund.
   * **+ Cash Sales:** Total cash received from sales.
   * **+ Debt Collections:** Cash collected from credit customers.
   * **- Cash Refunds:** Cash paid out for customer returns.
   * **- Shift Expenses:** Petty cash spent during the shift.
   * **= Expected Cash in Drawer.**
6. The system calculates the variance:
   * **Balanced ($0.00):** Perfect reconciliation.
   * **Over (+):** More cash than recorded sales (investigate missed receipts).
   * **Short (-):** Cash missing (logged against cashier accountability).
7. Add closing notes and click **Finalize & Archive Shift**. A printable Shift Report is generated.

### 5.4 Customer Credit (Khata) Ledger & FIFO Debt Collection
For regular customers who buy on credit:
* **Viewing Receivables:** Go to the **Credit** tab. The system lists every debtor, their contact phone number, total outstanding balance, and date of oldest unpaid purchase.
* **Collecting Debt Payments:**
  1. Locate the customer in the Credit list and click **Collect Payment**.
  2. Enter the amount being paid (full or partial).
  3. Select payment destination (`Cash Drawer`, `Bank Account`, `Telebirr`).
  4. The system applies the money **FIFO (First-In, First-Out)**, marking the oldest unpaid invoices as cleared first.
  5. Print or SMS an official payment acknowledgement receipt.

### 5.5 Supplier Payable Tracking & Purchase Settlement
* Under **Purchases -> Supplier Accounts**, monitor all unpaid invoices for stock received on credit.
* Click **Record Supplier Payment** to log payments made via bank transfer or cheque, updating your accounts payable balance immediately.

### 5.6 Executive Financial Reports
The **Reports** module provides enterprise-grade reporting for business owners:
* **Profit & Loss (P&L) Statement:**
  $$\text{Net Profit} = \text{Gross Revenue} - \text{Cost of Goods Sold (COGS)} - \text{Operating Expenses}$$
* **Stock Valuation Report:** Total asset value currently sitting on shelves at cost price vs. total potential realization at retail price.
* **Dead Stock Analysis:** Identifies products with zero sales in the last 30, 60, or 90 days—highlighting capital trapped in slow-moving items.

---

## 6. Hospital & Clinic Management Workflow

*(Applies to Hospital / Clinic business workspaces)*

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│ 1. RECEPTION    │  ──►  │ 2. TRIAGE / QUEUE│  ──►  │ 3. CONSULTATION │
│ Patient Record  │       │ Vitals & Doctor │       │ Doctor Exam, Dx │
│ MRN Generated   │       │ Live Queue Board│       │ Prescriptions   │
└─────────────────┘       └─────────────────┘       └────────┬────────┘
                                                             │
┌─────────────────┐       ┌─────────────────┐                │
│ 5. BILLING & POS│  ◄──  │ 4. LABORATORY   │  ◄─────────────┘
│ Invoices Issued │       │ Sample & Results│
│ Meds Dispensed  │       │ Catalog Verified│
└─────────────────┘       └─────────────────┘
```

### 6.1 Patient Registration & Medical Record Number (MRN) Assignment
1. Go to **Patients** and click **+ Register Patient**.
2. Complete patient demographics:
   * Full Name, Gender, Date of Birth / Age, Phone Number, Emergency Contact.
   * **Blood Group** ($A^+, B^+, AB^+, O^+$, etc.).
   * **Allergies & Chronic Conditions:** Prominently recorded. Any recorded allergies (e.g., *Penicillin*) will appear in bright red alert banners across doctor consultation views.
3. Click **Save Patient**. The system assigns a sequential Medical Record Number (e.g., `PAT-00124`).

### 6.2 Appointment Booking & Double-Booking Prevention
1. Go to **Appointments -> Book Appointment**.
2. Select Patient, Assigned Doctor, Department, and Appointment Slot.
3. **Conflict Detection:** If the selected doctor already has a confirmed booking during that time window, the system blocks the action and prompts the receptionist to select another slot or provider.

### 6.3 Live Patient Queue Board & Triage
1. Patients arriving at the clinic are checked into the **Live Queue Board**.
2. **Nurse Triage Station:**
   * Nurses click the patient's card to record vitals:
     * Blood Pressure (Systolic / Diastolic mmHg)
     * Pulse Rate (bpm)
     * Body Temperature (°C)
     * Respiratory Rate & Oxygen Saturation ($SpO_2 \%$)
     * Body Weight (kg) & Height (cm) (automatic BMI calculation)
3. The patient status transitions from `Waiting` $\rightarrow$ `In Triage` $\rightarrow$ `Ready for Doctor`.
4. The Doctor's room display updates live via WebSockets/polling.

### 6.4 Doctor Consultation Suite (Vitals, Clinical Notes, Prescriptions)
1. The physician opens their **Doctor Dashboard** and selects the next patient in queue.
2. Review historical visits, past lab reports, and vitals history in a unified 360° medical view.
3. Fill out consultation documentation:
   * **Chief Complaint & History of Present Illness (HPI)**
   * **Physical Examination Findings**
   * **Provisional / Confirmed Diagnosis** (with ICD-10 or clinical tagging)
4. **Electronic Prescription (e-Rx):**
   * Search dispensary products directly from the clinic's internal pharmacy catalog.
   * Prescribe dosage, frequency (e.g., *1 tab TID × 5 days*), and instructions.
   * Prescriptions route directly to the clinic pharmacy counter for instant fulfillment.

### 6.5 Laboratory Workflow (Catalog, Orders, Samples, Results)
1. **Ordering Tests:** The doctor selects lab tests from the catalog (e.g., *Complete Blood Count (CBC)*, *Malaria RDT*, *Urinalysis*, *Lipid Profile*).
2. **Lab Technician Station:**
   * Under the **Labs** tab, pending test orders appear in real-time.
   * Click **Collect Sample** (logs sample collection timestamp and specimen type).
   * Run the test and click **Enter Results**.
   * Enter quantitative/qualitative values. The system automatically highlights values outside configured normal reference ranges in bold red.
   * Click **Authorize & Release**. Results become instantly visible in the Doctor's consultation file.

### 6.6 Clinic Billing, Co-Pays & Partial Payments
1. Go to **Billing**.
2. The system consolidates consultation fees, ordered laboratory procedures, and pharmacy items into a unified patient invoice (`INV-XXXXX`).
3. Supports flexible settlement:
   * **Cash / Mobile Payment**
   * **Corporate / Insurance Co-pay Split**
   * **Partial Payment:** Patient pays a deposit today; outstanding balance is tracked on their medical profile.

---

## 7. School Administration Workflow

*(Applies to School workspaces)*

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                             ACADEMIC LIFECYCLE                              │
├────────────────────┬────────────────────┬───────────────────────────────────┤
│ 1. ADMISSIONS      │ 2. DAILY OPERATIONS│ 3. EVALUATION & REPORTING         │
│ • Student Rosters  │ • Timetable Master │ • Assessment Gradebook            │
│ • Class Assignment │ • Attendance Call  │ • Auto-Computed Report Cards      │
│ • Guardian Contact │ • Fee Collection   │ • Class Rank & Promotion Engine   │
└────────────────────┴────────────────────┴───────────────────────────────────┘
```

### 7.1 Student Roster & Class Assignment
1. Go to **Students** and click **+ Enroll Student**.
2. Enter student information:
   * Name, Gender, Date of Birth.
   * Assign to **Class / Grade** (e.g., *Grade 7-A*, *Kindergarten Blue*).
   * Guardian Full Name, Primary Phone Number, and Email.
3. System assigns an official Student ID (`STU-00512`).

### 7.2 Weekly Timetable Master Grid
1. Navigate to **Timetable**.
2. Select the target Class.
3. Build the weekly schedule across periods (Period 1 through 8, Monday to Saturday).
4. Assign Subject and Subject Teacher.
5. **Teacher Conflict Guard:** The system will reject any timetable entry where a teacher is assigned to two different classrooms during the same period.

### 7.3 Daily Attendance Register
1. Teachers or administrators open **Attendance**.
2. Select Class and Date (defaults to today).
3. The student roll call appears.
4. Mark statuses with a single tap:
   * `Present (P)`
   * `Late (L)`
   * `Absent (A)`
   * `Excused (E)`
5. Click **Submit Attendance**.
   * Absences immediately update the student's academic profile.
   * Optional automated Telegram/SMS alert notifications are dispatched to guardians of absent students.

### 7.4 Gradebook & Bulk Assessment Score Entry
1. Open **Grades**.
2. Select Class, Subject (e.g., *Mathematics*), and Assessment Component (e.g., *Mid-Term Exam (30%)*, *Quiz 1 (10%)*, *Final Exam (60%)*).
3. **Bulk Scoring Matrix:**
   * Enter scores directly down the student roster list.
   * **Data Validation:** The system prevents user error by blocking any entry greater than the configured maximum mark for that test.
4. Click **Save Gradebook**.

### 7.5 Automated Report Cards (Grades, Attendance, Class Rank)
1. Go to **Report Cards**.
2. Select Class and Academic Term.
3. Click **Compute Term Results**.
4. The system executes automated processing:
   * Sums weighted assessment scores per subject.
   * Calculates subject letter grades ($A, B, C, D, F$).
   * Computes overall term average and GPA.
   * Pulls total term attendance percentages.
   * **Calculates Class Rank:** Automatically sorts all students in the class from 1st place to last place based on cumulative average.
5. Click **Print All Report Cards** to batch-print official, branded report cards formatted for parent distribution.

### 7.6 Term Fee Billing & Defaulter Tracking
1. Under **Fees**, configure the fee structure for the academic year (e.g., *Term 1 Tuition*, *Registration Fee*, *Bus Transport*).
2. **Assign Fees:** Apply the fee structure across the entire school, to a specific grade, or to individual students.
3. **Collecting Fees:**
   * When a parent pays, click **Record Fee Payment**.
   * Supports partial payments with running balances.
   * System prints a formal fee receipt voucher.
4. **Defaulters Report:** One-click filter that isolates all students with overdue fee balances, their guardian contact numbers, and total outstanding school revenue.

### 7.7 Annual Promotion & Graduation Engine
At the conclusion of the academic year:
1. Open **Classes -> Academic Year Roll-over**.
2. Select the completed class (e.g., *Grade 8*).
3. Review students who passed based on their cumulative report cards.
4. Select **Promote Class** $\rightarrow$ choose target class (*Grade 9*).
5. All students and their historical academic records are promoted in a single batch operation. Graduating classes are archived as Alumni.

---

## 8. Marketing, Campaigns & Telegram Bot

### 8.1 Contact Management & Dynamic Audience Segmentation
AFRO Suite includes a native multi-channel marketing engine:
* **Contacts:** Maintain a clean contact directory of customers, patients, or guardians.
  * Import contacts via Excel/CSV spreadsheet.
  * Fields include: Name, Mobile Phone, Email, City, Customer Segment.
* **Audiences:**
  * **Static Audiences:** Hand-picked groups (e.g., *VIP Wholesale Customers*).
  * **Dynamic Audiences:** Rule-based segments that update automatically (e.g., *"All customers with unpaid credit > 1,000 ETB"* or *"All guardians of Grade 10 students"*).

### 8.2 Template Design with Dynamic Merge Tags
Create reusable communication templates under **Templates**:
* Supported merge tags:
  * `{{first_name}}`: Customer's first name.
  * `{{full_name}}`: Full registered name.
  * `{{business_name}}`: Your company name.
  * `{{balance}}`: Outstanding balance owed.
* *Example SMS Template:*
  > *"Dear {{first_name}}, your prescription at {{business_name}} is ready for pickup. Thank you for choosing us!"*

### 8.3 Multi-Channel Dispatch (Ethio Telecom SMPP SMS & Resend Email)
1. Go to **Campaigns -> + New Campaign**.
2. Select target **Audience**.
3. Choose communication channel:
   * **SMS:** Sent directly through Ethio Telecom SMPP gateway for reliable delivery on Ethiopian mobile networks.
   * **Email:** High-deliverability HTML email via Resend with open and click tracking.
4. Select your pre-approved Template.
5. Click **Send Now** (or schedule for a future date/time).

### 8.4 Delivery Webhooks & Analytics
* Once dispatched, background workers (BullMQ) queue and distribute messages with automatic exponential backoff retries.
* Monitor real-time performance on the **Campaign Analytics Dashboard**:
  * **Total Sent**
  * **Delivered %**
  * **Failed / Bounced %**
  * **Opt-Outs / Unsubscribed** (The system automatically suppresses unsubscribed contacts to maintain carrier compliance).

### 8.5 Connecting Your Business Telegram Bot
Every AFRO Suite company can link its own private Telegram Bot in under 3 minutes:

```
Step 1: Open Telegram & search @BotFather
                    │
Step 2: Send /newbot and choose bot name
                    │
Step 3: Copy the HTTP API Token
                    │
Step 4: Paste Token into AFRO Suite Settings -> Telegram Bot
                    │
Result: Bot is live with automated alerts & Mini App!
```

1. Open Telegram and start a chat with [@BotFather](https://t.me/BotFather).
2. Type `/newbot` and follow the prompts to name your bot (e.g., `MetroPharmacy_Bot`).
3. BotFather will provide an **HTTP API Token** (e.g., `7123456789:AAF-abcdef...`).
4. Copy this token, open your AFRO Suite workspace, and navigate to **Settings -> Telegram Integration**.
5. Paste the token and click **Connect Bot**.
6. The system verifies the webhook with Telegram servers and activates the bot immediately.

### 8.6 Staff Telegram Commands & Telegram Mini App Access
Once connected, authorized staff can interact with your company bot directly inside Telegram:
* **/today:** Returns live summary of today's gross revenue, transaction counts, and cash drawer status.
* **/lowstock:** Displays a list of all products currently below reorder threshold.
* **/expiring:** Lists batches expiring within the next 30 days.
* **/shift:** Displays who is currently logged into the active cash register shift.
* **Telegram Mini App:** Tapping the bot's bottom-left **Menu / Open App** button launches the entire AFRO Suite interface inside Telegram with automatic secure token authentication—no password re-entry required.

---

## 9. Subscription, Billing & Platform Support

### 9.1 Trial Period Details (45-Day Full Feature Trial)
* Every new company begins on a **45-day free trial**.
* All enterprise features are unlocked from Day 1—no credit card required.
* The header displays the remaining trial days countdown.
* If a trial expires, your data remains secure and intact; simply choose a subscription plan to resume full operations.

### 9.2 Plan Selection & Payment Method
1. Navigate to **Settings -> Subscription & Plan**.
2. Select your billing frequency:
   * **Monthly Plan**
   * **Semi-Annual Plan (Save 15%)**
   * **Annual Enterprise Plan (Save 25%)**
3. Choose a **Payment method** — the platform supports **Chapa** (cards, wallets), **Telebirr**, **M-Pesa (Safaricom)** and **CBE Birr / manual bank transfer**. Only the methods currently enabled by AFRO-TECH are shown.
4. Click **Subscribe**.
   * *Chapa / Telebirr / M-Pesa:* you are redirected to the provider's secure checkout page; completion returns you here and activates your plan within seconds.
   * *CBE Birr / manual transfer:* transfer the amount quoting the payment reference shown; AFRO-TECH confirms the transfer and your workspace activates automatically.
5. Upon successful payment verification, your workspace is extended automatically and an official tax invoice is generated.

### 9.3 Getting Technical Support
If your team requires assistance, reach our technical support desk through:
* **Phone / WhatsApp Support:** `+251-910-011-818`
* **Official Support Email:** `yonasmindaye04@gmail.com`
* **Headquarters:** Addis Ababa, Ethiopia
* **Support Operating Hours:** Monday – Saturday, 8:00 AM – 8:00 PM (East Africa Time)

---

## 10. Troubleshooting & Frequently Asked Questions (FAQ)

### 10.1 POS & Hardware Troubleshooting

#### Problem: Barcode scanner does not input numbers or add products to cart.
* **Solution 1:** Test the scanner outside the browser. Open Notepad on your PC and scan a barcode. If no text appears, check the USB cable or recharge the scanner battery.
* **Solution 2:** Ensure your scanner is programmed with a **Carriage Return (Enter)** suffix. Scan the "Add Enter Suffix" barcode in your scanner's user booklet.
* **Solution 3:** Check if the product has a barcode registered in the catalog. Open **Products**, search the item, and verify the `Barcode` field.
* **Solution 4:** If the product is out of stock, the POS will show a red error notification `"[Product Name]" is out of stock`. Receive new stock under **Purchases** first.

#### Problem: Thermal receipt prints blank paper or garbled characters.
* **Solution 1:** If the paper comes out completely blank, the paper roll is inserted upside down. Thermal paper is heat-sensitive on only one side; flip the roll over.
* **Solution 2:** If characters appear unformatted, check your browser print preview margins. Set **Margins: None** and disable "Headers and Footers".

---

### 10.2 Inventory Diagnostics

#### Problem: The system blocks me from selling a product even though I see physical stock on the shelf.
* **Explanation:** The batch on your shelf has passed its expiration date. AFRO Suite enforces strict patient and consumer safety by blocking expired inventory from POS checkout.
* **Resolution:** Check **Expiry Tracking**. If the medicine has expired, execute an expired stock write-off and dispose of the product. If the expiry date was entered incorrectly during receiving, an Admin can edit the batch expiry date under **Purchases -> Batches**.

#### Problem: Physical count does not match the system stock number.
* **Resolution:** Open **Stock Adjustments**, conduct an inventory audit count, enter the real shelf quantity with a mandatory audit reason (e.g., *Physical Count Reconciliation*), and submit. The system will log the discrepancy in your financial loss ledger and realign your stock numbers.

---

### 10.3 Financial & Cash Drawer Questions

#### Problem: At shift closing, the cash register shows a "Cash Short" discrepancy.
* **Explanation:** A negative variance indicates less physical cash was counted in the drawer than the mathematical formula (`Opening Float + Cash Sales - Expenses - Refunds`).
* **Common Causes:**
  1. Petty cash was taken from the drawer during the day without recording an expense voucher.
  2. Change was miscalculated and overpaid to a customer.
  3. A customer paid via Telebirr/Card, but the cashier accidentally selected "Cash" during checkout.
* **Resolution:** Review the shift transaction log before finalizing. If an unrecorded expense occurred, add the expense record. The system records the shortage in the cashier's permanent audit history for supervisory review.

---

### 10.4 Staff & Security Inquiries

#### Problem: A cashier forgot their login password.
* **Resolution:** The business **Owner** or **Admin** can navigate to the **Team** menu, locate the employee, click **Reset Password**, enter a new temporary password, and provide it to the staff member.

#### Problem: Can a cashier see our wholesale purchase costs or daily store profits?
* **Answer:** No. Cashier accounts are restricted by role-based security. Cashiers can only view sales counters, retail selling prices, and their own current shift balances. Supplier acquisition costs, profit margins, and executive P&L statements are strictly restricted to Owner and Admin accounts.

---

*© 2026 AFRO-TECH Solutions. All rights reserved. Document version 2.4. Generated for customer deployment.*
