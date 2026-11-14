import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

/* ── In-Memory Multi-Tenant Store (for AI Studio container runtime) ── */
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 45);
const tenants = new Map();
const users = new Map();
const sessions = new Map();
const tenantData = new Map();
const auditLogs = [];

function recordAudit(tenantName, userName, action, entity, details = null) {
  auditLogs.unshift({
    id: `aud-${crypto.randomUUID().slice(0, 8)}`,
    tenant_name: tenantName || null,
    user_name: userName || null,
    action,
    entity,
    details,
    created_at: new Date().toISOString(),
  });
  if (auditLogs.length > 200) auditLogs.length = 200;
}

const DEFAULT_COA = [
  { code: '1110', name: 'Cash on Hand', root_type: 'Asset', account_type: 'Cash', balance: 45000 },
  { code: '1120', name: 'CBE / Bank Account', root_type: 'Asset', account_type: 'Bank', balance: 120000 },
  { code: '1210', name: 'Accounts Receivable', root_type: 'Asset', account_type: 'Receivable', balance: 1450 },
  { code: '1410', name: 'Inventory Stock Asset', root_type: 'Asset', account_type: 'Stock', balance: 15320 },
  { code: '2110', name: 'Accounts Payable', root_type: 'Liability', account_type: 'Payable', balance: 0 },
  { code: '2210', name: 'Payroll & Tax Payable', root_type: 'Liability', account_type: 'Tax', balance: 0 },
  { code: '3100', name: 'Owner Equity / Capital', root_type: 'Equity', account_type: 'Equity', balance: 180320 },
  { code: '4100', name: 'Sales & Service Revenue', root_type: 'Income', account_type: 'Income', balance: 1260 },
  { code: '5100', name: 'Cost of Goods Sold', root_type: 'Expense', account_type: 'Expense', balance: 850 },
  { code: '5200', name: 'Operating & Admin Expenses', root_type: 'Expense', account_type: 'Expense', balance: 2400 },
];

function appendGlEntry(store, { voucher_type, voucher_no, account_code, debit = 0, credit = 0, party = null, remarks = '' }) {
  const acct = store.accounts.find((a) => a.code === account_code) || store.accounts[0];
  if (!acct) return;
  const d = Number(debit || 0);
  const c = Number(credit || 0);
  if (acct.root_type === 'Asset' || acct.root_type === 'Expense') {
    acct.balance = Number((Number(acct.balance) + d - c).toFixed(2));
  } else {
    acct.balance = Number((Number(acct.balance) + c - d).toFixed(2));
  }
  store.glEntries.unshift({
    id: `gl-${crypto.randomUUID().slice(0, 8)}`,
    posting_date: new Date().toISOString().slice(0, 10),
    voucher_type,
    voucher_no,
    account_code: acct.code,
    account_name: acct.name,
    root_type: acct.root_type,
    party,
    debit: d,
    credit: c,
    remarks,
    created_at: new Date().toISOString(),
  });
}

function appendStockLedger(store, { voucher_type, voucher_no, product, warehouse_id, warehouse_name, qty_change, rate, batch_no = null }) {
  const whName = warehouse_name || store.warehouses.find((w) => w.id === warehouse_id)?.name || 'Main Store';
  store.stockLedger.unshift({
    id: `sle-${crypto.randomUUID().slice(0, 8)}`,
    posting_date: new Date().toISOString(),
    voucher_type,
    voucher_no,
    product_id: product.id,
    product_name: product.name,
    warehouse_id: warehouse_id || store.warehouses[0]?.id || 'wh-1',
    warehouse_name: whName,
    batch_no,
    in_qty: qty_change > 0 ? qty_change : 0,
    out_qty: qty_change < 0 ? Math.abs(qty_change) : 0,
    balance_qty: Number(product.stock || 0),
    valuation_rate: Number(rate ?? product.cost_price ?? 0),
  });
}

function syncProductStock(prod, deltaUnits) {
  if (!prod) return;
  const nextUnits = Math.max(0, Number(prod.stock || 0) + Number(deltaUnits || 0));
  prod.stock = nextUnits;
  prod.sellable_stock = nextUnits;
  prod.display_stock = prod.sell_by_pill ? nextUnits * Math.max(1, Number(prod.pills_per_unit || 1)) : nextUnits;
}

function ensureTenantStore(tenantId, businessType = 'pharmacy', tenantName = 'Workspace') {
  if (!tenantData.has(tenantId)) {
    const today = new Date().toISOString().slice(0, 10);
    const in25Days = new Date(Date.now() + 25 * 86400000).toISOString().slice(0, 10);
    const in180Days = new Date(Date.now() + 180 * 86400000).toISOString().slice(0, 10);

    const trend = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.now() - (13 - i) * 86400000);
      return {
        day: d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }),
        revenue: 12500 + ((i * 3700) % 18000),
        pct: 88 + (i % 10),
      };
    });

    const initialProducts = [
      {
        id: 'prod-1',
        name: businessType === 'pharmacy' ? 'Amoxicillin 500mg Capsule' : 'Ethiopian Yirgacheffe Coffee 500g',
        category: businessType === 'pharmacy' ? 'Antibiotics' : 'Beverages',
        unit: businessType === 'pharmacy' ? 'box' : 'pcs',
        sell_price: '420',
        cost_price: '310',
        low_stock_threshold: 10,
        barcode: '6001234567890',
        sell_by_pill: businessType === 'pharmacy',
        pills_per_unit: businessType === 'pharmacy' ? 20 : 1,
        default_margin: '35',
        stock: 48,
        sellable_stock: 48,
        expired_qty: 0,
        display_stock: businessType === 'pharmacy' ? 960 : 48,
        expiring_soon: 12,
      },
      {
        id: 'prod-2',
        name: businessType === 'pharmacy' ? 'Paracetamol 500mg Tablet' : 'Handwoven Habesha Kemis Set',
        category: businessType === 'pharmacy' ? 'Analgesics' : 'Apparel',
        unit: businessType === 'pharmacy' ? 'strip' : 'pcs',
        sell_price: '85',
        cost_price: '55',
        low_stock_threshold: 15,
        barcode: '6001234567891',
        sell_by_pill: false,
        pills_per_unit: 1,
        default_margin: '35',
        stock: 8,
        sellable_stock: 8,
        expired_qty: 0,
        display_stock: 8,
        expiring_soon: 0,
      },
    ];

    const initialBatches = [
      {
        id: 'bat-1',
        product_id: 'prod-1',
        product_name: initialProducts[0].name,
        category: initialProducts[0].category,
        batch_no: 'AMX-2026-A',
        expiry_date: in180Days,
        quantity: 36,
        cost_price: '310',
        created_at: new Date(Date.now() - 86400000 * 10).toISOString(),
      },
      {
        id: 'bat-2',
        product_id: 'prod-1',
        product_name: initialProducts[0].name,
        category: initialProducts[0].category,
        batch_no: 'AMX-2025-EXP',
        expiry_date: in25Days,
        quantity: 12,
        cost_price: '310',
        created_at: new Date(Date.now() - 86400000 * 60).toISOString(),
      },
    ];

    const warehouses = [
      { id: 'wh-1', name: 'Main Store', code: 'MAIN', location: 'Ground Floor', is_default: true, stock_map: { 'prod-1': 36, 'prod-2': 8 } },
      { id: 'wh-2', name: businessType === 'pharmacy' ? 'Dispensary Counter' : 'Showroom Floor', code: 'FRONT', location: 'Front Desk', is_default: false, stock_map: { 'prod-1': 12, 'prod-2': 0 } },
    ];

    const storeObj = {
      settings: {
        business_name: tenantName,
        currency: 'ETB',
        tax_rate: 15,
        margin_presets: '20,25,30',
        auto_print_receipt: false,
        receipt_header: 'Thank you for choosing us!',
        receipt_footer: 'Please keep your receipt.',
        academic_year: '2025/2026',
      },
      products: initialProducts,
      batches: initialBatches,
      warehouses,
      stockLedger: [
        {
          id: 'sle-seed-1',
          posting_date: new Date(Date.now() - 7200_000).toISOString(),
          voucher_type: 'Opening Stock',
          voucher_no: 'OPN-0001',
          product_id: 'prod-1',
          product_name: initialProducts[0].name,
          warehouse_id: 'wh-1',
          warehouse_name: 'Main Store',
          batch_no: 'AMX-2026-A',
          in_qty: 51,
          out_qty: 0,
          balance_qty: 51,
          valuation_rate: 310,
        },
        {
          id: 'sle-seed-2',
          posting_date: new Date(Date.now() - 3600_000).toISOString(),
          voucher_type: 'POS Sale',
          voucher_no: 'INV-1001',
          product_id: 'prod-1',
          product_name: initialProducts[0].name,
          warehouse_id: 'wh-1',
          warehouse_name: 'Main Store',
          batch_no: 'AMX-2026-A',
          in_qty: 0,
          out_qty: 3,
          balance_qty: 48,
          valuation_rate: 310,
        },
      ],
      sales: [
        {
          id: 'sale-1',
          invoice_no: 'INV-1001',
          subtotal: '1260',
          discount: '0',
          total: '1260',
          amount_paid: '1300',
          change_due: '40',
          status: 'completed',
          created_at: new Date(Date.now() - 3600_000).toISOString(),
          payment_method: 'cash',
          customer_id: null,
          customer_name: 'Walk-in',
          cashier: 'Yonas Mindaye',
          items: [{ product_id: 'prod-1', name: initialProducts[0].name, quantity: 3, unit_price: 420, line_total: 1260, subtotal: '1260' }],
        },
      ],
      returns: [],
      purchases: [
        {
          id: 'pur-1',
          total: '11160.00',
          paid_amount: '11160.00',
          discount: '0',
          tax: '0',
          notes: 'Initial stock batch',
          created_at: new Date(Date.now() - 86400000 * 3).toISOString(),
          supplier_id: 'sup-1',
          supplier_name: 'Addis Pharma Supply',
          received_by: 'Yonas Mindaye',
          item_count: 1,
          items: [{ product_id: 'prod-1', quantity: 36, unit_cost: 310, batch_no: 'AMX-2026-A', expiry_date: in180Days }],
        },
      ],
      supplierPayments: [],
      customerPayments: [],
      adjustments: [],
      suppliers: [
        { id: 'sup-1', name: 'Addis Pharma Supply', phone: '+251911223344', email: 'supply@addis.et', address: 'Bole Sub-city, Addis Ababa', payment_terms: 30, balance: '0', created_at: new Date().toISOString() },
      ],
      customers: [
        { id: 'cust-1', name: 'Abebe Bikila', phone: '+251922334455', email: 'abebe@example.com', balance: '1450', created_at: new Date().toISOString() },
      ],
      quotations: [
        {
          id: 'qt-1',
          number: 'QT-1001',
          customer_id: 'cust-1',
          customer_name: 'Abebe Bikila',
          valid_until: in25Days,
          status: 'sent',
          total: '2100.00',
          notes: 'Corporate wellness refill quote',
          items: [{ product_id: 'prod-1', product_name: initialProducts[0].name, quantity: 5, unit_price: 420 }],
          created_at: new Date(Date.now() - 86400000).toISOString(),
        },
      ],
      salesOrders: [],
      purchaseOrders: [
        {
          id: 'po-1',
          number: 'PO-1001',
          supplier_id: 'sup-1',
          supplier_name: 'Addis Pharma Supply',
          expected_date: in25Days,
          status: 'submitted',
          total: '2750.00',
          notes: 'Monthly replenishment order',
          items: [{ product_id: 'prod-2', product_name: initialProducts[1].name, quantity: 50, unit_cost: 55 }],
          created_at: new Date(Date.now() - 43200000).toISOString(),
        },
      ],
      materialRequests: [],
      accounts: DEFAULT_COA.map((a) => ({ ...a })),
      glEntries: [
        {
          id: 'gl-seed-1',
          posting_date: today,
          voucher_type: 'POS Sale',
          voucher_no: 'INV-1001',
          account_code: '1110',
          account_name: 'Cash on Hand',
          root_type: 'Asset',
          party: 'Walk-in',
          debit: 1260,
          credit: 0,
          remarks: 'POS Sale INV-1001',
          created_at: new Date(Date.now() - 3600_000).toISOString(),
        },
        {
          id: 'gl-seed-2',
          posting_date: today,
          voucher_type: 'POS Sale',
          voucher_no: 'INV-1001',
          account_code: '4100',
          account_name: 'Sales & Service Revenue',
          root_type: 'Income',
          party: 'Walk-in',
          debit: 0,
          credit: 1260,
          remarks: 'POS Sale INV-1001',
          created_at: new Date(Date.now() - 3600_000).toISOString(),
        },
      ],
      journalEntries: [],
      leads: [
        {
          id: 'lead-1',
          name: 'Selamawit Tadesse',
          organization: 'Kazanchis Clinic',
          email: 'selam@kazanchis.et',
          phone: '+251911445566',
          source: 'Referral',
          stage: 'qualified',
          expected_value: 18500,
          follow_up_date: in25Days,
          notes: 'Requested monthly bulk supply quote',
          created_at: new Date().toISOString(),
        },
      ],
      expenses: [
        {
          id: 'exp-1',
          category: 'Utilities',
          description: 'Monthly fiber internet',
          amount: '2400',
          spent_at: today,
          expense_date: today,
          receipt_url: null,
          is_recurring: true,
          recurrence: 'monthly',
          status: 'approved',
          recorded_by_name: 'Yonas Mindaye',
          created_at: new Date().toISOString(),
        },
      ],
      income: [],
      shift: null,
      shifts: [],
      patients: [
        { id: 'pat-1', code: 'PT-1001', first_name: 'Meron', last_name: 'Alemu', gender: 'female', phone: '+251911001122', blood_type: 'O+', allergies: null, created_at: new Date().toISOString() },
      ],
      appointments: [
        { id: 'apt-1', scheduled_at: new Date().toISOString(), patient_id: 'pat-1', patient_name: 'Meron Alemu', patient_code: 'PT-1001', doctor_id: 'doc-1', doctor_name: 'Dr. Dawit Bekele', reason: 'General Consultation', status: 'scheduled' },
      ],
      doctors: [
        { id: 'doc-1', full_name: 'Dr. Dawit Bekele', specialty: 'General Practice', phone: '+251911998877', consultation_fee: '500', is_active: true },
      ],
      records: [],
      labs: [],
      invoices: [
        { id: 'inv-1', number: 'MED-1001', patient_id: 'pat-1', patient_name: 'Meron Alemu', description: 'General Consultation', amount: '500', paid_amount: '500', status: 'paid', issued_on: today },
      ],
      departments: [
        { id: 'dept-1', name: 'Reception / Triage', type: 'triage' },
        { id: 'dept-2', name: 'General OPD', type: 'consultation' },
        { id: 'dept-3', name: 'Laboratory', type: 'lab' },
        { id: 'dept-4', name: 'Pharmacy & Billing', type: 'billing' },
      ],
      visits: [],
      orders: [],
      students: [
        { id: 'stu-1', code: 'ST-2001', first_name: 'Kidus', last_name: 'Yohannes', gender: 'male', class_id: 'cls-1', class_name: 'Grade 10 - A', created_at: new Date().toISOString() },
      ],
      classes: [
        { id: 'cls-1', name: 'Grade 10 - A', grade_level: '10', teacher_name: 'Mr. Solomon', student_count: 1 },
      ],
      teachers: [
        { id: 'tch-1', full_name: 'Mr. Solomon', email: 'solomon@school.et', phone: '+251911556677', subject: 'Mathematics' },
      ],
      subjects: [
        { id: 'sub-1', name: 'Mathematics' },
        { id: 'sub-2', name: 'English' },
      ],
      fees: [
        { id: 'fee-1', title: 'Term 1 Tuition', amount: '4500', paid_amount: '4500', due_date: today, status: 'paid', paid_at: new Date().toISOString(), student_id: 'stu-1', student_name: 'Kidus Yohannes', student_code: 'ST-2001', class_name: 'Grade 10 - A', created_at: new Date().toISOString() },
      ],
      grades: [],
      attendance: {},
      timetable: [],
      announcements: [],
      expectations: [],
      teachingSessions: [],
      teachingActivities: [],
      payrollRuns: [],
      marketingContacts: [],
      marketingAudiences: [],
      marketingTemplates: [],
      marketingCampaigns: [],
      tenantBot: null,
      botSubscribers: [],
      botBroadcasts: [],
      botReceipts: [],
      trend,
    };
    tenantData.set(tenantId, storeObj);
  }
  return tenantData.get(tenantId);
}

