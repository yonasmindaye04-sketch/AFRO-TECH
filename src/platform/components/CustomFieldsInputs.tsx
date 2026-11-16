import { useEffect, useState } from 'react'
import { api } from '../api'
import { Field } from '../ui'

export interface CustomFieldDef {
  id: string
  entity: 'product' | 'customer' | 'supplier'
  key: string
  label: string
  type: 'text' | 'number' | 'date' | 'select'
  options?: string
  required?: boolean
}

export function CustomFieldsInputs({
  entity,
  values,
  onChange,
}: {
  entity: 'product' | 'customer' | 'supplier'
  values: Record<string, string>
  onChange: (next: Record<string, string>) => void
}): JSX.Element | null {
  const [fields, setFields] = useState<CustomFieldDef[]>([])

  useEffect(() => {
    let active = true
    api
      .get<{ fields: CustomFieldDef[] }>(`/tenant/custom-fields?entity=${entity}`)
      .then((res) => {
        if (active) setFields(res.fields ?? [])
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [entity])

  if (!fields.length) return null

  return (
    <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 12, marginTop: 8, marginBottom: 8 }}>
      <p style={{ fontSize: '.76rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--text-dim)', marginBottom: 10 }}>
        Custom Fields
      </p>
      <div className="pl-grid-2">
        {fields.map((f) => {
          const val = values[f.key] ?? ''
          const setVal = (v: string) => onChange({ ...values, [f.key]: v })
          if (f.type === 'select') {
            const opts = (f.options || '')
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
            return (
              <Field key={f.id} label={f.label}>
                <select className="pl-select" required={f.required} value={val} onChange={(e) => setVal(e.target.value)}>
                  <option value="">Select…</option>
                  {opts.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </Field>
            )
          }
          return (
            <Field key={f.id} label={f.label}>
              <input
                className="pl-input"
                type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                required={f.required}
                value={val}
                onChange={(e) => setVal(e.target.value)}
                placeholder={`Enter ${f.label.toLowerCase()}…`}
              />
            </Field>
          )
        })}
      </div>
    </div>
  )
}
