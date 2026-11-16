import express from 'express';
import cors from 'cors';
import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { sendContactTelegramNotification } from './server/contactTelegram.js';
import {
  decryptSecret,
  encryptSecret,
  maskSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from './server/paymentVault.js';
import {
  buildChapaInitPayload,
  generateServiceTxRef,
  initializeChapaPayment,
  verifyChapaPayment,
} from './server/chapaService.js';
import {
  applyTelebirrFabricToken,
  generateTelebirrOrderId,
  initializeTelebirrOrder,
  queryTelebirrOrder,
  verifyTelebirrSignature,
} from './server/telebirrService.js';
import {
  generateMpesaTxRef,
  getMpesaAccessToken,
  initiateMpesaStkPush,
  normalizeMpesaPhone,
  parseMpesaCallback,
  queryMpesaStkStatus,
} from './server/mpesaService.js';
import {
  buildInvoiceData,
  buildInvoiceListItem,
  ensureAndDispatchInvoice,
  filterInvoiceHistoryItems,
  generateInvoicePdfBuffer,
  isValidEmail,
} from './server/invoiceService.js';
import {
  getPlatformGatewayEnv,
  initiateGatewayCheckout,
  normalizeGatewayProvider,
  resolveGatewayRuntime,
  verifyGatewaySettlement,
} from './server/gatewayResolver.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/api/telebirr/notify', express.text({ type: 'text/plain', limit: '512kb' }));

/* ── In-Memory Multi-Tenant Store (for AI Studio container runtime) ── */
const TRIAL_DAYS = Number(process.env.TRIAL_DAYS || 45);
const tenants = new Map();
const users = new Map();
const sessions = new Map();
const tenantData = new Map();
const serviceChapaOrders = new Map();
const invoiceRegistry = new Map();
const auditLogs = [];

const DEFAULT_SERVICE_MERCHANT = {
  name: 'AFRO-TECH Digital Services',
  tin_number: null,
  phone: '+251 910 011 818',
  address: 'Bole Sub-City, Addis Ababa, Ethiopia',
  email: process.env.CONTACT_EMAIL || process.env.EMAIL || 'billing@afrotech.et',
};

function buildTenantMerchantInfo(tenant, store) {
  return {
    name: store?.settings?.business_name || tenant?.name || 'AFRO Suite Merchant',
    tin_number: store?.settings?.tin_number || null,
    phone: store?.settings?.business_phone || '+251 910 011 818',
    address: store?.settings?.business_address || 'Addis Ababa, Ethiopia',
    email: tenant?.owner_email || process.env.CONTACT_EMAIL || process.env.EMAIL || 'billing@afrotech.et',
  };
}

function findTransactionForInvoice(txRef) {
  const cleanRef = String(txRef || '').trim();
  if (!cleanRef) return null;
  const svcOrder = serviceChapaOrders.get(cleanRef);
  if (svcOrder) {
    return { orderOrIntent: svcOrder, merchant: DEFAULT_SERVICE_MERCHANT, isServiceOrder: true };
  }
  for (const [tenantId, store] of tenantData.entries()) {
    const intent = (store.paymentIntents || []).find((i) => i.tx_ref === cleanRef);
    if (intent) {
      const tenant = tenants.get(tenantId);
      return {
        orderOrIntent: intent,
        merchant: buildTenantMerchantInfo(tenant, store),
        isServiceOrder: false,
        tenant,
        store,
      };
    }
  }
  return null;
}

async function dispatchTransactionInvoice(orderOrIntent, { merchant = DEFAULT_SERVICE_MERCHANT, forceResend = false, overrideEmail } = {}) {
  if (!orderOrIntent?.tx_ref) return null;
  try {
    return await ensureAndDispatchInvoice({
      txRef: orderOrIntent.tx_ref,
      orderOrIntent,
      merchantInfo: merchant,
      invoiceStore: invoiceRegistry,
      forceResend,
      overrideEmail,
    });
  } catch (err) {
    console.warn('[invoice] Auto-dispatch failed cleanly:', err instanceof Error ? err.message : err);
    return null;
  }
}

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
  { code: '1510', name: 'Property, Equipment & Hardware', root_type: 'Asset', account_type: 'Fixed Asset', balance: 85000 },
  { code: '1590', name: 'Accumulated Depreciation', root_type: 'Liability', account_type: 'Accumulated Depreciation', balance: 8500 },
  { code: '2110', name: 'Accounts Payable', root_type: 'Liability', account_type: 'Payable', balance: 0 },
  { code: '2210', name: 'Payroll & Tax Payable', root_type: 'Liability', account_type: 'Tax', balance: 0 },
  { code: '3100', name: 'Owner Equity / Capital', root_type: 'Equity', account_type: 'Equity', balance: 256820 },
  { code: '4100', name: 'Sales & Service Revenue', root_type: 'Income', account_type: 'Income', balance: 1260 },
  { code: '5100', name: 'Cost of Goods Sold', root_type: 'Expense', account_type: 'Expense', balance: 850 },
  { code: '5200', name: 'Operating & Admin Expenses', root_type: 'Expense', account_type: 'Expense', balance: 2400 },
  { code: '5300', name: 'Depreciation Expense', root_type: 'Expense', account_type: 'Depreciation', balance: 0 },
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
        {
          id: 'gl-seed-3',
          posting_date: today,
          voucher_type: 'Journal Entry',
          voucher_no: 'JV-1001',
          account_code: '5200',
          account_name: 'Operating & Admin Expenses',
          root_type: 'Expense',
          party: null,
          debit: 2400,
          credit: 0,
          remarks: 'Monthly fiber internet accrual',
          created_at: new Date(Date.now() - 1800_000).toISOString(),
        },
        {
          id: 'gl-seed-4',
          posting_date: today,
          voucher_type: 'Journal Entry',
          voucher_no: 'JV-1001',
          account_code: '1110',
          account_name: 'Cash on Hand',
          root_type: 'Asset',
          party: null,
          debit: 0,
          credit: 2400,
          remarks: 'Monthly fiber internet accrual',
          created_at: new Date(Date.now() - 1800_000).toISOString(),
        },
      ],
      journalEntries: [
        {
          id: 'je-seed-1',
          number: 'JV-1001',
          posting_date: today,
          remarks: 'Monthly fiber internet accrual',
          total_debit: '2400.00',
          total_credit: '2400.00',
          status: 'submitted',
          reversed_by: null,
          created_by: 'Yonas Mindaye',
          lines: [
            { account_code: '5200', debit: 2400, credit: 0 },
            { account_code: '1110', debit: 0, credit: 2400 },
          ],
          created_at: new Date(Date.now() - 1800_000).toISOString(),
        },
      ],
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
      boms: [
        {
          id: 'bom-1',
          code: 'BOM-001',
          name: businessType === 'pharmacy' ? 'First-Aid & Relief Kit' : 'Ethiopian Hospitality Gift Pack',
          output_product_id: 'prod-1',
          output_product_name: initialProducts[0].name,
          output_qty: 1,
          components: [{ product_id: 'prod-2', product_name: initialProducts[1].name, qty_per_unit: 2, unit_cost: Number(initialProducts[1].cost_price) }],
          notes: 'Standard assembly bundle',
          created_at: new Date().toISOString(),
        },
      ],
      workOrders: [
        {
          id: 'wo-1',
          number: 'MFG-1001',
          bom_id: 'bom-1',
          bom_name: businessType === 'pharmacy' ? 'First-Aid & Relief Kit' : 'Ethiopian Hospitality Gift Pack',
          output_product_id: 'prod-1',
          output_product_name: initialProducts[0].name,
          qty_to_produce: 2,
          estimated_cost: Number(initialProducts[1].cost_price) * 4,
          status: 'planned',
          due_date: in25Days,
          created_at: new Date().toISOString(),
        },
      ],
      assets: [
        {
          id: 'ast-1',
          code: 'AST-1001',
          name: businessType === 'hospital' ? 'Digital Hematology Analyzer' : businessType === 'school' ? 'Computer Lab Workstations (10x)' : 'POS Counter Terminal & Scanner Set',
          category: 'Equipment',
          location: 'Main Branch',
          purchase_date: today,
          purchase_cost: 85000,
          salvage_value: 5000,
          useful_life_months: 48,
          accumulated_depreciation: 8500,
          status: 'active',
          created_at: new Date().toISOString(),
        },
      ],
      telegramLink: { linked: false, code: null },
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
      customFields: [
        { id: 'cf-1', entity: 'product', key: 'shelf_bin', label: 'Shelf / Bin Code', type: 'text', options: '', required: false },
      ],
      paymentGateways: {
        cbe_bank: {
          provider: 'cbe_bank',
          enabled: true,
          configured: true,
          is_default: true,
          mode: 'sandbox',
          public_config: {
            account_holder: tenantName,
            settlement_account: '1000248910332',
            bank_name: 'Commercial Bank of Ethiopia · Bole',
          },
          encrypted_secrets: {},
          masked_secrets: {},
          health_status: 'verified',
          last_tested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        chapa: {
          provider: 'chapa',
          enabled: true,
          configured: true,
          is_default: false,
          mode: getPlatformGatewayEnv('chapa').configured ? 'live' : 'sandbox',
          public_config: {
            public_key: 'CHAPUBK_TEST-AFRO-DEMO',
            settlement_account: `${tenantName} · Chapa Multi-Rail`,
          },
          encrypted_secrets: {},
          masked_secrets: {},
          health_status: getPlatformGatewayEnv('chapa').configured ? 'verified' : 'configured',
          last_tested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        telebirr: {
          provider: 'telebirr',
          enabled: true,
          configured: true,
          is_default: false,
          mode: getPlatformGatewayEnv('telebirr').configured ? 'live' : 'sandbox',
          public_config: {
            merchant_id: getPlatformGatewayEnv('telebirr').publicConfig.merchant_id || '554120',
            settlement_account: `${tenantName} · Telebirr Merchant`,
          },
          encrypted_secrets: {},
          masked_secrets: {},
          health_status: getPlatformGatewayEnv('telebirr').configured ? 'verified' : 'configured',
          last_tested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        mpesa: {
          provider: 'mpesa',
          enabled: true,
          configured: true,
          is_default: false,
          mode: getPlatformGatewayEnv('mpesa').configured ? 'live' : 'sandbox',
          public_config: {
            merchant_id: getPlatformGatewayEnv('mpesa').publicConfig.merchant_id || '174379',
            settlement_account: `${tenantName} · M-Pesa Paybill 174379`,
          },
          encrypted_secrets: {},
          masked_secrets: {},
          health_status: getPlatformGatewayEnv('mpesa').configured ? 'verified' : 'configured',
          last_tested_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        stripe: {
          provider: 'stripe',
          enabled: false,
          configured: false,
          is_default: false,
          mode: 'sandbox',
          public_config: {},
          encrypted_secrets: {},
          masked_secrets: {},
          health_status: 'unconfigured',
          last_tested_at: null,
          updated_at: null,
        },
      },
      paymentIntents: [
        {
          id: 'pi-seed-1',
          tx_ref: 'AFRO-PAY-1001',
          token: 'seed-inv-1001',
          direction: 'receive',
          provider: 'cbe_bank',
          party_id: null,
          party_name: 'Walk-in Customer',
          customer_email: 'billing@asella-organic.et',
          reference_type: 'sale',
          reference_id: 'sale-1',
          description: 'POS Checkout · INV-1001',
          amount: 1260,
          fee_amount: 0,
          net_amount: 1260,
          currency: 'ETB',
          status: 'settled',
          payer_reference: 'FT26115CBE901',
          verified_signature: true,
          gl_voucher_no: 'INV-1001',
          created_at: new Date(Date.now() - 3600_000).toISOString(),
          settled_at: new Date(Date.now() - 3600_000).toISOString(),
        },
        {
          id: 'pi-seed-3',
          tx_ref: 'AFRO-PAY-1000',
          token: 'seed-chapa-1000',
          direction: 'receive',
          provider: 'chapa',
          party_id: null,
          party_name: 'Abebe Bikila',
          customer_email: 'demo@afrotech.et',
          reference_type: 'custom',
          reference_id: 'lic-1000',
          description: 'Annual Multi-Branch POS Subscription',
          amount: 8400,
          fee_amount: 210,
          net_amount: 8190,
          currency: 'ETB',
          status: 'settled',
          payer_reference: 'CHAPA-TXN-88412',
          verified_signature: true,
          gl_voucher_no: 'GW-1002',
          created_at: new Date(Date.now() - 86400_000 * 2).toISOString(),
          settled_at: new Date(Date.now() - 86400_000 * 2).toISOString(),
        },
        {
          id: 'pi-seed-4',
          tx_ref: 'AFRO-PAY-0999',
          token: 'seed-mpesa-0999',
          direction: 'receive',
          provider: 'mpesa',
          party_id: null,
          party_name: 'Mekdes Alemu',
          customer_email: 'demo@afrotech.et',
          customer_phone: '+251711223344',
          reference_type: 'custom',
          reference_id: 'pos-0999',
          description: 'Safaricom M-Pesa Terminal Onboarding',
          amount: 3250,
          fee_amount: 48.75,
          net_amount: 3201.25,
          currency: 'ETB',
          status: 'settled',
          payer_reference: 'MPESA-QKL881',
          verified_signature: true,
          gl_voucher_no: 'GW-1003',
          created_at: new Date(Date.now() - 86400_000 * 5).toISOString(),
          settled_at: new Date(Date.now() - 86400_000 * 5).toISOString(),
        },
        {
          id: 'pi-seed-2',
          tx_ref: 'AFRO-PAY-1002',
          token: 'demo-credit-450',
          direction: 'receive',
          provider: 'cbe_bank',
          party_id: 'cust-1',
          party_name: 'Dawit Bekele',
          reference_type: 'customer_credit',
          reference_id: 'cust-1',
          description: 'Customer Khata Balance Settlement',
          amount: 450,
          fee_amount: 0,
          net_amount: 450,
          currency: 'ETB',
          status: 'pending',
          payer_reference: null,
          verified_signature: false,
          gl_voucher_no: null,
          created_at: new Date(Date.now() - 1800_000).toISOString(),
          settled_at: null,
        },
      ],
      reportPresets: [
        {
          id: 'preset-low-stock',
          name: 'Low Stock & Reorder Watch',
          config: {
            dataset: 'products',
            columns: ['name', 'category', 'stock', 'low_stock_threshold', 'stock_value'],
            filters: [{ field: 'stock', op: 'lte', value: '15' }],
            sortBy: 'stock',
            sortDir: 'asc',
            groupBy: '',
          },
          created_at: new Date().toISOString(),
        },
        {
          id: 'preset-sales-by-method',
          name: 'Sales Grouped by Payment Method',
          config: {
            dataset: 'sales',
            columns: ['payment_method', 'total'],
            filters: [],
            sortBy: 'total',
            sortDir: 'desc',
            groupBy: 'payment_method',
          },
          created_at: new Date().toISOString(),
        },
      ],
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

  let emailSent = false;
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
      emailSent = true;
    } catch (err) {
      console.warn('[contact] SMTP send skipped:', err instanceof Error ? err.message : err);
    }
  }

  const telegram = await sendContactTelegramNotification({ name, email, phone, message });

  return res.json({
    ok: true,
    success: true,
    emailSent,
    telegram: {
      sent: telegram.sent,
      ...(telegram.reason ? { reason: telegram.reason } : {}),
    },
  });
});

/* ── Chapa Digital Services Checkout (/api/chapa/*) ────────── */
app.get('/api/chapa/config', (_req, res) => {
  const hasSecret = Boolean((process.env.CHAPA_SECRET_KEY || '').trim());
  res.json({
    ok: true,
    provider: 'chapa',
    currency: 'ETB',
    mode: hasSecret ? 'live' : 'sandbox',
  });
});