// Seed default demo account
const demoTenantId = 'tenant-demo-1';
const demoTrialEnds = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
tenants.set(demoTenantId, {
  id: demoTenantId,
  name: 'Bole Medhanealem Pharmacy',
  slug: 'bole-medhanealem-pharmacy',
  business_type: 'pharmacy',
  status: 'trial',
  trial_ends_at: demoTrialEnds,
  trial_days_left: TRIAL_DAYS,
  owner_id: 'user-demo-1',
  owner_name: 'Yonas Mindaye',
  owner_email: 'demo@afrotech.et',
  created_at: new Date().toISOString(),
});
users.set('demo@afrotech.et', {
  id: 'user-demo-1',
  email: 'demo@afrotech.et',
  password: 'password123',
  full_name: 'Yonas Mindaye',
  role: 'owner',
  is_active: true,
  tenant_id: demoTenantId,
  created_at: new Date().toISOString(),
  profile_values: { BASE_SALARY: 18000, TRANSPORT_ALLOW: 1200, HOUSING_ALLOW: 2000 },
});
ensureTenantStore(demoTenantId, 'pharmacy', 'Bole Medhanealem Pharmacy');

function buildMe(user) {
  const tenant = user.tenant_id ? tenants.get(user.tenant_id) || null : null;
  return {
    id: user.id,
    email: user.email,
    full_name: user.full_name,
    role: user.role,
    tenant_id: user.tenant_id,
    tenant,
    permissions: ['*'],
    job_roles: [user.role === 'owner' ? 'Owner' : 'Staff'],
  };
}

function getAuthUser(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return null;
  const email = sessions.get(token);
  if (!email) return null;
  return users.get(email) || null;
}

function activeCtx(req, fallbackType = 'pharmacy') {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const tenant = tenants.get(user.tenant_id);
  const store = ensureTenantStore(user.tenant_id, tenant?.business_type || fallbackType, tenant?.name || 'Workspace');
  return { user, tenant, store };
}

/* ── Health & Contact Endpoints ────────────────────────────── */
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'afro-suite', time: new Date().toISOString() });
});

app.post('/api/contact', async (req, res) => {
  const { name, email, phone, message } = req.body ?? {};
  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res.status(400).json({ ok: false, success: false, message: 'Name, email and message are required.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ ok: false, success: false, message: 'Invalid email address.' });
  }

  const EMAIL = (process.env.EMAIL || process.env.CONTACT_USER || '').trim();
  const EMAIL_PASS = (process.env.EMAIL_PASS || process.env.CONTACT_PASS || '').replace(/\s+/g, '');

  if (EMAIL && EMAIL_PASS) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: EMAIL, pass: EMAIL_PASS },
      });
      await transporter.sendMail({
        from: `"AFRO-TECH" <${EMAIL}>`,
        to: process.env.CONTACT_EMAIL || EMAIL,
        replyTo: email,
        subject: `New Inquiry from ${name.trim()}`,
        text: `Name: ${name}\nEmail: ${email}\nPhone: ${phone || 'Not provided'}\n\n${message}`,
      });
    } catch (err) {
      console.warn('[contact] SMTP send skipped:', err instanceof Error ? err.message : err);
    }
  }

  return res.json({ ok: true, success: true });
});

/* ── Auth (/api/v1/auth/*) ─────────────────────────────────── */
app.get('/api/v1/auth/providers', (_req, res) => {
  res.json({
    google: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    telegram_bot: process.env.TELEGRAM_BOT_USERNAME ? process.env.TELEGRAM_BOT_USERNAME.replace(/^@/, '') : null,
  });
});

app.post('/api/v1/auth/register', (req, res) => {
  const { company_name, business_type = 'pharmacy', owner_name, email, password } = req.body ?? {};
  if (!company_name?.trim() || !owner_name?.trim() || !email?.trim() || !password || password.length < 8) {
    return res.status(400).json({ error: 'Please complete all fields (password min 8 chars)', code: 'VALIDATION_ERROR' });
  }
  const cleanEmail = String(email).trim().toLowerCase();
  if (users.has(cleanEmail)) {
    return res.status(409).json({ error: 'An account with this email already exists', code: 'EMAIL_TAKEN' });
  }
  const tenantId = `tenant-${crypto.randomUUID().slice(0, 8)}`;
  const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
  const slug = company_name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
  const trialEnds = new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString();
  const tenant = {
    id: tenantId,
    name: company_name.trim(),
    slug,
    business_type,
    status: 'trial',
    trial_ends_at: trialEnds,
    trial_days_left: TRIAL_DAYS,
    owner_id: userId,
    owner_name: owner_name.trim(),
    owner_email: cleanEmail,
    created_at: new Date().toISOString(),
  };
  tenants.set(tenantId, tenant);
  ensureTenantStore(tenantId, business_type, tenant.name);

  const user = {
    id: userId,
    email: cleanEmail,
    password: String(password),
    full_name: owner_name.trim(),
    role: 'owner',
    is_active: true,
    tenant_id: tenantId,
    created_at: new Date().toISOString(),
    profile_values: { BASE_SALARY: 0, TRANSPORT_ALLOW: 0, HOUSING_ALLOW: 0 },
  };
  users.set(cleanEmail, user);
  const token = `tok_${crypto.randomUUID()}`;
  sessions.set(token, cleanEmail);
  recordAudit(tenant.name, user.full_name, 'tenant.register', 'tenant', { business_type });

  return res.status(201).json({ token, me: buildMe(user) });
});

app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = users.get(cleanEmail);
  if (!user || user.password !== String(password || '')) {
    return res.status(401).json({ error: 'Incorrect email or password', code: 'BAD_CREDENTIALS' });
  }
  if (!user.is_active) {
    return res.status(403).json({ error: 'This account is disabled. Contact your workspace owner.', code: 'DISABLED' });
  }
  const token = `tok_${crypto.randomUUID()}`;
  sessions.set(token, cleanEmail);
  return res.json({ token, me: buildMe(user) });
});

app.get('/api/v1/auth/me', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized', code: 'UNAUTHORIZED' });
  const header = req.headers.authorization || '';
  const token = header.slice(7).trim();
  return res.json({ token, me: buildMe(user) });
});

app.post('/api/v1/auth/change-password', (req, res) => {
  const user = getAuthUser(req);
  if (!user) return res.status(401).json({ error: 'Unauthorized' });
  const { current_password, new_password } = req.body ?? {};
  if (user.password !== String(current_password || '')) {
    return res.status(400).json({ error: 'Current password is incorrect' });
  }
  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  user.password = String(new_password);
  return res.json({ ok: true });
});

/* ── Tenant & Settings ─────────────────────────────────────── */
app.patch('/api/v1/tenant', (req, res) => {
  const { tenant } = activeCtx(req);
  if (tenant && req.body?.name) {
    tenant.name = String(req.body.name).trim();
  }
  res.json({ tenant });
});

app.get('/api/v1/tenant/settings', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ settings: store.settings });
});

app.put('/api/v1/tenant/settings', (req, res) => {
  const { store } = activeCtx(req);
  store.settings = { ...store.settings, ...(req.body ?? {}) };
  res.json({ settings: store.settings });
});

/* ── Retail / Pharmacy (/api/v1/retail/*) ──────────────────── */
function enrichBatch(b) {
  const now = Date.now();
  const expTs = b.expiry_date ? new Date(b.expiry_date).getTime() : null;
  const expired = expTs !== null && expTs < now;
  const expiring_soon = expTs !== null && !expired && expTs <= now + 90 * 86400000;
  return { ...b, expired, expiring_soon };
}

app.get('/api/v1/retail/dashboard', (req, res) => {
  const { store } = activeCtx(req);
  const completedSales = store.sales.filter((s) => s.status === 'completed');
  const totalSales = completedSales.reduce((acc, s) => acc + Number(s.total || 0), 0);
  const totalExpenses = store.expenses.reduce((acc, e) => acc + Number(e.amount || 0), 0);
  const lowStock = store.products
    .filter((p) => Number(p.stock) <= Number(p.low_stock_threshold))
    .map((p) => ({ name: p.name, stock: Number(p.stock), threshold: Number(p.low_stock_threshold) }));

  const expiringSoon = store.batches
    .map(enrichBatch)
    .filter((b) => b.quantity > 0 && (b.expired || b.expiring_soon))
    .slice(0, 6)
    .map((b) => ({
      name: b.product_name,
      batch_no: b.batch_no,
      expiry_date: b.expiry_date,
      quantity: b.quantity,
    }));

  res.json({
    today: { sales: totalSales, transactions: completedSales.length },
    month: { revenue: 184500 + totalSales, profit: 64200 + Math.round(totalSales * 0.3), expenses: totalExpenses },
    comparison: { this_month: 184500 + totalSales, last_month: 156000, change_pct: 18.3 },
    low_stock: lowStock,
    expiring_soon: expiringSoon,
    trend: store.trend.map(({ day, revenue }) => ({ day, revenue })),
    top_products: store.products.slice(0, 5).map((p, idx) => ({
      name: p.name,
      qty: 24 - idx * 5,
      revenue: (24 - idx * 5) * Number(p.sell_price || 100),
    })),
    recent_sales: store.sales.slice(0, 8),
  });
});

app.get('/api/v1/retail/reports', (req, res) => {
  const { store } = activeCtx(req);
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));
  const completedSales = store.sales.filter((s) => s.status === 'completed');
  const revenue = completedSales.reduce((a, s) => a + Number(s.total || 0), 0);
  const expenses = store.expenses.reduce((a, e) => a + Number(e.amount || 0), 0);
  const cogs = Math.round(revenue * 0.68);
  const gross_profit = revenue - cogs;
  const stock_value = store.products.reduce((a, p) => a + Number(p.cost_price || 0) * Number(p.stock || 0), 0);
  const retail_value = store.products.reduce((a, p) => a + Number(p.sell_price || 0) * Number(p.stock || 0), 0);
  const units = store.products.reduce((a, p) => a + Number(p.stock || 0), 0);

  const byMethodMap = {};
  for (const s of completedSales) {
    const m = s.payment_method || 'cash';
    if (!byMethodMap[m]) byMethodMap[m] = { method: m, total: 0, count: 0 };
    byMethodMap[m].total += Number(s.total || 0);
    byMethodMap[m].count += 1;
  }

  res.json({
    period: { from, to },
    pnl: {
      revenue,
      cogs,
      gross_profit,
      discounts: completedSales.reduce((a, s) => a + Number(s.discount || 0), 0),
      expenses,
      expenses_by_category: store.expenses.map((e) => ({ category: e.category, total: Number(e.amount || 0) })),
      net_profit: gross_profit - expenses,
      transactions: completedSales.length,
    },
    by_category: store.products.map((p) => ({ category: p.category, revenue: Number(p.sell_price) * 5, qty: 5 })),
    by_payment: Object.values(byMethodMap),
    top_products: store.products.map((p) => ({
      name: p.name,
      qty: 5,
      revenue: Number(p.sell_price) * 5,
      profit: (Number(p.sell_price) - Number(p.cost_price)) * 5,
    })),
    stock: {
      stock_value,
      retail_value,
      units,
      dead_stock: [],
      reorder: store.products
        .filter((p) => p.stock <= p.low_stock_threshold)
        .map((p) => ({
          name: p.name,
          stock: p.stock,
          threshold: p.low_stock_threshold,
          suggested: Math.max(10, p.low_stock_threshold * 2 - p.stock),
        })),
    },
  });
});

app.get('/api/v1/retail/products', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ products: store.products });
});

app.get('/api/v1/retail/products/barcode/:code', (req, res) => {
  const { store } = activeCtx(req);
  const product = store.products.find((p) => p.barcode === req.params.code);
  if (!product) return res.status(404).json({ error: 'No product matches this barcode' });
  return res.json({ product });
});

app.get('/api/v1/retail/products/:id/batches', (req, res) => {
  const { store } = activeCtx(req);
  const batches = store.batches.filter((b) => b.product_id === req.params.id && b.quantity > 0).map(enrichBatch);
  res.json({ batches });
});

app.post('/api/v1/retail/products', (req, res) => {
  const { store } = activeCtx(req);
  const b = req.body ?? {};
  const stock = Number(b.initial_stock ?? 0);
  const sellByPill = Boolean(b.sell_by_pill);
  const pillsPerUnit = Math.max(1, Number(b.pills_per_unit ?? 1));
  const product = {
    id: `prod-${crypto.randomUUID().slice(0, 8)}`,
    name: String(b.name || 'Unnamed Product').trim(),
    category: String(b.category || 'General').trim(),
    unit: String(b.unit || 'pcs').trim(),
    sell_price: String(b.sell_price ?? 0),
    cost_price: String(b.cost_price ?? 0),
    low_stock_threshold: Number(b.low_stock_threshold ?? 10),
    barcode: b.barcode || null,
    sell_by_pill: sellByPill,
    pills_per_unit: pillsPerUnit,
    default_margin: String(b.default_margin ?? 25),
    stock,
    sellable_stock: stock,
    expired_qty: 0,
    display_stock: sellByPill ? stock * pillsPerUnit : stock,
    expiring_soon: 0,
  };
  store.products.unshift(product);
  if (stock > 0) {
    const defWh = store.warehouses[0];
    if (defWh) defWh.stock_map[product.id] = stock;
    appendStockLedger(store, {
      voucher_type: 'Opening Stock',
      voucher_no: `OPN-${store.stockLedger.length + 1}`,
      product,
      warehouse_id: defWh?.id,
      qty_change: stock,
      rate: Number(product.cost_price || 0),
    });
  }
  res.status(201).json({ product });
});

app.patch('/api/v1/retail/products/:id', (req, res) => {
  const { store } = activeCtx(req);
  const idx = store.products.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Product not found' });
  const b = req.body ?? {};
  store.products[idx] = {
    ...store.products[idx],
    name: b.name !== undefined ? String(b.name).trim() : store.products[idx].name,
    category: b.category !== undefined ? String(b.category).trim() : store.products[idx].category,
    unit: b.unit !== undefined ? String(b.unit).trim() : store.products[idx].unit,
    sell_price: b.sell_price !== undefined ? String(b.sell_price) : store.products[idx].sell_price,
    cost_price: b.cost_price !== undefined ? String(b.cost_price) : store.products[idx].cost_price,
    low_stock_threshold: b.low_stock_threshold !== undefined ? Number(b.low_stock_threshold) : store.products[idx].low_stock_threshold,
    barcode: b.barcode !== undefined ? b.barcode : store.products[idx].barcode,
  };
  res.json({ product: store.products[idx] });
});

