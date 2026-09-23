import fs from 'fs'

let pr = fs.readFileSync('src/platform/pages/Payroll.tsx', 'utf8')
pr = pr.replace(/render: \(r\) => r\.period_label/g, "render: (r: any) => r.period_label")
pr = pr.replace(/render: \(r\) => r\.item_count/g, "render: (r: any) => String(r.item_count)")
fs.writeFileSync('src/platform/pages/Payroll.tsx', pr)

console.log('Fixed period_label TS errors')