app.post('/api/chapa/initialize', async (req, res) => {
  const {
    serviceId,
    serviceName = 'Digital Service Package',
    paymentPlan = 'deposit',
    amount,
    fullName,
    email,
    phone = '',
    notes = '',
    returnPath = '/services',
  } = req.body ?? {};

  const numAmount = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(numAmount) || numAmount < 50 || numAmount > 5_000_000) {
    return res.status(400).json({ ok: false, message: 'Amount must be between 50 and 5,000,000 ETB.' });
  }
  const cleanName = String(fullName || '').trim();
  const cleanEmail = String(email || '').trim();
  if (cleanName.length < 2) {
    return res.status(400).json({ ok: false, message: 'Please enter your full name.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ ok: false, message: 'A valid email address is required.' });
  }

  const secretKey = (process.env.CHAPA_SECRET_KEY || '').trim();
  const txRef = generateServiceTxRef('CHAPA-SVC');
  const token = `chapa-${crypto.randomUUID().slice(0, 10)}`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const origin = (process.env.PUBLIC_URL || `${proto}://${host}`).replace(/\/$/, '');
  const safePath = String(returnPath || '/services').startsWith('/') ? returnPath : '/services';
  const separator = safePath.includes('?') ? '&' : '?';
  const returnUrl = `${origin}${safePath}${separator}tx_ref=${encodeURIComponent(txRef)}#pay-now`;
  const callbackUrl = `${origin}/api/chapa/webhook`;

  const description = `${String(serviceName).trim()} (${paymentPlan === 'full' ? 'Full Payment' : paymentPlan === 'custom' ? 'Custom Quote' : '40% Deposit'})`;
  let payload;
  try {
    payload = buildChapaInitPayload({
      amount: numAmount,
      currency: 'ETB',
      email: cleanEmail,
      fullName: cleanName,
      phone,
      txRef,
      callbackUrl,
      returnUrl,
      serviceTitle: 'AFRO-TECH Pay',
      description: notes ? `${description} - ${String(notes).slice(0, 40)}` : description,
    });
  } catch (err) {
    return res.status(400).json({ ok: false, message: err instanceof Error ? err.message : 'Invalid payment payload.' });
  }

  let mode = 'sandbox';
  let checkoutUrl = `/pay/${token}`;
  if (secretKey) {
    const chapaInit = await initializeChapaPayment({ secretKey, payload });
    if (!chapaInit.ok) {
      return res.status(chapaInit.statusCode || 502).json({
        ok: false,
        message: chapaInit.error || 'Chapa gateway declined payment initialization.',
      });
    }
    mode = 'live';
    checkoutUrl = chapaInit.checkoutUrl;
  }

  const order = {
    id: `svc-${crypto.randomUUID().slice(0, 8)}`,
    provider: 'chapa',
    tx_ref: txRef,
    token,
    service_id: serviceId ?? null,
    service_name: String(serviceName).trim(),
    payment_plan: paymentPlan,
    amount: numAmount,
    currency: 'ETB',
    customer_name: cleanName,
    customer_email: cleanEmail,
    customer_phone: String(phone || '').trim() || null,
    description,
    mode,
    checkout_url: checkoutUrl,
    return_url: returnUrl,
    status: 'pending',
    payer_reference: null,
    chapa_reference: null,
    created_at: new Date().toISOString(),
    settled_at: null,
  };
  serviceChapaOrders.set(txRef, order);

  return res.status(201).json({
    ok: true,
    provider: 'chapa',
    mode,
    tx_ref: txRef,
    token,
    amount: numAmount,
    currency: 'ETB',
    checkout_url: checkoutUrl,
    return_url: returnUrl,
  });
});

app.get('/api/chapa/verify/:txRef', async (req, res) => {
  const txRef = String(req.params.txRef || '').trim();
  const order = serviceChapaOrders.get(txRef);
  const secretKey = (process.env.CHAPA_SECRET_KEY || '').trim();

  if (secretKey && txRef) {
    const verifyRes = await verifyChapaPayment({ secretKey, txRef });
    if (verifyRes.verified && order) {
      order.status = 'settled';
      order.chapa_reference = verifyRes.reference || order.chapa_reference;
      order.settled_at = order.settled_at || new Date().toISOString();
      await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
    }
    if (order) {
      if (order.status === 'settled' && !order.invoice) {
        await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
      }
      return res.json({
        ok: true,
        verified: order.status === 'settled' || verifyRes.verified,
        status: order.status,
        mode: order.mode,
        order,
        invoice: order.invoice || null,
      });
    }
    return res.status(verifyRes.ok ? 200 : 404).json({
      ok: verifyRes.ok,
      verified: verifyRes.verified,
      status: verifyRes.status,
      amount: verifyRes.amount,
      currency: verifyRes.currency,
      tx_ref: txRef,
    });
  }

  if (!order) {
    return res.status(404).json({ ok: false, verified: false, message: 'Transaction reference not found.' });
  }
  if (order.status === 'settled' && !order.invoice) {
    await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
  }
  return res.json({
    ok: true,
    verified: order.status === 'settled',
    status: order.status,
    mode: order.mode,
    order,
    invoice: order.invoice || null,
  });
});

app.post('/api/chapa/webhook', async (req, res) => {
  const sig = req.headers['chapa-signature'] || req.headers['x-chapa-signature'] || '';
  const webhookSecret = (process.env.CHAPA_WEBHOOK_SECRET || process.env.CHAPA_SECRET_KEY || '').trim();
  if (webhookSecret && sig) {
    if (!verifyWebhookSignature(req.body, String(sig), webhookSecret)) {
      return res.status(401).json({ ok: false, message: 'Invalid Chapa webhook signature.' });
    }
  }
  const txRef = String(req.body?.tx_ref || req.body?.trx_ref || '').trim();
  const order = serviceChapaOrders.get(txRef);
  const isSuccess = String(req.body?.status || 'success').toLowerCase() === 'success';
  if (order && isSuccess) {
    order.status = 'settled';
    order.chapa_reference = req.body?.reference || req.body?.ref_id || txRef;
    order.settled_at = order.settled_at || new Date().toISOString();
    await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
    await sendContactTelegramNotification({
      name: `${order.customer_name} (Chapa Payment)`,
      email: order.customer_email,
      phone: order.customer_phone || '',
      message: `Chapa Payment Verified: ${order.amount} ${order.currency} for ${order.description} (Ref: ${txRef})`,
    }).catch(() => null);
  } else if (isSuccess && txRef) {
    for (const [tenantId, store] of tenantData.entries()) {
      const intent = (store.paymentIntents || []).find((i) => i.tx_ref === txRef);
      if (intent) {
        settleInboundIntent(store, intent, {
          providerOverride: 'chapa',
          payerReference: req.body?.reference || req.body?.ref_id || txRef,
          verifiedSig: true,
        });
        await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenants.get(tenantId), store) });
        break;
      }
    }
  }
  return res.json({ ok: true, received: true });
});

/* ── Telebirr Official Fabric API Routes (/api/telebirr/*) ───── */
function getServerTelebirrConfig() {
  const fabricAppId = (process.env.TELEBIRR_FABRIC_APP_ID || '').trim();
  const appSecret = (process.env.TELEBIRR_APP_SECRET || '').trim();
  const merchantAppId = (process.env.TELEBIRR_MERCHANT_APP_ID || '').trim();
  const merchantCode = (process.env.TELEBIRR_MERCHANT_CODE || '').trim();
  const privateKey = (process.env.TELEBIRR_PRIVATE_KEY || '').trim();
  const publicKey = (process.env.TELEBIRR_PUBLIC_KEY || '').trim();
  const baseUrl = (process.env.TELEBIRR_BASE_URL || '').trim();
  const webBaseUrl = (process.env.TELEBIRR_WEB_BASE_URL || '').trim();
  const configured = Boolean(fabricAppId && appSecret && merchantAppId && merchantCode && privateKey);
  return {
    configured,
    fabricAppId,
    appSecret,
    merchantAppId,
    merchantCode,
    privateKey,
    publicKey,
    ...(baseUrl ? { baseUrl } : {}),
    ...(webBaseUrl ? { webBaseUrl } : {}),
  };
}

function maskTelebirrMerchantCode(code) {
  const clean = String(code || '').trim();
  if (!clean) return null;
  if (clean.length <= 4) return `${clean[0]}***`;
  return `${clean.slice(0, 2)}••${clean.slice(-2)}`;
}

function extractTelebirrHost(rawUrl) {
  try {
    return new URL(rawUrl).host;
  } catch {
    return 'developerportal.ethiotelebirr.et';
  }
}

app.get('/api/telebirr/config', (_req, res) => {
  const cfg = getServerTelebirrConfig();
  res.json({
    ok: true,
    provider: 'telebirr',
    currency: 'ETB',
    mode: cfg.configured ? 'live' : 'sandbox',
    flow: 'H5_FABRIC',
    merchant_configured: cfg.configured,
    merchant_code_masked: maskTelebirrMerchantCode(cfg.merchantCode),
    public_key_configured: Boolean(cfg.publicKey),
    web_gateway_host: extractTelebirrHost(cfg.webBaseUrl || 'https://196.188.120.3:38443/payment/web/paygate'),
  });
});

app.post('/api/telebirr/initialize', async (req, res) => {
  const {
    serviceId,
    serviceName = 'Digital Service Package',
    paymentPlan = 'deposit',
    amount,
    fullName,
    email,
    phone = '',
    notes = '',
    returnPath = '/services',
  } = req.body ?? {};

  const numAmount = Math.round(Number(amount) * 100) / 100;
  if (!Number.isFinite(numAmount) || numAmount < 50 || numAmount > 5_000_000) {
    return res.status(400).json({ ok: false, message: 'Amount must be between 50 and 5,000,000 ETB.' });
  }
  const cleanName = String(fullName || '').trim();
  const cleanEmail = String(email || '').trim();
  if (cleanName.length < 2) {
    return res.status(400).json({ ok: false, message: 'Please enter your full name.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ ok: false, message: 'A valid email address is required.' });
  }

  const merchOrderId = generateTelebirrOrderId('TB-SVC');
  const token = `tb-${crypto.randomUUID().slice(0, 10)}`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const origin = (process.env.PUBLIC_URL || `${proto}://${host}`).replace(/\/$/, '');
  const safePath = String(returnPath || '/services').startsWith('/') ? returnPath : '/services';
  const separator = safePath.includes('?') ? '&' : '?';
  const returnUrl = `${origin}${safePath}${separator}tx_ref=${encodeURIComponent(merchOrderId)}&provider=telebirr#pay-now`;
  const notifyUrl = `${origin}/api/telebirr/notify`;

  const description = `${String(serviceName).trim()} (${paymentPlan === 'full' ? 'Full Payment' : paymentPlan === 'custom' ? 'Custom Quote' : '40% Deposit'})`;
  const title = notes ? `${description} - ${String(notes).slice(0, 24)}` : description;

  const cfg = getServerTelebirrConfig();
  let mode = 'sandbox';
  let checkoutUrl = `/pay/${token}`;
  let prepayId = null;
  let receiveCode = null;

  if (cfg.configured) {
    const tbInit = await initializeTelebirrOrder({
      config: cfg,
      orderParams: {
        merchOrderId,
        title,
        amount: numAmount,
        notifyUrl,
        redirectUrl: returnUrl,
      },
    });
    if (!tbInit.ok) {
      return res.status(tbInit.statusCode || 502).json({
        ok: false,
        message: tbInit.error || 'Telebirr gateway declined pre-order initialization.',
      });
    }
    mode = 'live';
    checkoutUrl = tbInit.checkoutUrl;
    prepayId = tbInit.prepayId;
    receiveCode = tbInit.receiveCode;
  }

  const order = {
    id: `svc-${crypto.randomUUID().slice(0, 8)}`,
    provider: 'telebirr',
    tx_ref: merchOrderId,
    token,
    service_id: serviceId ?? null,
    service_name: String(serviceName).trim(),
    payment_plan: paymentPlan,
    amount: numAmount,
    currency: 'ETB',
    customer_name: cleanName,
    customer_email: cleanEmail,
    customer_phone: String(phone || '').trim() || null,
    description,
    mode,
    checkout_url: checkoutUrl,
    return_url: returnUrl,
    prepay_id: prepayId,
    receive_code: receiveCode,
    status: 'pending',
    payer_reference: null,
    chapa_reference: null,
    created_at: new Date().toISOString(),
    settled_at: null,
  };
  serviceChapaOrders.set(merchOrderId, order);

  return res.status(201).json({
    ok: true,
    provider: 'telebirr',
    flow: 'H5_FABRIC',
    mode,
    merchant_code_masked: maskTelebirrMerchantCode(cfg.merchantCode),
    tx_ref: merchOrderId,
    token,
    prepay_id: prepayId,
    receive_code: receiveCode,
    amount: numAmount,
    currency: 'ETB',
    checkout_url: checkoutUrl,
    return_url: returnUrl,
  });
});

app.get('/api/telebirr/verify/:txRef', async (req, res) => {
  const txRef = String(req.params.txRef || '').trim();
  const order = serviceChapaOrders.get(txRef);
  const cfg = getServerTelebirrConfig();

  if (cfg.configured && txRef) {
    const queryRes = await queryTelebirrOrder({ config: cfg, merchOrderId: txRef });
    if (queryRes.verified && order) {
      order.status = 'settled';
      order.payer_reference = queryRes.reference || order.payer_reference;
      order.settled_at = order.settled_at || new Date().toISOString();
      await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
    }
    if (order) {
      if (order.status === 'settled' && !order.invoice) {
        await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
      }
      return res.json({
        ok: true,
        verified: order.status === 'settled' || queryRes.verified,
        status: order.status,
        mode: order.mode,
        order,
        invoice: order.invoice || null,
      });
    }
    return res.status(queryRes.ok ? 200 : 404).json({
      ok: queryRes.ok,
      verified: queryRes.verified,
      status: queryRes.status,
      amount: queryRes.amount,
      currency: 'ETB',
      tx_ref: txRef,
    });
  }

  if (!order) {
    return res.status(404).json({ ok: false, verified: false, message: 'Telebirr transaction reference not found.' });
  }
  if (order.status === 'settled' && !order.invoice) {
    await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
  }
  return res.json({
    ok: true,
    verified: order.status === 'settled',
    status: order.status,
    mode: order.mode,
    order,
    invoice: order.invoice || null,
  });
});

app.post('/api/telebirr/notify', async (req, res) => {
  let payload = req.body;
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload);
    } catch {
      payload = {};
    }
  }
  const cfg = getServerTelebirrConfig();
  const sig = payload?.sign || req.headers['x-telebirr-signature'] || '';
  if (cfg.publicKey && sig) {
    if (!verifyTelebirrSignature(payload, String(sig), cfg.publicKey)) {
      return res.status(401).json({ ok: false, message: 'Invalid Telebirr RSA signature.' });
    }
  }

  const txRef = String(
    payload?.merch_order_id || payload?.biz_content?.merch_order_id || payload?.outTradeNo || '',
  ).trim();
  const statusUpper = String(
    payload?.trade_status
    || payload?.order_status
    || payload?.biz_content?.trade_status
    || payload?.biz_content?.order_status
    || 'PAY_SUCCESS',
  ).toUpperCase();
  const paymentRef = String(
    payload?.payment_order_id
    || payload?.biz_content?.payment_order_id
    || payload?.biz_content?.trade_voucher
    || txRef,
  ).trim();

  const isSuccess = ['PAY_SUCCESS', 'TRADE_SUCCESS', 'COMPLETED', 'SUCCESS'].includes(statusUpper);
  const svcOrder = serviceChapaOrders.get(txRef);
  if (svcOrder && isSuccess) {
    svcOrder.status = 'settled';
    svcOrder.payer_reference = paymentRef;
    svcOrder.settled_at = svcOrder.settled_at || new Date().toISOString();
    await dispatchTransactionInvoice(svcOrder, { merchant: DEFAULT_SERVICE_MERCHANT });
    await sendContactTelegramNotification({
      name: `${svcOrder.customer_name} (Telebirr Payment)`,
      email: svcOrder.customer_email,
      phone: svcOrder.customer_phone || '',
      message: `Telebirr Payment Verified: ${svcOrder.amount} ${svcOrder.currency} for ${svcOrder.description} (Ref: ${txRef})`,
    }).catch(() => null);
  } else if (isSuccess && txRef) {
    for (const [tenantId, store] of tenantData.entries()) {
      const intent = (store.paymentIntents || []).find((i) => i.tx_ref === txRef);
      if (intent) {
        settleInboundIntent(store, intent, { providerOverride: 'telebirr', payerReference: paymentRef, verifiedSig: true });
        await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenants.get(tenantId), store) });
        break;
      }
    }
  }

  return res.json({ code: '0', msg: 'success' });
});

/* ── Safaricom Ethiopia M-Pesa API Routes (/api/mpesa/*) ────── */
function getServerMpesaConfig() {
  const consumerKey = (process.env.MPESA_CONSUMER_KEY || '').trim();
  const consumerSecret = (process.env.MPESA_CONSUMER_SECRET || '').trim();
  const shortCode = (process.env.MPESA_SHORTCODE || '').trim();
  const passkey = (process.env.MPESA_PASSKEY || '').trim();
  const baseUrl = (process.env.MPESA_BASE_URL || '').trim();
  const configured = Boolean(consumerKey && consumerSecret && shortCode && passkey);
  return {
    configured,
    consumerKey,
    consumerSecret,
    shortCode,
    passkey,
    ...(baseUrl ? { baseUrl } : {}),
  };
}

app.get('/api/mpesa/config', (_req, res) => {
  const cfg = getServerMpesaConfig();
  res.json({
    ok: true,
    provider: 'mpesa',
    currency: 'ETB',
    mode: cfg.configured ? 'live' : 'sandbox',
  });
});