app.delete('/api/v1/retail/products/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.products = store.products.filter((p) => p.id !== req.params.id);
  res.json({ ok: true });
});

app.get('/api/v1/retail/sales', (req, res) => {
  const { store } = activeCtx(req);
  const from = req.query.from ? String(req.query.from) : '';
  const to = req.query.to ? String(req.query.to) : '';
  const filtered = store.sales.filter((s) => {
    const day = String(s.created_at || '').slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    return true;
  });
  res.json({ sales: filtered, total: filtered.length });
});

function createSaleInternal(store, user, b) {
  const rawItems = Array.isArray(b.items) ? b.items : [];
  const invoiceNo = `INV-${1001 + store.sales.length}`;
  const lineItems = rawItems.map((it) => {
    const prod = store.products.find((p) => p.id === it.product_id);
    const qty = Math.max(1, Number(it.quantity || 1));
    const soldAsPills = Boolean(it.sold_as_pills ?? prod?.sell_by_pill);
    let unitPrice = prod
      ? soldAsPills
        ? Number(prod.sell_price) / Math.max(1, prod.pills_per_unit)
        : Number(prod.sell_price)
      : Number(it.unit_price || 0);
    if (it.margin !== undefined && it.margin !== null && prod) {
      const baseCost = soldAsPills ? Number(prod.cost_price) / Math.max(1, prod.pills_per_unit) : Number(prod.cost_price);
      unitPrice = baseCost * (1 + Number(it.margin) / 100);
    }
    if (prod) {
      if (soldAsPills) {
        prod.display_stock = Math.max(0, Number(prod.display_stock || 0) - qty);
        prod.stock = Math.floor(prod.display_stock / Math.max(1, prod.pills_per_unit));
        prod.sellable_stock = prod.stock;
      } else {
        syncProductStock(prod, -qty);
      }
      const defWh = store.warehouses[0];
      if (defWh) defWh.stock_map[prod.id] = Math.max(0, Number(defWh.stock_map[prod.id] ?? prod.stock));
      appendStockLedger(store, {
        voucher_type: 'POS Sale',
        voucher_no: invoiceNo,
        product: prod,
        warehouse_id: defWh?.id,
        qty_change: soldAsPills ? -Math.ceil(qty / Math.max(1, prod.pills_per_unit)) : -qty,
        rate: Number(prod.cost_price || 0),
      });
    }
    const lineTotal = unitPrice * qty;
    return {
      product_id: it.product_id,
      name: prod?.name || it.name || 'Item',
      quantity: qty,
      unit_price: Number(unitPrice.toFixed(2)),
      line_total: Number(lineTotal.toFixed(2)),
      sold_as_pills: soldAsPills,
    };
  });

  const subtotal = lineItems.length ? lineItems.reduce((a, x) => a + x.line_total, 0) : Number(b.total ?? 0);
  const discount = Number(b.discount ?? 0);
  const total = Math.max(0, subtotal - discount);
  const paymentMethod = b.payment_method || 'cash';
  const amountPaid = b.amount_paid !== undefined ? Number(b.amount_paid) : paymentMethod === 'credit' ? 0 : total;
  const changeDue = Math.max(0, amountPaid - total);
  const customer = b.customer_id ? store.customers.find((c) => c.id === b.customer_id) : null;
  const due = Math.max(0, total - amountPaid);

  if (customer && due > 0) {
    customer.balance = (Number(customer.balance || 0) + due).toFixed(2);
  }

  const sale = {
    id: `sale-${crypto.randomUUID().slice(0, 8)}`,
    invoice_no: invoiceNo,
    subtotal: subtotal.toFixed(2),
    discount: discount.toFixed(2),
    total: total.toFixed(2),
    amount_paid: amountPaid.toFixed(2),
    change_due: changeDue.toFixed(2),
    status: 'completed',
    created_at: new Date().toISOString(),
    payment_method: paymentMethod,
    customer_id: customer?.id || b.customer_id || null,
    customer_name: customer?.name || b.customer_name || 'Walk-in',
    cashier: user.full_name,
    items: lineItems,
  };
  store.sales.unshift(sale);

  if (total > 0) {
    const assetAcct = paymentMethod === 'credit' && due > 0 ? '1210' : paymentMethod === 'bank' || paymentMethod === 'card' || paymentMethod === 'mobile' ? '1120' : '1110';
    appendGlEntry(store, {
      voucher_type: 'POS Sale',
      voucher_no: invoiceNo,
      account_code: assetAcct,
      debit: total,
      credit: 0,
      party: sale.customer_name,
      remarks: `Sale ${invoiceNo} (${paymentMethod})`,
    });
    appendGlEntry(store, {
      voucher_type: 'POS Sale',
      voucher_no: invoiceNo,
      account_code: '4100',
      debit: 0,
      credit: total,
      party: sale.customer_name,
      remarks: `Revenue ${invoiceNo}`,
    });
  }

  return { sale, items: lineItems };
}

app.post('/api/v1/retail/sales', (req, res) => {
  const { user, store } = activeCtx(req);
  const result = createSaleInternal(store, user, req.body ?? {});
  res.status(201).json(result);
});

app.get('/api/v1/retail/returns', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ returns: store.returns });
});

app.post('/api/v1/retail/sales/:id/returns', (req, res) => {
  const { user, store } = activeCtx(req);
  const sale = store.sales.find((s) => s.id === req.params.id);
  const qty = Math.max(1, Number(req.body?.quantity || 1));
  const reason = req.body?.reason || 'CustomerReturn';
  const isResalable = !['Damaged', 'Expired'].includes(reason);
  const item = (sale?.items ?? []).find((it) => it.product_id === req.body?.product_id) || sale?.items?.[0];
  const prod = store.products.find((p) => p.id === (req.body?.product_id || item?.product_id));
  const refundAmount = Number(item?.unit_price || prod?.sell_price || 0) * qty;

  if (prod && isResalable) {
    const soldAsPills = Boolean(req.body?.sold_as_pills ?? item?.sold_as_pills);
    if (soldAsPills) {
      prod.display_stock = Number(prod.display_stock || 0) + qty;
      prod.stock = Math.floor(prod.display_stock / Math.max(1, prod.pills_per_unit));
      prod.sellable_stock = prod.stock;
    } else {
      syncProductStock(prod, qty);
    }
    appendStockLedger(store, {
      voucher_type: 'Sales Return',
      voucher_no: sale?.invoice_no || req.params.id,
      product: prod,
      qty_change: qty,
      rate: Number(prod.cost_price || 0),
    });
  }

  const ret = {
    id: `ret-${crypto.randomUUID().slice(0, 8)}`,
    sale_id: req.params.id,
    quantity: qty,
    sold_as_pills: Boolean(req.body?.sold_as_pills),
    reason,
    refund_amount: refundAmount.toFixed(2),
    is_resalable: isResalable,
    created_at: new Date().toISOString(),
    product_name: item?.name || prod?.name || 'Item',
    processed_by: user.full_name,
    invoice_no: sale?.invoice_no || null,
  };
  store.returns.unshift(ret);
  res.status(201).json({ return: ret });
});

app.post('/api/v1/retail/sales/:id/refund', (req, res) => {
  const { store } = activeCtx(req);
  const sale = store.sales.find((s) => s.id === req.params.id);
  if (sale && sale.status !== 'refunded') {
    sale.status = 'refunded';
    for (const it of sale.items ?? []) {
      const prod = store.products.find((p) => p.id === it.product_id);
      if (prod) {
        if (it.sold_as_pills) {
          prod.display_stock = Number(prod.display_stock || 0) + Number(it.quantity || 0);
          prod.stock = Math.floor(prod.display_stock / Math.max(1, prod.pills_per_unit));
          prod.sellable_stock = prod.stock;
        } else {
          syncProductStock(prod, Number(it.quantity || 0));
        }
        appendStockLedger(store, {
          voucher_type: 'Sale Refund',
          voucher_no: sale.invoice_no,
          product: prod,
          qty_change: Number(it.quantity || 0),
          rate: Number(prod.cost_price || 0),
        });
      }
    }
  }
  res.json({ ok: true, sale });
});

app.get('/api/v1/retail/purchases', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ purchases: store.purchases });
});

function createPurchaseInternal(store, user, b) {
  const items = Array.isArray(b.items)
    ? b.items
    : b.product_id
      ? [{ product_id: b.product_id, quantity: b.quantity, unit_cost: b.unit_cost, batch_no: b.batch_no, expiry_date: b.expiry_date }]
      : [];
  const supplier = b.supplier_id ? store.suppliers.find((s) => s.id === b.supplier_id) : null;
  const purchaseNo = `PUR-${1001 + store.purchases.length}`;
  let subtotal = 0;

  const normalizedItems = items.map((it) => {
    const prod = store.products.find((p) => p.id === it.product_id);
    const qty = Math.max(1, Number(it.quantity || 0));
    const unitCost = Number(it.unit_cost || prod?.cost_price || 0);
    subtotal += qty * unitCost;

    if (prod && qty > 0) {
      prod.cost_price = String(unitCost);
      syncProductStock(prod, qty);
      const defWh = store.warehouses[0];
      if (defWh) defWh.stock_map[prod.id] = Number(defWh.stock_map[prod.id] || 0) + qty;
      const batchNo = it.batch_no || `BAT-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}-${store.batches.length + 1}`;
      store.batches.unshift({
        id: `bat-${crypto.randomUUID().slice(0, 8)}`,
        product_id: prod.id,
        product_name: prod.name,
        category: prod.category,
        batch_no: batchNo,
        expiry_date: it.expiry_date || null,
        quantity: qty,
        cost_price: String(unitCost),
        created_at: new Date().toISOString(),
      });
      appendStockLedger(store, {
        voucher_type: 'Purchase Receipt',
        voucher_no: purchaseNo,
        product: prod,
        warehouse_id: defWh?.id,
        batch_no: batchNo,
        qty_change: qty,
        rate: unitCost,
      });
    }
    return {
      product_id: it.product_id,
      product_name: prod?.name || 'Product',
      quantity: qty,
      unit_cost: unitCost,
      batch_no: it.batch_no || null,
      expiry_date: it.expiry_date || null,
    };
  });

  const discount = Number(b.discount || 0);
  const tax = Number(b.tax || 0);
  const total = Math.max(0, subtotal - discount + tax);
  const paidAmount = b.paid_amount !== undefined ? Number(b.paid_amount) : total;
  const due = Math.max(0, total - paidAmount);

  if (supplier && due > 0) {
    supplier.balance = (Number(supplier.balance || 0) + due).toFixed(2);
  }

  const purchase = {
    id: `pur-${crypto.randomUUID().slice(0, 8)}`,
    purchase_no: purchaseNo,
    supplier_id: supplier?.id || b.supplier_id || null,
    supplier_name: supplier?.name || null,
    received_by: user.full_name,
    item_count: normalizedItems.length,
    total: total.toFixed(2),
    paid_amount: paidAmount.toFixed(2),
    discount: discount.toFixed(2),
    tax: tax.toFixed(2),
    notes: b.notes || null,
    items: normalizedItems,
    created_at: new Date().toISOString(),
  };
  store.purchases.unshift(purchase);

  if (total > 0) {
    appendGlEntry(store, {
      voucher_type: 'Purchase Receipt',
      voucher_no: purchaseNo,
      account_code: '1410',
      debit: total,
      credit: 0,
      party: supplier?.name || 'Supplier',
      remarks: `Stock received (${purchaseNo})`,
    });
    if (paidAmount > 0) {
      appendGlEntry(store, {
        voucher_type: 'Purchase Receipt',
        voucher_no: purchaseNo,
        account_code: '1110',
        debit: 0,
        credit: Math.min(paidAmount, total),
        party: supplier?.name || 'Supplier',
        remarks: `Cash paid for ${purchaseNo}`,
      });
    }
    if (due > 0) {
      appendGlEntry(store, {
        voucher_type: 'Purchase Receipt',
        voucher_no: purchaseNo,
        account_code: '2110',
        debit: 0,
        credit: due,
        party: supplier?.name || 'Supplier',
        remarks: `Payable for ${purchaseNo}`,
      });
    }
  }

  return purchase;
}

app.post('/api/v1/retail/purchases', (req, res) => {
  const { user, store } = activeCtx(req);
  const purchase = createPurchaseInternal(store, user, req.body ?? {});
  res.status(201).json({ purchase });
});

app.delete('/api/v1/retail/purchases/:id', (req, res) => {
  const { store } = activeCtx(req);
  const pur = store.purchases.find((p) => p.id === req.params.id);
  if (pur) {
    for (const it of pur.items ?? []) {
      const prod = store.products.find((p) => p.id === it.product_id);
      if (prod) {
        syncProductStock(prod, -Number(it.quantity || 0));
        appendStockLedger(store, {
          voucher_type: 'Purchase Reversal',
          voucher_no: pur.purchase_no || pur.id,
          product: prod,
          qty_change: -Number(it.quantity || 0),
          rate: Number(it.unit_cost || prod.cost_price || 0),
        });
      }
    }
    const due = Math.max(0, Number(pur.total || 0) - Number(pur.paid_amount || 0));
    if (pur.supplier_id && due > 0) {
      const sup = store.suppliers.find((s) => s.id === pur.supplier_id);
      if (sup) sup.balance = Math.max(0, Number(sup.balance || 0) - due).toFixed(2);
    }
  }
  store.purchases = store.purchases.filter((p) => p.id !== req.params.id);
  res.json({ ok: true });
});

app.get('/api/v1/retail/suppliers', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ suppliers: store.suppliers });
});

app.post('/api/v1/retail/suppliers', (req, res) => {
  const { store } = activeCtx(req);
  const sup = { id: `sup-${crypto.randomUUID().slice(0, 8)}`, ...req.body, balance: '0', created_at: new Date().toISOString() };
  store.suppliers.unshift(sup);
  res.status(201).json({ supplier: sup });
});

app.delete('/api/v1/retail/suppliers/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.suppliers = store.suppliers.filter((s) => s.id !== req.params.id);
  res.json({ ok: true });
});

app.post('/api/v1/retail/supplier-payments', (req, res) => {
  const { user, store } = activeCtx(req);
  const { supplier_id, amount, payment_method = 'cash', notes = null } = req.body ?? {};
  const sup = store.suppliers.find((s) => s.id === supplier_id);
  const amt = Math.max(0, Number(amount || 0));
  if (sup) {
    sup.balance = Math.max(0, Number(sup.balance || 0) - amt).toFixed(2);
  }
  const payment = {
    id: `sp-${crypto.randomUUID().slice(0, 8)}`,
    supplier_id,
    amount: amt.toFixed(2),
    payment_method,
    notes,
    recorded_by: user.full_name,
    created_at: new Date().toISOString(),
  };
  store.supplierPayments.unshift(payment);
  if (amt > 0) {
    const voucherNo = `PAY-${store.supplierPayments.length + 100}`;
    appendGlEntry(store, {
      voucher_type: 'Payment Entry',
      voucher_no: voucherNo,
      account_code: '2110',
      debit: amt,
      credit: 0,
      party: sup?.name || 'Supplier',
      remarks: notes || 'Supplier payment',
    });
    appendGlEntry(store, {
      voucher_type: 'Payment Entry',
      voucher_no: voucherNo,
      account_code: payment_method === 'cash' ? '1110' : '1120',
      debit: 0,
      credit: amt,
      party: sup?.name || 'Supplier',
      remarks: notes || 'Supplier payment',
    });
  }
  res.status(201).json({ payment, supplier: sup });
});

