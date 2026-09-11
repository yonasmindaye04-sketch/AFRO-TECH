import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool, query, queryOne } from '../config/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const ethiopianNames = {
  male: ['Abebe', 'Abel', 'Abiy', 'Amanuel', 'Binyam', 'Dawit', 'Ephrem', 'Fikru', 'Gebre', 'Haile', 'Henok', 'Kaleb', 'Mahlet', 'Mekonnen', 'Mesfin', 'Mikias', 'Nahom', 'Natnael', 'Samuel', 'Tadesse', 'Tewodros', 'Yohannes', 'Yonas'],
  female: ['Abebech', 'Almaz', 'Aster', 'Bethel', 'Bruktawit', 'Desta', 'Eden', 'Eleni', 'Feyisa', 'Genet', 'Hana', 'Helen', 'Kalkidan', 'Lidia', 'Mahlet', 'Mariam', 'Mekdes', 'Meron', 'Rahel', 'Rebecca', 'Sara', 'Selam', 'Tsion'],
  last: ['Alemu', 'Bekele', 'Desta', 'Gebremedhin', 'Haile', 'Hailu', 'Kebede', 'Lemma', 'Mekonnen', 'Mengistu', 'Mesfin', 'Nigatu', 'Tadesse', 'Tafesse', 'Tekle', 'Tesfaye', 'Wolde', 'Worku', 'Yohannes', 'Zewde']
}

const bloodTypes = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const allergies = ['Penicillin', 'Sulfa drugs', 'Aspirin', 'Latex', 'Peanuts', 'Shellfish', 'Pollen', 'None', 'None', 'None']
const specialties = ['General Medicine', 'Cardiology', 'Pediatrics', 'Dermatology', 'Orthopedics', 'Gynecology', 'Neurology', 'Psychiatry', 'ENT', 'Ophthalmology']
const reasons = ['General checkup', 'Fever and cough', 'Follow-up visit', 'Headache', 'Stomach pain', 'Back pain', 'Skin rash', 'Vaccination', 'Prenatal care', 'Blood pressure check']
const diagnoses = ['Malaria', 'Upper respiratory infection', 'Hypertension', 'Diabetes mellitus', 'Gastritis', 'Anemia', 'Urinary tract infection', 'Dermatitis', 'Pneumonia', 'Typhoid']
const prescriptions = ['Artemether-Lumefantrine', 'Amoxicillin 500mg', 'Amlodipine 5mg', 'Metformin 500mg', 'Omeprazole 20mg', 'Ferrous sulfate', 'Ciprofloxacin 500mg', 'Hydrocortisone cream', 'Azithromycin 500mg', 'Ceftriaxone 1g']
const schoolSubjects = ['Mathematics', 'English', 'Physics', 'Chemistry', 'Biology', 'History', 'Geography', 'Civics', 'Amharic', 'Computer Science', 'Physical Education', 'Art']
const guardianNames = ['Ato Alemayehu', 'W/ro Almaz', 'Ato Bekele', 'W/ro Desta', 'Ato Gebre', 'W/ro Hana', 'Ato Kassa', 'W/ro Lidia', 'Ato Mesfin', 'W/ro Rahel']

// Pharmacy/Store products
const pharmacyProducts = [
  { name: 'Amoxicillin 500mg', category: 'Antibiotics', unit: 'capsule', sell_price: 45, cost_price: 25, low_stock_threshold: 50 },
  { name: 'Paracetamol 500mg', category: 'Pain Relief', unit: 'tablet', sell_price: 12, cost_price: 6, low_stock_threshold: 100 },
  { name: 'Ibuprofen 400mg', category: 'Pain Relief', unit: 'tablet', sell_price: 18, cost_price: 10, low_stock_threshold: 80 },
  { name: 'Omeprazole 20mg', category: 'Gastric', unit: 'capsule', sell_price: 35, cost_price: 20, low_stock_threshold: 60 },
  { name: 'Ciprofloxacin 500mg', category: 'Antibiotics', unit: 'tablet', sell_price: 55, cost_price: 30, low_stock_threshold: 40 },
  { name: 'Metronidazole 400mg', category: 'Antibiotics', unit: 'tablet', sell_price: 28, cost_price: 15, low_stock_threshold: 50 },
  { name: 'Salbutamol Inhaler', category: 'Respiratory', unit: 'piece', sell_price: 350, cost_price: 200, low_stock_threshold: 10 },
  { name: 'Cetirizine 10mg', category: 'Antihistamine', unit: 'tablet', sell_price: 22, cost_price: 12, low_stock_threshold: 50 },
  { name: 'Vitamin C 500mg', category: 'Supplements', unit: 'tablet', sell_price: 15, cost_price: 8, low_stock_threshold: 100 },
  { name: 'ORS Sachet', category: 'Hydration', unit: 'sachet', sell_price: 8, cost_price: 4, low_stock_threshold: 200 },
  { name: 'Diclofenac Gel', category: 'Topical', unit: 'tube', sell_price: 85, cost_price: 45, low_stock_threshold: 20 },
  { name: 'Multivitamin Syrup', category: 'Supplements', unit: 'bottle', sell_price: 120, cost_price: 70, low_stock_threshold: 15 },
  { name: 'Antacid Tablet', category: 'Gastric', unit: 'tablet', sell_price: 10, cost_price: 5, low_stock_threshold: 100 },
  { name: 'Azithromycin 500mg', category: 'Antibiotics', unit: 'tablet', sell_price: 180, cost_price: 100, low_stock_threshold: 20 },
  { name: 'Folic Acid 5mg', category: 'Supplements', unit: 'tablet', sell_price: 12, cost_price: 6, low_stock_threshold: 80 },
]

