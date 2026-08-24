import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, loadAuth, saveAuth, ApiError } from './api'
import type { Me } from './api'

interface AuthState {
  me: Me | null
  ready: boolean
  login: (email: string, password: string) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => void
  refreshMe: () => Promise<void>
}

export interface RegisterInput {
  company_name: string
  business_type: 'pharmacy' | 'store' | 'hospital' | 'school'
  owner_name: string
  email: string
  password: string
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [me, setMe] = useState<Me | null>(() => loadAuth()?.me ?? null)
  // If there is nothing stored, we are "ready" immediately; otherwise the
  // bootstrap effect below flips this once /auth/me resolves.
  const [ready, setReady] = useState(() => loadAuth() === null)

  const persist = useCallback((token: string, nextMe: Me) => {
    saveAuth({ token, me: nextMe })
    setMe(nextMe)
  }, [])

  useEffect(() => {
    if (!loadAuth()) return
    let cancelled = false
    api
      .get<{ me: Me; token: string }>('/auth/me')
      .then((res) => {
        if (!cancelled) persist(res.token, res.me)
      })
      .catch(() => {
        if (!cancelled) saveAuth(null)
      })
      .finally(() => {
        if (!cancelled) setReady(true)
      })
    return () => {
      cancelled = true
    }
  }, [persist])

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<{ token: string; me: Me }>('/auth/login', { email, password })
      persist(res.token, res.me)
    },
    [persist]
  )

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await api.post<{ token: string; me: Me }>('/auth/register', input)
      persist(res.token, res.me)
    },
    [persist]
  )

  const refreshMe = useCallback(async () => {
    const res = await api.get<{ me: Me; token: string }>('/auth/me')
    persist(res.token, res.me)
  }, [persist])

  const logout = useCallback(() => {
    saveAuth(null)
    setMe(null)
  }, [])

  const value = useMemo(() => ({ me, ready, login, register, logout, refreshMe }), [me, ready, login, register, logout, refreshMe])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

/* Context files conventionally export the hook alongside the provider —
   this is intentional, not a fast-refresh violation. */
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

// eslint-disable-next-line react-refresh/only-export-components
export function isTrialError(err: unknown): err is ApiError & { code: 'TRIAL_EXPIRED' } {
  return err instanceof ApiError && err.code === 'TRIAL_EXPIRED'
}