app.get('/api/v1/retail/customers', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ customers: store.customers });
});

app.post('/api/v1/retail/customers', (req, res) => {
  const { store } = activeCtx(req);
  const cust = { id: `cust-${crypto.randomUUID().slice(0, 8)}`, ...req.body, balance: '0', created_at: new Date().toISOString() };
  store.customers.unshift(cust);
  res.status(201).json({ customer: cust });
});

app.delete('/api/v1/retail/customers/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.customers = store.customers.filter((c) => c.id !== req.params.id);
  res.json({ ok: true });
});

app.get('/api/v1/retail/credit', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ customers: store.customers.filter((c) => Number(c.balance || 0) > 0) });
});

app.get('/api/v1/retail/customers/:id/statement', (req, res) => {
  const { store } = activeCtx(req);
  const customer = store.customers.find((c) => c.id === req.params.id) || { id: req.params.id, name: 'Customer', phone: null, balance: '0' };
  const creditSales = store.sales
    .filter((s) => s.customer_id === req.params.id && Number(s.total) > Number(s.amount_paid || 0))
    .map((s) => ({
      id: s.id,
      invoice_no: s.invoice_no,
      total: s.total,
      amount_paid: s.amount_paid,
      due: Math.max(0, Number(s.total) - Number(s.amount_paid || 0)).toFixed(2),
      created_at: s.created_at,
    }));
  const payments = store.customerPayments.filter((p) => p.customer_id === req.params.id);
  res.json({
    customer,
    credit_sales: creditSales,
    payments,
    balance: Number(customer.balance || 0),
  });
});

app.post('/api/v1/retail/customers/:id/payments', (req, res) => {
  const { user, store } = activeCtx(req);
  const cust = store.customers.find((c) => c.id === req.params.id);
  const amt = Math.max(0, Number(req.body?.amount || 0));
  if (cust) {
    cust.balance = Math.max(0, Number(cust.balance || 0) - amt).toFixed(2);
  }
  const payment = {
    id: `cp-${crypto.randomUUID().slice(0, 8)}`,
    customer_id: req.params.id,
    amount: amt.toFixed(2),
    note: req.body?.note || null,
    recorded_by: user.full_name,
    created_at: new Date().toISOString(),
  };
  store.customerPayments.unshift(payment);
  if (amt > 0) {
    const voucherNo = `RCP-${store.customerPayments.length + 100}`;
    appendGlEntry(store, {
      voucher_type: 'Payment Entry',
      voucher_no: voucherNo,
      account_code: '1110',
      debit: amt,
      credit: 0,
      party: cust?.name || 'Customer',
      remarks: req.body?.note || 'Credit collection',
    });
    appendGlEntry(store, {
      voucher_type: 'Payment Entry',
      voucher_no: voucherNo,
      account_code: '1210',
      debit: 0,
      credit: amt,
      party: cust?.name || 'Customer',
      remarks: req.body?.note || 'Credit collection',
    });
  }
  res.status(201).json({ payment, customer: cust });
});

app.get('/api/v1/retail/expiry', (req, res) => {
  const { store } = activeCtx(req);
  const days = Number(req.query.days || 90);
  const cutoff = Date.now() + days * 86400000;
  const batches = store.batches
    .filter((b) => b.quantity > 0 && b.expiry_date && new Date(b.expiry_date).getTime() <= cutoff)
    .map(enrichBatch);
  res.json({ batches });
});

app.post('/api/v1/retail/expiry/:id/write-off', (req, res) => {
  const { user, store } = activeCtx(req);
  const bat = store.batches.find((b) => b.id === req.params.id);
  if (!bat) return res.status(404).json({ error: 'Batch not found' });
  const qty = Number(bat.quantity || 0);
  const prod = store.products.find((p) => p.id === bat.product_id);
  if (prod && qty > 0) {
    syncProductStock(prod, -qty);
    appendStockLedger(store, {
      voucher_type: 'Expiry Write-off',
      voucher_no: bat.batch_no,
      product: prod,
      batch_no: bat.batch_no,
      qty_change: -qty,
      rate: Number(bat.cost_price || prod.cost_price || 0),
    });
    store.adjustments.unshift({
      id: `adj-${crypto.randomUUID().slice(0, 8)}`,
      product_id: prod.id,
      product_name: prod.name,
      delta: -qty,
      reason: req.body?.reason || `Expired batch ${bat.batch_no} written off`,
      recorded_by: user.full_name,
      created_at: new Date().toISOString(),
    });
  }
  bat.quantity = 0;
  res.json({ ok: true, batch: bat });
});

app.get('/api/v1/retail/adjustments', (req, res) => res.json({ adjustments: activeCtx(req).store.adjustments }));
app.post('/api/v1/retail/adjustments', (req, res) => {
  const { user, store } = activeCtx(req);
  const { product_id, batch_id, delta, reason } = req.body ?? {};
  const d = Number(delta || 0);
  const prod = store.products.find((p) => p.id === product_id);
  if (prod) {
    syncProductStock(prod, d);
    if (batch_id) {
      const bat = store.batches.find((b) => b.id === batch_id);
      if (bat) bat.quantity = Math.max(0, Number(bat.quantity || 0) + d);
    }
    appendStockLedger(store, {
      voucher_type: 'Stock Adjustment',
      voucher_no: `ADJ-${store.adjustments.length + 1}`,
      product: prod,
      qty_change: d,
      rate: Number(prod.cost_price || 0),
    });
  }
  const adj = {
    id: `adj-${crypto.randomUUID().slice(0, 8)}`,
    product_id,
    product_name: prod?.name || 'Product',
    delta: d,
    reason: reason || 'Manual adjustment',
    recorded_by: user.full_name,
    created_at: new Date().toISOString(),
  };
  store.adjustments.unshift(adj);
  res.status(201).json({ adjustment: adj });
});

app.get('/api/v1/retail/expenses', (req, res) => res.json({ expenses: activeCtx(req).store.expenses }));
app.post('/api/v1/retail/expenses', (req, res) => {
  const { user, store } = activeCtx(req);
  const exp = { id: `exp-${crypto.randomUUID().slice(0, 8)}`, ...req.body, status: 'approved', recorded_by_name: user.full_name, created_at: new Date().toISOString() };
  store.expenses.unshift(exp);
  res.status(201).json({ expense: exp });
});
app.delete('/api/v1/retail/expenses/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.expenses = store.expenses.filter((e) => e.id !== req.params.id);
  res.json({ ok: true });
});

app.get('/api/v1/retail/income', (req, res) => res.json({ income: activeCtx(req).store.income }));
app.post('/api/v1/retail/income', (req, res) => {
  const { store } = activeCtx(req);
  const inc = { id: `inc-${crypto.randomUUID().slice(0, 8)}`, ...req.body, created_at: new Date().toISOString() };
  store.income.unshift(inc);
  res.status(201).json({ income: inc });
});
app.delete('/api/v1/retail/income/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.income = store.income.filter((i) => i.id !== req.params.id);
  res.json({ ok: true });
});

app.get('/api/v1/retail/shift', (req, res) => res.json({ shift: activeCtx(req).store.shift }));
app.get('/api/v1/retail/shift/history', (req, res) => res.json({ shifts: activeCtx(req).store.shifts }));
app.post('/api/v1/retail/shift/start', (req, res) => {
  const { user, store } = activeCtx(req);
  store.shift = { id: `sh-${crypto.randomUUID().slice(0, 8)}`, cashier_name: user.full_name, opening_balance: String(req.body?.opening_balance ?? 0), started_at: new Date().toISOString(), status: 'open' };
  res.status(201).json({ shift: store.shift });
});
app.post('/api/v1/retail/shift/end', (req, res) => {
  const { store } = activeCtx(req);
  if (store.shift) {
    const closed = { ...store.shift, counted_cash: String(req.body?.counted_cash ?? 0), ended_at: new Date().toISOString(), status: 'closed' };
    store.shifts.unshift(closed);
    store.shift = null;
    return res.json({ shift: closed });
  }
  res.json({ shift: null });
});

/* ── ERPNext-Inspired Modules (/api/v1/erp/*) ──────────────── */
// Quotations & Sales Orders (Selling Cycle)
app.get('/api/v1/erp/quotations', (req, res) => {
  res.json({ quotations: activeCtx(req).store.quotations });
});
app.post('/api/v1/erp/quotations', (req, res) => {
  const { store } = activeCtx(req);
  const b = req.body ?? {};
  const cust = store.customers.find((c) => c.id === b.customer_id);
  const items = (Array.isArray(b.items) ? b.items : []).map((it) => {
    const prod = store.products.find((p) => p.id === it.product_id);
    return {
      product_id: it.product_id,
      product_name: prod?.name || it.product_name || 'Item',
      quantity: Math.max(1, Number(it.quantity || 1)),
      unit_price: Number(it.unit_price ?? prod?.sell_price ?? 0),
    };
  });
  const total = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  const qt = {
    id: `qt-${crypto.randomUUID().slice(0, 8)}`,
    number: `QT-${1001 + store.quotations.length}`,
    customer_id: cust?.id || null,
    customer_name: cust?.name || b.customer_name || 'Walk-in',
    valid_until: b.valid_until || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10),
    status: b.status || 'draft',
    total: total.toFixed(2),
    notes: b.notes || null,
    items,
    created_at: new Date().toISOString(),
  };
  store.quotations.unshift(qt);
  res.status(201).json({ quotation: qt });
});
app.patch('/api/v1/erp/quotations/:id', (req, res) => {
  const { store } = activeCtx(req);
  const qt = store.quotations.find((q) => q.id === req.params.id);
  if (!qt) return res.status(404).json({ error: 'Quotation not found' });
  if (req.body?.status) qt.status = req.body.status;
  res.json({ quotation: qt });
});
app.post('/api/v1/erp/quotations/:id/convert-sale', (req, res) => {
  const { user, store } = activeCtx(req);
  const qt = store.quotations.find((q) => q.id === req.params.id);
  if (!qt) return res.status(404).json({ error: 'Quotation not found' });
  const result = createSaleInternal(store, user, {
    customer_id: qt.customer_id,
    customer_name: qt.customer_name,
    payment_method: req.body?.payment_method || 'cash',
    items: qt.items.map((it) => ({
      product_id: it.product_id,
      name: it.product_name,
      quantity: it.quantity,
      unit_price: it.unit_price,
      sold_as_pills: false,
    })),
  });
  qt.status = 'ordered';
  res.status(201).json({ quotation: qt, ...result });
});

app.get('/api/v1/erp/sales-orders', (req, res) => {
  res.json({ sales_orders: activeCtx(req).store.salesOrders });
});
app.post('/api/v1/erp/sales-orders', (req, res) => {
  const { store } = activeCtx(req);
  const b = req.body ?? {};
  const cust = store.customers.find((c) => c.id === b.customer_id);
  const items = (Array.isArray(b.items) ? b.items : []).map((it) => {
    const prod = store.products.find((p) => p.id === it.product_id);
    return {
      product_id: it.product_id,
      product_name: prod?.name || it.product_name || 'Item',
      quantity: Math.max(1, Number(it.quantity || 1)),
      unit_price: Number(it.unit_price ?? prod?.sell_price ?? 0),
    };
  });
  const total = items.reduce((s, it) => s + it.quantity * it.unit_price, 0);
  const so = {
    id: `so-${crypto.randomUUID().slice(0, 8)}`,
    number: `SO-${1001 + store.salesOrders.length}`,
    customer_id: cust?.id || null,
    customer_name: cust?.name || b.customer_name || 'Customer',
    delivery_date: b.delivery_date || new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    status: 'to_deliver',
    total: total.toFixed(2),
    notes: b.notes || null,
    items,
    created_at: new Date().toISOString(),
  };
  store.salesOrders.unshift(so);
  res.status(201).json({ sales_order: so });
});
app.post('/api/v1/erp/sales-orders/:id/deliver', (req, res) => {
  const { user, store } = activeCtx(req);
  const so = store.salesOrders.find((x) => x.id === req.params.id);
  if (!so) return res.status(404).json({ error: 'Sales Order not found' });
  const result = createSaleInternal(store, user, {
    customer_id: so.customer_id,
    customer_name: so.customer_name,
    payment_method: req.body?.payment_method || 'cash',
    items: so.items.map((it) => ({ product_id: it.product_id, name: it.product_name, quantity: it.quantity, unit_price: it.unit_price, sold_as_pills: false })),
  });
  so.status = 'completed';
  res.json({ sales_order: so, ...result });
});

// Purchase Orders (Buying Cycle)
app.get('/api/v1/erp/purchase-orders', (req, res) => {
  res.json({ purchase_orders: activeCtx(req).store.purchaseOrders });
});
app.post('/api/v1/erp/purchase-orders', (req, res) => {
  const { store } = activeCtx(req);
  const b = req.body ?? {};
  const sup = store.suppliers.find((s) => s.id === b.supplier_id);
  const items = (Array.isArray(b.items) ? b.items : []).map((it) => {
    const prod = store.products.find((p) => p.id === it.product_id);
    return {
      product_id: it.product_id,
      product_name: prod?.name || it.product_name || 'Product',
      quantity: Math.max(1, Number(it.quantity || 1)),
      unit_cost: Number(it.unit_cost ?? prod?.cost_price ?? 0),
    };
  });
  const total = items.reduce((s, it) => s + it.quantity * it.unit_cost, 0);
  const po = {
    id: `po-${crypto.randomUUID().slice(0, 8)}`,
    number: `PO-${1001 + store.purchaseOrders.length}`,
    supplier_id: sup?.id || null,
    supplier_name: sup?.name || 'Supplier',
    expected_date: b.expected_date || new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
    status: b.status || 'submitted',
    total: total.toFixed(2),
    notes: b.notes || null,
    items,
    created_at: new Date().toISOString(),
  };
  store.purchaseOrders.unshift(po);
  res.status(201).json({ purchase_order: po });
});
app.post('/api/v1/erp/purchase-orders/:id/receive', (req, res) => {
  const { user, store } = activeCtx(req);
  const po = store.purchaseOrders.find((x) => x.id === req.params.id);
  if (!po) return res.status(404).json({ error: 'Purchase Order not found' });
  const purchase = createPurchaseInternal(store, user, {
    supplier_id: po.supplier_id,
    notes: `Received from ${po.number}`,
    paid_amount: req.body?.paid_amount !== undefined ? Number(req.body.paid_amount) : Number(po.total),
    items: po.items.map((it) => ({ product_id: it.product_id, quantity: it.quantity, unit_cost: it.unit_cost })),
  });
  po.status = 'received';
  res.json({ purchase_order: po, purchase });
});