const storeProducts = [
  { name: 'Bottled Water 500ml', category: 'Beverages', unit: 'bottle', sell_price: 15, cost_price: 8, low_stock_threshold: 100 },
  { name: 'Coca Cola 300ml', category: 'Beverages', unit: 'bottle', sell_price: 25, cost_price: 15, low_stock_threshold: 80 },
  { name: 'Bread Loaf', category: 'Bakery', unit: 'loaf', sell_price: 35, cost_price: 20, low_stock_threshold: 30 },
  { name: 'Milk 1L', category: 'Dairy', unit: 'liter', sell_price: 55, cost_price: 35, low_stock_threshold: 40 },
  { name: 'Eggs (Tray 30)', category: 'Dairy', unit: 'tray', sell_price: 180, cost_price: 120, low_stock_threshold: 15 },
  { name: 'Rice 1kg', category: 'Grains', unit: 'kg', sell_price: 85, cost_price: 55, low_stock_threshold: 50 },
  { name: 'Sugar 1kg', category: 'Grains', unit: 'kg', sell_price: 75, cost_price: 50, low_stock_threshold: 50 },
  { name: 'Cooking Oil 1L', category: 'Cooking', unit: 'liter', sell_price: 180, cost_price: 120, low_stock_threshold: 30 },
  { name: 'Pasta 500g', category: 'Grains', unit: 'pack', sell_price: 45, cost_price: 25, low_stock_threshold: 60 },
  { name: 'Soap Bar', category: 'Household', unit: 'piece', sell_price: 30, cost_price: 18, low_stock_threshold: 80 },
  { name: 'Detergent 1kg', category: 'Household', unit: 'kg', sell_price: 120, cost_price: 80, low_stock_threshold: 40 },
  { name: 'Toothpaste', category: 'Personal Care', unit: 'tube', sell_price: 65, cost_price: 40, low_stock_threshold: 50 },
  { name: 'Shampoo 250ml', category: 'Personal Care', unit: 'bottle', sell_price: 150, cost_price: 90, low_stock_threshold: 30 },
  { name: 'Toilet Paper 4-pack', category: 'Household', unit: 'pack', sell_price: 85, cost_price: 55, low_stock_threshold: 40 },
  { name: 'Biscuits Pack', category: 'Snacks', unit: 'pack', sell_price: 25, cost_price: 15, low_stock_threshold: 100 },
]

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]
}

function randomDate(start: Date, end: Date): Date {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()))
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0]
}

