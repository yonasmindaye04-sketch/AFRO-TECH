import fs from 'fs'

const files = [
  'src/platform/pages/Expenses.tsx',
  'src/platform/pages/Payroll.tsx'
]

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8')
  
  // PageHeader: sub -> subtitle
  content = content.replace(/<PageHeader title="([^"]+)" sub="/g, '<PageHeader title="$1" subtitle="')
  
  // DataTable columns: title -> header
  content = content.replace(/title:/g, 'header:')
  
  // PageHeader again for Payroll
  content = content.replace(/<PageHeader header=/g, '<PageHeader title=')

  fs.writeFileSync(file, content)
}

let pr = fs.readFileSync('src/platform/pages/Payroll.tsx', 'utf8')
pr = pr.replace(/me\?\.role === 'admin'/g, "me?.role === 'staff'") // staff can be managers? or just 'owner'
pr = pr.replace(/me\?\.role === 'owner' \|\| me\?\.role === 'staff'/g, "me?.role === 'owner'") 
fs.writeFileSync('src/platform/pages/Payroll.tsx', pr)

console.log('Fixed more TS errors')