// Warehouses & Stock Ledger
app.get('/api/v1/erp/warehouses', (req, res) => {
  const { store } = activeCtx(req);
  const enriched = store.warehouses.map((w) => ({
    ...w,
    total_units: Object.values(w.stock_map || {}).reduce((a, n) => a + Number(n || 0), 0),
  }));
  res.json({ warehouses: enriched, products: store.products });
});
app.post('/api/v1/erp/warehouses', (req, res) => {
  const { store } = activeCtx(req);
  const wh = {
    id: `wh-${crypto.randomUUID().slice(0, 8)}`,
    name: String(req.body?.name || 'New Warehouse').trim(),
    code: String(req.body?.code || 'WH').trim().toUpperCase(),
    location: String(req.body?.location || '').trim(),
    is_default: false,
    stock_map: {},
  };
  store.warehouses.push(wh);
  res.status(201).json({ warehouse: wh });
});
app.post('/api/v1/erp/stock-transfers', (req, res) => {
  const { store } = activeCtx(req);
  const { product_id, from_warehouse_id, to_warehouse_id, quantity } = req.body ?? {};
  const qty = Math.max(1, Number(quantity || 0));
  const prod = store.products.find((p) => p.id === product_id);
  const fromWh = store.warehouses.find((w) => w.id === from_warehouse_id);
  const toWh = store.warehouses.find((w) => w.id === to_warehouse_id);
  if (!prod || !fromWh || !toWh || fromWh.id === toWh.id) {
    return res.status(400).json({ error: 'Select product and two different warehouses' });
  }
  const available = Number(fromWh.stock_map[prod.id] || 0);
  if (qty > available) {
    return res.status(400).json({ error: `Only ${available} units available in ${fromWh.name}` });
  }
  fromWh.stock_map[prod.id] = available - qty;
  toWh.stock_map[prod.id] = Number(toWh.stock_map[prod.id] || 0) + qty;
  const voucherNo = `TRF-${store.stockLedger.length + 100}`;
  appendStockLedger(store, { voucher_type: 'Warehouse Transfer (Out)', voucher_no: voucherNo, product: prod, warehouse_id: fromWh.id, warehouse_name: fromWh.name, qty_change: -qty, rate: Number(prod.cost_price || 0) });
  appendStockLedger(store, { voucher_type: 'Warehouse Transfer (In)', voucher_no: voucherNo, product: prod, warehouse_id: toWh.id, warehouse_name: toWh.name, qty_change: qty, rate: Number(prod.cost_price || 0) });
  res.json({ ok: true });
});
app.get('/api/v1/erp/stock-ledger', (req, res) => {
  res.json({ entries: activeCtx(req).store.stockLedger });
});

// Accounting: Chart of Accounts, GL Entries, Journal Entries
app.get('/api/v1/erp/accounts', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ accounts: store.accounts });
});
app.get('/api/v1/erp/gl-entries', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ entries: store.glEntries });
});
app.get('/api/v1/erp/journal-entries', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ journal_entries: store.journalEntries });
});
app.post('/api/v1/erp/journal-entries', (req, res) => {
  const { user, store } = activeCtx(req);
  const { posting_date, remarks, lines = [] } = req.body ?? {};
  const cleanLines = Array.isArray(lines) ? lines : [];
  const totalDebit = cleanLines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const totalCredit = cleanLines.reduce((s, l) => s + Number(l.credit || 0), 0);
  if (cleanLines.length < 2 || Math.abs(totalDebit - totalCredit) > 0.01 || totalDebit <= 0) {
    return res.status(400).json({ error: 'Journal Entry must have >= 2 lines with Total Debit equal to Total Credit (> 0)' });
  }
  const voucherNo = `JV-${1001 + store.journalEntries.length}`;
  const je = {
    id: `je-${crypto.randomUUID().slice(0, 8)}`,
    number: voucherNo,
    posting_date: posting_date || new Date().toISOString().slice(0, 10),
    remarks: remarks || 'Manual Journal Entry',
    total_debit: totalDebit.toFixed(2),
    total_credit: totalCredit.toFixed(2),
    status: 'submitted',
    created_by: user.full_name,
    lines: cleanLines,
    created_at: new Date().toISOString(),
  };
  store.journalEntries.unshift(je);
  for (const l of cleanLines) {
    appendGlEntry(store, {
      voucher_type: 'Journal Entry',
      voucher_no: voucherNo,
      account_code: l.account_code,
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      remarks: remarks || voucherNo,
    });
  }
  res.status(201).json({ journal_entry: je });
});

// CRM Leads & Opportunities
app.get('/api/v1/erp/leads', (req, res) => {
  res.json({ leads: activeCtx(req).store.leads });
});
app.post('/api/v1/erp/leads', (req, res) => {
  const { store } = activeCtx(req);
  const lead = {
    id: `lead-${crypto.randomUUID().slice(0, 8)}`,
    stage: 'lead',
    expected_value: Number(req.body?.expected_value || 0),
    ...req.body,
    created_at: new Date().toISOString(),
  };
  store.leads.unshift(lead);
  res.status(201).json({ lead });
});
app.patch('/api/v1/erp/leads/:id', (req, res) => {
  const { store } = activeCtx(req);
  const lead = store.leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  Object.assign(lead, req.body);
  res.json({ lead });
});
app.post('/api/v1/erp/leads/:id/convert', (req, res) => {
  const { tenant, store } = activeCtx(req);
  const lead = store.leads.find((l) => l.id === req.params.id);
  if (!lead) return res.status(404).json({ error: 'Lead not found' });
  lead.stage = 'won';
  const bType = tenant?.business_type || 'pharmacy';
  if (bType === 'hospital') {
    const parts = String(lead.name || 'New Patient').trim().split(/\s+/);
    const pat = {
      id: `pat-${crypto.randomUUID().slice(0, 8)}`,
      code: `PT-${1001 + store.patients.length}`,
      first_name: parts[0] || 'Patient',
      last_name: parts.slice(1).join(' ') || '—',
      gender: 'other',
      phone: lead.phone || null,
      created_at: new Date().toISOString(),
    };
    store.patients.unshift(pat);
    return res.json({ lead, converted_type: 'patient', record: pat });
  }
  const cust = {
    id: `cust-${crypto.randomUUID().slice(0, 8)}`,
    name: lead.organization ? `${lead.name} (${lead.organization})` : lead.name,
    phone: lead.phone || null,
    email: lead.email || null,
    balance: '0',
    created_at: new Date().toISOString(),
  };
  store.customers.unshift(cust);
  res.json({ lead, converted_type: 'customer', record: cust });
});
app.delete('/api/v1/erp/leads/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.leads = store.leads.filter((l) => l.id !== req.params.id);
  res.json({ ok: true });
});

/* ── Hospital & Flow (/api/v1/hospital/*, /api/v1/flow/*) ──── */
app.get('/api/v1/hospital/dashboard', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const unpaidTotal = store.invoices.reduce((a, i) => a + Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0)), 0);
  const collected = store.invoices.reduce((a, i) => a + Number(i.paid_amount || 0), 0);
  res.json({
    stats: {
      patients: store.patients.length,
      today_appointments: store.appointments.length,
      upcoming_appointments: store.appointments.filter((a) => a.status === 'scheduled').length,
      unpaid_total: unpaidTotal,
      month_revenue: 94500 + collected,
    },
    todays_appointments: store.appointments,
    recent_patients: store.patients,
  });
});

app.get('/api/v1/hospital/reports', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));
  const billed = store.invoices.reduce((a, i) => a + Number(i.amount || 0), 0);
  const collected = store.invoices.reduce((a, i) => a + Number(i.paid_amount || 0), 0);
  res.json({
    period: { from, to },
    appointments: { total: store.appointments.length, completed: store.appointments.filter((a) => a.status === 'completed').length, cancelled: 0, no_show: 0 },
    billing: { billed, collected, outstanding: Math.max(0, billed - collected), invoices: store.invoices.length },
    new_patients: store.patients.length,
    top_diagnoses: [{ diagnosis: 'General Checkup', count: 4 }],
    labs: { ordered: store.labs.length, resulted: store.labs.filter((l) => l.status === 'resulted').length, revenue: 0 },
    doctor_load: store.doctors.map((d) => ({ doctor: d.full_name, seen: 1 })),
  });
});

app.get('/api/v1/hospital/patients', (req, res) => res.json({ patients: activeCtx(req, 'hospital').store.patients }));
app.post('/api/v1/hospital/patients', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const pat = { id: `pat-${crypto.randomUUID().slice(0, 8)}`, code: `PT-${1001 + store.patients.length}`, ...req.body, created_at: new Date().toISOString() };
  store.patients.unshift(pat);
  res.status(201).json({ patient: pat });
});

app.get('/api/v1/hospital/doctors', (req, res) => res.json({ doctors: activeCtx(req, 'hospital').store.doctors }));
app.post('/api/v1/hospital/doctors', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const doc = { id: `doc-${crypto.randomUUID().slice(0, 8)}`, is_active: true, ...req.body };
  store.doctors.unshift(doc);
  res.status(201).json({ doctor: doc });
});

app.get('/api/v1/hospital/appointments', (req, res) => res.json({ appointments: activeCtx(req, 'hospital').store.appointments }));
app.post('/api/v1/hospital/appointments', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const pat = store.patients.find((p) => p.id === req.body?.patient_id);
  const doc = store.doctors.find((d) => d.id === req.body?.doctor_id);
  const apt = {
    id: `apt-${crypto.randomUUID().slice(0, 8)}`,
    ...req.body,
    patient_name: pat ? `${pat.first_name} ${pat.last_name}` : 'Patient',
    patient_code: pat?.code || 'PT-000',
    doctor_name: doc?.full_name || null,
    status: 'scheduled',
  };
  store.appointments.unshift(apt);
  res.status(201).json({ appointment: apt });
});
app.patch('/api/v1/hospital/appointments/:id', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const apt = store.appointments.find((a) => a.id === req.params.id);
  if (apt && req.body?.status) apt.status = req.body.status;
  res.json({ appointment: apt });
});

app.get('/api/v1/hospital/queue', (req, res) => res.json({ queue: activeCtx(req, 'hospital').store.appointments }));
app.post('/api/v1/hospital/queue/walk-in', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const pat = store.patients.find((p) => p.id === req.body?.patient_id);
  const doc = store.doctors.find((d) => d.id === req.body?.doctor_id);
  const item = {
    id: `apt-${crypto.randomUUID().slice(0, 8)}`,
    scheduled_at: new Date().toISOString(),
    patient_id: pat?.id || null,
    patient_name: pat ? `${pat.first_name} ${pat.last_name}` : 'Walk-in',
    patient_code: pat?.code || 'PT-WALKIN',
    doctor_name: doc?.full_name || null,
    reason: req.body?.reason || 'Walk-in',
    status: 'checked_in',
  };
  store.appointments.unshift(item);
  res.status(201).json({ appointment: item });
});

app.get('/api/v1/hospital/records', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const pid = req.query.patient_id ? String(req.query.patient_id) : '';
  const records = pid ? store.records.filter((r) => r.patient_id === pid) : store.records;
  res.json({ records });
});
app.post('/api/v1/hospital/records', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const pat = store.patients.find((p) => p.id === req.body?.patient_id);
  const rec = {
    id: `rec-${crypto.randomUUID().slice(0, 8)}`,
    ...req.body,
    patient_name: pat ? `${pat.first_name} ${pat.last_name}` : 'Patient',
    patient_code: pat?.code || 'PT-000',
    created_at: new Date().toISOString(),
  };
  store.records.unshift(rec);
  res.status(201).json({ record: rec });
});

app.get('/api/v1/hospital/labs', (req, res) => res.json({ labs: activeCtx(req, 'hospital').store.labs }));
app.get('/api/v1/hospital/labs/catalog', (_req, res) => res.json({ catalog: [{ id: 'lab-cbc', name: 'Complete Blood Count (CBC)', price: '250' }, { id: 'lab-ua', name: 'Urinalysis', price: '150' }, { id: 'lab-lft', name: 'Liver Function Test', price: '450' }] }));
app.post('/api/v1/hospital/labs', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const pat = store.patients.find((p) => p.id === req.body?.patient_id);
  const lab = { id: `lab-${crypto.randomUUID().slice(0, 8)}`, ...req.body, patient_name: pat ? `${pat.first_name} ${pat.last_name}` : 'Patient', status: 'ordered', created_at: new Date().toISOString() };
  store.labs.unshift(lab);
  res.status(201).json({ lab });
});
app.patch('/api/v1/hospital/labs/:id', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const lab = store.labs.find((l) => l.id === req.params.id);
  if (lab) Object.assign(lab, req.body);
  res.json({ lab });
});

app.get('/api/v1/hospital/invoices', (req, res) => res.json({ invoices: activeCtx(req, 'hospital').store.invoices }));
app.post('/api/v1/hospital/invoices', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const pat = store.patients.find((p) => p.id === req.body?.patient_id);
  const amount = Number(req.body?.amount || 0);
  const paid = Number(req.body?.paid_amount || 0);
  const number = `MED-${1001 + store.invoices.length}`;
  const inv = {
    id: `inv-${crypto.randomUUID().slice(0, 8)}`,
    number,
    patient_id: req.body?.patient_id || null,
    patient_name: pat ? `${pat.first_name} ${pat.last_name}` : null,
    description: req.body?.description || null,
    amount: String(amount),
    paid_amount: String(paid),
    status: paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid',
    issued_on: new Date().toISOString().slice(0, 10),
  };
  store.invoices.unshift(inv);
  if (paid > 0) {
    appendGlEntry(store, { voucher_type: 'Medical Invoice', voucher_no: number, account_code: '1110', debit: paid, credit: 0, party: inv.patient_name || 'Patient', remarks: inv.description || 'Medical payment' });
    appendGlEntry(store, { voucher_type: 'Medical Invoice', voucher_no: number, account_code: '4100', debit: 0, credit: paid, party: inv.patient_name || 'Patient', remarks: inv.description || 'Medical revenue' });
  }
  res.status(201).json({ invoice: inv });
});
app.patch('/api/v1/hospital/invoices/:id/pay', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const inv = store.invoices.find((i) => i.id === req.params.id);
  if (inv) {
    const payAmt = Number(req.body?.amount || 0);
    const nextPaid = Number(inv.paid_amount || 0) + payAmt;
    inv.paid_amount = String(nextPaid);
    inv.status = nextPaid >= Number(inv.amount) ? 'paid' : 'partial';
    if (payAmt > 0) {
      appendGlEntry(store, { voucher_type: 'Medical Payment', voucher_no: inv.number, account_code: '1110', debit: payAmt, credit: 0, party: inv.patient_name || 'Patient', remarks: inv.description || 'Invoice payment' });
      appendGlEntry(store, { voucher_type: 'Medical Payment', voucher_no: inv.number, account_code: '4100', debit: 0, credit: payAmt, party: inv.patient_name || 'Patient', remarks: inv.description || 'Invoice payment' });
    }
  }
  res.json({ invoice: inv });
});

