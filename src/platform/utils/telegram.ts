interface TelegramWebApp {
  initData: string
  initDataUnsafe?: { user?: { id: number; first_name?: string } }
  ready: () => void
  expand: () => void
  setHeaderColor?: (color: string) => void
  HapticFeedback?: { impactOccurred: (style: string) => void }
}

export function tg(): TelegramWebApp | null {
  const w = window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }
  return w.Telegram?.WebApp ?? null
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
