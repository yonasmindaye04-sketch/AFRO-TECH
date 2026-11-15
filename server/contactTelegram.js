/**
 * Pure formatting and delivery helper for Telegram contact-form notifications.
 * Uses process.env.TELEGRAM_BOT_TOKEN and process.env.TELEGRAM_CONTACT_CHAT_ID
 * (falling back to TELEGRAM_CHAT_ID when TELEGRAM_CONTACT_CHAT_ID is unset).
 */

/**
 * Escape user-supplied text for Telegram's HTML parse mode.
 * Bare &, <, > characters otherwise break Telegram sendMessage with HTTP 400.
 * @param {unknown} text
 * @returns {string}
 */
export function escapeTelegramHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Resolve Telegram bot token and target chat ID from options or environment variables.
 * @param {{ botToken?: string, chatId?: string | number, env?: Record<string, string | undefined> }} [options]
 */
export function resolveTelegramContactConfig(options = {}) {
  const env = options.env ?? (typeof process !== 'undefined' ? process.env : {});
  const botToken = String(options.botToken ?? env.TELEGRAM_BOT_TOKEN ?? '').trim();
  const chatId = String(
    options.chatId ?? env.TELEGRAM_CONTACT_CHAT_ID ?? env.TELEGRAM_CHAT_ID ?? ''
  ).trim();
  return { botToken, chatId };
}

/**
 * Format a validated contact submission into an HTML-safe Telegram message.
 * @param {{ name: string, email: string, phone?: string, message: string, timestamp?: string }} payload
 * @returns {string}
 */
export function formatContactTelegramMessage({ name, email, phone, message, timestamp }) {
  const safeName = escapeTelegramHtml(String(name ?? '').trim());
  const safeEmail = escapeTelegramHtml(String(email ?? '').trim());
  const trimmedPhone = String(phone ?? '').trim();
  const safePhone = trimmedPhone ? escapeTelegramHtml(trimmedPhone) : 'Not provided';
  const safeMessage = escapeTelegramHtml(String(message ?? '').trim());
  const sentAt = escapeTelegramHtml(timestamp || new Date().toISOString());

  return [
    '📩 <b>New AFRO-TECH Contact Inquiry</b>',
    '',
    `<b>Name:</b> ${safeName}`,
    `<b>Email:</b> ${safeEmail}`,
    `<b>Phone:</b> ${safePhone}`,
    '',
    '<b>Message:</b>',
    safeMessage,
    '',
    `<i>Submitted: ${sentAt}</i>`,
  ].join('\n');
}

/**
 * Send a Telegram chat notification when the contact form is submitted.
 * Never throws; returns a structured result so form submissions remain resilient.
 *
 * @param {{ name: string, email: string, phone?: string, message: string, timestamp?: string }} payload
 * @param {{
 *   botToken?: string,
 *   chatId?: string | number,
 *   env?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   timeoutMs?: number
 * }} [options]
 * @returns {Promise<{ sent: boolean, reason?: string, messageId?: number, error?: string }>}
 */
export async function sendContactTelegramNotification(payload, options = {}) {
  const { botToken, chatId } = resolveTelegramContactConfig(options);

  if (!botToken) {
    return { sent: false, reason: 'missing_bot_token' };
  }
  if (!chatId) {
    return { sent: false, reason: 'missing_chat_id' };
  }

  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchFn !== 'function') {
    return { sent: false, reason: 'fetch_unavailable' };
  }

  const text = formatContactTelegramMessage(payload);
  const timeoutMs = Number(options.timeoutMs ?? 8000);
  const signal =
    typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
      ? AbortSignal.timeout(timeoutMs)
      : undefined;

  try {
    const response = await fetchFn(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      }),
      ...(signal ? { signal } : {}),
    });

    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.ok) {
      const description = data?.description || `HTTP ${response.status}`;
      console.warn('[contact:telegram] sendMessage failed:', description);
      return { sent: false, reason: 'telegram_api_error', error: description };
    }

    return {
      sent: true,
      messageId: data.result?.message_id,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn('[contact:telegram] request error:', error);
    return { sent: false, reason: 'network_error', error };
  }
}