app.get('/api/v1/flow/departments', (req, res) => res.json({ departments: activeCtx(req, 'hospital').store.departments }));
app.get('/api/v1/flow/visits', (req, res) => res.json({ visits: activeCtx(req, 'hospital').store.visits }));
app.post('/api/v1/flow/visits', (req, res) => {
  const { user, store } = activeCtx(req, 'hospital');
  const pat = store.patients.find((p) => p.id === req.body?.patient_id);
  const dept = store.departments.find((d) => d.id === req.body?.department_id) || store.departments[0];
  const v = {
    id: `vis-${crypto.randomUUID().slice(0, 8)}`,
    patient_id: req.body?.patient_id,
    patient_name: pat ? `${pat.first_name} ${pat.last_name}` : 'Patient',
    patient_code: pat?.code || 'PT-000',
    phone: pat?.phone || null,
    blood_type: pat?.blood_type || null,
    allergies: pat?.allergies || null,
    department_id: dept?.id,
    department_name: dept?.name || 'General',
    chief_complaint: req.body?.chief_complaint || null,
    status: 'waiting',
    priority: req.body?.priority || 'normal',
    history: [
      { id: `ev-${crypto.randomUUID().slice(0, 8)}`, event: 'checked_in', department_name: dept?.name || 'Reception', handler_name: user.full_name, note: req.body?.chief_complaint || null, created_at: new Date().toISOString() },
    ],
    created_at: new Date().toISOString(),
  };
  store.visits.unshift(v);
  res.status(201).json({ visit: v });
});
app.get('/api/v1/flow/visits/:id', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const visit = store.visits.find((v) => v.id === req.params.id) || store.visits[0] || null;
  res.json({ visit, orders: store.orders.filter((o) => o.visit_id === req.params.id), history: visit?.history || [], events: visit?.history || [] });
});
app.post('/api/v1/flow/visits/:id/call', (req, res) => {
  const { user, store } = activeCtx(req, 'hospital');
  const v = store.visits.find((x) => x.id === req.params.id);
  if (v) {
    v.status = 'in_service';
    v.history = [...(v.history || []), { id: `ev-${crypto.randomUUID().slice(0, 8)}`, event: 'called', department_name: v.department_name, handler_name: user.full_name, note: null, created_at: new Date().toISOString() }];
  }
  res.json({ visit: v });
});
app.post('/api/v1/flow/visits/:id/transfer', (req, res) => {
  const { user, store } = activeCtx(req, 'hospital');
  const v = store.visits.find((x) => x.id === req.params.id);
  const dept = store.departments.find((d) => d.id === req.body?.department_id);
  if (v && dept) {
    v.department_id = dept.id;
    v.department_name = dept.name;
    v.status = 'waiting';
    v.history = [...(v.history || []), { id: `ev-${crypto.randomUUID().slice(0, 8)}`, event: 'transferred', department_name: dept.name, handler_name: user.full_name, note: null, created_at: new Date().toISOString() }];
  }
  res.json({ visit: v });
});
app.post('/api/v1/flow/visits/:id/complete', (req, res) => {
  const { user, store } = activeCtx(req, 'hospital');
  const v = store.visits.find((x) => x.id === req.params.id);
  if (v) {
    v.status = 'completed';
    v.history = [...(v.history || []), { id: `ev-${crypto.randomUUID().slice(0, 8)}`, event: 'completed', department_name: v.department_name, handler_name: user.full_name, note: null, created_at: new Date().toISOString() }];
  }
  res.json({ visit: v });
});
app.post('/api/v1/flow/visits/:id/invoice', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const v = store.visits.find((x) => x.id === req.params.id);
  const visitOrders = store.orders.filter((o) => o.visit_id === req.params.id);
  const totalFee = visitOrders.reduce((s, o) => s + Number(o.fee || 0), 0) || 500;
  const inv = {
    id: `inv-${crypto.randomUUID().slice(0, 8)}`,
    number: `MED-${1001 + store.invoices.length}`,
    patient_id: v?.patient_id || null,
    patient_name: v?.patient_name || 'Patient',
    description: `Visit services (${visitOrders.length} orders)`,
    amount: String(totalFee),
    paid_amount: '0',
    status: 'unpaid',
    issued_on: new Date().toISOString().slice(0, 10),
  };
  store.invoices.unshift(inv);
  res.status(201).json({ invoice: inv });
});
app.get('/api/v1/flow/orders', (req, res) => res.json({ orders: activeCtx(req, 'hospital').store.orders }));
app.post('/api/v1/flow/orders', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const dept = store.departments.find((d) => d.id === req.body?.target_department_id);
  const o = {
    id: `ord-${crypto.randomUUID().slice(0, 8)}`,
    ...req.body,
    department_name: dept?.name || 'Laboratory',
    status: 'pending',
    created_at: new Date().toISOString(),
  };
  store.orders.unshift(o);
  res.status(201).json({ order: o });
});
app.post('/api/v1/flow/orders/:id/start', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const o = store.orders.find((x) => x.id === req.params.id);
  if (o) o.status = 'in_progress';
  res.json({ order: o });
});
app.post('/api/v1/flow/orders/:id/complete', (req, res) => {
  const { store } = activeCtx(req, 'hospital');
  const o = store.orders.find((x) => x.id === req.params.id);
  if (o) {
    o.status = 'completed';
    o.result = req.body?.result || null;
  }
  res.json({ order: o });
});

/* ── School & Teaching (/api/v1/school/*, /api/v1/teaching/*) ─ */
app.get('/api/v1/school/dashboard', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const unpaidFees = store.fees.reduce((a, f) => a + Math.max(0, Number(f.amount || 0) - Number(f.paid_amount || 0)), 0);
  const collected = store.fees.reduce((a, f) => a + Number(f.paid_amount || 0), 0);
  res.json({
    stats: {
      students: store.students.length,
      classes: store.classes.length,
      teachers: store.teachers.length,
      attendance_today: 95,
      unpaid_fees: unpaidFees,
      collected_this_month: collected,
    },
    attendance_trend: store.trend.map(({ day, pct }) => ({ day, pct })),
    class_overview: store.classes.map((c) => ({ name: c.name, students: c.student_count })),
    recent_students: store.students,
  });
});

app.get('/api/v1/school/reports', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));
  const billed = store.fees.reduce((a, f) => a + Number(f.amount || 0), 0);
  const collected = store.fees.reduce((a, f) => a + Number(f.paid_amount || 0), 0);
  res.json({
    period: { from, to },
    totals: { billed, collected, outstanding: Math.max(0, billed - collected) },
    collection_by_class: store.classes.map((c) => ({ class: c.name, billed, collected })),
    defaulters: store.fees.filter((f) => f.status !== 'paid').map((f) => ({ student: f.student_name, class: f.class_name, due: Math.max(0, Number(f.amount) - Number(f.paid_amount)) })),
    monthly_collection: [
      { month: 'Jan 2026', collected: 112000 },
      { month: 'Feb 2026', collected: 128000 },
      { month: 'Mar 2026', collected: Math.max(145000, collected) },
    ],
    attendance_by_class: store.classes.map((c) => ({ class: c.name, pct: 95 })),
    subject_averages: store.subjects.map((s) => ({ subject: s.name, avg: 84, entries: 12 })),
  });
});

app.get('/api/v1/school/students', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const classId = req.query.class_id;
  const students = classId ? store.students.filter((s) => s.class_id === classId) : store.students;
  res.json({ students });
});
app.post('/api/v1/school/students', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const cls = store.classes.find((c) => c.id === req.body?.class_id);
  const st = {
    id: `stu-${crypto.randomUUID().slice(0, 8)}`,
    code: `ST-${2001 + store.students.length}`,
    ...req.body,
    class_name: cls?.name || null,
    created_at: new Date().toISOString(),
  };
  store.students.unshift(st);
  if (cls) cls.student_count = store.students.filter((s) => s.class_id === cls.id).length;
  res.status(201).json({ student: st });
});
app.patch('/api/v1/school/students/:id', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const st = store.students.find((s) => s.id === req.params.id);
  if (st) Object.assign(st, req.body);
  res.json({ student: st });
});
app.post('/api/v1/school/students/promote', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const { from_class_id, to_class_id } = req.body ?? {};
  const toCls = store.classes.find((c) => c.id === to_class_id);
  let moved = 0;
  if (from_class_id && toCls) {
    for (const st of store.students) {
      if (st.class_id === from_class_id) {
        st.class_id = toCls.id;
        st.class_name = toCls.name;
        moved += 1;
      }
    }
    for (const c of store.classes) {
      c.student_count = store.students.filter((s) => s.class_id === c.id).length;
    }
  }
  res.json({ moved });
});

app.get('/api/v1/school/classes', (req, res) => res.json({ classes: activeCtx(req, 'school').store.classes }));
app.post('/api/v1/school/classes', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const cls = { id: `cls-${crypto.randomUUID().slice(0, 8)}`, student_count: 0, ...req.body };
  store.classes.unshift(cls);
  res.status(201).json({ class: cls });
});

app.get('/api/v1/school/teachers', (req, res) => res.json({ teachers: activeCtx(req, 'school').store.teachers }));
app.post('/api/v1/school/teachers', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const t = { id: `tch-${crypto.randomUUID().slice(0, 8)}`, ...req.body };
  store.teachers.unshift(t);
  res.status(201).json({ teacher: t });
});

app.get('/api/v1/school/subjects', (req, res) => res.json({ subjects: activeCtx(req, 'school').store.subjects }));
app.post('/api/v1/school/subjects', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const s = { id: `sub-${crypto.randomUUID().slice(0, 8)}`, name: req.body?.name || 'Subject' };
  store.subjects.push(s);
  res.status(201).json({ subject: s });
});
app.delete('/api/v1/school/subjects/:id', (req, res) => {
  const { store } = activeCtx(req, 'school');
  store.subjects = store.subjects.filter((s) => s.id !== req.params.id);
  res.json({ ok: true });
});

app.get('/api/v1/school/fees', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const status = req.query.status ? String(req.query.status) : '';
  const fees = status ? store.fees.filter((f) => f.status === status) : store.fees;
  res.json({ fees });
});
app.post('/api/v1/school/fees', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const ids = Array.isArray(req.body?.student_ids) ? req.body.student_ids : [];
  const created = ids.map((sid) => {
    const st = store.students.find((s) => s.id === sid);
    return {
      id: `fee-${crypto.randomUUID().slice(0, 8)}`,
      title: req.body?.title || 'Tuition Fee',
      amount: String(req.body?.amount || 0),
      paid_amount: '0',
      due_date: req.body?.due_date || null,
      status: 'unpaid',
      paid_at: null,
      student_id: sid,
      student_name: st ? `${st.first_name} ${st.last_name}` : 'Student',
      student_code: st?.code || 'ST-000',
      class_name: st?.class_name || null,
      created_at: new Date().toISOString(),
    };
  });
  store.fees.unshift(...created);
  res.status(201).json({ fees: created });
});
app.patch('/api/v1/school/fees/:id/pay', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const fee = store.fees.find((f) => f.id === req.params.id);
  if (fee) {
    const payAmt = Number(req.body?.amount || 0);
    const nextPaid = Number(fee.paid_amount || 0) + payAmt;
    fee.paid_amount = String(nextPaid);
    fee.status = nextPaid >= Number(fee.amount) ? 'paid' : 'partial';
    fee.paid_at = new Date().toISOString();
    if (payAmt > 0) {
      appendGlEntry(store, { voucher_type: 'Tuition Fee', voucher_no: `FEE-${fee.id.slice(0, 6).toUpperCase()}`, account_code: '1110', debit: payAmt, credit: 0, party: fee.student_name, remarks: fee.title });
      appendGlEntry(store, { voucher_type: 'Tuition Fee', voucher_no: `FEE-${fee.id.slice(0, 6).toUpperCase()}`, account_code: '4100', debit: 0, credit: payAmt, party: fee.student_name, remarks: fee.title });
    }
  }
  res.json({ fee });
});
app.post('/api/v1/school/fees/:id/notify', (_req, res) => {
  res.json({ ok: true, emailStatus: 'sent', telegramStatus: 'not_configured' });
});

app.get('/api/v1/school/grades', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const classId = req.query.class_id ? String(req.query.class_id) : '';
  const grades = classId ? store.grades.filter((g) => g.class_id === classId) : store.grades;
  res.json({ grades });
});
app.post('/api/v1/school/grades/bulk', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
  for (const e of entries) {
    const st = store.students.find((s) => s.id === e.student_id);
    store.grades.unshift({
      id: `grd-${crypto.randomUUID().slice(0, 8)}`,
      ...e,
      class_id: st?.class_id || null,
      score: String(e.score),
      max_score: String(e.max_score || 100),
      student_name: st ? `${st.first_name} ${st.last_name}` : 'Student',
      student_code: st?.code || 'ST-000',
      class_name: st?.class_name || null,
      created_at: new Date().toISOString(),
    });
  }
  res.status(201).json({ ok: true });
});

app.get('/api/v1/school/attendance', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const classId = String(req.query.class_id || '');
  const date = String(req.query.date || new Date().toISOString().slice(0, 10));
  const students = classId ? store.students.filter((s) => s.class_id === classId) : store.students;
  const roster = students.map((s) => ({
    student_id: s.id,
    code: s.code,
    first_name: s.first_name,
    last_name: s.last_name,
    status: store.attendance[`${classId}:${date}:${s.id}`] || 'present',
    att_date: date,
  }));
  res.json({ roster });
});
app.get('/api/v1/school/attendance/summary', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const vals = Object.values(store.attendance);
  if (!vals.length) return res.json({ summary: { present: store.students.length, late: 0, absent: 0, excused: 0 } });
  const summary = { present: 0, late: 0, absent: 0, excused: 0 };
  for (const v of vals) summary[v] = (summary[v] || 0) + 1;
  res.json({ summary });
});
app.post('/api/v1/school/attendance', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const { class_id, att_date, entries } = req.body ?? {};
  for (const e of entries ?? []) {
    store.attendance[`${class_id}:${att_date}:${e.student_id}`] = e.status;
  }
  res.json({ ok: true });
});

app.get('/api/v1/school/timetable', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const classId = req.query.class_id ? String(req.query.class_id) : '';
  const slots = classId ? store.timetable.filter((t) => t.class_id === classId) : store.timetable;
  res.json({ slots });
});
app.post('/api/v1/school/timetable', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const t = store.teachers.find((x) => x.id === req.body?.teacher_id);
  const slot = { id: `tt-${crypto.randomUUID().slice(0, 8)}`, ...req.body, teacher_name: t?.full_name || null };
  store.timetable.push(slot);
  res.status(201).json({ slot });
});
app.delete('/api/v1/school/timetable/:id', (req, res) => {
  const { store } = activeCtx(req, 'school');
  store.timetable = store.timetable.filter((s) => s.id !== req.params.id);
  res.json({ ok: true });
});

app.get('/api/v1/school/announcements', (req, res) => res.json({ announcements: activeCtx(req, 'school').store.announcements }));
app.post('/api/v1/school/announcements', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const ann = { id: `ann-${crypto.randomUUID().slice(0, 8)}`, ...req.body, created_at: new Date().toISOString() };
  store.announcements.unshift(ann);
  res.status(201).json({ announcement: ann });
});

app.get('/api/v1/school/report-cards', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const classId = String(req.query.class_id || '');
  const cls = store.classes.find((c) => c.id === classId) || store.classes[0] || { id: 'cls-1', name: 'Grade 10 - A' };
  const students = store.students.filter((s) => !classId || s.class_id === classId).map((s) => ({
    id: s.id,
    code: s.code,
    first_name: s.first_name,
    last_name: s.last_name,
    grades: store.grades.filter((g) => g.student_id === s.id),
    attendance: { present: 20, absent: 0, late: 0 },
  }));
  res.json({ class: cls, term: String(req.query.term || 'Semester 1'), students });
});

