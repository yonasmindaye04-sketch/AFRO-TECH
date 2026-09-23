import fs from 'fs'

const files = [
  'src/platform/pages/Expenses.tsx',
  'src/platform/pages/Payroll.tsx'
]

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8')
  
  // DataTable columns: label -> title
  content = content.replace(/label:/g, 'title:')
  
  // Modal: add open={true}
  content = content.replace(/<Modal title=/g, '<Modal open={true} title=')
  
  // EmptyState: message -> title
  content = content.replace(/message="/g, 'title="')

  // api.delete -> api.del
  content = content.replace(/api\.delete\(/g, 'api.del(')

  fs.writeFileSync(file, content)
}
console.log('Fixed TS errors')
