export interface TemplateVariables {
  [key: string]: string | number | boolean | null | undefined
}

export function renderTemplate(template: string, variables: TemplateVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = variables[key]
    return value !== undefined && value !== null ? String(value) : match
  })
}

export function extractVariables(template: string): string[] {
  const matches = template.match(/\{\{(\w+)\}\}/g)
  if (!matches) return []
  return [...new Set(matches.map(m => m.slice(2, -2)))]
}

export function validateVariables(template: string, variables: TemplateVariables): { valid: boolean; missing: string[] } {
  const required = extractVariables(template)
  const missing = required.filter(key => variables[key] === undefined || variables[key] === null)
  return { valid: missing.length === 0, missing }
}