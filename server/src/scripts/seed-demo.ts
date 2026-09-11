import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import path from 'path'
import { fileURLToPath } from 'url'
import { pool, query, queryOne } from '../config/db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
dotenv.config({ path: path.resolve(__dirname, '../../.env') })

const DEMO_TENANT_SLUG = 'demo-hospital'
const DEMO_SCHOOL_SLUG = 'demo-school'

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

async function createTenant(name: string, slug: string, businessType: 'hospital' | 'school'): Promise<string> {
  const existing = await queryOne(`SELECT id FROM tenants WHERE slug = $1`, [slug])
  if (existing) {
    console.log(`Tenant ${slug} already exists`)
    return existing.id
  }
  const trialEnds = new Date()
  trialEnds.setFullYear(trialEnds.getFullYear() + 1)
  const row = await queryOne(
    `INSERT INTO tenants (name, slug, business_type, status, trial_ends_at) VALUES ($1,$2,$3,'active',$4) RETURNING id`,
    [name, slug, businessType, trialEnds.toISOString()]
  )
  console.log(`Created tenant: ${name} (${slug})`)
  return row!.id
}

async function createUser(tenantId: string, email: string, password: string, fullName: string, role: 'owner' | 'staff' = 'owner'): Promise<string> {
  const existing = await queryOne(`SELECT id FROM users WHERE email = $1`, [email])
  if (existing) {
    console.log(`User ${email} already exists`)
    return existing.id
  }
  const hash = await bcrypt.hash(password, 12)
  const row = await queryOne(
    `INSERT INTO users (tenant_id, email, password_hash, full_name, role, is_active) VALUES ($1,$2,$3,$4,$5,true) RETURNING id`,
    [tenantId, email, hash, fullName, role]
  )
  console.log(`Created user: ${fullName} (${email})`)
  return row!.id
}

async function seedHospital(tenantId: string, ownerId: string): Promise<void> {
  console.log('\n=== Seeding Hospital Data ===')

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
  console.log(`Created ${departments.length} departments`)

  // Assign owner to all departments
  for (const dept of departments) {
    await queryOne(
      `INSERT INTO department_staff (department_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [dept.id, ownerId]
    )
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
  console.log(`Created ${doctors.length} doctors`)

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
  console.log(`Created ${patients.length} patients`)

  // Create appointments (past, today, future)
  const now = new Date()
  const appointments: { id: string; patient_id: string; scheduled_at: Date; status: string }[] = []
  
  // Past appointments (completed)
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

  // Today's appointments
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

  // Future appointments
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
  console.log(`Created ${appointments.length} appointments`)

  // Create medical records for completed appointments
  const completedAppts = appointments.filter(a => a.status === 'completed')
  for (const appt of completedAppts) {
    const doctor = randomItem(doctors)
    const visitDate = new Date(appt.scheduled_at)
    await queryOne(
      `INSERT INTO medical_records (tenant_id, patient_id, doctor_name, visit_date, diagnosis, prescription, notes, vitals) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        tenantId,
        appt.patient_id,
        doctor.full_name,
        formatDate(visitDate),
        randomItem(diagnoses),
        randomItem(prescriptions),
        'Patient advised to return for follow-up in 2 weeks.',
        JSON.stringify({ bp: '120/80', temperature: '36.8', pulse: '78', weight: '70', height: '170', spo2: '98' })
      ]
    )
  }
  console.log(`Created ${completedAppts.length} medical records`)

  // Create invoices
  for (let i = 0; i < 30; i++) {
    const patient = randomItem(patients)
    const amount = Math.floor(500 + Math.random() * 5000)
    const paid = Math.random() < 0.7 ? amount : Math.floor(Math.random() * amount)
    const status = paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
    const issued = randomDate(new Date(now.getTime() - 60 * 86400000), now)
    const nextInvNum = i + 1
    const number = `INV${String(nextInvNum).padStart(4, '0')}`
    await queryOne(
      `INSERT INTO invoices (tenant_id, patient_id, number, description, amount, paid_amount, status, issued_on) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, patient.id, number, 'Consultation and medication', amount, paid, status, formatDate(issued)]
    )
  }
  console.log('Created 30 invoices')

  // Create lab tests
  const staffUsers = await query(`SELECT id FROM users WHERE tenant_id = $1`, [tenantId])
  const staffIds = staffUsers.map(r => r.id)
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
  console.log('Created 25 lab tests')

  // Create visits (patient journey)
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
    
    // Add status history
    await queryOne(
      `INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by, note) VALUES ($1,$2,$3,'checked_in',$4,$5)`,
      [visit!.id, tenantId, dept?.id ?? null, ownerId, visitType === 'walk_in' ? 'Walk-in' : 'Scheduled check-in']
    )
    
    if (status === 'in_service' || status === 'completed') {
      await queryOne(
        `INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by) VALUES ($1,$2,$3,'in_service',$4)`,
        [visit!.id, tenantId, dept?.id ?? null, ownerId]
      )
    }
    if (status === 'completed') {
      await queryOne(
        `INSERT INTO visit_status_history (visit_id, tenant_id, department_id, event, handled_by) VALUES ($1,$2,$3,'completed',$4)`,
        [visit!.id, tenantId, dept?.id ?? null, ownerId]
      )
    }
  }
  console.log('Created 20 visits with status history')

  // Create service orders (lab orders, etc.)
  const labDept = departments.find(d => d.type === 'laboratory')
  if (labDept) {
    const visitsResult = await query(`SELECT id, patient_id FROM visits WHERE tenant_id = $1 AND status IN ('waiting','in_service','completed') LIMIT 15`, [tenantId])
    for (const v of visitsResult) {
      const test = randomItem([
        { name: 'CBC (Complete Blood Count)', fee: 350 },
        { name: 'Malaria RDT', fee: 150 },
        { name: 'Blood Glucose (Fasting)', fee: 120 },
        { name: 'Urinalysis', fee: 200 },
      ])
      const status = randomItem(['pending', 'in_progress', 'completed'])
      const order = await queryOne(
        `INSERT INTO service_orders (tenant_id, visit_id, patient_id, order_type, target_department_id, ordered_by, priority, details, fee, status) 
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [tenantId, v.id, v.patient_id, 'lab_test', labDept.id, ownerId, 'normal', JSON.stringify({ test_name: test.name }), test.fee, status]
      )
      if (status === 'completed') {
        await queryOne(
          `UPDATE service_orders SET completed_by = $1, completed_at = now(), result = $2 WHERE id = $3`,
          [ownerId, JSON.stringify({ result: 'Normal' }), order!.id]
        )
      }
    }
    console.log('Created service orders')
  }

  console.log('✅ Hospital seeding complete!')
}

