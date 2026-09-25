import nodemailer from 'nodemailer';

/* ── Allowed origins for browser calls (same-origin in production, Vite dev server locally) ── */
const ALLOWED_ORIGINS = new Set([
  'https://afro-tech-et.vercel.app',
  // Legacy alias of the same site (kept so the contact form doesn't break there)
  'https://afro-tech-liard.vercel.app',
  'http://localhost:5173',
  'http://localhost:4173',
]);

/** Escape user input before embedding it in HTML email templates. */
const escapeHtml = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export default async function handler(req, res) {
  // CORS: only known origins may call this endpoint from a browser.
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight request
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ message: 'Method Not Allowed' });
  }

  // Environment variables
  const EMAIL = (process.env.EMAIL || '').trim();
  const EMAIL_PASS = (process.env.EMAIL_PASS || '').replace(/\s+/g, '');

  if (!EMAIL || !EMAIL_PASS) {
    return res.status(500).json({ success: false, message: 'Server email configuration is missing.' });
  }

  const { name, email, phone, message } = req.body ?? {};

  if (!name?.trim() || !email?.trim() || !message?.trim()) {
    return res.status(400).json({ success: false, message: 'Name, email and message are required.' });
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, message: 'Invalid email address.' });
  }

  // Sanitize before embedding into the HTML templates below
  const safeName = escapeHtml(name.trim());
  const safeEmail = escapeHtml(email.trim());
  const safePhone = escapeHtml(phone?.trim() || 'Not provided');
  const safeMessage = escapeHtml(message.trim()).replace(/\n/g, '<br>');
  const firstName = escapeHtml(name.trim().split(' ')[0]);
  // Plain-text (header) variant — never allow header injection via CR/LF
  const plainFirstName = name.trim().split(' ')[0].replace(/[\r\n]+/g, ' ').slice(0, 80);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: EMAIL, pass: EMAIL_PASS },
  });

  try {
    /* — notification to you — */
    await transporter.sendMail({
      from: `"AFRO-TECH" <${EMAIL}>`,
      to: EMAIL,
      replyTo: email,
      subject: `New Inquiry from ${plainFirstName}`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#09090b;color:#f4f0e8;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#d4a853,#e8c06a);padding:28px 32px;">
            <h2 style="margin:0;color:#09090b;">New Project Inquiry</h2>
            <p style="margin:4px 0 0;color:#09090b;opacity:.7;font-size:.88rem;">via AFRO-TECH contact form</p>
          </div>
          <div style="padding:32px;">
            <table style="width:100%;border-collapse:collapse;">
              <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);color:#94a3b8;font-size:.85rem;width:100px;">Name</td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);font-weight:600;">${safeName}</td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);color:#94a3b8;font-size:.85rem;">Email</td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);"><a href="mailto:${safeEmail}" style="color:#d4a853;">${safeEmail}</a></td></tr>
              <tr><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);color:#94a3b8;font-size:.85rem;">Phone</td><td style="padding:10px 0;border-bottom:1px solid rgba(255,255,255,.08);">${safePhone}</td></tr>
              <tr><td style="padding:14px 0;color:#94a3b8;font-size:.85rem;vertical-align:top;">Message</td><td style="padding:14px 0;line-height:1.65;">${safeMessage}</td></tr>
            </table>
            <a href="mailto:${safeEmail}" style="display:inline-block;margin-top:22px;background:#d4a853;color:#09090b;padding:12px 26px;border-radius:50px;text-decoration:none;font-weight:700;font-size:.9rem;">Reply to ${safeName}</a>
          </div>
        </div>`,
    });

    /* — auto-reply to client — */
    await transporter.sendMail({
      from: `"AFRO-TECH" <${EMAIL}>`,
      to: email,
      subject: `We got your message, ${plainFirstName}!`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#09090b;color:#f4f0e8;border-radius:12px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#d4a853,#e8c06a);padding:28px 32px;">
            <h2 style="margin:0;color:#09090b;">Thanks for reaching out!</h2>
          </div>
          <div style="padding:32px;line-height:1.7;">
            <p>Hi <strong>${firstName}</strong>,</p>
            <p style="margin-top:14px;">We've received your message and will reply within <strong>24 hours</strong> with a detailed proposal.</p>
            <p style="margin-top:20px;color:#94a3b8;font-size:.9rem;">You can also reach us directly:</p>
            <ul style="margin-top:8px;padding-left:18px;color:#94a3b8;font-size:.9rem;line-height:2;">
              <li>Telegram: <a href="https://t.me/yona64" style="color:#29b6f6;">@yona64</a></li>
              <li>WhatsApp: <a href="https://wa.me/251910011818" style="color:#25d366;">+251-910011818</a></li>
            </ul>
            <p style="margin-top:28px;color:#6b7280;font-size:.85rem;">— The AFRO-TECH Team</p>
          </div>
        </div>`,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Send error:', err.message);
    return res.status(500).json({ success: false, message: 'Email failed. Please contact us directly on Telegram.' });
  }
}
