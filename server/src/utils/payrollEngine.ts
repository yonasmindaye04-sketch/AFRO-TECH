// ═══════════════════════════════════════════════════════════
// AFRO Suite — Configurable Formula-Driven Payroll Engine
// ═══════════════════════════════════════════════════════════

export interface ComponentDef {
  code: string
  category: 'EARNING' | 'DEDUCTION' | 'EMPLOYER_COST' | 'MEMO'
  source: 'PROFILE' | 'MANUAL' | 'DERIVED'
  taxability: 'TAXABLE' | 'NON_TAXABLE'
  pensionable: boolean
  formula: string | null
  rounding_decimals: number
}

export interface TaxBracketLine {
  min_amount: number
  max_amount: number | null
  rate: number // percentage (0 to 100)
  deduction: number
}

export interface TaxBracket {
  code: string
  lines: TaxBracketLine[]
}

type ValuesMap = Record<string, number | string>

interface EvalContext {
  components: Record<string, ComponentDef>
  values: ValuesMap
  brackets: Record<string, TaxBracket>
}

// Custom AST-based formula parser (NO eval)
class Parser {
  private pos = 0
  constructor(private tokens: string[], private ctx: EvalContext) {}

  public parse(): number {
    const val = this.parseExpression()
    if (this.pos < this.tokens.length) throw new Error(`Unexpected token: ${this.tokens[this.pos]}`)
    return val
  }

  private match(t: string): boolean {
    if (this.pos < this.tokens.length && this.tokens[this.pos] === t) {
      this.pos++
      return true
    }
    return false
  }

  private consume(t: string): void {
    if (!this.match(t)) {
      throw new Error(`Expected '${t}' but found '${this.tokens[this.pos] ?? 'EOF'}'`)
    }
  }

  private parseExpression(): number {
    let left = this.parseTerm()
    while (this.pos < this.tokens.length) {
      const op = this.tokens[this.pos]
      if (op === '+' || op === '-') {
        this.pos++
        const right = this.parseTerm()
        left = op === '+' ? left + right : left - right
      } else if (op === '>' || op === '<' || op === '>=' || op === '<=' || op === '==' || op === '!=') {
        this.pos++
        const right = this.parseTerm()
        // Logical comparisons return 1 or 0
        switch(op) {
          case '>': left = left > right ? 1 : 0; break;
          case '<': left = left < right ? 1 : 0; break;
          case '>=': left = left >= right ? 1 : 0; break;
          case '<=': left = left <= right ? 1 : 0; break;
          case '==': left = left === right ? 1 : 0; break;
          case '!=': left = left !== right ? 1 : 0; break;
        }
      } else {
        break
      }
    }
    return left
  }

  private parseTerm(): number {
    let left = this.parseFactor()
    while (this.pos < this.tokens.length) {
      const op = this.tokens[this.pos]
      if (op === '*' || op === '/') {
        this.pos++
        const right = this.parseFactor()
        if (op === '/') {
          if (right === 0) throw new Error('Division by zero')
          left = left / right
        } else {
          left = left * right
        }
      } else {
        break
      }
    }
    return left
  }

  private parseFactor(): number {
    const op = this.tokens[this.pos]
    if (op === '+' || op === '-') {
      this.pos++
      const val = this.parseFactor()
      return op === '-' ? -val : val
    }

    const token = this.tokens[this.pos++]
    if (!token) throw new Error('Unexpected EOF')

    if (token === '(') {
      const val = this.parseExpression()
      this.consume(')')
      return val
    }

    if (!isNaN(Number(token))) {
      return Number(token)
    }

    // Function calls
    if (this.pos < this.tokens.length && this.tokens[this.pos] === '(') {
      const funcName = token.toUpperCase()
      this.pos++ // consume '('
      const args: (number | string)[] = []
      if (this.tokens[this.pos] !== ')') {
        do {
          const argToken = this.tokens[this.pos]
          if (argToken.startsWith("'") || argToken.startsWith('"')) {
            args.push(argToken.slice(1, -1))
            this.pos++
          } else {
            args.push(this.parseExpression())
          }
        } while (this.match(','))
      }
      this.consume(')')

      return this.executeFunction(funcName, args)
    }

    // Variable lookup
    const varName = token
    if (this.ctx.values[varName] !== undefined) {
      return Number(this.ctx.values[varName])
    }

    // It's neither a known function, nor number, nor existing variable
    // Default undefined variables to 0 (graceful degrade for MANUAL without entries)
    return 0
  }

