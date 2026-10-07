import { applyTenantTheme, initTelegramUi, isTelegram, loadTelegramSdk, type TenantBrand } from './utils/telegram'

/**
 * Mini App boot: load the Telegram SDK, resolve which tenant this launch
 * belongs to (server verifies the initData HMAC), and paint their brand
 * before the user signs in. Auth itself happens in Login.tsx.
 */
export async function bootstrapMiniApp(): Promise<{ tenantId: string | null; brand: TenantBrand | null }> {
  const app = await loadTelegramSdk()
  if (!app || !isTelegram()) return { tenantId: null, brand: null }
  initTelegramUi()

  const initData = app.initData
  const params = new URLSearchParams(window.location.search)
  const tenantId = params.get('tenant_id') || undefined
  const botId = params.get('bot_id') || undefined

  try {
    const res = await fetch('/api/v1/telegram/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ initData, tenantId, botId }),
    })
    if (!res.ok) return { tenantId: null, brand: null }
    const data = (await res.json()) as { tenant: { id: string; brand: TenantBrand } }
    applyTenantTheme(data.tenant.brand)
    return { tenantId: data.tenant.id, brand: data.tenant.brand }
  } catch {
    return { tenantId: null, brand: null }
  }
}