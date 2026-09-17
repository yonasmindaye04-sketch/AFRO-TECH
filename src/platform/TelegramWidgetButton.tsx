import { useEffect } from 'react'
import { api } from './api'

interface Props {
  botUsername: string
  onError: (msg: string) => void
}

declare global {
  interface Window {
    onTelegramAuth?: (user: Record<string, unknown>) => void
  }
}

/**
 * Telegram Login Widget. Verifies the payload server-side (POST /auth/telegram-login),
 * then hands over to /app/social which persists the token and finishes onboarding.
 */
export default function TelegramWidgetButton({ botUsername, onError }: Props): JSX.Element {
  useEffect(() => {
    window.onTelegramAuth = (user) => {
      api
        .post<{ token: string; needs_workspace: boolean }>('/auth/telegram-login', user)
        .then((res) => {
          window.location.assign(`/app/social?token=${encodeURIComponent(res.token)}`)
        })
        .catch((err) => onError(err instanceof Error ? err.message : 'Telegram sign-in failed'))
    }

    const script = document.createElement('script')
    script.src = 'https://telegram.org/js/telegram-widget.js?22'
    script.async = true
    script.setAttribute('data-telegram-login', botUsername)
    script.setAttribute('data-size', 'large')
    script.setAttribute('data-radius', '8')
    script.setAttribute('data-onauth', 'onTelegramAuth(user)')
    script.setAttribute('data-request-access', 'write')
    const container = document.getElementById('telegram-widget')
    if (container && !container.hasChildNodes()) container.appendChild(script)

    return () => {
      delete window.onTelegramAuth
    }
  }, [botUsername, onError])

  return <div id="telegram-widget" style={{ display: 'flex', justifyContent: 'center' }} />
}
