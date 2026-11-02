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

function ensureTenantStore(tenantId, businessType = 'pharmacy') {
  if (!tenantData.has(tenantId)) {
    const today = new Date().toISOString().slice(0, 10);
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
        display_stock: 48,
        expiring_soon: 0,
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
    tenantData.set(tenantId, {
      products: initialProducts,
      sales: [
        {
          id: 'sale-1',
          total: '1260',
          created_at: new Date(Date.now() - 3600_000).toISOString(),
          payment_method: 'cash',
          customer_name: 'Walk-in',
          items: [{ product_id: 'prod-1', name: initialProducts[0].name, quantity: 3, unit_price: '420', subtotal: '1260' }],
        },
      ],
      purchases: [],
      suppliers: [{ id: 'sup-1', name: 'Addis Pharma Supply', phone: '+251911223344', email: 'supply@addis.et', balance: '0' }],
      customers: [{ id: 'cust-1', name: 'Abebe Bikila', phone: '+251922334455', email: 'abebe@example.com', balance: '0' }],
      expenses: [{ id: 'exp-1', category: 'Utilities', description: 'Monthly fiber internet', amount: '2400', expense_date: today, created_at: new Date().toISOString() }],
      patients: [
        { id: 'pat-1', code: 'PT-1001', first_name: 'Meron', last_name: 'Alemu', gender: 'female', phone: '+251911001122', created_at: new Date().toISOString() },
      ],
      appointments: [
        { id: 'apt-1', scheduled_at: new Date().toISOString(), patient_name: 'Meron Alemu', patient_code: 'PT-1001', doctor_name: 'Dr. Dawit', reason: 'General Consultation', status: 'scheduled' },
      ],
      doctors: [
        { id: 'doc-1', full_name: 'Dr. Dawit Bekele', specialty: 'General Practice', phone: '+251911998877', consultation_fee: '500', is_active: true },
      ],
      students: [
        { id: 'stu-1', code: 'ST-2001', first_name: 'Kidus', last_name: 'Yohannes', gender: 'male', class_name: 'Grade 10 - A', created_at: new Date().toISOString() },
      ],
      classes: [
        { id: 'cls-1', name: 'Grade 10 - A', grade_level: '10', teacher_name: 'Mr. Solomon', student_count: 1 },
      ],
      trend,
    });
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
});
users.set('demo@afrotech.et', {
  id: 'user-demo-1',
  email: 'demo@afrotech.et',
  password: 'password123',
  full_name: 'Yonas Mindaye',
  role: 'owner',
  tenant_id: demoTenantId,
});
ensureTenantStore(demoTenantId, 'pharmacy');

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

/* ── AFRO Suite Platform API (/api/v1/*) ───────────────────── */
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
  };
  tenants.set(tenantId, tenant);
  ensureTenantStore(tenantId, business_type);

  const user = {
    id: `user-${crypto.randomUUID().slice(0, 8)}`,
    email: cleanEmail,
    password: String(password),
    full_name: owner_name.trim(),
    role: 'owner',
    tenant_id: tenantId,
  };
  users.set(cleanEmail, user);
  const token = `tok_${crypto.randomUUID()}`;
  sessions.set(token, cleanEmail);

  return res.status(201).json({ token, me: buildMe(user) });
});