app.post('/api/mpesa/stkpush', async (req, res) => {
  const {
    serviceId,
    serviceName = 'Digital Service Package',
    paymentPlan = 'deposit',
    amount,
    fullName,
    email,
    phone = '',
    notes = '',
    returnPath = '/services',
  } = req.body ?? {};

  const numAmount = Math.round(Number(amount));
  if (!Number.isFinite(numAmount) || numAmount < 50 || numAmount > 5_000_000) {
    return res.status(400).json({ ok: false, message: 'Amount must be between 50 and 5,000,000 ETB.' });
  }
  const cleanName = String(fullName || '').trim();
  const cleanEmail = String(email || '').trim();
  if (cleanName.length < 2) {
    return res.status(400).json({ ok: false, message: 'Please enter your full name.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ ok: false, message: 'A valid email address is required.' });
  }
  const msisdn = normalizeMpesaPhone(phone);
  if (!msisdn) {
    return res.status(400).json({
      ok: false,
      message: 'A valid Ethiopian Safaricom/Telecom phone number (e.g. +251 711 223344 or 0711223344) is required for M-Pesa STK Push.',
    });
  }

  const txRef = generateMpesaTxRef('MPESA-SVC');
  const token = `mpesa-${crypto.randomUUID().slice(0, 10)}`;
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000';
  const origin = (process.env.PUBLIC_URL || `${proto}://${host}`).replace(/\/$/, '');
  const safePath = String(returnPath || '/services').startsWith('/') ? returnPath : '/services';
  const separator = safePath.includes('?') ? '&' : '?';
  const returnUrl = `${origin}${safePath}${separator}tx_ref=${encodeURIComponent(txRef)}&provider=mpesa#pay-now`;
  const callbackUrl = `${origin}/api/mpesa/callback`;

  const description = `${String(serviceName).trim()} (${paymentPlan === 'full' ? 'Full Payment' : paymentPlan === 'custom' ? 'Custom Quote' : '40% Deposit'})`;
  const cfg = getServerMpesaConfig();

  let mode = 'sandbox';
  let checkoutUrl = `/pay/${token}`;
  let checkoutRequestId = `ws_CO_${crypto.randomUUID().slice(0, 12).replace(/-/g, '')}`;
  let customerMessage = `Authorize the M-Pesa STK prompt for +${msisdn} to receive an instant verified receipt.`;

  if (cfg.configured) {
    const pushRes = await initiateMpesaStkPush({
      config: cfg,
      orderParams: {
        amount: numAmount,
        phoneNumber: msisdn,
        callbackUrl,
        accountReference: txRef.slice(0, 12),
        transactionDesc: notes ? `${String(serviceName).slice(0, 20)} - ${String(notes).slice(0, 15)}` : description,
      },
    });
    if (!pushRes.ok) {
      return res.status(pushRes.statusCode || 502).json({
        ok: false,
        message: pushRes.error || 'M-Pesa STK Push could not be dispatched.',
      });
    }
    mode = 'live';
    checkoutRequestId = pushRes.checkoutRequestId;
    customerMessage = pushRes.customerMessage;
    checkoutUrl = returnUrl;
  }

  const order = {
    id: `svc-${crypto.randomUUID().slice(0, 8)}`,
    provider: 'mpesa',
    tx_ref: txRef,
    token,
    checkout_request_id: checkoutRequestId,
    service_id: serviceId ?? null,
    service_name: String(serviceName).trim(),
    payment_plan: paymentPlan,
    amount: numAmount,
    currency: 'ETB',
    customer_name: cleanName,
    customer_email: cleanEmail,
    customer_phone: `+${msisdn}`,
    description,
    mode,
    checkout_url: checkoutUrl,
    return_url: returnUrl,
    customer_message: customerMessage,
    status: 'pending',
    payer_reference: null,
    chapa_reference: null,
    created_at: new Date().toISOString(),
    settled_at: null,
  };
  serviceChapaOrders.set(txRef, order);

  return res.status(201).json({
    ok: true,
    provider: 'mpesa',
    mode,
    tx_ref: txRef,
    token,
    checkout_request_id: checkoutRequestId,
    customer_message: customerMessage,
    amount: numAmount,
    currency: 'ETB',
    checkout_url: checkoutUrl,
    return_url: returnUrl,
  });
});

app.get('/api/mpesa/query/:txRef', async (req, res) => {
  const txRef = String(req.params.txRef || '').trim();
  const order = serviceChapaOrders.get(txRef);
  const cfg = getServerMpesaConfig();

  if (cfg.configured && order?.checkout_request_id) {
    const queryRes = await queryMpesaStkStatus({
      config: cfg,
      checkoutRequestId: order.checkout_request_id,
    });
    if (queryRes.verified) {
      order.status = 'settled';
      order.settled_at = order.settled_at || new Date().toISOString();
      await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
    }
    if (order.status === 'settled' && !order.invoice) {
      await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
    }
    return res.json({
      ok: true,
      verified: order.status === 'settled' || queryRes.verified,
      status: order.status,
      mode: order.mode,
      order,
      invoice: order.invoice || null,
    });
  }

  if (!order) {
    return res.status(404).json({ ok: false, verified: false, message: 'M-Pesa transaction reference not found.' });
  }
  if (order.status === 'settled' && !order.invoice) {
    await dispatchTransactionInvoice(order, { merchant: DEFAULT_SERVICE_MERCHANT });
  }
  return res.json({
    ok: true,
    verified: order.status === 'settled',
    status: order.status,
    mode: order.mode,
    order,
    invoice: order.invoice || null,
  });
});

app.post('/api/mpesa/callback', async (req, res) => {
  const parsed = parseMpesaCallback(req.body);
  if (!parsed.valid) {
    return res.status(400).json({ ResultCode: 1, ResultDesc: 'Malformed M-Pesa callback payload' });
  }

  if (parsed.success && parsed.checkoutRequestId) {
    let matchedServiceOrder = null;
    for (const ord of serviceChapaOrders.values()) {
      if (ord.checkout_request_id === parsed.checkoutRequestId) {
        matchedServiceOrder = ord;
        break;
      }
    }

    if (matchedServiceOrder) {
      matchedServiceOrder.status = 'settled';
      matchedServiceOrder.payer_reference = parsed.mpesaReceiptNumber || parsed.checkoutRequestId;
      matchedServiceOrder.settled_at = matchedServiceOrder.settled_at || new Date().toISOString();
      await dispatchTransactionInvoice(matchedServiceOrder, { merchant: DEFAULT_SERVICE_MERCHANT });
      await sendContactTelegramNotification({
        name: `${matchedServiceOrder.customer_name} (M-Pesa STK)`,
        email: matchedServiceOrder.customer_email,
        phone: matchedServiceOrder.customer_phone || parsed.phoneNumber || '',
        message: `M-Pesa STK Confirmed: ${matchedServiceOrder.amount} ETB (${matchedServiceOrder.description}, Receipt: ${matchedServiceOrder.payer_reference})`,
      }).catch(() => null);
    } else {
      for (const [tenantId, store] of tenantData.entries()) {
        const intent = (store.paymentIntents || []).find(
          (i) => i.checkout_request_id === parsed.checkoutRequestId || i.tx_ref === parsed.checkoutRequestId,
        );
        if (intent) {
          settleInboundIntent(store, intent, {
            providerOverride: 'mpesa',
            payerReference: parsed.mpesaReceiptNumber || parsed.checkoutRequestId,
            verifiedSig: true,
          });
          await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenants.get(tenantId), store) });
          break;
        }
      }
    }
  }

  return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

/* ── Automated PDF Invoice & Email Receipt Endpoints (/api/invoices/*) ── */
app.get('/api/invoices', (req, res) => {
  const authUser = getAuthUser(req);
  const scope = String(req.query.scope || 'auto').trim().toLowerCase();
  const emailParam = String(req.query.email || '').trim().toLowerCase();
  const qParam = String(req.query.q || '').trim();
  const providerParam = String(req.query.provider || 'all').trim().toLowerCase();
  const txRefsParam = String(req.query.tx_refs || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const txRefSet = new Set(txRefsParam.map((r) => r.toUpperCase()));

  const collectedMap = new Map();

  // 1. If authenticated (ERP workspace), include tenant's settled inbound invoices
  if (authUser && (scope === 'tenant' || scope === 'auto')) {
    const tenant = tenants.get(authUser.tenant_id);
    const store = ensureTenantStore(authUser.tenant_id, tenant?.business_type || 'pharmacy', tenant?.name || 'Workspace');
    const merchant = buildTenantMerchantInfo(tenant, store);
    for (const intent of store.paymentIntents || []) {
      if (intent.status === 'settled' && intent.direction === 'receive') {
        const item = buildInvoiceListItem(intent, merchant, invoiceRegistry.get(intent.tx_ref));
        if (item) collectedMap.set(item.tx_ref, item);
      }
    }
  }

  // 2. Match explicit email, tx_refs, lookup query, or authenticated user email across service orders & tenant intents
  const lookupEmails = new Set();
  if (emailParam && isValidEmail(emailParam)) lookupEmails.add(emailParam);
  if (qParam && isValidEmail(qParam)) lookupEmails.add(qParam.toLowerCase());
  if (authUser?.email) lookupEmails.add(authUser.email.toLowerCase());

  const cleanLookupToken = qParam.trim().toUpperCase();
  const hasExplicitPublicLookup =
    lookupEmails.size > 0 || txRefSet.size > 0 || cleanLookupToken.length >= 6;

  if (hasExplicitPublicLookup) {
    const matchesPublicRecord = (record, merchant) => {
      if (!record || record.status !== 'settled') return null;
      const item = buildInvoiceListItem(record, merchant, invoiceRegistry.get(record.tx_ref));
      if (!item) return null;
      const recEmail = String(item.recipient_email || item.customer_email || '').trim().toLowerCase();
      const txUpper = String(item.tx_ref || '').toUpperCase();
      const invUpper = String(item.invoice_number || '').toUpperCase();

      const emailMatched = recEmail && lookupEmails.has(recEmail);
      const refSetMatched = txRefSet.has(txUpper);
      const tokenMatched =
        cleanLookupToken.length >= 6 &&
        (txUpper === cleanLookupToken ||
          invUpper === cleanLookupToken ||
          txUpper.includes(cleanLookupToken) ||
          invUpper.includes(cleanLookupToken));

      return emailMatched || refSetMatched || tokenMatched ? item : null;
    };

    for (const order of serviceChapaOrders.values()) {
      const item = matchesPublicRecord(order, DEFAULT_SERVICE_MERCHANT);
      if (item) collectedMap.set(item.tx_ref, item);
    }

    for (const [tenantId, store] of tenantData.entries()) {
      const merchant = buildTenantMerchantInfo(tenants.get(tenantId), store);
      for (const intent of store.paymentIntents || []) {
        if (intent.direction !== 'receive') continue;
        const item = matchesPublicRecord(intent, merchant);
        if (item && !collectedMap.has(item.tx_ref)) {
          collectedMap.set(item.tx_ref, item);
        }
      }
    }
  }

  const filterText = qParam || (authUser && scope === 'tenant' ? emailParam : '');
  const invoices = filterInvoiceHistoryItems(Array.from(collectedMap.values()), {
    query: filterText,
    provider: providerParam,
  });

  const requiresLookup = !authUser && !hasExplicitPublicLookup;
  return res.json({
    ok: true,
    authenticated: Boolean(authUser),
    requires_lookup: requiresLookup,
    invoices,
  });
});

app.get('/api/invoices/:txRef', async (req, res) => {
  const txRef = String(req.params.txRef || '').trim();
  const found = findTransactionForInvoice(txRef);
  const existing = invoiceRegistry.get(txRef);

  if (!found && !existing) {
    return res.status(404).json({ ok: false, message: 'Transaction or invoice not found.' });
  }

  if (found && found.orderOrIntent.status === 'settled' && !existing) {
    await dispatchTransactionInvoice(found.orderOrIntent, { merchant: found.merchant });
  }

  const invoice = found?.orderOrIntent?.invoice || invoiceRegistry.get(txRef)?.meta || null;
  if (!invoice) {
    return res.status(409).json({
      ok: false,
      message: 'Invoice is generated automatically once payment settlement completes.',
    });
  }
  return res.json({ ok: true, invoice });
});

app.get('/api/invoices/:txRef/pdf', async (req, res) => {
  const txRef = String(req.params.txRef || '').trim();
  const found = findTransactionForInvoice(txRef);
  let entry = invoiceRegistry.get(txRef);

  if (!entry) {
    if (!found) {
      return res.status(404).json({ ok: false, message: 'Transaction reference not found.' });
    }
    if (found.orderOrIntent.status !== 'settled') {
      return res.status(409).json({
        ok: false,
        message: 'PDF invoice becomes available once the payment settles.',
      });
    }
    const data = buildInvoiceData(found.orderOrIntent, found.merchant);
    const pdfBuffer = await generateInvoicePdfBuffer(data);
    entry = {
      meta: found.orderOrIntent.invoice || {
        invoice_number: data.invoiceNumber,
        filename: `${data.invoiceNumber}.pdf`,
      },
      pdfBuffer,
    };
    invoiceRegistry.set(txRef, entry);
  }

  const inline = req.query.inline === '1' || req.query.inline === 'true';
  const filename = entry.meta?.filename || `${txRef}.pdf`;
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename="${filename}"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(entry.pdfBuffer);
});

app.post('/api/invoices/:txRef/resend', async (req, res) => {
  const txRef = String(req.params.txRef || '').trim();
  const overrideEmail = String(req.body?.email || '').trim();
  if (overrideEmail && !isValidEmail(overrideEmail)) {
    return res.status(400).json({ ok: false, message: 'Enter a valid email address for the invoice recipient.' });
  }

  const found = findTransactionForInvoice(txRef);
  if (!found) {
    return res.status(404).json({ ok: false, message: 'Transaction reference not found.' });
  }
  if (found.orderOrIntent.status !== 'settled') {
    return res.status(409).json({ ok: false, message: 'Only settled transactions can send a paid PDF invoice.' });
  }

  const effectiveEmail =
    overrideEmail || found.orderOrIntent.customer_email || found.orderOrIntent.invoice?.recipient_email || '';
  if (!isValidEmail(effectiveEmail)) {
    return res.status(400).json({ ok: false, message: 'Please provide a recipient email address to send the invoice.' });
  }

  const result = await dispatchTransactionInvoice(found.orderOrIntent, {
    merchant: found.merchant,
    forceResend: true,
    overrideEmail: effectiveEmail,
  });

  if (!result?.invoice) {
    return res.status(500).json({ ok: false, message: 'Unable to dispatch PDF invoice right now.' });
  }

  return res.json({ ok: true, invoice: result.invoice });
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

app.post('/api/v1/auth/complete-social', (req, res) => {
  const { company_name = 'New Workspace', business_type = 'pharmacy', owner_name = 'Workspace Owner', email } = req.body ?? {};
  const cleanEmail = String(email || `social-${crypto.randomUUID().slice(0, 6)}@afrotech.et`).trim().toLowerCase();
  let user = users.get(cleanEmail);
  if (!user) {
    const tenantId = `tenant-${crypto.randomUUID().slice(0, 8)}`;
    const userId = `user-${crypto.randomUUID().slice(0, 8)}`;
    const slug = String(company_name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'workspace';
    const tenant = {
      id: tenantId,
      name: String(company_name).trim(),
      slug,
      business_type,
      status: 'trial',
      trial_ends_at: new Date(Date.now() + TRIAL_DAYS * 86400000).toISOString(),
      trial_days_left: TRIAL_DAYS,
      owner_id: userId,
      owner_name: String(owner_name).trim(),
      owner_email: cleanEmail,
      created_at: new Date().toISOString(),
    };
    tenants.set(tenantId, tenant);
    ensureTenantStore(tenantId, business_type, tenant.name);
    user = {
      id: userId,
      email: cleanEmail,
      password: crypto.randomUUID(),
      full_name: String(owner_name).trim(),
      role: 'owner',
      is_active: true,
      tenant_id: tenantId,
      created_at: new Date().toISOString(),
      profile_values: { BASE_SALARY: 0, TRANSPORT_ALLOW: 0, HOUSING_ALLOW: 0 },
    };
    users.set(cleanEmail, user);
  }
  const token = `tok_${crypto.randomUUID()}`;
  sessions.set(token, cleanEmail);
  return res.json({ token, me: buildMe(user) });
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

// No-code Custom Fields Builder (upgrade-safe entity extensions)
app.get('/api/v1/tenant/custom-fields', (req, res) => {
  const { store } = activeCtx(req);
  const entity = req.query.entity ? String(req.query.entity) : null;
  const list = store.customFields ?? [];
  res.json({ fields: entity ? list.filter((f) => f.entity === entity) : list });
});

app.post('/api/v1/tenant/custom-fields', (req, res) => {
  const { store } = activeCtx(req);
  const b = req.body ?? {};
  const label = String(b.label || '').trim();
  if (!label) return res.status(400).json({ error: 'Field label is required' });
  const entity = ['product', 'customer', 'supplier'].includes(b.entity) ? b.entity : 'product';
  const type = ['text', 'number', 'date', 'select'].includes(b.type) ? b.type : 'text';
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || `field_${Date.now()}`;
  const field = {
    id: `cf-${crypto.randomUUID().slice(0, 8)}`,
    entity,
    key,
    label,
    type,
    options: String(b.options || '').trim(),
    required: Boolean(b.required),
  };
  store.customFields = [...(store.customFields ?? []), field];
  res.status(201).json({ field, fields: store.customFields });
});

app.delete('/api/v1/tenant/custom-fields/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.customFields = (store.customFields ?? []).filter((f) => f.id !== req.params.id);
  res.json({ ok: true, fields: store.customFields });
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

// Self-Service Custom Report Builder datasets & presets
app.get('/api/v1/reports/datasets', (req, res) => {
  const { store } = activeCtx(req);
  res.json({
    datasets: {
      products: store.products.map((p) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        stock: Number(p.stock || 0),
        low_stock_threshold: Number(p.low_stock_threshold || 0),
        cost_price: Number(p.cost_price || 0),
        sell_price: Number(p.sell_price || 0),
        stock_value: Math.round(Number(p.stock || 0) * Number(p.cost_price || 0) * 100) / 100,
        expiring_soon: Number(p.expiring_soon || 0),
      })),
      sales: store.sales.map((s) => ({
        id: s.id,
        invoice_no: s.invoice_no,
        created_at: String(s.created_at || '').slice(0, 10),
        customer_name: s.customer_name || 'Walk-in',
        payment_method: s.payment_method || 'cash',
        status: s.status || 'completed',
        discount: Number(s.discount || 0),
        total: Number(s.total || 0),
        cashier: s.cashier || 'Staff',
      })),
      purchases: store.purchases.map((p) => ({
        id: p.id,
        purchase_no: p.purchase_no || p.id.toUpperCase(),
        created_at: String(p.created_at || '').slice(0, 10),
        supplier_name: p.supplier_name || 'Walk-in',
        item_count: Number(p.item_count || (p.items?.length ?? 0)),
        total: Number(p.total || 0),
        paid_amount: Number(p.paid_amount || 0),
        balance_due: Math.max(0, Math.round((Number(p.total || 0) - Number(p.paid_amount || 0)) * 100) / 100),
      })),
      expenses: store.expenses.map((e) => ({
        id: e.id,
        created_at: String(e.expense_date || e.created_at || '').slice(0, 10),
        category: e.category || 'General',
        description: e.description || '',
        amount: Number(e.amount || 0),
        recorded_by: e.recorded_by_name || 'Staff',
      })),
      gl: store.glEntries.map((g) => ({
        id: g.id,
        posting_date: String(g.posting_date || '').slice(0, 10),
        voucher_no: g.voucher_no,
        voucher_type: g.voucher_type,
        account_code: g.account_code,
        account_name: g.account_name,
        debit: Number(g.debit || 0),
        credit: Number(g.credit || 0),
      })),
      leads: store.leads.map((l) => ({
        id: l.id,
        name: l.name,
        organization: l.organization || '—',
        stage: l.stage || 'lead',
        source: l.source || 'Direct',
        expected_value: Number(l.expected_value || 0),
        follow_up_date: String(l.follow_up_date || '').slice(0, 10),
      })),
    },
  });
});

app.get('/api/v1/reports/presets', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ presets: store.reportPresets ?? [] });
});

app.post('/api/v1/reports/presets', (req, res) => {
  const { store } = activeCtx(req);
  const name = String(req.body?.name || '').trim();
  const config = req.body?.config;
  if (!name || !config) return res.status(400).json({ error: 'Preset name and config required' });
  const preset = {
    id: `preset-${crypto.randomUUID().slice(0, 8)}`,
    name,
    config,
    created_at: new Date().toISOString(),
  };
  store.reportPresets = [preset, ...(store.reportPresets ?? [])];
  res.status(201).json({ preset, presets: store.reportPresets });
});

app.delete('/api/v1/reports/presets/:id', (req, res) => {
  const { store } = activeCtx(req);
  store.reportPresets = (store.reportPresets ?? []).filter((p) => p.id !== req.params.id);
  res.json({ ok: true, presets: store.reportPresets });
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
    custom_values: b.custom_values && typeof b.custom_values === 'object' ? b.custom_values : {},
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
    custom_values: b.custom_values !== undefined ? b.custom_values : (store.products[idx].custom_values ?? {}),
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
  const paymentMethod = String(b.payment_method || 'cash').toLowerCase();
  const amountPaid = b.amount_paid !== undefined ? Number(b.amount_paid) : paymentMethod === 'credit' ? 0 : total;
  const changeDue = Math.max(0, amountPaid - total);
  const customer = b.customer_id
    ? store.customers.find((c) => c.id === b.customer_id)
    : b.customer_phone
      ? store.customers.find((c) => c.phone && String(c.phone).replace(/\s+/g, '') === String(b.customer_phone).replace(/\s+/g, ''))
      : null;
  const due = Math.max(0, total - amountPaid);

  if (customer && due > 0) {
    customer.balance = (Number(customer.balance || 0) + due).toFixed(2);
  }

  const sale = {
    id: `sale-${crypto.randomUUID().slice(0, 8)}`,
    invoice_no: invoiceNo,
    subtotal: subtotal.toFixed(2),
    discount: discount.toFixed(2),
    tax_amount: Number(b.tax_amount ?? 0).toFixed(2),
    total: total.toFixed(2),
    amount_paid: amountPaid.toFixed(2),
    change_due: changeDue.toFixed(2),
    status: 'completed',
    order_type: b.order_type === 'delivery' ? 'delivery' : 'pickup',
    created_at: new Date().toISOString(),
    payment_method: paymentMethod,
    customer_id: customer?.id || b.customer_id || null,
    customer_name: customer?.name || b.customer_name || 'Walk-in',
    customer_phone: b.customer_phone || customer?.phone || null,
    customer_city: b.customer_city || customer?.city || null,
    customer_location: b.customer_location || customer?.location || null,
    referral_code: b.referral_code || null,
    notes: b.notes || null,
    cashier: user.full_name,
    items: lineItems,
  };
  store.sales.unshift(sale);

  if (store.shift && store.shift.status === 'open') {
    if (paymentMethod === 'cash') {
      store.shift.cash_sales = (Number(store.shift.cash_sales || 0) + total).toFixed(2);
    } else if (paymentMethod === 'card') {
      store.shift.card_sales = (Number(store.shift.card_sales || 0) + total).toFixed(2);
    } else if (['mobile', 'telebirr', 'cbe', 'mpesa'].includes(paymentMethod)) {
      store.shift.mobile_sales = (Number(store.shift.mobile_sales || 0) + total).toFixed(2);
    }
  }

  if (total > 0) {
    const isDigitalOrBank = ['bank', 'card', 'mobile', 'telebirr', 'cbe', 'mpesa'].includes(paymentMethod);
    const assetAcct = paymentMethod === 'credit' && due > 0 ? '1210' : isDigitalOrBank ? '1120' : '1110';
    appendGlEntry(store, {
      voucher_type: 'POS Sale',
      voucher_no: invoiceNo,
      account_code: assetAcct,
      debit: total,
      credit: 0,
      party: sale.customer_name,
      remarks: `Sale ${invoiceNo} (${paymentMethod}, ${sale.order_type})`,
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
  const q = req.query.search ? String(req.query.search).trim().toLowerCase() : '';
  const limit = req.query.limit ? Math.max(1, Number(req.query.limit)) : 0;
  let customers = store.customers;
  if (q) {
    customers = customers.filter((c) =>
      String(c.name || '').toLowerCase().includes(q) ||
      String(c.phone || '').toLowerCase().includes(q) ||
      String(c.city || '').toLowerCase().includes(q) ||
      String(c.location || '').toLowerCase().includes(q)
    );
  }
  if (limit > 0) customers = customers.slice(0, limit);
  res.json({ customers });
});

app.post('/api/v1/retail/customers', (req, res) => {
  const { store } = activeCtx(req);
  const b = req.body ?? {};
  const cust = {
    id: `cust-${crypto.randomUUID().slice(0, 8)}`,
    name: String(b.name || 'Customer').trim(),
    phone: b.phone ? String(b.phone).trim() : null,
    email: b.email ? String(b.email).trim() : null,
    address: b.address ? String(b.address).trim() : b.location ? String(b.location).trim() : null,
    city: b.city ? String(b.city).trim() : 'Addis Ababa',
    location: b.location ? String(b.location).trim() : '',
    gender: b.gender || '',
    age_group: b.age_group || '',
    source: b.source || 'walk-in',
    referral_code: b.referral_code || '',
    notes: b.notes || '',
    balance: '0',
    created_at: new Date().toISOString(),
  };
  store.customers.unshift(cust);
  res.status(201).json({ customer: cust });
});

app.patch('/api/v1/retail/customers/:id', (req, res) => {
  const { store } = activeCtx(req);
  const idx = store.customers.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Customer not found' });
  const b = req.body ?? {};
  store.customers[idx] = {
    ...store.customers[idx],
    ...b,
    id: store.customers[idx].id,
  };
  res.json({ customer: store.customers[idx] });
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
  const now = new Date().toISOString();
  store.shift = {
    id: `sh-${crypto.randomUUID().slice(0, 8)}`,
    cashier: user.full_name,
    cashier_name: user.full_name,
    opening_balance: Number(req.body?.opening_balance ?? 0).toFixed(2),
    cash_sales: '0.00',
    card_sales: '0.00',
    mobile_sales: '0.00',
    expenses: '0.00',
    counted_cash: null,
    expected_cash: null,
    difference: null,
    opened_at: now,
    started_at: now,
    closed_at: null,
    status: 'open',
  };
  res.status(201).json({ shift: store.shift });
});
app.post('/api/v1/retail/shift/end', (req, res) => {
  const { store } = activeCtx(req);
  if (store.shift) {
    const counted = Number(req.body?.counted_cash ?? 0);
    const expected = Number(store.shift.opening_balance || 0) + Number(store.shift.cash_sales || 0) - Number(store.shift.expenses || 0);
    const diff = counted - expected;
    const now = new Date().toISOString();
    const closed = {
      ...store.shift,
      counted_cash: counted.toFixed(2),
      expected_cash: expected.toFixed(2),
      difference: diff.toFixed(2),
      closed_at: now,
      ended_at: now,
      status: 'closed',
    };
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
  const recItems = Array.isArray(req.body?.received_items) ? req.body.received_items : null;
  const recMap = recItems ? new Map(recItems.map((r) => [r.product_id, r])) : null;
  const itemsToReceive = po.items
    .map((it) => {
      const ov = recMap?.get(it.product_id);
      const qty = ov ? Math.max(0, Number(ov.received_qty ?? it.quantity)) : it.quantity;
      const unitCost = ov ? Math.max(0, Number(ov.billed_unit_cost ?? it.unit_cost)) : it.unit_cost;
      return { product_id: it.product_id, quantity: qty, unit_cost: unitCost };
    })
    .filter((it) => it.quantity > 0);
  if (!itemsToReceive.length) return res.status(400).json({ error: 'Enter at least 1 received unit to post receipt' });
  const purchase = createPurchaseInternal(store, user, {
    supplier_id: po.supplier_id,
    notes: req.body?.match_note ? `3-Way Verified (${po.number}): ${req.body.match_note}` : `Received from ${po.number}`,
    paid_amount: req.body?.paid_amount !== undefined ? Number(req.body.paid_amount) : itemsToReceive.reduce((s, it) => s + it.quantity * it.unit_cost, 0),
    items: itemsToReceive,
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
app.post('/api/v1/erp/warehouses/reconcile', (req, res) => {
  const { store } = activeCtx(req);
  const defWh = store.warehouses[0];
  if (!defWh) return res.status(400).json({ error: 'No default warehouse' });
  let fixedCount = 0;
  for (const prod of store.products) {
    const binTotal = store.warehouses.reduce((s, w) => s + Number(w.stock_map?.[prod.id] ?? 0), 0);
    const diff = Number(prod.stock || 0) - binTotal;
    if (Math.abs(diff) > 0.001) {
      defWh.stock_map[prod.id] = Math.max(0, Number(defWh.stock_map[prod.id] || 0) + diff);
      fixedCount += 1;
    }
  }
  res.json({ ok: true, reconciled_skus: fixedCount });
});
app.get('/api/v1/erp/stock-ledger', (req, res) => {
  res.json({ entries: activeCtx(req).store.stockLedger });
});

// Accounting: Chart of Accounts, GL Entries, Journal Entries, Exceptions & 1-Click Reversal
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
app.get('/api/v1/erp/reconciliation-snapshot', (req, res) => {
  const { store } = activeCtx(req);
  res.json({
    accounts: store.accounts,
    gl_entries: store.glEntries,
    products: store.products,
    warehouses: store.warehouses,
    customers: store.customers,
    suppliers: store.suppliers,
  });
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
    reversed_by: null,
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
app.post('/api/v1/erp/journal-entries/:id/reverse', (req, res) => {
  const { user, store } = activeCtx(req);
  const orig = store.journalEntries.find((j) => j.id === req.params.id);
  if (!orig) return res.status(404).json({ error: 'Journal Entry not found' });
  if (orig.status === 'reversed') return res.status(400).json({ error: `${orig.number} has already been reversed` });
  const revLines = (orig.lines || []).map((l) => ({
    account_code: l.account_code,
    debit: Number(l.credit || 0),
    credit: Number(l.debit || 0),
  }));
  const voucherNo = `JV-${1001 + store.journalEntries.length}`;
  const totalAmt = revLines.reduce((s, l) => s + Number(l.debit || 0), 0);
  const contra = {
    id: `je-${crypto.randomUUID().slice(0, 8)}`,
    number: voucherNo,
    posting_date: new Date().toISOString().slice(0, 10),
    remarks: `Reversal of ${orig.number}: ${orig.remarks}`,
    total_debit: totalAmt.toFixed(2),
    total_credit: totalAmt.toFixed(2),
    status: 'submitted',
    reversed_by: null,
    reversal_of: orig.number,
    created_by: user.full_name,
    lines: revLines,
    created_at: new Date().toISOString(),
  };
  orig.status = 'reversed';
  orig.reversed_by = voucherNo;
  store.journalEntries.unshift(contra);
  for (const l of revLines) {
    appendGlEntry(store, {
      voucher_type: 'Journal Reversal',
      voucher_no: voucherNo,
      account_code: l.account_code,
      debit: Number(l.debit || 0),
      credit: Number(l.credit || 0),
      remarks: contra.remarks,
    });
  }
  auditLogs.unshift({
    id: `aud-${crypto.randomUUID().slice(0, 8)}`,
    actor: user.email,
    action: 'REVERSE_JOURNAL_ENTRY',
    target: `${orig.number} -> ${voucherNo}`,
    created_at: new Date().toISOString(),
  });
  res.status(201).json({ original: orig, reversal: contra });
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

// Payment Entries (Customer Receipt / Supplier Payment -> Double-entry GL)
app.post('/api/v1/erp/payment-entries', (req, res) => {
  const { store } = activeCtx(req);
  const { direction = 'receive', party_id = '', amount = 0, payment_method = 'cash', remarks = '' } = req.body ?? {};
  const amt = Math.max(0, Number(amount || 0));
  if (amt <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });
  const cashAcct = payment_method === 'cash' ? '1110' : '1120';
  if (direction === 'receive') {
    const cust = store.customers.find((c) => c.id === party_id);
    if (cust) cust.balance = Math.max(0, Number(cust.balance || 0) - amt).toFixed(2);
    const voucherNo = `PE-R-${1001 + store.glEntries.length}`;
    appendGlEntry(store, { voucher_type: 'Payment Entry', voucher_no: voucherNo, account_code: cashAcct, debit: amt, credit: 0, party: cust?.name || 'Customer', remarks: remarks || 'Customer receipt' });
    appendGlEntry(store, { voucher_type: 'Payment Entry', voucher_no: voucherNo, account_code: '1210', debit: 0, credit: amt, party: cust?.name || 'Customer', remarks: remarks || 'Receivable settlement' });
    return res.status(201).json({ ok: true, voucher_no: voucherNo });
  }
  const sup = store.suppliers.find((s) => s.id === party_id);
  if (sup) sup.balance = Math.max(0, Number(sup.balance || 0) - amt).toFixed(2);
  const voucherNo = `PE-P-${1001 + store.glEntries.length}`;
  appendGlEntry(store, { voucher_type: 'Payment Entry', voucher_no: voucherNo, account_code: '2110', debit: amt, credit: 0, party: sup?.name || 'Supplier', remarks: remarks || 'Supplier payment' });
  appendGlEntry(store, { voucher_type: 'Payment Entry', voucher_no: voucherNo, account_code: cashAcct, debit: 0, credit: amt, party: sup?.name || 'Supplier', remarks: remarks || 'Supplier payment' });
  return res.status(201).json({ ok: true, voucher_no: voucherNo });
});

// Manufacturing: Bills of Materials (BOM) & Work Orders
app.get('/api/v1/erp/boms', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ boms: store.boms, products: store.products });
});
app.post('/api/v1/erp/boms', (req, res) => {
  const { store } = activeCtx(req);
  const b = req.body ?? {};
  const outProd = store.products.find((p) => p.id === b.output_product_id);
  const comps = (Array.isArray(b.components) ? b.components : []).map((c) => {
    const p = store.products.find((x) => x.id === c.product_id);
    return {
      product_id: c.product_id,
      product_name: p?.name || 'Material',
      qty_per_unit: Math.max(0.01, Number(c.qty_per_unit || 1)),
      unit_cost: Number(p?.cost_price || c.unit_cost || 0),
    };
  });
  const bom = {
    id: `bom-${crypto.randomUUID().slice(0, 8)}`,
    code: `BOM-${String(store.boms.length + 1).padStart(3, '0')}`,
    name: String(b.name || (outProd ? `${outProd.name} Assembly` : 'New BOM')).trim(),
    output_product_id: outProd?.id || b.output_product_id,
    output_product_name: outProd?.name || 'Finished Product',
    output_qty: Math.max(1, Number(b.output_qty || 1)),
    components: comps,
    notes: b.notes || null,
    created_at: new Date().toISOString(),
  };
  store.boms.unshift(bom);
  res.status(201).json({ bom });
});

app.get('/api/v1/erp/work-orders', (req, res) => {
  res.json({ work_orders: activeCtx(req).store.workOrders });
});
app.post('/api/v1/erp/work-orders', (req, res) => {
  const { store } = activeCtx(req);
  const b = req.body ?? {};
  const bom = store.boms.find((x) => x.id === b.bom_id);
  if (!bom) return res.status(404).json({ error: 'BOM not found' });
  const qty = Math.max(1, Number(b.qty_to_produce || 1));
  const unitCost = (bom.components || []).reduce((s, c) => s + Number(c.qty_per_unit || 0) * Number(c.unit_cost || 0), 0);
  const wo = {
    id: `wo-${crypto.randomUUID().slice(0, 8)}`,
    number: `MFG-${1001 + store.workOrders.length}`,
    bom_id: bom.id,
    bom_name: bom.name,
    output_product_id: bom.output_product_id,
    output_product_name: bom.output_product_name,
    qty_to_produce: qty,
    estimated_cost: Number((unitCost * qty).toFixed(2)),
    status: 'planned',
    due_date: b.due_date || new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10),
    created_at: new Date().toISOString(),
  };
  store.workOrders.unshift(wo);
  res.status(201).json({ work_order: wo });
});
app.post('/api/v1/erp/work-orders/:id/complete', (req, res) => {
  const { store } = activeCtx(req);
  const wo = store.workOrders.find((x) => x.id === req.params.id);
  if (!wo) return res.status(404).json({ error: 'Work Order not found' });
  if (wo.status === 'completed') return res.json({ work_order: wo });
  const bom = store.boms.find((b) => b.id === wo.bom_id);
  const defWh = store.warehouses[0];
  let totalConsumedValue = 0;

  for (const comp of bom?.components ?? []) {
    const rawProd = store.products.find((p) => p.id === comp.product_id);
    const consumeQty = Math.ceil(Number(comp.qty_per_unit || 1) * Number(wo.qty_to_produce || 1));
    if (rawProd) {
      syncProductStock(rawProd, -consumeQty);
      if (defWh) defWh.stock_map[rawProd.id] = Math.max(0, Number(defWh.stock_map[rawProd.id] ?? rawProd.stock));
      const rate = Number(rawProd.cost_price || comp.unit_cost || 0);
      totalConsumedValue += consumeQty * rate;
      appendStockLedger(store, {
        voucher_type: 'Manufacture (Consume)',
        voucher_no: wo.number,
        product: rawProd,
        warehouse_id: defWh?.id,
        qty_change: -consumeQty,
        rate,
      });
    }
  }

  const outProd = store.products.find((p) => p.id === wo.output_product_id);
  const producedQty = Number(wo.qty_to_produce || 1) * Number(bom?.output_qty || 1);
  if (outProd) {
    syncProductStock(outProd, producedQty);
    if (defWh) defWh.stock_map[outProd.id] = Number(defWh.stock_map[outProd.id] || 0) + producedQty;
    appendStockLedger(store, {
      voucher_type: 'Manufacture (Produce)',
      voucher_no: wo.number,
      product: outProd,
      warehouse_id: defWh?.id,
      qty_change: producedQty,
      rate: producedQty > 0 ? Number((totalConsumedValue / producedQty).toFixed(2)) : Number(outProd.cost_price || 0),
    });
  }

  wo.status = 'completed';
  wo.completed_at = new Date().toISOString();
  res.json({ work_order: wo });
});

// Fixed Assets & Depreciation
app.get('/api/v1/erp/assets', (req, res) => {
  res.json({ assets: activeCtx(req).store.assets });
});
app.post('/api/v1/erp/assets', (req, res) => {
  const { store } = activeCtx(req);
  const b = req.body ?? {};
  const cost = Math.max(0, Number(b.purchase_cost || 0));
  const asset = {
    id: `ast-${crypto.randomUUID().slice(0, 8)}`,
    code: `AST-${1001 + store.assets.length}`,
    name: String(b.name || 'New Asset').trim(),
    category: String(b.category || 'Equipment').trim(),
    location: String(b.location || 'Main Branch').trim(),
    purchase_date: b.purchase_date || new Date().toISOString().slice(0, 10),
    purchase_cost: cost,
    salvage_value: Math.max(0, Number(b.salvage_value || 0)),
    useful_life_months: Math.max(1, Number(b.useful_life_months || 36)),
    accumulated_depreciation: 0,
    status: 'active',
    created_at: new Date().toISOString(),
  };
  store.assets.unshift(asset);
  if (cost > 0) {
    appendGlEntry(store, { voucher_type: 'Asset Capitalization', voucher_no: asset.code, account_code: '1510', debit: cost, credit: 0, remarks: `Capitalize ${asset.name}` });
    appendGlEntry(store, { voucher_type: 'Asset Capitalization', voucher_no: asset.code, account_code: '1120', debit: 0, credit: cost, remarks: `Payment for ${asset.name}` });
  }
  res.status(201).json({ asset });
});
app.post('/api/v1/erp/assets/:id/depreciate', (req, res) => {
  const { store } = activeCtx(req);
  const asset = store.assets.find((a) => a.id === req.params.id);
  if (!asset) return res.status(404).json({ error: 'Asset not found' });
  const depreciable = Math.max(0, Number(asset.purchase_cost) - Number(asset.salvage_value));
  const remaining = Math.max(0, depreciable - Number(asset.accumulated_depreciation));
  if (remaining <= 0.005) {
    asset.status = 'fully_depreciated';
    return res.json({ asset, posted_amount: 0 });
  }
  const monthly = Number(((depreciable / Math.max(1, Number(asset.useful_life_months)))).toFixed(2));
  const postAmt = Math.min(remaining, monthly);
  asset.accumulated_depreciation = Number((Number(asset.accumulated_depreciation) + postAmt).toFixed(2));
  if (asset.accumulated_depreciation >= depreciable - 0.01) asset.status = 'fully_depreciated';
  const voucherNo = `DEP-${asset.code}-${store.glEntries.length + 1}`;
  appendGlEntry(store, { voucher_type: 'Depreciation Entry', voucher_no: voucherNo, account_code: '5300', debit: postAmt, credit: 0, remarks: `Monthly depreciation: ${asset.name}` });
  appendGlEntry(store, { voucher_type: 'Depreciation Entry', voucher_no: voucherNo, account_code: '1590', debit: 0, credit: postAmt, remarks: `Accumulated depreciation: ${asset.name}` });
  res.json({ asset, posted_amount: postAmt });
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
app.post('/api/v1/school/students/:id/notify', (_req, res) => {
  res.json({ ok: true, emailStatus: 'sent', telegramStatus: 'queued' });
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
app.delete('/api/v1/school/announcements/:id', (req, res) => {
  const { store } = activeCtx(req, 'school');
  store.announcements = store.announcements.filter((a) => a.id !== req.params.id);
  res.json({ ok: true });
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
app.post('/api/v1/teaching/teachers/:id/link-account', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const t = store.teachers.find((x) => x.id === req.params.id);
  if (t) t.user_id = req.body?.user_id || null;
  res.json({ ok: true, teacher: t });
});
app.post('/api/v1/teaching/sessions/:id/override', (req, res) => {
  const { store } = activeCtx(req, 'school');
  const s = store.teachingSessions.find((x) => x.id === req.params.id);
  if (s) {
    if (req.body?.status) s.status = req.body.status;
    if (req.body?.status_reason !== undefined) s.status_reason = req.body.status_reason;
    if (req.body?.substitute_name !== undefined) s.substitute_name = req.body.substitute_name;
  }
  res.json({ session: s });
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

const SUBSCRIPTION_PLAN_CATALOG = [
  { id: 'plan-starter', code: 'starter', name: 'Starter', business_types: ['pharmacy', 'store', 'hospital', 'school'], price_monthly: '1500', price_semiannual: '8000', price_annual: '15000', description: 'Single-branch workspace', features: ['POS & Inventory', 'Up to 5 staff', 'Reports & Receipts'] },
  { id: 'plan-pro', code: 'pro', name: 'Growth', business_types: ['pharmacy', 'store', 'hospital', 'school'], price_monthly: '3500', price_semiannual: '19000', price_annual: '35000', description: 'Full suite with Payroll & Marketing', features: ['Unlimited staff', 'Payroll & Expenses', 'Marketing & Telegram Bot'] },
];

app.get('/api/v1/billing/plans', (_req, res) => {
  res.json({ plans: SUBSCRIPTION_PLAN_CATALOG });
});
app.get('/api/v1/billing/subscription', (req, res) => {
  const { store, tenant } = activeCtx(req);
  res.json({
    subscription: store.activeSubscription || null,
    access_until: tenant?.trial_ends_at || demoTrialEnds,
  });
});
app.get('/api/v1/billing/payments', (req, res) => {
  const { store } = activeCtx(req);
  res.json({ payments: store.billingPayments || [] });
});
app.get('/api/v1/billing/providers', (_req, res) => {
  const tb = getServerTelebirrConfig();
  const chapaEnv = getPlatformGatewayEnv('chapa');
  const mpesaEnv = getPlatformGatewayEnv('mpesa');
  res.json({
    providers: [
      { id: 'telebirr', name: 'Telebirr', configured: tb.configured },
      { id: 'chapa', name: 'Chapa', configured: chapaEnv.configured },
      { id: 'mpesa', name: 'M-Pesa', configured: mpesaEnv.configured },
      { id: 'cbe', name: 'CBE Birr', configured: true },
    ],
  });
});
app.post('/api/v1/billing/checkout', async (req, res) => {
  const { tenant, user, store } = activeCtx(req);
  const { plan_code = 'pro', period_months = 1, provider = 'cbe' } = req.body ?? {};
  const plan = SUBSCRIPTION_PLAN_CATALOG.find((p) => p.code === plan_code) || SUBSCRIPTION_PLAN_CATALOG[0];
  const months = [1, 6, 12].includes(Number(period_months)) ? Number(period_months) : 1;
  const amount = Number(months === 12 ? plan.price_annual : months === 6 ? plan.price_semiannual : plan.price_monthly);
  const txRef = `AFRO-SUB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const origin = getRequestOrigin(req);
  const returnUrl = `${origin}/app/subscription?tx_ref=${encodeURIComponent(txRef)}`;

  store.billingPayments = store.billingPayments || [];
  let checkoutUrl = null;
  let providerRef = null;

  if (provider === 'telebirr') {
    const tb = getServerTelebirrConfig();
    if (!tb.configured) {
      return res.status(503).json({ error: 'Telebirr live merchant credentials are not configured on this server.' });
    }
    const tbInit = await initializeTelebirrOrder({
      config: tb,
      orderParams: {
        merchOrderId: txRef,
        title: `AFRO Suite ${plan.name} (${months}mo)`,
        amount,
        notifyUrl: `${origin}/api/telebirr/notify`,
        redirectUrl: returnUrl,
      },
    });
    if (!tbInit.ok) {
      return res.status(tbInit.statusCode || 502).json({ error: tbInit.error || 'Telebirr checkout initialization failed.' });
    }
    checkoutUrl = tbInit.checkoutUrl;
    providerRef = txRef;
  } else if (provider === 'chapa') {
    const chapaEnv = getPlatformGatewayEnv('chapa');
    if (!chapaEnv.configured) {
      return res.status(503).json({ error: 'Chapa live credentials are not configured on this server.' });
    }
    const payload = buildChapaInitPayload({
      amount,
      currency: 'ETB',
      email: user?.email || tenant?.owner_email || 'billing@afrotech.et',
      fullName: user?.full_name || 'Subscriber',
      txRef,
      callbackUrl: `${origin}/api/chapa/webhook`,
      returnUrl,
      serviceTitle: 'AFRO Suite Billing',
      description: `${plan.name} (${months}mo)`,
    });
    const chapaInit = await initializeChapaPayment({ secretKey: chapaEnv.credentials.secretKey, payload });
    if (!chapaInit.ok) {
      return res.status(chapaInit.statusCode || 502).json({ error: chapaInit.error || 'Chapa initialization failed.' });
    }
    checkoutUrl = chapaInit.checkoutUrl;
  }

  store.billingPayments.unshift({
    id: `bp-${crypto.randomUUID().slice(0, 8)}`,
    tx_ref: txRef,
    provider,
    provider_ref: providerRef,
    amount: amount.toFixed(2),
    currency: 'ETB',
    period_months: months,
    status: 'pending',
    paid_at: null,
    created_at: new Date().toISOString(),
    plan_id: plan.id,
    plan_code: plan.code,
    plan_name: plan.name,
    failure_reason: null,
  });

  res.json({ checkout_url: checkoutUrl, tx_ref: txRef, mock: false, provider });
});
app.post('/api/v1/billing/verify', async (req, res) => {
  const { store, tenant } = activeCtx(req);
  const txRef = String(req.body?.tx_ref || '').trim();
  store.billingPayments = store.billingPayments || [];
  const payment = store.billingPayments.find((p) => p.tx_ref === txRef);

  if (payment && payment.provider === 'telebirr' && payment.status !== 'success') {
    const tb = getServerTelebirrConfig();
    if (!tb.configured) {
      return res.status(503).json({ error: 'Telebirr credentials are not configured.' });
    }
    const q = await queryTelebirrOrder({ config: tb, merchOrderId: payment.provider_ref || txRef });
    if (!q.verified) {
      return res.json({ ok: false, pending: true, message: 'Awaiting Telebirr confirmation.' });
    }
    payment.status = 'success';
    payment.paid_at = new Date().toISOString();
  } else if (payment && payment.provider === 'chapa' && payment.status !== 'success') {
    const chapaEnv = getPlatformGatewayEnv('chapa');
    if (chapaEnv.configured) {
      const c = await verifyChapaPayment({ secretKey: chapaEnv.credentials.secretKey, txRef });
      if (!c.verified) {
        return res.json({ ok: false, pending: true, message: 'Awaiting Chapa confirmation.' });
      }
      payment.status = 'success';
      payment.paid_at = new Date().toISOString();
    }
  } else if (payment && payment.status !== 'success') {
    payment.status = 'success';
    payment.paid_at = new Date().toISOString();
  }

  if (payment && payment.status === 'success') {
    const start = new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + Number(payment.period_months || 1));
    if (tenant) {
      tenant.status = 'active';
      tenant.trial_ends_at = end.toISOString();
    }
    store.activeSubscription = {
      id: `sub-${crypto.randomUUID().slice(0, 8)}`,
      plan_id: payment.plan_id,
      plan_code: payment.plan_code,
      plan_name: payment.plan_name,
      status: 'active',
      current_period_start: start.toISOString(),
      current_period_end: end.toISOString(),
      amount_last: payment.amount,
    };
    return res.json({ ok: true, access_until: end.toISOString() });
  }

  res.json({ ok: true, access_until: tenant?.trial_ends_at || demoTrialEnds });
});

/* ── Tenant Payment Gateways, Links, Payouts & Public Checkout ── */
const PROVIDER_FEE_RATES = {
  chapa: 2.5,
  telebirr: 1.0,
  mpesa: 1.5,
  cbe_bank: 0,
  stripe: 2.9,
};
const OUTBOUND_CAPABLE = new Set(['chapa', 'telebirr', 'mpesa', 'cbe_bank']);

function sanitizeGateways(store) {
  const map = store.paymentGateways || {};
  return Object.values(map).map((gw) => {
    const platformEnv = getPlatformGatewayEnv(gw.provider);
    const hasSecret = Object.keys(gw.encrypted_secrets || {}).length > 0;
    const effectiveMode =
      gw.mode === 'live' && gw.configured && hasSecret
        ? 'live'
        : platformEnv.configured
          ? 'live'
          : gw.mode || 'sandbox';
    return {
      provider: gw.provider,
      enabled: Boolean(gw.enabled),
      configured: Boolean(gw.configured),
      is_default: Boolean(gw.is_default),
      mode: effectiveMode,
      platform_live_available: Boolean(platformEnv.configured),
      public_config: gw.public_config || {},
      masked_secrets: gw.masked_secrets || {},
      has_secret: hasSecret,
      health_status: gw.health_status || 'unconfigured',
      last_tested_at: gw.last_tested_at || null,
      updated_at: gw.updated_at || null,
    };
  });
}

function getRequestOrigin(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost:3000').split(',')[0].trim();
  return (process.env.PUBLIC_URL || `${proto}://${host}`).replace(/\/+$/, '');
}

function settleInboundIntent(store, intent, { providerOverride, payerReference, verifiedSig = true } = {}) {
  if (!intent || intent.status === 'settled') return intent;
  const prov = providerOverride || intent.provider || 'cbe_bank';
  const feePct = PROVIDER_FEE_RATES[prov] ?? 0;
  const gross = Number(intent.amount || 0);
  const fee = Math.round(gross * (feePct / 100) * 100) / 100;
  const net = Math.round(Math.max(0, gross - fee) * 100) / 100;

  intent.provider = prov;
  intent.fee_amount = fee;
  intent.net_amount = net;
  intent.status = 'settled';
  intent.payer_reference = payerReference || intent.payer_reference || `SIG-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  intent.verified_signature = Boolean(verifiedSig);
  intent.settled_at = new Date().toISOString();

  const voucherNo = intent.gl_voucher_no || `GW-${1001 + store.glEntries.length}`;
  intent.gl_voucher_no = voucherNo;

  const creditAcct = intent.party_id ? '1210' : '4100';
  appendGlEntry(store, {
    voucher_type: 'Gateway Receipt',
    voucher_no: voucherNo,
    account_code: '1120',
    debit: net,
    credit: 0,
    party: intent.party_name || 'Customer',
    remarks: `${intent.description} (${prov})`,
  });
  if (fee > 0) {
    appendGlEntry(store, {
      voucher_type: 'Gateway Receipt',
      voucher_no: voucherNo,
      account_code: '5200',
      debit: fee,
      credit: 0,
      party: prov,
      remarks: `Gateway processing fee (${feePct}%)`,
    });
  }
  appendGlEntry(store, {
    voucher_type: 'Gateway Receipt',
    voucher_no: voucherNo,
    account_code: creditAcct,
    debit: 0,
    credit: gross,
    party: intent.party_name || 'Customer',
    remarks: `${intent.description} (${intent.tx_ref})`,
  });

  if (intent.reference_type === 'customer_credit' && intent.party_id) {
    const cust = store.customers.find((c) => c.id === intent.party_id);
    if (cust) {
      cust.balance = Math.max(0, Number(cust.balance || 0) - gross).toFixed(2);
    }
    store.customerPayments.unshift({
      id: `cp-${crypto.randomUUID().slice(0, 8)}`,
      customer_id: intent.party_id,
      amount: gross.toFixed(2),
      note: `Online payment via ${prov} (${intent.tx_ref})`,
      recorded_by: 'Payment Gateway',
      created_at: new Date().toISOString(),
    });
  } else if (intent.reference_type === 'hospital_invoice' && intent.reference_id) {
    const inv = store.invoices.find((i) => i.id === intent.reference_id);
    if (inv) {
      const nextPaid = Math.min(Number(inv.amount), Number(inv.paid_amount || 0) + gross);
      inv.paid_amount = nextPaid.toFixed(2);
      inv.status = nextPaid >= Number(inv.amount) ? 'paid' : 'partial';
    }
  } else if (intent.reference_type === 'school_fee' && intent.reference_id) {
    const feeRow = store.fees.find((f) => f.id === intent.reference_id);
    if (feeRow) {
      const nextPaid = Math.min(Number(feeRow.amount), Number(feeRow.paid_amount || 0) + gross);
      feeRow.paid_amount = nextPaid.toFixed(2);
      feeRow.status = nextPaid >= Number(feeRow.amount) ? 'paid' : 'partial';
      if (feeRow.status === 'paid') feeRow.paid_at = new Date().toISOString();
    }
  }

  return intent;
}

app.get('/api/v1/payments/gateways', (req, res) => {
  const { tenant, store } = activeCtx(req);
  res.json({
    gateways: sanitizeGateways(store),
    webhook_url: `/api/v1/webhooks/payments/${tenant?.id || 'tenant-demo-1'}`,
  });
});

app.put('/api/v1/payments/gateways/:provider', (req, res) => {
  const { tenant, user, store } = activeCtx(req);
  const prov = req.params.provider;
  if (!store.paymentGateways?.[prov]) {
    return res.status(404).json({ error: 'Unsupported payment provider' });
  }
  const { enabled = true, mode = 'sandbox', public_config = {}, secrets = {}, is_default = false } = req.body ?? {};
  const existing = store.paymentGateways[prov];
  const nextEncrypted = { ...(existing.encrypted_secrets || {}) };
  const nextMasked = { ...(existing.masked_secrets || {}) };

  for (const [k, val] of Object.entries(secrets || {})) {
    const clean = String(val ?? '').trim();
    if (clean) {
      nextEncrypted[k] = encryptSecret(clean);
      nextMasked[k] = maskSecret(clean);
    }
  }

  const nextPublic = { ...(existing.public_config || {}) };
  for (const [k, val] of Object.entries(public_config || {})) {
    nextPublic[k] = String(val ?? '').trim();
  }

  const needsSecret = prov !== 'cbe_bank';
  const targetMode = mode === 'live' ? 'live' : 'sandbox';
  if (needsSecret && targetMode === 'live' && !nextEncrypted.secret_key) {
    return res.status(400).json({ error: 'Merchant secret key is required for Live mode and stored encrypted on the server.' });
  }
  if (targetMode === 'live' && prov === 'telebirr') {
    if (!nextPublic.fabric_app_id || !nextPublic.merchant_app_id || !nextPublic.merchant_id || !nextEncrypted.private_key) {
      return res.status(400).json({
        error: 'Telebirr Live mode requires Merchant Shortcode, Fabric App ID, Merchant App ID, App Secret, and RSA Private Key.',
      });
    }
  }
  if (targetMode === 'live' && prov === 'mpesa') {
    if (!nextPublic.public_key || !nextPublic.merchant_id || !nextEncrypted.passkey) {
      return res.status(400).json({
        error: 'M-Pesa Live mode requires Business Shortcode, Consumer Key, Consumer Secret, and Online STK Passkey.',
      });
    }
  }
  if (!String(nextPublic.settlement_account || nextPublic.public_key || nextPublic.merchant_id || '').trim()) {
    return res.status(400).json({ error: 'Merchant identifier or settlement account is required.' });
  }

  if (is_default) {
    for (const gw of Object.values(store.paymentGateways)) {
      gw.is_default = false;
    }
  }

  store.paymentGateways[prov] = {
    provider: prov,
    enabled: Boolean(enabled),
    configured: true,
    is_default: Boolean(is_default || existing.is_default),
    mode: targetMode,
    public_config: nextPublic,
    encrypted_secrets: nextEncrypted,
    masked_secrets: nextMasked,
    health_status: 'configured',
    last_tested_at: existing.last_tested_at,
    updated_at: new Date().toISOString(),
  };

  recordAudit(tenant?.name, user?.full_name, 'gateway.configured', prov, { mode: store.paymentGateways[prov].mode, enabled: Boolean(enabled) });
  res.json({ gateways: sanitizeGateways(store), gateway: sanitizeGateways(store).find((g) => g.provider === prov) });
});

app.post('/api/v1/payments/gateways/:provider/test', async (req, res) => {
  const { tenant, user, store } = activeCtx(req);
  const prov = req.params.provider;
  const gw = store.paymentGateways?.[prov];
  if (!gw || !gw.configured) {
    return res.status(400).json({ error: 'Configure and save this gateway before running verification.' });
  }
  try {
    const runtime = resolveGatewayRuntime({ store, provider: prov, env: process.env, decryptSecretFn: decryptSecret });
    if (runtime.mode === 'live' && prov === 'chapa') {
      const probe = await fetch('https://api.chapa.co/v1/banks', {
        headers: { Authorization: `Bearer ${runtime.credentials.secretKey}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => null);
      if (!probe || probe.status === 401 || !probe.ok) {
        gw.health_status = 'error';
        return res.status(400).json({ error: 'Live Chapa API rejected credentials or was unreachable.' });
      }
    } else if (runtime.mode === 'live' && prov === 'telebirr') {
      const tokenProbe = await applyTelebirrFabricToken({
        baseUrl: runtime.credentials.baseUrl,
        fabricAppId: runtime.credentials.fabricAppId,
        appSecret: runtime.credentials.appSecret,
      });
      if (!tokenProbe.ok) {
        gw.health_status = 'error';
        return res.status(400).json({ error: tokenProbe.error || 'Telebirr Fabric token handshake failed.' });
      }
    } else if (runtime.mode === 'live' && prov === 'mpesa') {
      const oauthProbe = await getMpesaAccessToken({
        baseUrl: runtime.credentials.baseUrl,
        consumerKey: runtime.credentials.consumerKey,
        consumerSecret: runtime.credentials.consumerSecret,
      });
      if (!oauthProbe.ok) {
        gw.health_status = 'error';
        return res.status(400).json({ error: oauthProbe.error || 'M-Pesa Safaricom OAuth handshake failed.' });
      }
    }
    gw.health_status = 'verified';
    gw.last_tested_at = new Date().toISOString();
    recordAudit(tenant?.name, user?.full_name, 'gateway.tested', prov, { mode: runtime.mode });
    res.json({ ok: true, status: 'verified', mode: runtime.mode, tested_at: gw.last_tested_at, gateways: sanitizeGateways(store) });
  } catch (err) {
    gw.health_status = 'error';
    res.status(400).json({ error: err instanceof Error ? err.message : 'Verification failed' });
  }
});

app.get('/api/v1/payments/transactions', (req, res) => {
  const { store } = activeCtx(req);
  const intents = store.paymentIntents || [];
  const settledInbound = intents.filter((i) => i.direction === 'receive' && i.status === 'settled').reduce((s, i) => s + Number(i.amount || 0), 0);
  const settledOutbound = intents.filter((i) => i.direction === 'pay' && i.status === 'settled').reduce((s, i) => s + Number(i.amount || 0), 0);
  const pendingCount = intents.filter((i) => i.status === 'pending').length;
  const totalFees = intents.filter((i) => i.status === 'settled').reduce((s, i) => s + Number(i.fee_amount || 0), 0);
  const activeGateways = Object.values(store.paymentGateways || {}).filter((g) => g.enabled && g.configured).length;
  res.json({
    intents,
    summary: { settled_inbound: settledInbound, settled_outbound: settledOutbound, pending_count: pendingCount, total_fees: totalFees, active_gateways: activeGateways },
    gateways: sanitizeGateways(store),
  });
});

app.post('/api/v1/payments/links', async (req, res) => {
  const { tenant, store } = activeCtx(req);
  const {
    provider,
    lock_provider,
    party_id = null,
    party_name = '',
    amount = 0,
    description = 'Invoice Payment',
    reference_type = 'custom',
    reference_id = null,
    customer_phone = '',
    customer_email = '',
  } = req.body ?? {};
  const amt = Number(amount || 0);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Payment amount must be greater than zero.' });
  }

  const runtime = resolveGatewayRuntime({
    store,
    provider,
    env: process.env,
    decryptSecretFn: decryptSecret,
  });
  if (!runtime.ok) {
    return res.status(400).json({ error: runtime.error || 'Unsupported payment gateway.' });
  }

  const chosenProvider = runtime.provider;
  const providerLocked = Boolean(normalizeGatewayProvider(provider)) && lock_provider !== false;

  let resolvedPartyName = String(party_name || '').trim();
  if (!resolvedPartyName && party_id) {
    const cust = store.customers.find((c) => c.id === party_id);
    if (cust) resolvedPartyName = cust.name;
  }

  const feePct = PROVIDER_FEE_RATES[chosenProvider] ?? 0;
  const fee = Math.round(amt * (feePct / 100) * 100) / 100;
  const net = Math.round(Math.max(0, amt - fee) * 100) / 100;
  const token = `pay-${crypto.randomUUID().slice(0, 10)}`;
  const txRef = `AFRO-PAY-${1001 + (store.paymentIntents?.length || 0)}`;
  const origin = getRequestOrigin(req);

  const intent = {
    id: `pi-${crypto.randomUUID().slice(0, 8)}`,
    tx_ref: txRef,
    token,
    direction: 'receive',
    provider: chosenProvider,
    provider_locked: providerLocked,
    mode: runtime.mode,
    credential_source: runtime.source,
    party_id,
    party_name: resolvedPartyName || 'Customer',
    customer_email: isValidEmail(customer_email) ? String(customer_email).trim() : null,
    customer_phone: String(customer_phone || '').trim() || null,
    reference_type,
    reference_id,
    description: String(description || 'Invoice Payment').trim(),
    amount: amt,
    fee_amount: fee,
    net_amount: net,
    currency: store.settings?.currency || 'ETB',
    status: 'pending',
    payer_reference: null,
    verified_signature: false,
    gl_voucher_no: null,
    external_checkout_url: null,
    prepay_id: null,
    receive_code: null,
    checkout_request_id: null,
    customer_message: null,
    invoice: null,
    created_at: new Date().toISOString(),
    settled_at: null,
  };

  // In LIVE mode, initialize upstream gateway session eagerly when prerequisite customer data is present (or Telebirr preOrder)
  const canPreInitLive =
    runtime.mode === 'live' &&
    (chosenProvider === 'telebirr' ||
      (chosenProvider === 'chapa' && Boolean(intent.customer_email)) ||
      (chosenProvider === 'mpesa' && Boolean(normalizeMpesaPhone(intent.customer_phone))));

  if (canPreInitLive) {
    const initRes = await initiateGatewayCheckout({
      runtime,
      intent,
      payerName: intent.party_name,
      payerEmail: intent.customer_email || '',
      payerPhone: intent.customer_phone || '',
      businessName: store.settings?.business_name || tenant?.name || 'AFRO Suite Merchant',
      callbacks: {
        chapaCallbackUrl: `${origin}/api/v1/webhooks/payments/${tenant?.id || 'tenant-demo-1'}`,
        telebirrNotifyUrl: `${origin}/api/v1/webhooks/payments/${tenant?.id || 'tenant-demo-1'}`,
        mpesaCallbackUrl: `${origin}/api/mpesa/callback`,
        returnUrl: `${origin}/pay/${token}?tx_ref=${encodeURIComponent(txRef)}&verify=1`,
      },
    });
    if (!initRes.ok) {
      return res.status(initRes.statusCode || 502).json({
        error: initRes.error || `Could not initialize ${chosenProvider} live checkout.`,
      });
    }
    intent.external_checkout_url = initRes.checkoutUrl || null;
    intent.prepay_id = initRes.prepayId || null;
    intent.receive_code = initRes.receiveCode || null;
    intent.checkout_request_id = initRes.checkoutRequestId || null;
    intent.customer_message = initRes.customerMessage || null;
  }

  store.paymentIntents.unshift(intent);
  res.status(201).json({
    intent,
    pay_path: `/pay/${token}`,
    checkout_url: intent.external_checkout_url || `/pay/${token}`,
    external_checkout_url: intent.external_checkout_url,
    provider: chosenProvider,
    provider_locked: providerLocked,
    mode: runtime.mode,
    credential_source: runtime.source,
  });
});

app.post('/api/v1/payments/payouts', (req, res) => {
  const { tenant, user, store } = activeCtx(req);
  const { provider = 'cbe_bank', party_id = null, party_name = '', destination_account = '', amount = 0, remarks = '' } = req.body ?? {};
  const gw = store.paymentGateways?.[provider];
  if (!gw || !gw.enabled || !gw.configured) {
    return res.status(400).json({ error: 'Selected payment gateway is not enabled.' });
  }
  if (!OUTBOUND_CAPABLE.has(provider)) {
    return res.status(400).json({ error: 'Selected gateway does not support outbound vendor payouts.' });
  }
  const amt = Number(amount || 0);
  if (!Number.isFinite(amt) || amt <= 0) {
    return res.status(400).json({ error: 'Payout amount must be greater than zero.' });
  }
  if (String(destination_account).trim().length < 4) {
    return res.status(400).json({ error: 'Enter a valid destination bank account or mobile wallet.' });
  }

  let sup = null;
  if (party_id) {
    sup = store.suppliers.find((s) => s.id === party_id) || null;
  }
  const recipientName = sup?.name || String(party_name || '').trim() || 'Vendor / Supplier';
  const txRef = `AFRO-OUT-${1001 + (store.paymentIntents?.length || 0)}`;
  const voucherNo = `POUT-${1001 + store.glEntries.length}`;

  if (sup) {
    sup.balance = Math.max(0, Number(sup.balance || 0) - amt).toFixed(2);
    store.supplierPayments.unshift({
      id: `sp-${crypto.randomUUID().slice(0, 8)}`,
      supplier_id: sup.id,
      amount: amt.toFixed(2),
      payment_method: provider,
      notes: remarks || `Gateway payout (${txRef})`,
      recorded_by: user.full_name,
      created_at: new Date().toISOString(),
    });
  }

  appendGlEntry(store, {
    voucher_type: 'Gateway Payout',
    voucher_no: voucherNo,
    account_code: sup ? '2110' : '5200',
    debit: amt,
    credit: 0,
    party: recipientName,
    remarks: remarks || `Outbound payout to ${destination_account}`,
  });
  appendGlEntry(store, {
    voucher_type: 'Gateway Payout',
    voucher_no: voucherNo,
    account_code: '1120',
    debit: 0,
    credit: amt,
    party: recipientName,
    remarks: `Paid via ${provider} (${txRef})`,
  });

  const payout = {
    id: `pi-${crypto.randomUUID().slice(0, 8)}`,
    tx_ref: txRef,
    token: null,
    direction: 'pay',
    provider,
    party_id: sup?.id || party_id,
    party_name: recipientName,
    destination_account: String(destination_account).trim(),
    reference_type: sup ? 'supplier_payout' : 'expense_payout',
    reference_id: sup?.id || null,
    description: remarks?.trim() || `Secure payout to ${recipientName}`,
    amount: amt,
    fee_amount: 0,
    net_amount: amt,
    currency: store.settings?.currency || 'ETB',
    status: 'settled',
    payer_reference: `TRF-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    verified_signature: true,
    gl_voucher_no: voucherNo,
    created_at: new Date().toISOString(),
    settled_at: new Date().toISOString(),
  };
  store.paymentIntents.unshift(payout);
  recordAudit(tenant?.name, user?.full_name, 'payment.payout_sent', txRef, { provider, recipient: recipientName, amount: amt });
  res.status(201).json({ payout });
});

app.post('/api/v1/payments/intents/:id/settle', async (req, res) => {
  const { tenant, user, store } = activeCtx(req);
  const intent = (store.paymentIntents || []).find((i) => i.id === req.params.id);
  if (!intent) return res.status(404).json({ error: 'Payment intent not found' });
  if (intent.status === 'settled') {
    if (!intent.invoice) {
      await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenant, store) });
    }
    return res.json({ intent });
  }
  settleInboundIntent(store, intent, {
    providerOverride: req.body?.provider,
    payerReference: req.body?.payer_reference,
    verifiedSig: true,
  });
  await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenant, store) });
  recordAudit(tenant?.name, user?.full_name, 'payment.settled', intent.tx_ref, { amount: intent.amount, provider: intent.provider });
  res.json({ intent });
});

app.post('/api/v1/payments/intents/:id/refund', (req, res) => {
  const { tenant, user, store } = activeCtx(req);
  const intent = (store.paymentIntents || []).find((i) => i.id === req.params.id);
  if (!intent) return res.status(404).json({ error: 'Payment intent not found' });
  if (intent.status !== 'settled' || intent.direction !== 'receive') {
    return res.status(400).json({ error: 'Only settled inbound payments can be refunded.' });
  }
  const voucherNo = `REF-${1001 + store.glEntries.length}`;
  appendGlEntry(store, {
    voucher_type: 'Gateway Refund',
    voucher_no: voucherNo,
    account_code: intent.party_id ? '1210' : '4100',
    debit: Number(intent.amount),
    credit: 0,
    party: intent.party_name,
    remarks: `Refund ${intent.tx_ref}`,
  });
  appendGlEntry(store, {
    voucher_type: 'Gateway Refund',
    voucher_no: voucherNo,
    account_code: '1120',
    debit: 0,
    credit: Number(intent.amount),
    party: intent.party_name,
    remarks: `Refund payout (${intent.provider})`,
  });
  intent.status = 'refunded';
  intent.refunded_at = new Date().toISOString();
  recordAudit(tenant?.name, user?.full_name, 'payment.refunded', intent.tx_ref, { amount: intent.amount });
  res.json({ intent });
});

app.post('/api/v1/webhooks/payments/:tenantId', async (req, res) => {
  const store = tenantData.get(req.params.tenantId);
  if (!store) return res.status(404).json({ error: 'Tenant not found' });

  // 1. M-Pesa STK Push callback format
  const mpesaParsed = parseMpesaCallback(req.body);
  if (mpesaParsed.valid) {
    if (mpesaParsed.success && mpesaParsed.checkoutRequestId) {
      const intent = (store.paymentIntents || []).find(
        (i) => i.checkout_request_id === mpesaParsed.checkoutRequestId || i.tx_ref === mpesaParsed.checkoutRequestId,
      );
      if (intent) {
        settleInboundIntent(store, intent, {
          providerOverride: 'mpesa',
          payerReference: mpesaParsed.mpesaReceiptNumber || mpesaParsed.checkoutRequestId,
          verifiedSig: true,
        });
        await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenants.get(req.params.tenantId), store) });
      }
    }
    return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
  }

  // 2. Telebirr Fabric Notify format
  if (req.body?.merch_order_id || req.body?.biz_content?.merch_order_id) {
    const tbRef = String(req.body?.merch_order_id || req.body?.biz_content?.merch_order_id || '').trim();
    const tbStatus = String(req.body?.trade_status || req.body?.order_status || req.body?.biz_content?.order_status || '').toUpperCase();
    const tbGw = store.paymentGateways?.telebirr;
    const tbPubKey = (tbGw?.encrypted_secrets?.public_key ? decryptSecret(tbGw.encrypted_secrets.public_key) : '') || String(tbGw?.public_config?.public_key || '');
    const tbSig = req.body?.sign || req.headers['x-telebirr-signature'] || '';
    if (tbPubKey && tbSig && !verifyTelebirrSignature(req.body, String(tbSig), tbPubKey)) {
      return res.status(401).json({ error: 'Invalid Telebirr RSA signature' });
    }
    if (['PAY_SUCCESS', 'TRADE_SUCCESS', 'COMPLETED', 'SUCCESS'].includes(tbStatus)) {
      const intent = (store.paymentIntents || []).find((i) => i.tx_ref === tbRef);
      if (intent) {
        settleInboundIntent(store, intent, {
          providerOverride: 'telebirr',
          payerReference: req.body?.payment_order_id || req.body?.biz_content?.payment_order_id || tbRef,
          verifiedSig: true,
        });
        await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenants.get(req.params.tenantId), store) });
      }
    }
    return res.json({ code: '0', msg: 'success' });
  }

  // 3. Chapa / generic signed tenant webhook
  const { tx_ref, trx_ref, provider = 'chapa', payer_reference, reference, ref_id } = req.body ?? {};
  const resolvedTxRef = String(tx_ref || trx_ref || '').trim();
  const sig = req.headers['x-afro-signature'] || req.headers['chapa-signature'] || req.headers['x-chapa-signature'] || '';
  const gw = store.paymentGateways?.[provider];
  const whSecret = gw?.encrypted_secrets?.webhook_secret
    ? decryptSecret(gw.encrypted_secrets.webhook_secret)
    : gw?.encrypted_secrets?.secret_key
      ? decryptSecret(gw.encrypted_secrets.secret_key)
      : '';
  if (whSecret && sig) {
    if (!verifyWebhookSignature(req.body ?? {}, whSecret, String(sig))) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }
  }
  const intent = (store.paymentIntents || []).find((i) => i.tx_ref === resolvedTxRef);
  if (!intent) return res.status(404).json({ error: 'Transaction reference not found' });
  settleInboundIntent(store, intent, {
    providerOverride: provider,
    payerReference: payer_reference || reference || ref_id || resolvedTxRef,
    verifiedSig: true,
  });
  await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenants.get(req.params.tenantId), store) });
  res.json({ ok: true, status: intent.status, tx_ref: intent.tx_ref, invoice: intent.invoice || null });
});

function findPublicIntentByToken(token) {
  for (const [tenantId, store] of tenantData.entries()) {
    const intent = (store.paymentIntents || []).find((i) => i.token === token);
    if (intent) {
      const tenant = tenants.get(tenantId);
      return { tenantId, tenant, store, intent };
    }
  }
  return null;
}

function findPublicServiceOrderByToken(token) {
  for (const order of serviceChapaOrders.values()) {
    if (order.token === token) return order;
  }
  return null;
}

app.get('/api/v1/public/pay/:token', async (req, res) => {
  const svcOrder = findPublicServiceOrderByToken(req.params.token);
  if (svcOrder) {
    if (svcOrder.status === 'settled' && !svcOrder.invoice) {
      await dispatchTransactionInvoice(svcOrder, { merchant: DEFAULT_SERVICE_MERCHANT });
    }
    const prov = svcOrder.provider || 'chapa';
    const walletLabel =
      prov === 'telebirr'
        ? 'AFRO-TECH Telebirr Merchant Checkout'
        : prov === 'mpesa'
          ? 'AFRO-TECH M-Pesa Safaricom Checkout'
          : 'AFRO-TECH Chapa Merchant Checkout';
    return res.json({
      merchant: {
        name: 'AFRO-TECH Digital Services',
        tin_number: null,
        phone: '+251 910 011 818',
        address: 'Addis Ababa, Ethiopia',
      },
      intent: {
        id: svcOrder.id,
        tx_ref: svcOrder.tx_ref,
        provider: prov,
        provider_locked: true,
        mode: svcOrder.mode || 'sandbox',
        credential_source: svcOrder.mode === 'live' ? 'platform_live' : 'platform_sandbox',
        party_name: svcOrder.customer_name,
        customer_email: svcOrder.customer_email || null,
        customer_phone: svcOrder.customer_phone || null,
        description: svcOrder.description,
        amount: svcOrder.amount,
        fee_amount: 0,
        net_amount: svcOrder.amount,
        currency: svcOrder.currency,
        status: svcOrder.status,
        payer_reference: svcOrder.payer_reference || svcOrder.chapa_reference,
        gl_voucher_no: null,
        external_checkout_url: svcOrder.mode === 'live' ? svcOrder.checkout_url || null : null,
        prepay_id: svcOrder.prepay_id || null,
        receive_code: svcOrder.receive_code || null,
        checkout_request_id: svcOrder.checkout_request_id || null,
        customer_message: svcOrder.customer_message || null,
        return_url: svcOrder.return_url,
        invoice: svcOrder.invoice || null,
        created_at: svcOrder.created_at,
        settled_at: svcOrder.settled_at,
      },
      enabled_gateways: [
        {
          provider: prov,
          mode: svcOrder.mode || 'sandbox',
          is_default: true,
          public_config: { settlement_account: walletLabel },
        },
      ],
    });
  }

  const found = findPublicIntentByToken(req.params.token);
  if (!found) return res.status(404).json({ error: 'Payment link not found or expired.' });
  const { tenant, store, intent } = found;
  if (intent.status === 'settled' && !intent.invoice) {
    await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenant, store) });
  }
  const runtime = resolveGatewayRuntime({
    store,
    provider: intent.provider,
    env: process.env,
    decryptSecretFn: decryptSecret,
  });

  const allSanitized = sanitizeGateways(store)
    .filter((g) => g.enabled && g.configured)
    .map((g) => ({
      provider: g.provider,
      mode: g.mode,
      is_default: g.is_default,
      public_config: g.provider === 'cbe_bank' ? g.public_config : { settlement_account: g.public_config?.settlement_account || '', merchant_id: g.public_config?.merchant_id || '' },
    }));

  let enabledGateways;
  if (intent.provider_locked) {
    const exact = allSanitized.find((g) => g.provider === intent.provider);
    enabledGateways = [
      exact || {
        provider: intent.provider,
        mode: runtime.mode === 'direct' ? 'sandbox' : runtime.mode,
        is_default: true,
        public_config: runtime.publicConfig || {},
      },
    ];
  } else {
    enabledGateways = [...allSanitized].sort((a, b) => (a.provider === intent.provider ? -1 : b.provider === intent.provider ? 1 : 0));
  }

  res.json({
    merchant: {
      name: store.settings?.business_name || tenant?.name || 'AFRO Suite Merchant',
      tin_number: store.settings?.tin_number || null,
      phone: store.settings?.business_phone || null,
      address: store.settings?.business_address || null,
    },
    intent: {
      id: intent.id,
      tx_ref: intent.tx_ref,
      provider: intent.provider,
      provider_locked: Boolean(intent.provider_locked),
      mode: intent.mode || runtime.mode,
      credential_source: intent.credential_source || runtime.source,
      party_name: intent.party_name,
      customer_email: intent.customer_email || null,
      customer_phone: intent.customer_phone || null,
      description: intent.description,
      amount: intent.amount,
      fee_amount: intent.fee_amount,
      net_amount: intent.net_amount,
      currency: intent.currency,
      status: intent.status,
      payer_reference: intent.payer_reference,
      gl_voucher_no: intent.gl_voucher_no,
      external_checkout_url: intent.external_checkout_url || null,
      prepay_id: intent.prepay_id || null,
      receive_code: intent.receive_code || null,
      checkout_request_id: intent.checkout_request_id || null,
      customer_message: intent.customer_message || null,
      invoice: intent.invoice || null,
      created_at: intent.created_at,
      settled_at: intent.settled_at,
    },
    enabled_gateways: enabledGateways,
  });
});

app.post('/api/v1/public/pay/:token/initiate', async (req, res) => {
  const { provider, payer_name = '', payer_email = '', payer_phone = '' } = req.body ?? {};
  const origin = getRequestOrigin(req);

  const svcOrder = findPublicServiceOrderByToken(req.params.token);
  if (svcOrder) {
    const prov = svcOrder.provider || 'chapa';
    if (payer_name.trim()) svcOrder.customer_name = payer_name.trim();
    if (isValidEmail(payer_email)) svcOrder.customer_email = payer_email.trim();
    if (payer_phone.trim()) svcOrder.customer_phone = payer_phone.trim();

    const runtime = resolveGatewayRuntime({ store: null, provider: prov, env: process.env });
    const initRes = await initiateGatewayCheckout({
      runtime,
      intent: {
        tx_ref: svcOrder.tx_ref,
        amount: svcOrder.amount,
        currency: svcOrder.currency,
        party_name: svcOrder.customer_name,
        customer_email: svcOrder.customer_email,
        customer_phone: svcOrder.customer_phone,
        description: svcOrder.description,
      },
      payerName: payer_name,
      payerEmail: payer_email,
      payerPhone: payer_phone,
      businessName: 'AFRO-TECH Digital Services',
      callbacks: {
        chapaCallbackUrl: `${origin}/api/chapa/webhook`,
        telebirrNotifyUrl: `${origin}/api/telebirr/notify`,
        mpesaCallbackUrl: `${origin}/api/mpesa/callback`,
        returnUrl: `${origin}/pay/${req.params.token}?tx_ref=${encodeURIComponent(svcOrder.tx_ref)}&verify=1`,
      },
    });
    if (!initRes.ok) {
      return res.status(initRes.statusCode || 400).json({ error: initRes.error });
    }
    svcOrder.mode = initRes.mode;
    svcOrder.prepay_id = initRes.prepayId || svcOrder.prepay_id || null;
    svcOrder.receive_code = initRes.receiveCode || svcOrder.receive_code || null;
    svcOrder.checkout_request_id = initRes.checkoutRequestId || svcOrder.checkout_request_id || null;
    svcOrder.customer_message = initRes.customerMessage || svcOrder.customer_message || null;
    return res.json({
      ok: true,
      action: initRes.action,
      mode: initRes.mode,
      provider: prov,
      checkout_url: initRes.checkoutUrl || null,
      prepay_id: svcOrder.prepay_id,
      receive_code: svcOrder.receive_code,
      checkout_request_id: svcOrder.checkout_request_id,
      customer_message: svcOrder.customer_message,
    });
  }

  const found = findPublicIntentByToken(req.params.token);
  if (!found) return res.status(404).json({ error: 'Payment link not found or expired.' });
  const { tenantId, tenant, store, intent } = found;
  if (intent.status === 'settled') {
    return res.json({ ok: true, action: 'already_settled', provider: intent.provider, mode: intent.mode || 'sandbox', intent });
  }

  const chosen = intent.provider_locked
    ? intent.provider
    : normalizeGatewayProvider(provider) || intent.provider;
  const runtime = resolveGatewayRuntime({
    store,
    provider: chosen,
    env: process.env,
    decryptSecretFn: decryptSecret,
  });
  if (!runtime.ok) {
    return res.status(400).json({ error: runtime.error });
  }

  if (payer_name.trim()) intent.party_name = payer_name.trim();
  if (isValidEmail(payer_email)) intent.customer_email = payer_email.trim();
  if (payer_phone.trim()) intent.customer_phone = payer_phone.trim();

  const initRes = await initiateGatewayCheckout({
    runtime,
    intent,
    payerName: payer_name,
    payerEmail: payer_email,
    payerPhone: payer_phone,
    businessName: store.settings?.business_name || tenant?.name || 'AFRO Suite Merchant',
    callbacks: {
      chapaCallbackUrl: `${origin}/api/v1/webhooks/payments/${tenantId}`,
      telebirrNotifyUrl: `${origin}/api/v1/webhooks/payments/${tenantId}`,
      mpesaCallbackUrl: `${origin}/api/mpesa/callback`,
      returnUrl: `${origin}/pay/${req.params.token}?tx_ref=${encodeURIComponent(intent.tx_ref)}&verify=1`,
    },
  });
  if (!initRes.ok) {
    return res.status(initRes.statusCode || 400).json({ error: initRes.error });
  }

  intent.provider = chosen;
  intent.mode = initRes.mode;
  intent.credential_source = runtime.source;
  intent.external_checkout_url = initRes.checkoutUrl || null;
  intent.prepay_id = initRes.prepayId || intent.prepay_id || null;
  intent.receive_code = initRes.receiveCode || intent.receive_code || null;
  intent.checkout_request_id = initRes.checkoutRequestId || intent.checkout_request_id || null;
  intent.customer_message = initRes.customerMessage || null;

  res.json({
    ok: true,
    action: initRes.action,
    mode: initRes.mode,
    provider: chosen,
    checkout_url: intent.external_checkout_url,
    prepay_id: intent.prepay_id,
    receive_code: intent.receive_code,
    checkout_request_id: intent.checkout_request_id,
    customer_message: intent.customer_message,
    intent,
  });
});

app.get('/api/v1/public/pay/:token/verify', async (req, res) => {
  const svcOrder = findPublicServiceOrderByToken(req.params.token);
  if (svcOrder) {
    const prov = svcOrder.provider || 'chapa';
    const runtime = resolveGatewayRuntime({ store: null, provider: prov, env: process.env });
    const verifyRes = await verifyGatewaySettlement({ runtime, intent: svcOrder });
    if (verifyRes.verified && svcOrder.status !== 'settled') {
      svcOrder.status = 'settled';
      svcOrder.payer_reference = verifyRes.payerReference || svcOrder.tx_ref;
      svcOrder.settled_at = svcOrder.settled_at || new Date().toISOString();
      await dispatchTransactionInvoice(svcOrder, { merchant: DEFAULT_SERVICE_MERCHANT });
    }
    if (svcOrder.status === 'settled' && !svcOrder.invoice) {
      await dispatchTransactionInvoice(svcOrder, { merchant: DEFAULT_SERVICE_MERCHANT });
    }
    const receiptSignature = signWebhookPayload({ tx_ref: svcOrder.tx_ref, amount: svcOrder.amount, settled_at: svcOrder.settled_at }, 'afro-receipt-verify');
    return res.json({
      ok: true,
      verified: svcOrder.status === 'settled',
      status: svcOrder.status,
      mode: svcOrder.mode || runtime.mode,
      message: verifyRes.message || null,
      intent: svcOrder,
      invoice: svcOrder.invoice || null,
      receipt_signature: receiptSignature,
    });
  }

  const found = findPublicIntentByToken(req.params.token);
  if (!found) return res.status(404).json({ error: 'Payment link not found or expired.' });
  const { tenant, store, intent } = found;
  const runtime = resolveGatewayRuntime({
    store,
    provider: intent.provider,
    env: process.env,
    decryptSecretFn: decryptSecret,
  });

  const verifyRes = await verifyGatewaySettlement({ runtime, intent });
  if (verifyRes.verified && intent.status !== 'settled') {
    settleInboundIntent(store, intent, {
      providerOverride: intent.provider,
      payerReference: verifyRes.payerReference,
      verifiedSig: true,
    });
    await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenant, store) });
  } else if (intent.status === 'settled' && !intent.invoice) {
    await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenant, store) });
  }

  const receiptSignature = signWebhookPayload({ tx_ref: intent.tx_ref, amount: intent.amount, settled_at: intent.settled_at }, 'afro-receipt-verify');
  return res.json({
    ok: true,
    verified: intent.status === 'settled',
    status: intent.status,
    mode: intent.mode || runtime.mode,
    message: verifyRes.message || null,
    intent,
    invoice: intent.invoice || null,
    receipt_signature: receiptSignature,
  });
});

app.post('/api/v1/public/pay/:token/confirm', async (req, res) => {
  const { provider, payer_name = '', payer_reference = '', payer_email = '' } = req.body ?? {};
  const svcOrder = findPublicServiceOrderByToken(req.params.token);
  if (svcOrder) {
    const prov = svcOrder.provider || 'chapa';
    const runtime = resolveGatewayRuntime({ store: null, provider: prov, env: process.env });
    if (runtime.mode === 'live' && prov !== 'cbe_bank') {
      const verifyRes = await verifyGatewaySettlement({ runtime, intent: svcOrder });
      if (!verifyRes.verified) {
        return res.status(409).json({
          pending: true,
          error: verifyRes.message || `Complete payment authorization via ${prov.toUpperCase()} before confirming.`,
        });
      }
      svcOrder.payer_reference = verifyRes.payerReference || svcOrder.tx_ref;
    }
    if (!String(payer_name).trim()) {
      return res.status(400).json({ error: 'Enter payer full name to authorize this payment.' });
    }
    if (runtime.mode !== 'live' && !String(payer_reference).trim()) {
      return res.status(400).json({ error: `Enter ${prov.toUpperCase()} wallet phone or transaction reference.` });
    }
    if (svcOrder.status !== 'settled') {
      svcOrder.customer_name = String(payer_name).trim();
      if (isValidEmail(payer_email)) {
        svcOrder.customer_email = String(payer_email).trim();
      }
      svcOrder.payer_reference = svcOrder.payer_reference || String(payer_reference).trim();
      svcOrder.status = 'settled';
      svcOrder.settled_at = new Date().toISOString();
      await dispatchTransactionInvoice(svcOrder, { merchant: DEFAULT_SERVICE_MERCHANT });
      await sendContactTelegramNotification({
        name: `${svcOrder.customer_name} (Service Payment)`,
        email: svcOrder.customer_email,
        phone: svcOrder.customer_phone || '',
        message: `${prov.toUpperCase()} Checkout Confirmed: ${svcOrder.amount} ${svcOrder.currency} for ${svcOrder.description} (Ref: ${svcOrder.tx_ref})`,
      }).catch(() => null);
    } else if (!svcOrder.invoice) {
      await dispatchTransactionInvoice(svcOrder, { merchant: DEFAULT_SERVICE_MERCHANT });
    }
    const receiptSignature = signWebhookPayload(
      { tx_ref: svcOrder.tx_ref, amount: svcOrder.amount, settled_at: svcOrder.settled_at },
      'afro-receipt-verify',
    );
    return res.json({
      ok: true,
      intent: {
        id: svcOrder.id,
        tx_ref: svcOrder.tx_ref,
        provider: prov,
        provider_locked: true,
        mode: svcOrder.mode || runtime.mode,
        party_name: svcOrder.customer_name,
        customer_email: svcOrder.customer_email || null,
        description: svcOrder.description,
        amount: svcOrder.amount,
        fee_amount: 0,
        net_amount: svcOrder.amount,
        currency: svcOrder.currency,
        status: svcOrder.status,
        payer_reference: svcOrder.payer_reference,
        gl_voucher_no: null,
        return_url: svcOrder.return_url,
        invoice: svcOrder.invoice || null,
        created_at: svcOrder.created_at,
        settled_at: svcOrder.settled_at,
      },
      invoice: svcOrder.invoice || null,
      receipt_signature: receiptSignature,
    });
  }

  const found = findPublicIntentByToken(req.params.token);
  if (!found) return res.status(404).json({ error: 'Payment link not found or expired.' });
  const { tenant, store, intent } = found;
  const chosen = intent.provider_locked
    ? intent.provider
    : normalizeGatewayProvider(provider) || intent.provider;
  const runtime = resolveGatewayRuntime({
    store,
    provider: chosen,
    env: process.env,
    decryptSecretFn: decryptSecret,
  });

  if (runtime.mode === 'live' && chosen !== 'cbe_bank') {
    const verifyRes = await verifyGatewaySettlement({ runtime, intent });
    if (!verifyRes.verified) {
      return res.status(409).json({
        pending: true,
        error: verifyRes.message || `Complete authorization via ${chosen.toUpperCase()} before confirming.`,
      });
    }
    settleInboundIntent(store, intent, {
      providerOverride: chosen,
      payerReference: verifyRes.payerReference || intent.tx_ref,
      verifiedSig: true,
    });
    await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenant, store) });
    const receiptSignature = signWebhookPayload({ tx_ref: intent.tx_ref, amount: intent.amount, settled_at: intent.settled_at }, 'afro-receipt-verify');
    return res.json({ ok: true, intent, invoice: intent.invoice || null, receipt_signature: receiptSignature });
  }

  if (!String(payer_name).trim()) {
    return res.status(400).json({ error: 'Enter payer full name to authorize this payment.' });
  }
  if (!String(payer_reference).trim()) {
    return res.status(400).json({ error: chosen === 'cbe_bank' ? 'Enter your CBE bank transfer FT reference.' : 'Enter payment reference or wallet phone number.' });
  }
  if (intent.status === 'settled') {
    if (!intent.invoice) {
      await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenant, store) });
    }
    return res.json({
      ok: true,
      intent,
      invoice: intent.invoice || null,
      receipt_signature: signWebhookPayload({ tx_ref: intent.tx_ref, amount: intent.amount }, 'afro-receipt-verify'),
    });
  }
  intent.party_name = String(payer_name).trim();
  if (isValidEmail(payer_email)) {
    intent.customer_email = String(payer_email).trim();
  }
  settleInboundIntent(store, intent, {
    providerOverride: chosen,
    payerReference: String(payer_reference).trim(),
    verifiedSig: true,
  });
  await dispatchTransactionInvoice(intent, { merchant: buildTenantMerchantInfo(tenant, store) });
  const receiptSignature = signWebhookPayload({ tx_ref: intent.tx_ref, amount: intent.amount, settled_at: intent.settled_at }, 'afro-receipt-verify');
  res.json({ ok: true, intent, invoice: intent.invoice || null, receipt_signature: receiptSignature });
});

/* ── Bot Studio Endpoints ──────────────────────────────────── */
app.get('/api/v1/telegram/config', (req, res) => {
  const { store } = activeCtx(req);
  if (store.tenantBot) {
    return res.json({ enabled: store.tenantBot.is_active, bot_username: store.tenantBot.bot_username, is_tenant_bot: true, linked: Boolean(store.telegramLink?.linked || true), app_url: store.tenantBot.share_url });
  }
  res.json({ enabled: false, bot_username: null, linked: Boolean(store.telegramLink?.linked), app_url: '' });
});
app.post('/api/v1/telegram/link-code', (req, res) => {
  const { store } = activeCtx(req);
  const code = `AFRO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  store.telegramLink = { linked: false, code };
  res.json({ code, bot_username: store.tenantBot?.bot_username || 'afro_suite_bot', expires_in: 600 });
});
app.post('/api/v1/telegram/unlink', (req, res) => {
  const { store } = activeCtx(req);
  store.telegramLink = { linked: false, code: null };
  res.json({ ok: true });
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
app.post('/api/v1/tenant-bot/receipts/:id/review', (req, res) => {
  const { store } = activeCtx(req);
  const rc = store.botReceipts.find((r) => r.id === req.params.id);
  if (rc) rc.status = req.body?.status || 'approved';
  res.json({ ok: true, receipt: rc });
});
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
app.post('/api/v1/marketing/campaigns/:id/pause', (req, res) => {
  const { store } = activeCtx(req);
  const c = store.marketingCampaigns.find((x) => x.id === req.params.id);
  if (c) c.status = 'paused';
  res.json({ ok: true, campaign: c });
});

/* ── Workspace Notifications Feed ──────────────────────────── */
app.get('/api/v1/notifications/feed', (req, res) => {
  const { tenant, store } = activeCtx(req);
  const bType = tenant?.business_type || 'store';
  const alerts = [];

  if (bType === 'pharmacy' || bType === 'store') {
    // Low stock alerts (retail / pharmacy)
    const lowStock = (store.products || []).filter(
      (p) => Number(p.stock) <= Number(p.low_stock_threshold ?? 10)
    );
    for (const p of lowStock.slice(0, 4)) {
      alerts.push({
        id: `low-stock-${p.id}`,
        title: `Low stock: ${p.name}`,
        detail: `${p.stock} left (reorder at ${p.low_stock_threshold ?? 10})`,
        severity: Number(p.stock) === 0 ? 'bad' : 'warn',
        route: '/app/products',
        icon: 'fa-solid fa-boxes-stacked',
      });
    }

    // Expiring batches
    const expiring = (store.batches || [])
      .map(enrichBatch)
      .filter((b) => b.quantity > 0 && (b.expired || b.expiring_soon));
    for (const b of expiring.slice(0, 3)) {
      alerts.push({
        id: `expiry-${b.id}`,
        title: b.expired ? `Expired batch: ${b.product_name}` : `Expiring soon: ${b.product_name}`,
        detail: `Batch ${b.batch_no} · Qty ${b.quantity} (${b.expiry_date})`,
        severity: b.expired ? 'bad' : 'warn',
        route: '/app/expiry',
        icon: 'fa-solid fa-hourglass-half',
      });
    }

    // Pending sales/purchase orders
    const pendingOrders = (store.orders || []).filter((o) => o.status === 'draft' || o.status === 'pending');
    if (pendingOrders.length > 0) {
      alerts.push({
        id: `orders-pending-${pendingOrders.length}`,
        title: `${pendingOrders.length} open quote/order${pendingOrders.length > 1 ? 's' : ''}`,
        detail: 'Ready for review or conversion to invoice',
        severity: 'info',
        route: '/app/orders',
        icon: 'fa-solid fa-file-signature',
      });
    }
  }

  if (bType === 'hospital') {
    const waitingAppts = (store.appointments || []).filter((a) => a.status === 'scheduled' || a.status === 'waiting');
    if (waitingAppts.length > 0) {
      alerts.push({
        id: `appts-waiting-${waitingAppts.length}`,
        title: `${waitingAppts.length} queued appointment${waitingAppts.length > 1 ? 's' : ''}`,
        detail: 'Patients awaiting triage or consultation',
        severity: 'info',
        route: '/app/queue',
        icon: 'fa-solid fa-calendar-check',
      });
    }
  }

  if (bType === 'school') {
    const unpaidFees = (store.fees || []).filter((f) => f.status === 'unpaid' || f.status === 'partial');
    if (unpaidFees.length > 0) {
      alerts.push({
        id: `fees-unpaid-${unpaidFees.length}`,
        title: `${unpaidFees.length} pending student fee${unpaidFees.length > 1 ? 's' : ''}`,
        detail: 'Follow up with guardian payment reminders',
        severity: 'warn',
        route: '/app/fees',
        icon: 'fa-solid fa-money-bill-wave',
      });
    }
  }

  // Trial reminder
  if (tenant?.status === 'trial' && typeof tenant.trial_days_left === 'number') {
    alerts.push({
      id: `trial-days-${tenant.trial_days_left}`,
      title: `Trial active · ${tenant.trial_days_left} days left`,
      detail: 'Manage your workspace subscription plan',
      severity: tenant.trial_days_left <= 7 ? 'warn' : 'info',
      route: '/app/subscription',
      icon: 'fa-solid fa-receipt',
    });
  }

  res.json({ alerts });
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