function formatDateTime(d: Date): string {
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

async function createUser(tenantId: string, email: string, password: string, fullName: string, role: 'owner' | 'staff' = 'owner'): Promise<string> {
  const existing = await queryOne(`SELECT id FROM users WHERE email = $1`, [email])
  if (existing) {
    console.log(`  User ${email} already exists`)
    return existing.id
  }
  const hash = await bcrypt.hash(password, 12)
  const row = await queryOne(
    `INSERT INTO users (tenant_id, email, password_hash, full_name, role, is_active) VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
    [tenantId, email, hash, fullName, role]
  )
  console.log(`  Created user: ${fullName} (${email})`)
  return row!.id
}

async function ensureStaffUsers(tenantId: string): Promise<string[]> {
  const staffUsers = await query(`SELECT id FROM users WHERE tenant_id = $1`, [tenantId])
  return staffUsers.map(r => r.id)
}

async function seedPharmacy(tenantId: string, ownerId: string): Promise<void> {
  console.log(`\n=== Seeding Pharmacy: ${tenantId} ===`)

  // Create products
  console.log('  Creating products...')
  for (let i = 0; i < pharmacyProducts.length; i++) {
    const p = pharmacyProducts[i]
    await queryOne(
      `INSERT INTO products (tenant_id, name, category, unit, sell_price, cost_price, low_stock_threshold) 
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [tenantId, p.name, p.category, p.unit, p.sell_price, p.cost_price, p.low_stock_threshold]
    )
  }
  console.log(`  Created ${pharmacyProducts.length} products`)

  // Create product batches (stock)
  const products = await query(`SELECT id, sell_price, cost_price FROM products WHERE tenant_id = $1`, [tenantId])
  for (const prod of products) {
    const batchCount = Math.floor(Math.random() * 3) + 1
    for (let b = 0; b < batchCount; b++) {
      const qty = Math.floor(Math.random() * 200) + 50
      const expiry = new Date(Date.now() + (Math.random() * 365 + 30) * 86400000)
      await queryOne(
        `INSERT INTO product_batches (tenant_id, product_id, batch_no, expiry_date, quantity, cost_price) 
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, prod.id, `BATCH-${Date.now()}-${b}`, expiry, qty, prod.cost_price]
      )
    }
  }
  console.log('  Created product batches (stock)')

  // Create suppliers
  const supplierNames = ['Pharma Import PLC', 'Addis Medical Supplies', 'Ethio Drug Enterprise', 'Unity Pharma', 'Meda Distributors']
  for (const name of supplierNames) {
    await queryOne(
      `INSERT INTO suppliers (tenant_id, name, phone, email, address) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [tenantId, name, `+2519${Math.floor(10000000 + Math.random() * 90000000)}`, `${name.toLowerCase().replace(/\s+/g, '')}@example.com`, 'Addis Ababa']
    )
  }
  console.log('  Created suppliers')

  // Create customers
  for (let i = 0; i < 20; i++) {
    const gender = i % 2 === 0 ? 'male' : 'female'
    const firstName = randomItem(ethiopianNames[gender])
    const lastName = randomItem(ethiopianNames.last)
    await queryOne(
      `INSERT INTO customers (tenant_id, name, phone, email) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [tenantId, `${firstName} ${lastName}`, `+2519${Math.floor(10000000 + Math.random() * 90000000)}`, `customer${i+1}@example.com`]
    )
  }
  console.log('  Created 20 customers')

  // Create sales
  const now = new Date()
  const customers = await query(`SELECT id FROM customers WHERE tenant_id = $1`, [tenantId])
  const batches = await query(`SELECT id, product_id, quantity, cost_price FROM product_batches WHERE tenant_id = $1 AND quantity > 0`, [tenantId])
  const staffIds = await ensureStaffUsers(tenantId)
  
  for (let i = 0; i < 50; i++) {
    const saleDate = randomDate(new Date(now.getTime() - 30 * 86400000), now)
    const customer = customers.length > 0 ? randomItem(customers) : null
    const itemCount = Math.floor(Math.random() * 4) + 1
    let subtotal = 0
    const items: { batch_id: string; product_id: string; quantity: number; unit_price: number; cost_price: number }[] = []
    
    for (let j = 0; j < itemCount && batches.length > 0; j++) {
      const batch = randomItem(batches)
      const qty = Math.min(Math.floor(Math.random() * 10) + 1, batch.quantity)
      const product = await queryOne(`SELECT sell_price FROM products WHERE id = $1`, [batch.product_id])
      if (!product) continue
      const unitPrice = Number(product.sell_price)
      items.push({ batch_id: batch.id, product_id: batch.product_id, quantity: qty, unit_price: unitPrice, cost_price: Number(batch.cost_price) })
      subtotal += qty * unitPrice
    }
    if (items.length === 0) continue
    
    const discount = Math.random() < 0.1 ? Math.floor(subtotal * 0.05) : 0
    const total = subtotal - discount
    const paymentMethods = ['cash', 'card', 'telebirr', 'cbe_birr']
    const paymentMethod = randomItem(paymentMethods)
    const amountPaid = paymentMethod === 'cash' ? total + Math.floor(Math.random() * 50) : total
    const changeDue = Math.max(0, amountPaid - total)
    
    const sale = await queryOne(
      `INSERT INTO sales (tenant_id, user_id, customer_id, subtotal, discount, total, payment_method, amount_paid, change_due, status, created_at) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',$10) RETURNING id`,
      [tenantId, randomItem(staffIds), customer?.id ?? null, subtotal, discount, total, paymentMethod, amountPaid, changeDue, saleDate.toISOString()]
    )
    
    for (const item of items) {
      // Check available quantity first
      const batch = await queryOne(`SELECT quantity FROM product_batches WHERE id = $1`, [item.batch_id])
      const available = batch ? Number(batch.quantity) : 0
      const sellQty = Math.min(item.quantity, available)
      if (sellQty <= 0) continue
      
      await queryOne(
        `INSERT INTO sale_items (tenant_id, sale_id, product_id, batch_id, name, quantity, unit_price, cost_price, line_total) 
         VALUES ($1,$2,$3,$4,(SELECT name FROM products WHERE id = $3),$5,$6,$7,$8)`,
        [tenantId, sale!.id, item.product_id, item.batch_id, sellQty, item.unit_price, item.cost_price, sellQty * item.unit_price]
      )
      await queryOne(`UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`, [sellQty, item.batch_id])
    }
  }
  console.log('  Created 50 sales with items')

  // Create purchases (restocking)
  const suppliers = await query(`SELECT id FROM suppliers WHERE tenant_id = $1`, [tenantId])
  for (let i = 0; i < 15; i++) {
    const purchaseDate = randomDate(new Date(now.getTime() - 30 * 86400000), now)
    const supplier = randomItem(suppliers)
    const itemCount = Math.floor(Math.random() * 5) + 2
    let total = 0
    
    const purchase = await queryOne(
      `INSERT INTO purchases (tenant_id, supplier_id, total, paid_amount, notes, user_id, created_at) 
       VALUES ($1,$2,0,0,$3,$4,$5) RETURNING id`,
      [tenantId, supplier.id, 'Restock order', randomItem(staffIds), purchaseDate.toISOString()]
    )
    
    for (let j = 0; j < itemCount; j++) {
      const product = randomItem(products)
      const qty = Math.floor(Math.random() * 100) + 20
      const unitCost = Number(product.cost_price)
      const lineTotal = qty * unitCost
      total += lineTotal
      
      await queryOne(
        `INSERT INTO purchase_items (tenant_id, purchase_id, product_id, batch_no, expiry_date, quantity, unit_cost, line_total) 
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, purchase!.id, product.id, `PUR-${Date.now()}-${j}`, new Date(Date.now() + (Math.random() * 365 + 30) * 86400000), qty, unitCost, lineTotal]
      )
      
      // Add to batches
      await queryOne(
        `INSERT INTO product_batches (tenant_id, product_id, batch_no, expiry_date, quantity, cost_price) 
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenantId, product.id, `PUR-${Date.now()}-${j}`, new Date(Date.now() + (Math.random() * 365 + 30) * 86400000), qty, unitCost]
      )
    }
    
    await queryOne(`UPDATE purchases SET total = $1, paid_amount = $1 WHERE id = $2`, [total, purchase!.id])
  }
  console.log('  Created 15 purchases')

  // Create expenses
  const expenseCategories = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Marketing', 'Maintenance', 'Internet', 'Insurance']
  for (let i = 0; i < 25; i++) {
    const expenseDate = randomDate(new Date(now.getTime() - 30 * 86400000), now)
    const category = randomItem(expenseCategories)
    const amount = Math.floor(Math.random() * 5000) + 500
    await queryOne(
      `INSERT INTO expenses (tenant_id, category, description, amount, spent_at, user_id) 
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, category, `${category} expense`, amount, formatDate(expenseDate), randomItem(staffIds)]
    )
  }
  console.log('  Created 25 expenses')

  console.log('✅ Pharmacy seeding complete!')
}

async function seedStore(tenantId: string, ownerId: string): Promise<void> {
  console.log(`\n=== Seeding Store: ${tenantId} ===`)

  // Create products
  console.log('  Creating products...')
  for (const p of storeProducts) {
    await queryOne(
      `INSERT INTO products (tenant_id, name, category, unit, sell_price, cost_price, low_stock_threshold) 
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
      [tenantId, p.name, p.category, p.unit, p.sell_price, p.cost_price, p.low_stock_threshold]
    )
  }
  console.log(`  Created ${storeProducts.length} products`)

  // Create product batches (stock)
  const products = await query(`SELECT id, sell_price, cost_price FROM products WHERE tenant_id = $1`, [tenantId])
  for (const prod of products) {
    const batchCount = Math.floor(Math.random() * 2) + 1
    for (let b = 0; b < batchCount; b++) {
      const qty = Math.floor(Math.random() * 300) + 100
      await queryOne(
        `INSERT INTO product_batches (tenant_id, product_id, batch_no, quantity, cost_price) 
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, prod.id, `BATCH-${Date.now()}-${b}`, qty, prod.cost_price]
      )
    }
  }
  console.log('  Created product batches (stock)')

  // Create suppliers
  const supplierNames = ['Addis Wholesale', 'Merkato Distributors', 'Bole Cash & Carry', 'Family Supplies PLC', 'Ethio Trading']
  for (const name of supplierNames) {
    await queryOne(
      `INSERT INTO suppliers (tenant_id, name, phone, email, address) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [tenantId, name, `+2519${Math.floor(10000000 + Math.random() * 90000000)}`, `${name.toLowerCase().replace(/\s+/g, '')}@example.com`, 'Addis Ababa']
    )
  }
  console.log('  Created suppliers')

  // Create customers
  for (let i = 0; i < 30; i++) {
    const gender = i % 2 === 0 ? 'male' : 'female'
    const firstName = randomItem(ethiopianNames[gender])
    const lastName = randomItem(ethiopianNames.last)
    await queryOne(
      `INSERT INTO customers (tenant_id, name, phone, email) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
      [tenantId, `${firstName} ${lastName}`, `+2519${Math.floor(10000000 + Math.random() * 90000000)}`, `customer${i+1}@example.com`]
    )
  }
  console.log('  Created 30 customers')

  // Create sales
  const now = new Date()
  const customers = await query(`SELECT id FROM customers WHERE tenant_id = $1`, [tenantId])
  const batches = await query(`SELECT id, product_id, quantity, cost_price FROM product_batches WHERE tenant_id = $1 AND quantity > 0`, [tenantId])
  const staffIds = await ensureStaffUsers(tenantId)
  
  for (let i = 0; i < 80; i++) {
    const saleDate = randomDate(new Date(now.getTime() - 30 * 86400000), now)
    const customer = customers.length > 0 ? randomItem(customers) : null
    const itemCount = Math.floor(Math.random() * 6) + 1
    let subtotal = 0
    const items: { batch_id: string; product_id: string; quantity: number; unit_price: number; cost_price: number }[] = []
    
    for (let j = 0; j < itemCount && batches.length > 0; j++) {
      const batch = randomItem(batches)
      const qty = Math.min(Math.floor(Math.random() * 20) + 1, batch.quantity)
      const product = await queryOne(`SELECT sell_price FROM products WHERE id = $1`, [batch.product_id])
      if (!product) continue
      const unitPrice = Number(product.sell_price)
      items.push({ batch_id: batch.id, product_id: batch.product_id, quantity: qty, unit_price: unitPrice, cost_price: Number(batch.cost_price) })
      subtotal += qty * unitPrice
    }
    if (items.length === 0) continue
    
    const discount = Math.random() < 0.15 ? Math.floor(subtotal * 0.05) : 0
    const total = subtotal - discount
    const paymentMethods = ['cash', 'card', 'telebirr', 'cbe_birr']
    const paymentMethod = randomItem(paymentMethods)
    const amountPaid = paymentMethod === 'cash' ? total + Math.floor(Math.random() * 100) : total
    const changeDue = Math.max(0, amountPaid - total)
    
    const sale = await queryOne(
      `INSERT INTO sales (tenant_id, user_id, customer_id, subtotal, discount, total, payment_method, amount_paid, change_due, status, created_at) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'completed',$10) RETURNING id`,
      [tenantId, randomItem(staffIds), customer?.id ?? null, subtotal, discount, total, paymentMethod, amountPaid, changeDue, saleDate.toISOString()]
    )
    
    for (const item of items) {
      // Check available quantity first
      const batch = await queryOne(`SELECT quantity FROM product_batches WHERE id = $1`, [item.batch_id])
      const available = batch ? Number(batch.quantity) : 0
      const sellQty = Math.min(item.quantity, available)
      if (sellQty <= 0) continue
      
      await queryOne(
        `INSERT INTO sale_items (tenant_id, sale_id, product_id, batch_id, name, quantity, unit_price, cost_price, line_total) 
         VALUES ($1,$2,$3,$4,(SELECT name FROM products WHERE id = $3),$5,$6,$7,$8)`,
        [tenantId, sale!.id, item.product_id, item.batch_id, sellQty, item.unit_price, item.cost_price, sellQty * item.unit_price]
      )
      await queryOne(`UPDATE product_batches SET quantity = quantity - $1 WHERE id = $2`, [sellQty, item.batch_id])
    }
  }
  console.log('  Created 80 sales with items')

  // Create purchases
  const suppliers = await query(`SELECT id FROM suppliers WHERE tenant_id = $1`, [tenantId])
  for (let i = 0; i < 20; i++) {
    const purchaseDate = randomDate(new Date(now.getTime() - 30 * 86400000), now)
    const supplier = randomItem(suppliers)
    const itemCount = Math.floor(Math.random() * 8) + 3
    let total = 0
    
    const purchase = await queryOne(
      `INSERT INTO purchases (tenant_id, supplier_id, total, paid_amount, notes, user_id, created_at) 
       VALUES ($1,$2,0,0,$3,$4,$5) RETURNING id`,
      [tenantId, supplier.id, 'Restock order', randomItem(staffIds), purchaseDate.toISOString()]
    )
    
    for (let j = 0; j < itemCount; j++) {
      const product = randomItem(products)
      const qty = Math.floor(Math.random() * 200) + 50
      const unitCost = Number(product.cost_price)
      const lineTotal = qty * unitCost
      total += lineTotal
      
      await queryOne(
        `INSERT INTO purchase_items (tenant_id, purchase_id, product_id, batch_no, quantity, unit_cost, line_total) 
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tenantId, purchase!.id, product.id, `PUR-${Date.now()}-${j}`, qty, unitCost, lineTotal]
      )
      
      await queryOne(
        `INSERT INTO product_batches (tenant_id, product_id, batch_no, quantity, cost_price) 
         VALUES ($1,$2,$3,$4,$5)`,
        [tenantId, product.id, `PUR-${Date.now()}-${j}`, qty, unitCost]
      )
    }
    
    await queryOne(`UPDATE purchases SET total = $1, paid_amount = $1 WHERE id = $2`, [total, purchase!.id])
  }
  console.log('  Created 20 purchases')

  // Create expenses
  const expenseCategories = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Marketing', 'Maintenance', 'Internet', 'Insurance', 'Licenses']
  for (let i = 0; i < 30; i++) {
    const expenseDate = randomDate(new Date(now.getTime() - 30 * 86400000), now)
    const category = randomItem(expenseCategories)
    const amount = Math.floor(Math.random() * 10000) + 1000
    await queryOne(
      `INSERT INTO expenses (tenant_id, category, description, amount, spent_at, user_id) 
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tenantId, category, `${category} expense`, amount, formatDate(expenseDate), randomItem(staffIds)]
    )
  }
  console.log('  Created 30 expenses')

  console.log('✅ Store seeding complete!')
}

async function seedHospital(tenantId: string, ownerId: string): Promise<void> {
  console.log(`\n=== Seeding Hospital: ${tenantId} ===`)

  // Create departments
  const deptTypes = ['reception', 'consultation', 'laboratory', 'injection', 'procedure', 'billing'] as const
  const departments: { id: string; name: string; type: string }[] = []
  for (const type of deptTypes) {
    const name = type.charAt(0).toUpperCase() + type.slice(1)
    const row = await queryOne(
      `INSERT INTO departments (tenant_id, name, type) VALUES ($1,$2,$3) ON CONFLICT (tenant_id, name) DO UPDATE SET type = EXCLUDED.type RETURNING id, name, type`,
      [tenantId, name, type]
    )
    departments.push(row!)
  }
  console.log(`  Created ${departments.length} departments`)

  // Assign owner to all departments
  for (const dept of departments) {
    await queryOne(`INSERT INTO department_staff (department_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [dept.id, ownerId])
  }

  // Create doctors
  const doctors: { id: string; full_name: string; specialty: string }[] = []
  for (let i = 0; i < 6; i++) {
    const gender = i % 2 === 0 ? 'male' : 'female'
    const firstName = randomItem(ethiopianNames[gender])
    const lastName = randomItem(ethiopianNames.last)
    const row = await queryOne(
      `INSERT INTO doctors (tenant_id, full_name, specialty, phone, fee) VALUES ($1,$2,$3,$4,$5) RETURNING id, full_name, specialty`,
      [tenantId, `Dr. ${firstName} ${lastName}`, randomItem(specialties), `+2519${Math.floor(10000000 + Math.random() * 90000000)}`, Math.floor(200 + Math.random() * 800)]
    )
    doctors.push(row!)
  }
  console.log(`  Created ${doctors.length} doctors`)

  // Create patients
  const patients: { id: string; code: string; first_name: string; last_name: string; gender: string }[] = []
  for (let i = 0; i < 50; i++) {
    const gender = i % 2 === 0 ? 'male' : 'female'
    const firstName = randomItem(ethiopianNames[gender])
    const lastName = randomItem(ethiopianNames.last)
    const dob = randomDate(new Date(1940, 0, 1), new Date(2015, 11, 31))
    const nextCodeNum = i + 1
    const code = `PAT${String(nextCodeNum).padStart(4, '0')}`
    const row = await queryOne(
      `INSERT INTO patients (tenant_id, code, first_name, last_name, gender, dob, phone, address, blood_type, allergies) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, code, first_name, last_name, gender`,
      [tenantId, code, firstName, lastName, gender, formatDate(dob), `+2519${Math.floor(10000000 + Math.random() * 90000000)}`, 'Addis Ababa', randomItem(bloodTypes), randomItem(allergies)]
    )
    patients.push(row!)
  }
  console.log(`  Created ${patients.length} patients`)

  // Create appointments
  const now = new Date()
  const appointments: { id: string; patient_id: string; scheduled_at: Date; status: string }[] = []
  
  for (let i = 0; i < 20; i++) {
    const patient = randomItem(patients)
    const doctor = randomItem(doctors)
    const scheduled = randomDate(new Date(now.getTime() - 30 * 86400000), new Date(now.getTime() - 86400000))
    const row = await queryOne(
      `INSERT INTO appointments (tenant_id, patient_id, doctor_id, scheduled_at, reason, status, notes) VALUES ($1,$2,$3,$4,$5,'completed',$6) RETURNING id, patient_id, scheduled_at, status`,
      [tenantId, patient.id, doctor.id, scheduled.toISOString(), randomItem(reasons), `Patient responded well to treatment. Prescribed ${randomItem(prescriptions)}.`]
    )
    appointments.push(row!)
  }

  for (let i = 0; i < 12; i++) {
    const patient = randomItem(patients)
    const doctor = randomItem(doctors)
    const hour = 8 + Math.floor(Math.random() * 8)
    const minute = Math.random() < 0.5 ? 0 : 30
    const scheduled = new Date(now)
    scheduled.setHours(hour, minute, 0, 0)
    const status = i < 3 ? 'completed' : i < 6 ? 'in_service' : 'scheduled'
    const row = await queryOne(
      `INSERT INTO appointments (tenant_id, patient_id, doctor_id, scheduled_at, reason, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, patient_id, scheduled_at, status`,
      [tenantId, patient.id, doctor.id, scheduled.toISOString(), randomItem(reasons), status]
    )
    appointments.push(row!)
  }

  for (let i = 0; i < 15; i++) {
    const patient = randomItem(patients)
    const doctor = randomItem(doctors)
    const scheduled = randomDate(new Date(now.getTime() + 86400000), new Date(now.getTime() + 14 * 86400000))
    const row = await queryOne(
      `INSERT INTO appointments (tenant_id, patient_id, doctor_id, scheduled_at, reason, status) VALUES ($1,$2,$3,$4,$5,'scheduled') RETURNING id, patient_id, scheduled_at, status`,
      [tenantId, patient.id, doctor.id, scheduled.toISOString(), randomItem(reasons)]
    )
    appointments.push(row!)
  }
  console.log(`  Created ${appointments.length} appointments`)

  // Medical records
  const completedAppts = appointments.filter(a => a.status === 'completed')
  for (const appt of completedAppts) {
    const doctor = randomItem(doctors)
    const visitDate = new Date(appt.scheduled_at)
    await queryOne(
      `INSERT INTO medical_records (tenant_id, patient_id, doctor_name, visit_date, diagnosis, prescription, notes, vitals) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, appt.patient_id, doctor.full_name, formatDate(visitDate), randomItem(diagnoses), randomItem(prescriptions), 'Follow-up in 2 weeks.', JSON.stringify({ bp: '120/80', temperature: '36.8', pulse: '78', weight: '70', height: '170', spo2: '98' })]
    )
  }
  console.log(`  Created ${completedAppts.length} medical records`)

  // Invoices
  for (let i = 0; i < 30; i++) {
    const patient = randomItem(patients)
    const amount = Math.floor(500 + Math.random() * 5000)
    const paid = Math.random() < 0.7 ? amount : Math.floor(Math.random() * amount)
    const status = paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
    const issued = randomDate(new Date(now.getTime() - 60 * 86400000), now)
    const nextInvNum = i + 1
    const number = `INV${String(nextInvNum).padStart(4, '0')}`
    await queryOne(
      `INSERT INTO invoices (tenant_id, patient_id, number, description, amount, paid_amount, status, issued_on) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, patient.id, number, 'Consultation and medication', amount, paid, status, formatDate(issued)]
    )
  }
  console.log('  Created 30 invoices')

  // Lab tests
  const staffIds = await ensureStaffUsers(tenantId)
  for (let i = 0; i < 25; i++) {
    const patient = randomItem(patients)
    const catalog = [
      { name: 'CBC (Complete Blood Count)', normal_range: 'Hb 12-16 g/dL, WBC 4-11 ×10⁹/L', price: 350 },
      { name: 'Malaria RDT', normal_range: 'Negative', price: 150 },
      { name: 'Blood Glucose (Fasting)', normal_range: '70-100 mg/dL', price: 120 },
      { name: 'Urinalysis', normal_range: 'No protein, glucose or blood', price: 200 },
      { name: 'HIV Screening', normal_range: 'Non-reactive', price: 250 },
      { name: 'Pregnancy Test (hCG)', normal_range: 'Negative', price: 150 },
      { name: 'Liver Function Test', normal_range: 'ALT 7-56 U/L, AST 10-40 U/L', price: 800 },
      { name: 'Kidney Function Test', normal_range: 'Creatinine 0.6-1.2 mg/dL', price: 800 },
    ]
    const test = randomItem(catalog)
    const status = randomItem(['ordered', 'sample_collected', 'resulted', 'cancelled'])
    const created = randomDate(new Date(now.getTime() - 30 * 86400000), now)
    await queryOne(
      `INSERT INTO lab_tests (tenant_id, patient_id, test_name, normal_range, price, notes, ordered_by, status, created_at, resulted_at) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tenantId, patient.id, test.name, test.normal_range, test.price, 'Routine check', randomItem(staffIds), status, created.toISOString(), status === 'resulted' ? new Date(created.getTime() + 2 * 3600000).toISOString() : null]
    )
  }
  console.log('  Created 25 lab tests')

  // Visits
  const usedAppointmentIds = new Set<string>()
  for (let i = 0; i < 20; i++) {
    const patient = randomItem(patients)
    const appt = appointments.find(a => a.patient_id === patient.id && a.status !== 'cancelled' && !usedAppointmentIds.has(a.id))
    const dept = departments.find(d => d.type === 'consultation')
    const visitType = appt ? 'scheduled' : 'walk_in'
    if (appt) usedAppointmentIds.add(appt.id)
    const status = randomItem(['waiting', 'in_service', 'completed'])
    const opened = randomDate(new Date(now.getTime() - 7 * 86400000), now)
    const visit = await queryOne(
      `INSERT INTO visits (tenant_id, patient_id, appointment_id, visit_type, current_department_id, status, priority, chief_complaint, opened_by, opened_at) 
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tenantId, patient.id, appt?.id ?? null, visitType, dept?.id ?? null, status, randomItem(['normal', 'urgent']), randomItem(reasons), ownerId, opened.toISOString()]
    )
    
    await queryOne(`INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by, note) VALUES ($1,$2,$3,'checked_in',$4,$5)`, [visit!.id, tenantId, dept?.id ?? null, ownerId, visitType === 'walk_in' ? 'Walk-in' : 'Scheduled check-in'])
    
    if (status === 'in_service' || status === 'completed') {
      await queryOne(`INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by) VALUES ($1,$2,$3,'in_service',$4)`, [visit!.id, tenantId, dept?.id ?? null, ownerId])
    }
    if (status === 'completed') {
      await queryOne(`INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by) VALUES ($1,$2,$3,'completed',$4)`, [visit!.id, tenantId, dept?.id ?? null, ownerId])
    }
  }
  console.log('  Created 20 visits with status history')

  // Service orders
  const labDept = departments.find(d => d.type === 'laboratory')
  if (labDept) {
    const visitsResult = await query(`SELECT id, patient_id FROM visits WHERE tenant_id = $1 AND status IN ('waiting','in_service','completed') LIMIT 15`, [tenantId])
    for (const v of visitsResult) {
      const test = randomItem([{ name: 'CBC (Complete Blood Count)', fee: 350 }, { name: 'Malaria RDT', fee: 150 }, { name: 'Blood Glucose (Fasting)', fee: 120 }, { name: 'Urinalysis', fee: 200 }])
      const status = randomItem(['pending', 'in_progress', 'completed'])
      const order = await queryOne(`INSERT INTO service_orders (tenant_id, visit_id, patient_id, order_type, target_department_id, ordered_by, priority, details, fee, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`, [tenantId, v.id, v.patient_id, 'lab_test', labDept.id, ownerId, 'normal', JSON.stringify({ test_name: test.name }), test.fee, status])
      if (status === 'completed') {
        await queryOne(`UPDATE service_orders SET completed_by = $1, completed_at = now(), result = $2 WHERE id = $3`, [ownerId, JSON.stringify({ result: 'Normal' }), order!.id])
      }
    }
    console.log('  Created service orders')
  }

  console.log('✅ Hospital seeding complete!')
}