app.get('/api/v1/teaching/sessions', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const date = req.query.date ? String(req.query.date) : '';
  const sessionsList = date ? store.teachingSessions.filter((s) => s.session_date === date) : store.teachingSessions;
  res.json({ sessions: sessionsList });
});
app.post('/api/v1/teaching/sessions/generate', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const date = String(req.body?.date || new Date().toISOString().slice(0, 10));
  let created = 0;
  for (const slot of store.timetable) {
    const exists = store.teachingSessions.some((s) => s.timetable_id === slot.id && s.session_date === date);
    if (!exists) {
      const cls = store.classes.find((c) => c.id === slot.class_id);
      store.teachingSessions.unshift({
        id: `ts-${crypto.randomUUID().slice(0, 8)}`,
        timetable_id: slot.id,
        subject: slot.subject,
        session_date: date,
        scheduled_start: `${date}T${slot.start_time}:00`,
        scheduled_end: `${date}T${slot.end_time}:00`,
        actual_start: null,
        actual_end: null,
        is_completed: false,
        status: 'scheduled',
        minutes_late: 0,
        status_reason: null,
        teacher_name: slot.teacher_name || 'Assigned Teacher',
        class_name: cls?.name || 'Class',
        substitute_name: null,
      });
      created += 1;
    }
  }
  res.json({ created });
});
app.post('/api/v1/teaching/sessions/:id/start', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const s = store.teachingSessions.find((x) => x.id === req.params.id);
  if (s) {
    s.actual_start = new Date().toISOString();
    s.status = 'present';
  }
  res.json({ session: s });
});
app.post('/api/v1/teaching/sessions/:id/complete', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const s = store.teachingSessions.find((x) => x.id === req.params.id);
  if (s) {
    s.actual_end = new Date().toISOString();
    s.is_completed = true;
  }
  res.json({ session: s });
});
app.get('/api/v1/teaching/activities', (req, res) => res.json({ activities: activeCtx(req, 'school').store.teachingActivities }));
app.post('/api/v1/teaching/activities', (req, res) => {
  const { user, store } = activeCtx(req, 'school');
  const cls = store.classes.find((c) => c.id === req.body?.class_id);
  const classStudents = store.students.filter((s) => !req.body?.class_id || s.class_id === req.body.class_id);
  const act = {
    id: `act-${crypto.randomUUID().slice(0, 8)}`,
    ...req.body,
    status: 'draft',
    class_name: cls?.name || 'Class',
    teacher_name: user.full_name,
    submission_count: classStudents.length,
    submitted_count: 0,
    submissions: classStudents.map((st) => ({
      id: `sub-${crypto.randomUUID().slice(0, 8)}`,
      student_id: st.id,
      student_name: `${st.first_name} ${st.last_name}`,
      student_code: st.code,
      status: 'pending',
      score: null,
      feedback: null,
    })),
    created_at: new Date().toISOString(),
  };
  store.teachingActivities.unshift(act);
  res.status(201).json({ activity: act });
});
app.post('/api/v1/teaching/activities/:id/assign', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const act = store.teachingActivities.find((a) => a.id === req.params.id);
  if (act) act.status = 'assigned';
  res.json({ activity: act });
});
app.patch('/api/v1/teaching/activities/:id', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const act = store.teachingActivities.find((a) => a.id === req.params.id);
  if (act) Object.assign(act, req.body);
  res.json({ activity: act });
});
app.get('/api/v1/teaching/activities/:id/submissions', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const act = store.teachingActivities.find((a) => a.id === req.params.id);
  res.json({ submissions: act?.submissions || [] });
});
app.post('/api/v1/teaching/activities/:id/submissions/bulk', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const act = store.teachingActivities.find((a) => a.id === req.params.id);
  if (act) {
    const entries = Array.isArray(req.body?.entries) ? req.body.entries : [];
    for (const e of entries) {
      const sub = (act.submissions || []).find((s) => s.student_id === e.student_id);
      if (sub) {
        sub.status = e.status;
        sub.score = e.score ?? null;
      }
    }
    act.submitted_count = (act.submissions || []).filter((s) => s.status === 'submitted' || s.status === 'graded').length;
  }
  res.json({ ok: true });
});

app.get('/api/v1/teaching/reports/overview', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const from = String(req.query.from || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const to = String(req.query.to || new Date().toISOString().slice(0, 10));
  const ses = store.teachingSessions;
  const acts = store.teachingActivities;
  const present = ses.filter((s) => s.status === 'present').length;
  const late = ses.filter((s) => s.status === 'late').length;
  const absent = ses.filter((s) => s.status === 'absent').length;
  const held = present + late + absent;
  res.json({
    period: { from, to },
    sessions: { total: ses.length, present, late, absent, excused: 0, scheduled: ses.filter((s) => s.status === 'scheduled').length, avg_minutes_late: 0, completed: ses.filter((s) => s.is_completed).length },
    activities: { total: acts.length, assigned: acts.filter((a) => a.status === 'assigned').length, completed: acts.filter((a) => a.status === 'completed').length, overdue: 0 },
    submissions: { total: 0, done: 0 },
    on_time_pct: held > 0 ? Math.round((present / held) * 100) : null,
  });
});
app.get('/api/v1/teaching/reports/teachers', (req, res) => {
  const { store } = activeCtx(req, 'school');
  res.json({
    teachers: store.teachers.map((t) => ({
      teacher_id: t.id,
      teacher_name: t.full_name,
      sessions: store.teachingSessions.length,
      present: store.teachingSessions.filter((s) => s.status === 'present').length,
      late: 0,
      absent: 0,
      excused: 0,
      avg_minutes_late: 0,
      activities: store.teachingActivities.length,
      overdue_activities: 0,
    })),
  });
});
app.get('/api/v1/teaching/reports/attention', (_req, res) => res.json({ attention: [] }));
app.get('/api/v1/teaching/reports/teachers/:id', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const t = store.teachers.find((x) => x.id === req.params.id) || store.teachers[0] || null;
  if (!t) return res.status(404).json({ error: 'Teacher not found' });
  res.json({
    teacher: t,
    sessions: store.teachingSessions,
    activities: store.teachingActivities,
    events: [],
    period: { from: String(req.query.from || ''), to: String(req.query.to || '') },
  });
});
app.get('/api/v1/teaching/expectations', (req, res) => res.json({ expectations: activeCtx(req, 'school').store.expectations }));
app.post('/api/v1/teaching/expectations', (req, res) => {
  const { user, store } = activeCtx(req, 'school');
  const cls = store.classes.find((c) => c.id === req.body?.class_id);
  const exp = { id: `texp-${crypto.randomUUID().slice(0, 8)}`, ...req.body, class_name: cls?.name || null, created_by_name: user.full_name };
  store.expectations.push(exp);
  res.status(201).json({ expectation: exp });
});
app.delete('/api/v1/teaching/expectations/:id', (req, res) => {
  const { store } = activeCtx(req, 'school');
  store.expectations = store.expectations.filter((e) => e.id !== req.params.id);
  res.json({ ok: true });
});

/* ── Expenses, Payroll, Users, Billing, Bot, Marketing, Admin ─ */
app.get('/api/v1/expenses', (req, res) => {
  const { store } = activeCtx(req);
  const cat = req.query.category ? String(req.query.category) : '';
  const search = req.query.search ? String(req.query.search).toLowerCase() : '';
  const from = req.query.from ? String(req.query.from) : '';
  const to = req.query.to ? String(req.query.to) : '';
  const filtered = store.expenses.filter((e) => {
    if (cat && e.category !== cat) return false;
    if (from && e.spent_at < from) return false;
    if (to && e.spent_at > to) return false;
    if (search && !`${e.category} ${e.description ?? ''}`.toLowerCase().includes(search)) return false;
    return true;
  });
  res.json({ expenses: filtered });
});
app.get('/api/v1/expenses/summary', (req, res) => {
  const { store } = activeCtx(req);
  const total = store.expenses.reduce((a, e) => a + Number(e.amount || 0), 0);
  const byCat = {};
  for (const e of store.expenses) {
    byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount || 0);
  }
  const sorted = Object.entries(byCat).map(([category, tot]) => ({ category, total: tot })).sort((a, b) => b.total - a.total);
  res.json({
    this_month: total,
    last_month: 0,
    this_year: total,
    by_category: sorted,
  });
});
app.get('/api/v1/expenses/export', (req, res) => {
  const { store } = activeCtx(req);
  const header = ['Date', 'Category', 'Description', 'Amount', 'Status', 'Recorded By'].join(',');
  const rows = store.expenses.map((e) =>
    [e.spent_at, e.category, `"${String(e.description || '').replace(/"/g, '""')}"`, e.amount, e.status, `"${e.recorded_by_name || ''}"`].join(',')
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="expenses.csv"');
  res.send([header, ...rows].join('\n'));
});
app.post('/api/v1/expenses', (req, res) => {
  const { user, store } = activeCtx(req);
  const amt = Number(req.body?.amount || 0);
  const exp = {
    id: `exp-${crypto.randomUUID().slice(0, 8)}`,
    ...req.body,
    amount: String(amt),
    spent_at: req.body?.spent_at || new Date().toISOString().slice(0, 10),
    is_recurring: Boolean(req.body?.is_recurring),
    status: 'approved',
    recorded_by_name: user.full_name,
    created_at: new Date().toISOString(),
  };
  store.expenses.unshift(exp);
  if (amt > 0) {
    const voucherNo = `EXP-${store.expenses.length + 100}`;
    appendGlEntry(store, { voucher_type: 'Expense', voucher_no: voucherNo, account_code: '5200', debit: amt, credit: 0, remarks: `${exp.category}: ${exp.description || ''}` });
    appendGlEntry(store, { voucher_type: 'Expense', voucher_no: voucherNo, account_code: '1110', debit: 0, credit: amt, remarks: `${exp.category}: ${exp.description || ''}` });
  }
  res.status(201).json({ expense: exp });
});
app.patch('/api/v1/expenses/:id', (req, res) => {
  const { store } = activeCtx(req);
  const exp = store.expenses.find((e) => e.id === req.params.id);
  if (exp) Object.assign(exp, req.body);
  res.json({ expense: exp });
});
app.patch('/api/v1/expenses/:id/approve', (req, res) => {
  const { store } = activeCtx(req);
  const exp = store.expenses.find((e) => e.id === req.params.id);
  if (exp) exp.status = 'approved';
  res.json({ expense: exp });
});
app.patch('/api/v1/expenses/:id/reject', (req, res) => {
  const { store } = activeCtx(req);
  const exp = store.expenses.find((e) => e.id === req.params.id);
  if (exp) exp.status = 'rejected';
  res.json({ expense: exp });
});
app.delete('/api/v1/expenses/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.expenses = store.expenses.filter((e) => e.id !== req.params.id);
  res.json({ ok: true });
});

const PAYROLL_COMPONENTS = [
  { code: 'BASE_SALARY', label: 'Base Salary', source: 'PROFILE', display_order: 1 },
  { code: 'TRANSPORT_ALLOW', label: 'Transport Allowance', source: 'PROFILE', display_order: 2 },
  { code: 'HOUSING_ALLOW', label: 'Housing Allowance', source: 'PROFILE', display_order: 3 },
  { code: 'GROSS', label: 'Gross Pay', source: 'COMPUTED', display_order: 4 },
  { code: 'INCOME_TAX', label: 'Income Tax', source: 'COMPUTED', display_order: 5 },
  { code: 'PENSION_EE', label: 'Pension (7%)', source: 'COMPUTED', display_order: 6 },
];

app.get('/api/v1/payroll/components', (_req, res) => res.json({ components: PAYROLL_COMPONENTS }));
app.get('/api/v1/payroll/employees', (req, res) => {
  const { user } = activeCtx(req);
  const list = Array.from(users.values()).filter((u) => u.tenant_id === user.tenant_id).map((u) => ({
    id: u.id,
    full_name: u.full_name,
    email: u.email,
    role: u.role,
    base_salary: u.profile_values?.BASE_SALARY ?? 0,
    transport_allow: u.profile_values?.TRANSPORT_ALLOW ?? 0,
    housing_allow: u.profile_values?.HOUSING_ALLOW ?? 0,
    other_allow: 0,
    pension_pct: 7,
    profile_values: u.profile_values ?? {},
    is_active: u.is_active ?? true,
  }));
  res.json({ employees: list });
});
app.post('/api/v1/payroll/employees/:id', (req, res) => {
  for (const u of users.values()) {
    if (u.id === req.params.id) {
      u.profile_values = { ...(u.profile_values || {}), ...(req.body?.profile_values || {}) };
    }
  }
  res.json({ ok: true });
});
app.get('/api/v1/payroll/runs', (req, res) => res.json({ runs: activeCtx(req).store.payrollRuns }));
app.post('/api/v1/payroll/run', (req, res) => {
  const { user, store } = activeCtx(req);
  const tenantUsers = Array.from(users.values()).filter((u) => u.tenant_id === user.tenant_id);
  const items = tenantUsers.map((u) => {
    const base = Number(u.profile_values?.BASE_SALARY || 0);
    const trans = Number(u.profile_values?.TRANSPORT_ALLOW || 0);
    const house = Number(u.profile_values?.HOUSING_ALLOW || 0);
    const gross = base + trans + house;
    const tax = Math.round(gross * 0.15);
    const pension = Math.round(base * 0.07);
    const net = Math.max(0, gross - tax - pension);
    return {
      id: `pi-${crypto.randomUUID().slice(0, 8)}`,
      user_id: u.id,
      employee_name: u.full_name,
      values: { BASE_SALARY: base, TRANSPORT_ALLOW: trans, HOUSING_ALLOW: house, GROSS: gross, INCOME_TAX: tax, PENSION_EE: pension },
      net_pay: String(net),
    };
  });
  const totalGross = items.reduce((a, i) => a + i.values.GROSS, 0);
  const totalNet = items.reduce((a, i) => a + Number(i.net_pay), 0);
  const run = {
    id: `pr-${crypto.randomUUID().slice(0, 8)}`,
    period_label: req.body?.period_label || new Date().toISOString().slice(0, 7),
    period_header: req.body?.period_label || new Date().toISOString().slice(0, 7),
    frequency: req.body?.frequency || 'monthly',
    status: 'draft',
    total_gross: String(totalGross),
    total_net: String(totalNet),
    item_count: items.length,
    created_at: new Date().toISOString(),
    items,
    run: { components: PAYROLL_COMPONENTS },
  };
  store.payrollRuns.unshift(run);
  res.status(201).json({ run });
});
app.get('/api/v1/payroll/runs/:id', (req, res) => {
  const { store } = activeCtx(req);
  const run = store.payrollRuns.find((r) => r.id === req.params.id);
  res.json({ run });
});
app.get('/api/v1/payroll/runs/:id/export', (req, res) => {
  const { store } = activeCtx(req);
  const run = store.payrollRuns.find((r) => r.id === req.params.id);
  const header = ['Employee', 'Base Salary', 'Gross', 'Income Tax', 'Pension', 'Net Pay'].join(',');
  const rows = (run?.items || []).map((i) =>
    [`"${i.employee_name}"`, i.values?.BASE_SALARY ?? 0, i.values?.GROSS ?? 0, i.values?.INCOME_TAX ?? 0, i.values?.PENSION_EE ?? 0, i.net_pay].join(',')
  );
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="payroll-${req.params.id.slice(0, 8)}.csv"`);
  res.send([header, ...rows].join('\n'));
});
app.patch('/api/v1/payroll/runs/:id/approve', (req, res) => {
  const { store } = activeCtx(req);
  const run = store.payrollRuns.find((r) => r.id === req.params.id);
  if (run) run.status = 'approved';
  res.json({ run });
});
app.patch('/api/v1/payroll/runs/:id/paid', (req, res) => {
  const { store } = activeCtx(req);
  const run = store.payrollRuns.find((r) => r.id === req.params.id);
  if (run && run.status !== 'paid') {
    run.status = 'paid';
    const amt = Number(run.total_net || 0);
    if (amt > 0) {
      appendGlEntry(store, { voucher_type: 'Payroll Run', voucher_no: run.period_label || run.id.slice(0, 6), account_code: '5200', debit: amt, credit: 0, remarks: `Payroll ${run.period_label}` });
      appendGlEntry(store, { voucher_type: 'Payroll Run', voucher_no: run.period_label || run.id.slice(0, 6), account_code: '1120', debit: 0, credit: amt, remarks: `Payroll disbursement ${run.period_label}` });
    }
  }
  res.json({ run });
});
app.delete('/api/v1/payroll/runs/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.payrollRuns = store.payrollRuns.filter((r) => r.id !== req.params.id);
  res.json({ ok: true });
});
app.get('/api/v1/payroll/my-payslips', (req, res) => {
  const { user, store } = activeCtx(req);
  const payslips = store.payrollRuns.flatMap((r) =>
    (r.items || []).filter((i) => i.user_id === user.id).map((i) => ({ ...i, period_label: r.period_label, period_header: r.period_header, status: r.status }))
  );
  res.json({ payslips });
});

app.get('/api/v1/users', (req, res) => {
  const { user } = activeCtx(req);
  const list = Array.from(users.values()).filter((u) => u.tenant_id === user.tenant_id).map((u) => ({
    id: u.id,
    email: u.email,
    full_name: u.full_name,
    role: u.role,
    is_active: u.is_active ?? true,
    created_at: u.created_at,
    job_roles: [],
  }));
  res.json({ users: list });
});
app.get('/api/v1/users/roles', (_req, res) => res.json({ roles: [{ id: 'role-staff', name: 'staff', description: 'Standard staff access' }] }));
app.post('/api/v1/users', (req, res) => {
  const { user } = activeCtx(req);
  const email = String(req.body?.email || '').trim().toLowerCase();
  if (users.has(email)) return res.status(409).json({ error: 'Email already exists' });
  const staff = {
    id: `user-${crypto.randomUUID().slice(0, 8)}`,
    email,
    password: String(req.body?.password || 'password123'),
    full_name: String(req.body?.full_name || 'Staff Member').trim(),
    role: 'staff',
    is_active: true,
    tenant_id: user.tenant_id,
    created_at: new Date().toISOString(),
    profile_values: { BASE_SALARY: 0, TRANSPORT_ALLOW: 0, HOUSING_ALLOW: 0 },
  };
  users.set(email, staff);
  res.status(201).json({ user: staff });
});
app.patch('/api/v1/users/:id', (req, res) => {
  for (const u of users.values()) {
    if (u.id === req.params.id) {
      if (req.body?.is_active !== undefined) u.is_active = Boolean(req.body.is_active);
      return res.json({ user: u });
    }
  }
  res.status(404).json({ error: 'User not found' });
});

app.get('/api/v1/billing/plans', (_req, res) => {
  res.json({
    plans: [
      { id: 'plan-starter', code: 'starter', name: 'Starter', business_types: ['pharmacy', 'store', 'hospital', 'school'], price_monthly: '1500', price_semiannual: '8000', price_annual: '15000', description: 'Single-branch workspace', features: ['POS & Inventory', 'Up to 5 staff', 'Reports & Receipts'] },
      { id: 'plan-pro', code: 'pro', name: 'Growth', business_types: ['pharmacy', 'store', 'hospital', 'school'], price_monthly: '3500', price_semiannual: '19000', price_annual: '35000', description: 'Full suite with Payroll & Marketing', features: ['Unlimited staff', 'Payroll & Expenses', 'Marketing & Telegram Bot'] },
    ],
  });
});
app.get('/api/v1/billing/subscription', (_req, res) => res.json({ subscription: null, access_until: demoTrialEnds }));
app.get('/api/v1/billing/payments', (_req, res) => res.json({ payments: [] }));
app.get('/api/v1/billing/providers', (_req, res) => res.json({ providers: [{ id: 'cbe', name: 'CBE Birr', configured: true }] }));
app.post('/api/v1/billing/checkout', (req, res) => res.json({ checkout_url: null, tx_ref: `TX-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, mock: false, provider: req.body?.provider || 'cbe' }));
app.post('/api/v1/billing/verify', (_req, res) => res.json({ ok: true, access_until: demoTrialEnds }));

