interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: { id: number; first_name?: string } }
  ready: () => void
  expand: () => void
  setHeaderColor?: (color: string) => void
  setBackgroundColor?: (color: string) => void
  BackButton?: {
    isVisible: boolean
    show: () => void
    hide: () => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
  }
  MainButton?: {
    text: string
    show: () => void
    hide: () => void
    setText?: (t: string) => void
    onClick: (cb: () => void) => void
    offClick: (cb: () => void) => void
  }
  HapticFeedback?: { impactOccurred: (style: string) => void }
  themeParams?: Record<string, string>
}

export function tg(): TelegramWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }
  return w.Telegram?.WebApp ?? null
}

let sdkPromise: Promise<TelegramWebApp | null> | null = null

/**
 * Lazily load the Telegram Mini App SDK (telegram-web-app.js).
 * The script is injected on demand so it never blocks page rendering on
 * routes that don't need it. Resolves once the SDK is available (or null
 * when the script fails to load, e.g. offline).
 */
export function loadTelegramSdk(): Promise<TelegramWebApp | null> {
  if (sdkPromise) return sdkPromise
  sdkPromise = new Promise((resolve) => {
    const existing = tg()
    if (existing) { resolve(existing); return }
    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-web-app.js'
    script.async = true
    script.onload = () => resolve(tg())
    script.onerror = () => resolve(null)
    document.head.appendChild(script)
  })
  return sdkPromise
}

export function isTelegram(): boolean {
  const app = tg()
  return Boolean(app?.initData)
}

/** Announce the app to Telegram and take over the viewport. */
export function initTelegramUi(): void {
  const app = tg()
  if (!app) return
  app.ready()
  app.expand()
  app.setHeaderColor?.('#100e0a')
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export interface TenantBrand {
  primary?: string
  accent?: string
  logo_url?: string
  tagline?: string
}

/**
 * Paint the tenant's brand onto CSS custom properties so the whole Mini App
 * re-themes from one place. Values are re-validated here (not just server
 * side) and assigned via style.setProperty, so a hostile brand value can
 * never inject arbitrary CSS.
 */
export function applyTenantTheme(brand: TenantBrand | undefined | null): void {
  if (!brand) return
  const root = document.documentElement
  if (brand.primary && HEX.test(brand.primary)) {
    root.style.setProperty('--brand', brand.primary)
    root.style.setProperty('--brand-soft', `color-mix(in srgb, ${brand.primary} 18%, transparent)`)
    root.style.setProperty('--brand-line', `color-mix(in srgb, ${brand.primary} 35%, transparent)`)
  }
  if (brand.accent && HEX.test(brand.accent)) {
    root.style.setProperty('--accent', brand.accent)
  }
  tg()?.setHeaderColor?.(brand.primary && HEX.test(brand.primary) ? brand.primary : '#100e0a')
}