  private executeFunction(name: string, args: (number | string)[]): number {
    switch (name) {
      case 'IF':
        if (args.length !== 3) throw new Error(`IF requires 3 arguments`)
        return args[0] ? Number(args[1]) : Number(args[2])
      case 'MIN':
        return Math.min(...(args.map(Number)))
      case 'MAX':
        return Math.max(...(args.map(Number)))
      case 'ROUND':
        if (args.length !== 2) throw new Error(`ROUND requires 2 arguments`)
        const factor = Math.pow(10, Number(args[1]))
        return Math.round(Number(args[0]) * factor) / factor
      case 'SUM':
        return args.reduce<number>((acc, val) => {
          const num = typeof val === 'number' ? val : Number(val)
          return (Number(acc) + (isNaN(num) ? 0 : num)) as any
        }, 0)
      case 'SUMIF': {
        // SUMIF('EARNING', 'NON_TAXABLE') or just SUMIF('EARNING')
        const category = args[0] as string
        const taxability = args.length > 1 ? args[1] as string : null

        let sum = 0
        for (const [code, val] of Object.entries(this.ctx.values)) {
          const def = this.ctx.components[code]
          if (!def) continue
          if (def.category === category && (!taxability || def.taxability === taxability)) {
            const num = typeof val === 'number' ? val : Number(val)
            sum += (isNaN(num) ? 0 : num)
          }
        }
        return sum
      }
      case 'PCT':
        if (args.length !== 2) throw new Error(`PCT requires 2 arguments`)
        return Number(args[0]) * (Number(args[1]) / 100)
      case 'TAX_BRACKET': {
        if (args.length !== 2) throw new Error(`TAX_BRACKET requires 2 arguments`)
        const amount = Number(args[0])
        const bracketCode = args[1] as string
        const bracket = this.ctx.brackets[bracketCode]
        if (!bracket) throw new Error(`Tax bracket '${bracketCode}' not found`)

        for (const line of bracket.lines) {
          if (amount >= line.min_amount && (line.max_amount === null || amount <= line.max_amount)) {
            return (amount * (line.rate / 100)) - line.deduction
          }
        }
        return 0
      }
      default:
        throw new Error(`Unknown function '${name}'`)
    }
  }
}

// Tokenizer
function tokenize(formula: string): string[] {
  const tokens: string[] = []
  let i = 0
  while (i < formula.length) {
    const c = formula[i]
    if (/\s/.test(c)) {
      i++
    } else if (/[+\-*/(),<>=!]/.test(c)) {
      if ((c === '>' || c === '<' || c === '=' || c === '!') && formula[i + 1] === '=') {
        tokens.push(c + '=')
        i += 2
      } else {
        tokens.push(c)
        i++
      }
    } else if (c === "'" || c === '"') {
       let str = c
       i++
       while(i < formula.length && formula[i] !== c) {
           str += formula[i]
           i++
       }
       if(i < formula.length) str += formula[i] // close quote
       tokens.push(str)
       i++
    } else if (/[A-Za-z0-9_.]/.test(c)) {
      let val = ''
      while (i < formula.length && /[A-Za-z0-9_.]/.test(formula[i])) {
        val += formula[i]
        i++
      }
      tokens.push(val)
    } else {
      throw new Error(`Invalid character in formula: ${c}`)
    }
  }
  return tokens
}

/** Evaluates a single parsed expression safely */
export function evaluateFormula(formula: string, ctx: EvalContext): number {
  if (!formula.trim()) return 0
  const tokens = tokenize(formula)
  const parser = new Parser(tokens, ctx)
  return parser.parse()
}

/** Extracts variable names from a formula for dependency resolution */
export function extractDependencies(formula: string): string[] {
  if (!formula) return []
  const tokens = tokenize(formula)
  const deps = new Set<string>()
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    // A dependency is an identifier that is not a function name (followed by '(')
    // and not a number, and not a string literal
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(t) && !/^(IF|MIN|MAX|ROUND|SUM|SUMIF|PCT|TAX_BRACKET)$/i.test(t)) {
      if (i + 1 < tokens.length && tokens[i + 1] === '(') {
        continue // it's a function call
      }
      deps.add(t)
    }
  }
  return Array.from(deps)
}