async function seedSchool(tenantId: string, ownerId: string): Promise<void> {
  console.log(`\n=== Seeding School: ${tenantId} ===`)

  // Create teachers
  const teachers: { id: string; full_name: string; subject: string }[] = []
  for (let i = 0; i < 10; i++) {
    const gender = i % 2 === 0 ? 'male' : 'female'
    const firstName = randomItem(ethiopianNames[gender])
    const lastName = randomItem(ethiopianNames.last)
    const row = await queryOne(
      `INSERT INTO teachers (tenant_id, full_name, subject, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING id, full_name, subject`,
      [tenantId, `${gender === 'male' ? 'Ato' : 'W/ro'} ${firstName} ${lastName}`, randomItem(schoolSubjects), `+2519${Math.floor(10000000 + Math.random() * 90000000)}`, `teacher${i+1}@school.edu.et`]
    )
    teachers.push(row!)
  }
  console.log(`  Created ${teachers.length} teachers`)

  // Create classes
  const classNames = ['Grade 1A', 'Grade 1B', 'Grade 2A', 'Grade 2B', 'Grade 3A', 'Grade 3B', 'Grade 4A', 'Grade 4B', 'Grade 5A', 'Grade 5B']
  const classes: { id: string; name: string; homeroom_teacher_id: string | null }[] = []
  for (let i = 0; i < classNames.length; i++) {
    const row = await queryOne(
      `INSERT INTO classes (tenant_id, name, academic_year, homeroom_teacher_id) VALUES ($1,$2,'2025/2026',$3) RETURNING id, name, homeroom_teacher_id`,
      [tenantId, classNames[i], teachers[i % teachers.length]?.id ?? null]
    )
    classes.push(row!)
  }
  console.log(`  Created ${classes.length} classes`)

  // Create students
  const students: { id: string; code: string; first_name: string; last_name: string; class_id: string | null }[] = []
  for (let i = 0; i < 120; i++) {
    const gender = i % 2 === 0 ? 'male' : 'female'
    const firstName = randomItem(ethiopianNames[gender])
    const lastName = randomItem(ethiopianNames.last)
    const classId = classes[i % classes.length].id
    const guardian = randomItem(guardianNames)
    const nextCodeNum = i + 1
    const code = `STU${String(nextCodeNum).padStart(4, '0')}`
    const row = await queryOne(
      `INSERT INTO students (tenant_id, code, first_name, last_name, gender, dob, class_id, guardian_name, guardian_phone, guardian_email, guardian_telegram_chat_id, address) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id, code, first_name, last_name, class_id`,
      [tenantId, code, firstName, lastName, gender, formatDate(randomDate(new Date(2008, 0, 1), new Date(2018, 11, 31))), classId, guardian, `+2519${Math.floor(10000000 + Math.random() * 90000000)}`, `guardian${i+1}@example.com`, `${100000000 + i}`, 'Addis Ababa']
    )
    students.push(row!)
  }
  console.log(`  Created ${students.length} students`)

  // Subjects
  for (const subject of schoolSubjects) {
    await queryOne(`INSERT INTO subjects (tenant_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [tenantId, subject])
  }
  console.log('  Created subjects')

  // Attendance
  const now = new Date()
  for (let day = 0; day < 30; day++) {
    const attDate = new Date(now.getTime() - day * 86400000)
    if (attDate.getDay() === 0 || attDate.getDay() === 6) continue
    for (const cls of classes) {
      const classStudents = students.filter(s => s.class_id === cls.id)
      for (const student of classStudents) {
        const rand = Math.random()
        let status: 'present' | 'absent' | 'late' | 'excused'
        if (rand < 0.9) status = 'present'
        else if (rand < 0.95) status = 'absent'
        else if (rand < 0.98) status = 'late'
        else status = 'excused'
        await queryOne(`INSERT INTO attendance (tenant_id, student_id, class_id, att_date, status, recorded_by) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (student_id, att_date) DO UPDATE SET status = EXCLUDED.status`, [tenantId, student.id, cls.id, formatDate(attDate), status, ownerId])
      }
    }
  }
  console.log('  Created attendance for 30 days')

  // Grades
  const terms = ['Semester 1', 'Semester 2']
  const examTypes = ['test', 'assignment', 'mid', 'final']
  for (const student of students) {
    const cls = classes.find(c => c.id === student.class_id)
    if (!cls) continue
    for (const subject of schoolSubjects.slice(0, 6)) {
      for (const term of terms) {
        for (const examType of examTypes) {
          const maxScore = examType === 'final' ? 100 : examType === 'mid' ? 80 : 50
          const score = Math.floor(maxScore * (0.4 + Math.random() * 0.5))
          await queryOne(`INSERT INTO grades (tenant_id, student_id, class_id, subject, exam_type, term, score, max_score, recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (student_id, subject, exam_type, term) DO UPDATE SET score = EXCLUDED.score`, [tenantId, student.id, cls.id, subject, examType, term, score, maxScore, ownerId])
        }
      }
    }
  }
  console.log('  Created grades for all students')

  // Fees
  const feeTitles = ['Tuition Fee - Semester 1', 'Tuition Fee - Semester 2', 'Uniform', 'Textbooks', 'Transport', 'Exam Fee', 'Activity Fee']
  for (const student of students) {
    for (const title of feeTitles.slice(0, 4)) {
      const amount = title.includes('Tuition') ? 15000 : title === 'Uniform' ? 3000 : title === 'Textbooks' ? 2500 : 1500
      const dueDate = new Date(now.getTime() + Math.floor(Math.random() * 60) * 86400000)
      const paid = Math.random() < 0.6 ? amount : Math.floor(Math.random() * amount * 0.5)
      const status = paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
      const paidAt = status === 'paid' ? now.toISOString() : status === 'partial' ? now.toISOString() : null
      await queryOne(`INSERT INTO fees (tenant_id, student_id, title, amount, due_date, paid_amount, status, paid_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [tenantId, student.id, title, amount, formatDate(dueDate), paid, status, paidAt])
    }
  }
  console.log('  Created fee records')

  // Timetable
  const timeSlots = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00']
  for (const cls of classes) {
    const classTeachers = teachers.slice(0, 6)
    for (let day = 1; day <= 5; day++) {
      for (let slot = 0; slot < 5; slot++) {
        const subject = schoolSubjects[slot % schoolSubjects.length]
        const teacher = classTeachers[slot % classTeachers.length]
        await queryOne(`INSERT INTO timetable_slots (tenant_id, class_id, day_of_week, start_time, end_time, subject, teacher_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`, [tenantId, cls.id, day, timeSlots[slot], timeSlots[slot + 1], subject, teacher.id])
      }
    }
  }
  console.log('  Created timetable slots')

  // Announcements
  const announcements = [
    { title: 'Welcome Back to School!', body: 'Dear parents and students, welcome to the new academic year 2025/2026. We are excited to have you back.', pinned: true, target_type: 'all' as const },
    { title: 'Parent-Teacher Conference', body: 'Parent-teacher conferences will be held on October 15-16. Please schedule your appointment with the homeroom teacher.', pinned: false, target_type: 'all' as const },
    { title: 'School Trip to National Museum', body: 'Grade 4 and 5 students will visit the National Museum on November 5. Permission slips due by October 30.', pinned: false, target_type: 'class' as const, class_id: classes.find(c => c.name.includes('Grade 4'))?.id },
    { title: 'Mid-term Exams Schedule', body: 'Mid-term exams begin on November 18. Please check the detailed schedule on the notice board.', pinned: true, target_type: 'all' as const },
  ]
  for (const a of announcements) {
    await queryOne(`INSERT INTO announcements (tenant_id, title, body, pinned, target_type, class_id, created_by, sent_email, sent_telegram) VALUES ($1,$2,$3,$4,$5,$6,$7,false,false)`, [tenantId, a.title, a.body, a.pinned, a.target_type, a.class_id ?? null, ownerId])
  }
  console.log('  Created announcements')

  console.log('✅ School seeding complete!')
}

async function main(): Promise<void> {
  console.log('🌱 Starting comprehensive demo data seeding for ALL tenants...\n')

  // Get all existing tenants
  const tenants = await query(`SELECT id, name, slug, business_type FROM tenants ORDER BY business_type, name`)
  console.log(`Found ${tenants.length} tenants to seed:`)
  for (const t of tenants) {
    console.log(`  - ${t.name} (${t.business_type})`)
  }

  for (const tenant of tenants) {
    // Ensure owner user exists
    const ownerEmail = `${tenant.slug.replace(/[^a-z0-9]/gi, '')}@demo.com`.toLowerCase()
    const ownerId = await createUser(tenant.id, ownerEmail, 'demo123', `${tenant.name} Owner`, 'owner')
    
    // Add staff users
    await createUser(tenant.id, `${tenant.slug.replace(/[^a-z0-9]/gi, '')}.staff@demo.com`.toLowerCase(), 'demo123', 'Staff Member', 'staff')
    await createUser(tenant.id, `${tenant.slug.replace(/[^a-z0-9]/gi, '')}.cashier@demo.com`.toLowerCase(), 'demo123', 'Cashier', 'staff')

    // Seed based on business type
    switch (tenant.business_type) {
      case 'pharmacy':
        await seedPharmacy(tenant.id, ownerId)
        break
      case 'store':
        await seedStore(tenant.id, ownerId)
        break
      case 'hospital':
        await seedHospital(tenant.id, ownerId)
        break
      case 'school':
        await seedSchool(tenant.id, ownerId)
        break
      default:
        console.log(`  ⚠️ Unknown business type: ${tenant.business_type}`)
    }
  }

  console.log('\n🎉 All demo data seeded successfully for ALL tenants!')
  console.log('\n📋 Demo Login Credentials (password: demo123):')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  for (const tenant of tenants) {
    const email = `${tenant.slug.replace(/[^a-z0-9]/gi, '')}@demo.com`.toLowerCase()
    console.log(`${tenant.business_type.toUpperCase()}: ${email}`)
  }
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  await pool.end()
}

main().catch((err) => {
  console.error('❌ Seeding failed:', err)
  process.exit(1)
})