/* ── Bot Studio Endpoints ──────────────────────────────────── */
app.get('/api/v1/telegram/config', (req, res) => {
  const { store } = activeCtx(req);
  if (store.tenantBot) {
    return res.json({ enabled: store.tenantBot.is_active, bot_username: store.tenantBot.bot_username, is_tenant_bot: true, linked: true, app_url: store.tenantBot.share_url });
  }
  res.json({ enabled: false, bot_username: null, linked: false, app_url: '' });
});
app.get('/api/v1/tenant-bot', (req, res) => res.json({ bot: activeCtx(req).store.tenantBot }));
app.post('/api/v1/tenant-bot/register', (req, res) => {
  const { tenant, store } = activeCtx(req);
  const slug = tenant?.slug || 'workspace';
  store.tenantBot = {
    id: `bot-${crypto.randomUUID().slice(0, 8)}`,
    bot_username: `${slug.replace(/-/g, '_')}_bot`,
    bot_id: 900123456,
    display_name: `${tenant?.name || 'Workspace'} Assistant`,
    description: 'Company Telegram Bot & Mini App',
    welcome_message: `Welcome {name} to ${tenant?.name || 'our store'}!`,
    commands: [{ trigger: '/hours', response: 'Open Mon–Sat 8:00 AM – 8:00 PM' }],
    auto_reply: true,
    is_active: true,
    broadcast_limit_per_day: 3,
    total_subscribers: store.botSubscribers.length,
    total_subscribers_ever: store.botSubscribers.length,
    last_broadcast_at: null,
    share_url: `https://t.me/${slug.replace(/-/g, '_')}_bot`,
    total_broadcasts: store.botBroadcasts.length,
  };
  res.status(201).json({ id: store.tenantBot.id, bot: store.tenantBot });
});
app.post('/api/v1/tenant-bot/pause', (req, res) => {
  const { store } = activeCtx(req);
  if (store.tenantBot) store.tenantBot.is_active = false;
  res.json({ ok: true });
});
app.post('/api/v1/tenant-bot/resume', (req, res) => {
  const { store } = activeCtx(req);
  if (store.tenantBot) store.tenantBot.is_active = true;
  res.json({ ok: true });
});
app.patch('/api/v1/tenant-bot', (req, res) => {
  const { store } = activeCtx(req);
  if (store.tenantBot) Object.assign(store.tenantBot, req.body ?? {});
  res.json({ bot: store.tenantBot });
});
app.get('/api/v1/tenant-bot/subscribers', (req, res) => res.json({ subscribers: activeCtx(req).store.botSubscribers }));
app.get('/api/v1/tenant-bot/broadcasts', (req, res) => res.json({ broadcasts: activeCtx(req).store.botBroadcasts }));
app.get('/api/v1/tenant-bot/receipts', (req, res) => res.json({ receipts: activeCtx(req).store.botReceipts }));
app.get('/api/v1/tenant-bot/miniapp', (req, res) => {
  const { tenant, store } = activeCtx(req);
  res.json({
    miniapp: {
      tenant_id: tenant?.id || '',
      name: tenant?.name || 'Workspace',
      slug: tenant?.slug || 'workspace',
      bot_slug: store.botSlug || tenant?.slug || 'workspace',
      currency: store.settings.currency || 'ETB',
      brand: store.botBrand || { primary: '#1f6f5c', accent: '#e0a33e', tagline: '' },
      bot_username: store.tenantBot?.bot_username || null,
      launch_url: store.tenantBot ? `https://t.me/${store.tenantBot.bot_username}?startapp=${store.botSlug || tenant?.slug || 'app'}` : null,
    },
  });
});
app.patch('/api/v1/tenant-bot/miniapp', (req, res) => {
  const { store } = activeCtx(req);
  if (req.body?.bot_slug) store.botSlug = req.body.bot_slug;
  if (req.body?.brand) store.botBrand = req.body.brand;
  res.json({ bot_slug: store.botSlug || null, brand: store.botBrand || {} });
});
app.post('/api/v1/tenant-bot/broadcast', (req, res) => {
  const { store } = activeCtx(req);
  const count = store.botSubscribers.length;
  store.botBroadcasts.unshift({
    id: `bc-${crypto.randomUUID().slice(0, 8)}`,
    message: req.body?.message || '',
    recipients: count,
    delivered: count,
    failed: 0,
    status: 'sent',
    error: null,
    sent_at: new Date().toISOString(),
    created_at: new Date().toISOString(),
  });
  if (store.tenantBot) store.tenantBot.last_broadcast_at = new Date().toISOString();
  res.json({ delivered: count, failed: 0 });
});

/* ── Marketing ─────────────────────────────────────────────── */
app.get('/api/v1/marketing/analytics/overview', (req, res) => {
  const { store } = activeCtx(req);
  res.json({
    contacts: { total: store.marketingContacts.length },
    campaigns: { total: store.marketingCampaigns.length },
    messages: { sent: 0, delivered: 0 },
    recent: store.marketingCampaigns.slice(0, 5),
  });
});
app.get('/api/v1/marketing/analytics/channels', (_req, res) => {
  res.json({
    sms: { sent: '0', delivered: '0', failed: '0' },
    email: { sent: '0', delivered: '0', failed: '0', opened: '0', clicked: '0' },
  });
});
app.get('/api/v1/marketing/contacts', (req, res) => res.json({ contacts: activeCtx(req).store.marketingContacts }));
app.post('/api/v1/marketing/contacts', (req, res) => {
  const { store } = activeCtx(req);
  const c = { id: `mc-${crypto.randomUUID().slice(0, 8)}`, status: 'active', ...req.body, created_at: new Date().toISOString() };
  store.marketingContacts.unshift(c);
  res.status(201).json({ contact: c });
});
app.get('/api/v1/marketing/audiences', (req, res) => res.json({ audiences: activeCtx(req).store.marketingAudiences }));
app.get('/api/v1/marketing/audiences/:id', (req, res) => {
  const { store } = activeCtx(req);
  res.json(store.marketingAudiences.find((a) => a.id === req.params.id) || null);
});
app.post('/api/v1/marketing/audiences', (req, res) => {
  const { store } = activeCtx(req);
  const a = { id: `ma-${crypto.randomUUID().slice(0, 8)}`, member_count: Array.isArray(req.body?.members) ? req.body.members.length : 0, ...req.body };
  store.marketingAudiences.unshift(a);
  res.status(201).json({ audience: a });
});
app.put('/api/v1/marketing/audiences/:id', (req, res) => {
  const { store } = activeCtx(req);
  const a = store.marketingAudiences.find((x) => x.id === req.params.id);
  if (a) Object.assign(a, req.body);
  res.json({ audience: a });
});
app.get('/api/v1/marketing/templates', (req, res) => res.json({ templates: activeCtx(req).store.marketingTemplates }));
app.post('/api/v1/marketing/templates', (req, res) => {
  const { store } = activeCtx(req);
  const t = { id: `mt-${crypto.randomUUID().slice(0, 8)}`, status: 'published', ...req.body };
  store.marketingTemplates.unshift(t);
  res.status(201).json({ template: t });
});
app.get('/api/v1/marketing/campaigns', (req, res) => res.json({ campaigns: activeCtx(req).store.marketingCampaigns }));
app.post('/api/v1/marketing/campaigns', (req, res) => {
  const { store } = activeCtx(req);
  const aud = store.marketingAudiences.find((a) => a.id === req.body?.audience_id);
  const c = {
    id: `cmp-${crypto.randomUUID().slice(0, 8)}`,
    ...req.body,
    audience_name: aud?.name || null,
    channel_count: Array.isArray(req.body?.channels) ? req.body.channels.length : 0,
    recipients: aud?.member_count || 0,
    status: 'draft',
    created_at: new Date().toISOString(),
  };
  store.marketingCampaigns.unshift(c);
  res.status(201).json({ campaign: c });
});
app.post('/api/v1/marketing/campaigns/:id/send', (req, res) => {
  const { store } = activeCtx(req);
  const c = store.marketingCampaigns.find((x) => x.id === req.params.id);
  if (c) c.status = 'completed';
  res.json({ queued: c?.recipients || 0 });
});

/* ── Admin ─────────────────────────────────────────────────── */
app.get('/api/v1/admin/stats', (_req, res) => {
  const list = Array.from(tenants.values());
  const by_type = list.reduce((acc, t) => {
    acc[t.business_type] = (acc[t.business_type] || 0) + 1;
    return acc;
  }, {});
  res.json({
    by_type,
    total_tenants: list.length,
    active_tenants: list.filter((t) => t.status === 'active' || t.status === 'trial').length,
    expiring_soon: list.filter((t) => t.status === 'trial' && t.trial_days_left <= 7).length,
  });
});
app.get('/api/v1/admin/tenants', (req, res) => {
  const search = String(req.query.search || '').toLowerCase();
  const list = Array.from(tenants.values()).filter((t) => !search || t.name.toLowerCase().includes(search));
  res.json({ tenants: list, total: list.length });
});
app.patch('/api/v1/admin/tenants/:id', (req, res) => {
  const t = tenants.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  if (req.body?.status) t.status = req.body.status;
  recordAudit(t.name, 'Admin', 'tenant.status_change', 'tenant', { status: t.status });
  res.json({ tenant: t });
});
app.post('/api/v1/admin/tenants/:id/extend', (req, res) => {
  const t = tenants.get(req.params.id);
  if (!t) return res.status(404).json({ error: 'Tenant not found' });
  const days = Math.max(1, Number(req.body?.days || 30));
  const nextEnd = new Date(new Date(t.trial_ends_at).getTime() + days * 86400000);
  t.trial_ends_at = nextEnd.toISOString();
  t.trial_days_left = Math.max(0, Math.round((nextEnd.getTime() - Date.now()) / 86400000));
  recordAudit(t.name, 'Admin', 'tenant.extend', 'tenant', { days });
  res.json({ tenant: t });
});
app.post('/api/v1/admin/users/:id/reset-password', (req, res) => {
  const { new_password } = req.body ?? {};
  if (!new_password || String(new_password).length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  for (const u of users.values()) {
    if (u.id === req.params.id) {
      u.password = String(new_password);
      recordAudit(null, 'Admin', 'user.reset_password', 'user', { email: u.email });
      return res.json({ ok: true });
    }
  }
  res.status(404).json({ error: 'User not found' });
});
app.get('/api/v1/admin/audit', (_req, res) => res.json({ logs: auditLogs }));

// Fallback for any other /api/v1/* endpoints so pages never crash with 404/500
app.all('/api/v1/*splat', (req, res) => {
  if (req.method === 'GET') {
    return res.json({
      items: [],
      rows: [],
      data: [],
      users: [],
      roles: [],
      departments: [],
      expenses: [],
      employees: [],
      campaigns: [],
      contacts: [],
      audiences: [],
      templates: [],
      suppliers: [],
      customers: [],
      purchases: [],
      adjustments: [],
      batches: [],
      patients: [],
      appointments: [],
      doctors: [],
      records: [],
      invoices: [],
      students: [],
      classes: [],
      fees: [],
      announcements: [],
      settings: {},
      session: null,
    });
  }
  return res.json({ ok: true });
});

async function startServer() {
  const isProd = process.env.NODE_ENV === 'production';
  if (!isProd) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(import.meta.dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*splat', (_req, res) => {
      const indexFile = path.join(distPath, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Build output not found. Run npm run build first.');
      }
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`AFRO-TECH & AFRO Suite running on http://0.0.0.0:${port}`);
  });
}

startServer();
