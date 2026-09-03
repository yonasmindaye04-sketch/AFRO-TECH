export interface TenantInfo {
  id: string
  name: string
  slug: string
  business_type: 'pharmacy' | 'store' | 'hospital' | 'school'
  status: 'trial' | 'active' | 'expired' | 'suspended'
  trial_ends_at: string
  trial_days_left?: number
}

export interface Me {
  id: string
  email: string
  full_name: string
  role: 'owner' | 'staff' | 'afrotech_admin'
  tenant_id: string | null
  tenant?: TenantInfo | null
}

export class ApiError extends Error {
  status: number
  code: string
  constructor(status: number, message: string, code = 'ERROR') {
    super(message)
    this.status = status
    this.code = code
  }
}

const STORAGE_KEY = 'afro_suite_auth'

export function loadAuth(): { token: string; me: Me } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as { token: string; me: Me }) : null
  } catch {
    return null
  }
}

export function saveAuth(auth: { token: string; me: Me } | null): void {
  if (auth) localStorage.setItem(STORAGE_KEY, JSON.stringify(auth))
  else localStorage.removeItem(STORAGE_KEY)
}

async function request<T>(method: string, path: string, body?: unknown, extraHeaders?: Record<string, string>): Promise<T> {
  const auth = loadAuth()
  const res = await fetch(`/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth ? { Authorization: `Bearer ${auth.token}` } : {}),
      ...extraHeaders,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    /* no body */
  }

  if (!res.ok) {
    const err = (data ?? {}) as { error?: string; code?: string }
    throw new ApiError(res.status, err.error || `Request failed (${res.status})`, err.code || 'ERROR')
  }
  return data as T
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown, extraHeaders?: Record<string, string>) => request<T>('POST', path, body, extraHeaders),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
}

export const fmtMoney = (n: number | string | null | undefined): string =>
  new Intl.NumberFormat('en-ET', { maximumFractionDigits: 2 }).format(Number(n ?? 0))

export const fmtDate = (d: string | Date | null | undefined): string => {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const fmtDateTime = (d: string | Date | null | undefined): string => {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}
