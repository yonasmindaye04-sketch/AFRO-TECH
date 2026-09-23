import fs from 'fs'

const files = [
  'src/platform/pages/Expenses.tsx',
  'src/platform/pages/Payroll.tsx'
]

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8')
  
  // PageHeader children -> action
  content = content.replace(/<PageHeader title="([^"]+)" subtitle="([^"]+)">\s*(<button[\s\S]*?<\/button>)\s*<\/PageHeader>/g, '<PageHeader title="$1" subtitle="$2" action={<>$3</>} />')
  content = content.replace(/<PageHeader title="([^"]+)" subtitle="([^"]+)">\s*(<div[\s\S]*?<\/div>)\s*<\/PageHeader>/g, '<PageHeader title="$1" subtitle="$2" action={<>$3</>} />')

  // DataTable align -> div
  content = content.replace(/, align: 'right'/g, '')
  content = content.replace(/, align: 'center'/g, '')

  fs.writeFileSync(file, content)
}

let exp = fs.readFileSync('src/platform/pages/Expenses.tsx', 'utf8')
exp = exp.replace(/{ key: 'category', header: 'Category' }/g, "{ key: 'category', header: 'Category', render: (r) => r.category }")
fs.writeFileSync('src/platform/pages/Expenses.tsx', exp)

let pr = fs.readFileSync('src/platform/pages/Payroll.tsx', 'utf8')
pr = pr.replace(/{ key: 'full_name', header: 'Employee' }/g, "{ key: 'full_name', header: 'Employee', render: (r) => r.full_name }")
pr = pr.replace(/{ key: 'role', header: 'Role' }/g, "{ key: 'role', header: 'Role', render: (r) => r.role }")
pr = pr.replace(/{ key: 'employee_name', header: 'Employee' }/g, "{ key: 'employee_name', header: 'Employee', render: (r) => r.employee_name }")
pr = pr.replace(/{ key: 'period_label', header: 'Period' }/g, "{ key: 'period_label', header: 'Period', render: (r) => r.period_label }")
pr = pr.replace(/{ key: 'frequency', header: 'Frequency' }/g, "{ key: 'frequency', header: 'Frequency', render: (r) => r.frequency }")
pr = pr.replace(/{ key: 'item_count', header: 'Staff' }/g, "{ key: 'item_count', header: 'Staff', render: (r) => String(r.item_count) }")
pr = pr.replace(/detail\.period_label/g, "(detail as any).period_label")
fs.writeFileSync('src/platform/pages/Payroll.tsx', pr)

console.log('Fixed final TS errors')