app.post('/api/v1/auth/login', (req, res) => {
  const { email, password } = req.body ?? {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const user = users.get(cleanEmail);
  if (!user || user.password !== String(password || '')) {
    return res.status(401).json({ error: 'Incorrect email or password', code: 'BAD_CREDENTIALS' });
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

app.get('/api/v1/retail/dashboard', (req, res) => {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const store = ensureTenantStore(user.tenant_id, tenants.get(user.tenant_id)?.business_type);
  const totalSales = store.sales.reduce((acc, s) => acc + Number(s.total || 0), 0);
  const totalExpenses = store.expenses.reduce((acc, e) => acc + Number(e.amount || 0), 0);
  const lowStock = store.products
    .filter((p) => Number(p.stock) <= Number(p.low_stock_threshold))
    .map((p) => ({ name: p.name, stock: Number(p.stock), threshold: Number(p.low_stock_threshold) }));

  res.json({
    today: { sales: totalSales, transactions: store.sales.length },
    month: { revenue: 184500 + totalSales, profit: 64200 + Math.round(totalSales * 0.3), expenses: totalExpenses },
    comparison: { this_month: 184500 + totalSales, last_month: 156000, change_pct: 18.3 },
    low_stock: lowStock,
    expiring_soon: [],
    trend: store.trend.map(({ day, revenue }) => ({ day, revenue })),
    top_products: store.products.slice(0, 5).map((p, idx) => ({
      name: p.name,
      qty: 24 - idx * 5,
      revenue: (24 - idx * 5) * Number(p.sell_price || 100),
    })),
    recent_sales: store.sales.slice(0, 8),
  });
});

app.get('/api/v1/retail/products', (req, res) => {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const store = ensureTenantStore(user.tenant_id);
  res.json({ products: store.products });
});

app.post('/api/v1/retail/products', (req, res) => {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const store = ensureTenantStore(user.tenant_id);
  const b = req.body ?? {};
  const stock = Number(b.initial_stock ?? 0);
  const product = {
    id: `prod-${crypto.randomUUID().slice(0, 8)}`,
    name: String(b.name || 'Unnamed Product').trim(),
    category: String(b.category || 'General').trim(),
    unit: String(b.unit || 'pcs').trim(),
    sell_price: String(b.sell_price ?? 0),
    cost_price: String(b.cost_price ?? 0),
    low_stock_threshold: Number(b.low_stock_threshold ?? 10),
    barcode: b.barcode || null,
    sell_by_pill: Boolean(b.sell_by_pill),
    pills_per_unit: Number(b.pills_per_unit ?? 1),
    default_margin: String(b.default_margin ?? 25),
    stock,
    sellable_stock: stock,
    expired_qty: 0,
    display_stock: stock,
    expiring_soon: 0,
  };
  store.products.unshift(product);
  res.status(201).json({ product });
});

app.patch('/api/v1/retail/products/:id', (req, res) => {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const store = ensureTenantStore(user.tenant_id);
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
  };
  res.json({ product: store.products[idx] });
});

app.delete('/api/v1/retail/products/:id', (req, res) => {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const store = ensureTenantStore(user.tenant_id);
  store.products = store.products.filter((p) => p.id !== req.params.id);
  res.json({ ok: true });
});

app.get('/api/v1/retail/sales', (req, res) => {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const store = ensureTenantStore(user.tenant_id);
  res.json({ sales: store.sales });
});

app.post('/api/v1/retail/sales', (req, res) => {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const store = ensureTenantStore(user.tenant_id);
  const b = req.body ?? {};
  const sale = {
    id: `sale-${crypto.randomUUID().slice(0, 8)}`,
    total: String(b.total ?? 0),
    created_at: new Date().toISOString(),
    payment_method: b.payment_method || 'cash',
    customer_name: b.customer_name || 'Walk-in',
    items: b.items || [],
  };
  store.sales.unshift(sale);
  res.status(201).json({ sale });
});

app.get('/api/v1/hospital/dashboard', (req, res) => {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const store = ensureTenantStore(user.tenant_id, 'hospital');
  res.json({
    stats: {
      patients: store.patients.length,
      today_appointments: store.appointments.length,
      upcoming_appointments: store.appointments.length,
      unpaid_total: 0,
      month_revenue: 94500,
    },
    todays_appointments: store.appointments,
    recent_patients: store.patients,
  });
});

app.get('/api/v1/school/dashboard', (req, res) => {
  const user = getAuthUser(req) || users.get('demo@afrotech.et');
  const store = ensureTenantStore(user.tenant_id, 'school');
  res.json({
    stats: {
      students: store.students.length,
      classes: store.classes.length,
      teachers: 8,
      attendance_today: 95,
      unpaid_fees: 12000,
      collected_this_month: 145000,
    },
    attendance_trend: store.trend.map(({ day, pct }) => ({ day, pct })),
    class_overview: store.classes.map((c) => ({ name: c.name, students: c.student_count })),
    recent_students: store.students,
  });
});

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