async function seedSchool(tenantId: string, ownerId: string): Promise<void> {
  console.log('\n=== Seeding School Data ===')

  // Create teachers
  const teachers: { id: string; full_name: string; subject: string }[] = []
  for (let i = 0; i < 10; i++) {
    const gender = i % 2 === 0 ? 'male' : 'female'
    const firstName = randomItem(ethiopianNames[gender])
    const lastName = randomItem(ethiopianNames.last)
    const row = await queryOne(
      `INSERT INTO teachers (tenant_id, full_name, subject, phone, email) VALUES ($1,$2,$3,$4,$5) RETURNING id, full_name, subject`,
      [tenantId, `${gender === 'male' ? 'Ato' : 'W/ro'} ${firstName} ${lastName}`, randomItem(schoolSubjects), `+2519${Math.floor(10000000 + Math.random() * 90000000)}`, `teacher${i+1}@demo-school.edu.et`]
    )
    teachers.push(row!)
  }
  console.log(`Created ${teachers.length} teachers`)

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
  console.log(`Created ${classes.length} classes`)

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
      [
        tenantId, code, firstName, lastName, gender,
        formatDate(randomDate(new Date(2008, 0, 1), new Date(2018, 11, 31))),
        classId,
        guardian,
        `+2519${Math.floor(10000000 + Math.random() * 90000000)}`,
        `guardian${i+1}@example.com`,
        `${100000000 + i}`,
        'Addis Ababa'
      ]
    )
    students.push(row!)
  }
  console.log(`Created ${students.length} students`)

  // Create subjects
  for (const subject of schoolSubjects) {
    await queryOne(
      `INSERT INTO subjects (tenant_id, name) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [tenantId, subject]
    )
  }
  console.log('Created subjects')

  // Create attendance for last 30 days
  const now = new Date()
  for (let day = 0; day < 30; day++) {
    const attDate = new Date(now.getTime() - day * 86400000)
    // Skip weekends
    if (attDate.getDay() === 0 || attDate.getDay() === 6) continue
    
    for (const cls of classes) {
      const classStudents = students.filter(s => s.class_id === cls.id)
      for (const student of classStudents) {
        // 90% present, 5% absent, 3% late, 2% excused
        const rand = Math.random()
        let status: 'present' | 'absent' | 'late' | 'excused'
        if (rand < 0.9) status = 'present'
        else if (rand < 0.95) status = 'absent'
        else if (rand < 0.98) status = 'late'
        else status = 'excused'
        
        await queryOne(
          `INSERT INTO attendance (tenant_id, student_id, class_id, att_date, status, recorded_by) 
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (student_id, att_date) DO UPDATE SET status = EXCLUDED.status`,
          [tenantId, student.id, cls.id, formatDate(attDate), status, ownerId]
        )
      }
    }
  }
  console.log('Created attendance records for 30 days')

  // Create grades
  const terms = ['Semester 1', 'Semester 2']
  const examTypes = ['test', 'assignment', 'mid', 'final']
  for (const student of students) {
    const cls = classes.find(c => c.id === student.class_id)
    if (!cls) continue
    
    for (const subject of schoolSubjects.slice(0, 6)) { // 6 subjects per student
      for (const term of terms) {
        for (const examType of examTypes) {
          const maxScore = examType === 'final' ? 100 : examType === 'mid' ? 80 : 50
          const score = Math.floor(maxScore * (0.4 + Math.random() * 0.5)) // 40-90%
          await queryOne(
            `INSERT INTO grades (tenant_id, student_id, class_id, subject, exam_type, term, score, max_score, recorded_by) 
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (student_id, subject, exam_type, term) DO UPDATE SET score = EXCLUDED.score`,
            [tenantId, student.id, cls.id, subject, examType, term, score, maxScore, ownerId]
          )
        }
      }
    }
  }
  console.log('Created grades for all students')

  // Create fees
  const feeTitles = ['Tuition Fee - Semester 1', 'Tuition Fee - Semester 2', 'Uniform', 'Textbooks', 'Transport', 'Exam Fee', 'Activity Fee']
  for (const student of students) {
    for (const title of feeTitles.slice(0, 4)) {
      const amount = title.includes('Tuition') ? 15000 : title === 'Uniform' ? 3000 : title === 'Textbooks' ? 2500 : 1500
      const dueDate = new Date(now.getTime() + Math.floor(Math.random() * 60) * 86400000)
      const paid = Math.random() < 0.6 ? amount : Math.floor(Math.random() * amount * 0.5)
      const status = paid >= amount ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
      const paidAt = status === 'paid' ? now.toISOString() : status === 'partial' ? now.toISOString() : null
      
      await queryOne(
        `INSERT INTO fees (tenant_id, student_id, title, amount, due_date, paid_amount, status, paid_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [tenantId, student.id, title, amount, formatDate(dueDate), paid, status, paidAt]
      )
    }
  }
  console.log('Created fee records')

  // Create timetable slots
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
  const timeSlots = ['08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00']
  for (const cls of classes) {
    const classTeachers = teachers.slice(0, 6)
    for (let day = 1; day <= 5; day++) {
      for (let slot = 0; slot < 5; slot++) {
        const subject = schoolSubjects[slot % schoolSubjects.length]
        const teacher = classTeachers[slot % classTeachers.length]
        await queryOne(
          `INSERT INTO timetable_slots (tenant_id, class_id, day_of_week, start_time, end_time, subject, teacher_id) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING`,
          [tenantId, cls.id, day, timeSlots[slot], timeSlots[slot + 1], subject, teacher.id]
        )
      }
    }
  }
  console.log('Created timetable slots')

  // Create announcements
  const announcements = [
    { title: 'Welcome Back to School!', body: 'Dear parents and students, welcome to the new academic year 2025/2026. We are excited to have you back.', pinned: true, target_type: 'all' as const },
    { title: 'Parent-Teacher Conference', body: 'Parent-teacher conferences will be held on October 15-16. Please schedule your appointment with the homeroom teacher.', pinned: false, target_type: 'all' as const },
    { title: 'School Trip to National Museum', body: 'Grade 4 and 5 students will visit the National Museum on November 5. Permission slips due by October 30.', pinned: false, target_type: 'class' as const, class_id: classes.find(c => c.name.includes('Grade 4'))?.id },
    { title: 'Mid-term Exams Schedule', body: 'Mid-term exams begin on November 18. Please check the detailed schedule on the notice board.', pinned: true, target_type: 'all' as const },
  ]
  for (const a of announcements) {
    await queryOne(
      `INSERT INTO announcements (tenant_id, title, body, pinned, target_type, class_id, created_by, sent_email, sent_telegram) VALUES ($1,$2,$3,$4,$5,$6,$7,false,false)`,
      [tenantId, a.title, a.body, a.pinned, a.target_type, a.class_id ?? null, ownerId]
    )
  }
  console.log('Created announcements')

  console.log('✅ School seeding complete!')
}

