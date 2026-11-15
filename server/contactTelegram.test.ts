import test from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeTelegramHtml,
  formatContactTelegramMessage,
  resolveTelegramContactConfig,
  sendContactTelegramNotification,
} from './contactTelegram.js';

test('escapeTelegramHtml escapes &, <, and > while preserving Unicode text', () => {
  assert.equal(
    escapeTelegramHtml('Abebe & <script>alert("hi")</script> > ሰላም'),
    'Abebe &amp; &lt;script&gt;alert("hi")&lt;/script&gt; &gt; ሰላም'
  );
});

test('formatContactTelegramMessage formats contact details safely', () => {
  const formatted = formatContactTelegramMessage({
    name: 'Mekdes <Founder>',
    email: 'mekdes@example.com',
    phone: '',
    message: 'Need POS & ERP setup > ASAP',
    timestamp: '2026-01-15T12:00:00.000Z',
  });

  assert.match(formatted, /📩 <b>New AFRO-TECH Contact Inquiry<\/b>/);
  assert.match(formatted, /<b>Name:<\/b> Mekdes &lt;Founder&gt;/);
  assert.match(formatted, /<b>Email:<\/b> mekdes@example\.com/);
  assert.match(formatted, /<b>Phone:<\/b> Not provided/);
  assert.match(formatted, /Need POS &amp; ERP setup &gt; ASAP/);
  assert.match(formatted, /<i>Submitted: 2026-01-15T12:00:00\.000Z<\/i>/);
});

test('resolveTelegramContactConfig supports TELEGRAM_CONTACT_CHAT_ID and TELEGRAM_CHAT_ID fallback', () => {
  assert.deepEqual(
    resolveTelegramContactConfig({
      env: {
        TELEGRAM_BOT_TOKEN: ' 123:ABC ',
        TELEGRAM_CONTACT_CHAT_ID: ' -100998877 ',
        TELEGRAM_CHAT_ID: ' 5555 ',
      },
    }),
    { botToken: '123:ABC', chatId: '-100998877' }
  );

  assert.deepEqual(
    resolveTelegramContactConfig({
      env: {
        TELEGRAM_BOT_TOKEN: '123:ABC',
        TELEGRAM_CHAT_ID: '5555',
      },
    }),
    { botToken: '123:ABC', chatId: '5555' }
  );
});

test('sendContactTelegramNotification skips cleanly when token or chatId is missing', async () => {
  const noToken = await sendContactTelegramNotification(
    { name: 'Test', email: 'test@example.com', message: 'Hello' },
    { env: { TELEGRAM_CONTACT_CHAT_ID: '12345' } }
  );
  assert.deepEqual(noToken, { sent: false, reason: 'missing_bot_token' });

  const noChat = await sendContactTelegramNotification(
    { name: 'Test', email: 'test@example.com', message: 'Hello' },
    { env: { TELEGRAM_BOT_TOKEN: '123:ABC' } }
  );
  assert.deepEqual(noChat, { sent: false, reason: 'missing_chat_id' });
});

test('sendContactTelegramNotification posts formatted payload to Telegram Bot API', async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const mockFetch = async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 42 } }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  };

  const result = await sendContactTelegramNotification(
    {
      name: 'Dawit Bekele',
      email: 'dawit@afrotech.et',
      phone: '+251911001122',
      message: 'Interested in hospital module',
      timestamp: '2026-01-15T12:00:00.000Z',
    },
    {
      env: {
        TELEGRAM_BOT_TOKEN: 'bot-token-xyz',
        TELEGRAM_CONTACT_CHAT_ID: '-100123456',
      },
      fetchImpl: mockFetch as typeof fetch,
    }
  );

  assert.deepEqual(result, { sent: true, messageId: 42 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.telegram.org/botbot-token-xyz/sendMessage');
  assert.equal(calls[0].init.method, 'POST');
  const body = JSON.parse(String(calls[0].init.body));
  assert.equal(body.chat_id, '-100123456');
  assert.equal(body.parse_mode, 'HTML');
  assert.equal(body.disable_web_page_preview, true);
  assert.match(body.text, /Dawit Bekele/);
  assert.match(body.text, /\+251911001122/);
  assert.match(body.text, /Interested in hospital module/);
});

test('sendContactTelegramNotification handles Telegram API and network errors without throwing', async () => {
  const apiErrorFetch = async () =>
    new Response(JSON.stringify({ ok: false, description: 'Bad Request: chat not found' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });

  const apiErr = await sendContactTelegramNotification(
    { name: 'Test', email: 'test@example.com', message: 'Hi' },
    {
      botToken: '123:ABC',
      chatId: '999',
      fetchImpl: apiErrorFetch as typeof fetch,
    }
  );
  assert.equal(apiErr.sent, false);
  assert.equal(apiErr.reason, 'telegram_api_error');
  assert.equal(apiErr.error, 'Bad Request: chat not found');

  const throwingFetch = async () => {
    throw new Error('Network unreachable');
  };
  const netErr = await sendContactTelegramNotification(
    { name: 'Test', email: 'test@example.com', message: 'Hi' },
    {
      botToken: '123:ABC',
      chatId: '999',
      fetchImpl: throwingFetch as typeof fetch,
    }
  );
  assert.equal(netErr.sent, false);
  assert.equal(netErr.reason, 'network_error');
  assert.equal(netErr.error, 'Network unreachable');
});