/** Resolves the order to evaluate components based on their formulas */
export function buildExecutionOrder(components: Record<string, ComponentDef>): string[] {
  const graph: Record<string, string[]> = {}
  const inDegree: Record<string, number> = {}

  // Initialize graph
  for (const code of Object.keys(components)) {
    graph[code] = []
    inDegree[code] = 0
  }

  // Build edges
  for (const [code, def] of Object.entries(components)) {
    if (def.source !== 'DERIVED' || !def.formula) continue

    // SUMIF operates on categories so it intrinsically depends on ALL non-derived variables of that category.
    // For simplicity, we make DERIVED variables depend on all NON-DERIVED vars if they use SUMIF,
    // but typically SUMIF is used for GROSS -> EARNINGS, which are profile/manual.
    if (def.formula.includes('SUMIF')) {
      for (const [c2, d2] of Object.entries(components)) {
         if (d2.source !== 'DERIVED' && c2 !== code) {
             graph[c2].push(code)
             inDegree[code] = (inDegree[code] || 0) + 1
         }
      }
    }

    const deps = extractDependencies(def.formula)
    for (const dep of deps) {
      if (components[dep] && dep !== code) {
        if (!graph[dep]) graph[dep] = []
        graph[dep].push(code)
        inDegree[code] = (inDegree[code] || 0) + 1
      }
    }
  }

  // Kahn's algorithm for topological sort
  const queue: string[] = []
  for (const code of Object.keys(inDegree)) {
    if (inDegree[code] === 0) queue.push(code)
  }

  const order: string[] = []
  while (queue.length > 0) {
    const u = queue.shift()!
    order.push(u)

    for (const v of graph[u]) {
      inDegree[v]--
      if (inDegree[v] === 0) {
        queue.push(v)
      }
    }
  }

  if (order.length !== Object.keys(components).length) {
    throw new Error('Circular dependency detected in payroll components')
  }

  return order
}

/**
 * Executes a full payroll calculation for a single employee.
 * @param components Definitions of all active components
 * @param brackets Tax brackets mapping
 * @param profileValues Values coming from the employee's profile
 * @param overrides Values overridden manually for this run
 */
export function calculateEmployeePayroll(
  components: Record<string, ComponentDef>,
  brackets: Record<string, TaxBracket>,
  profileValues: Record<string, number | string>,
  overrides: Record<string, { value: number | string; reason: string; by: string }>
): { values: Record<string, number | string>; netPay: number } {

  const values: Record<string, number | string> = {}

  // 1. Initialize variables from PROFILE and MANUAL sources (apply overrides if present)
  for (const [code, def] of Object.entries(components)) {
    if (def.source === 'PROFILE') {
      values[code] = overrides[code]?.value ?? profileValues[code] ?? 0
    } else if (def.source === 'MANUAL') {
      values[code] = overrides[code]?.value ?? 0
    }
  }

  // 2. Sort execution order
  const order = buildExecutionOrder(components)

  const ctx: EvalContext = { components, values, brackets }

  // 3. Evaluate formulas sequentially
  for (const code of order) {
    const def = components[code]
    if (def.source === 'DERIVED') {
       if (!def.formula) {
         values[code] = 0 as number
         continue
       }

       try {
         const result = evaluateFormula(def.formula, ctx)
         const factor = Math.pow(10, def.rounding_decimals)
         values[code] = Math.round(Number(result) * factor) / factor
       } catch (err) {
         throw new Error(`Failed to calculate ${code}: ${err instanceof Error ? err.message : String(err)}`)
       }
    }
  }

  // 4. Calculate Net Pay implicitly from Gross - Total Ded, or just standard EARNINGS - DEDUCTIONS
  let totalEarnings = 0
  let totalDeductions = 0
  for (const [code, def] of Object.entries(components)) {
    const num = typeof values[code] === 'number' ? values[code] : Number(values[code])
    const safeNum = isNaN(num as number) ? 0 : (num as number)
    if (def.category === 'EARNING') totalEarnings += safeNum
    if (def.category === 'DEDUCTION') totalDeductions += safeNum
  }

  // If a NET component exists, use it, otherwise fallback to Earnings - Deductions
  const netPay = (typeof values['NET'] === 'number' ? values['NET'] : Math.max(0, totalEarnings - totalDeductions))

  return { values, netPay }
}