async function main(): Promise<void> {
  console.log('🌱 Starting demo data seeding...\n')

  // Create hospital tenant
  const hospitalTenantId = await createTenant('Demo Hospital', DEMO_TENANT_SLUG, 'hospital')
  const hospitalOwnerId = await createUser(hospitalTenantId, 'hospital@demo.com', 'demo123', 'Dr. Hospital Owner', 'owner')
  await createUser(hospitalTenantId, 'nurse@demo.com', 'demo123', 'Nurse Station', 'staff')
  await createUser(hospitalTenantId, 'lab@demo.com', 'demo123', 'Lab Technician', 'staff')
  await seedHospital(hospitalTenantId, hospitalOwnerId)

  // Create school tenant
  const schoolTenantId = await createTenant('Demo School', DEMO_SCHOOL_SLUG, 'school')
  const schoolOwnerId = await createUser(schoolTenantId, 'school@demo.com', 'demo123', 'Principal Director', 'owner')
  await createUser(schoolTenantId, 'teacher@demo.com', 'demo123', 'Class Teacher', 'staff')
  await seedSchool(schoolTenantId, schoolOwnerId)

  console.log('\n🎉 All demo data seeded successfully!')
  console.log('\n📋 Demo Login Credentials:')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
  console.log('Hospital: hospital@demo.com / demo123')
  console.log('School:   school@demo.com / demo123')
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

  await pool.end()
}

main().catch((err) => {
  console.error('❌ Seeding failed:', err)
  process.exit(1)
})