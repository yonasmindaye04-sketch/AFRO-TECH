import nodemailer from 'nodemailer'
import { pool, query, queryOne } from '../config/db.js'
import { sendMessage as sendSystemTelegramMessage, telegramEnabled } from './telegram.js'

export interface GuardianNoticePayload {
  tenantId: string
  studentId: string
  title: string
  message: string
  channel?: 'email' | 'telegram' | 'both'
  metadata?: Record<string, unknown>
}

export interface SendResult {
  success: boolean
  simulated?: boolean
  error?: string
}

/**
 * Sends an email notice to a student's guardian.
 * Tries Resend API first, then SMTP nodemailer, or simulates safely in dev.
 */
export async function sendGuardianEmail({
  to,
  subject,
  html,
  text,
  studentName,
  guardianName,
  schoolName = 'School Management',
}: {
  to: string
  subject: string
  html?: string
  text?: string
  studentName?: string
  guardianName?: string
  schoolName?: string
}): Promise<SendResult> {
  const safeTo = to.trim()
  if (!safeTo || !safeTo.includes('@')) {
    return { success: false, error: 'Invalid recipient email address' }
  }

  const emailSubject = `[${schoolName}] ${subject}`
  const bodyText = text || subject
  const bodyHtml =
    html ||
    `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px; background-color: #ffffff; color: #1e293b;">
      <div style="border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 20px;">
        <h2 style="color: #1e3a8a; margin: 0; font-size: 20px;">${schoolName}</h2>
        <span style="font-size: 13px; color: #64748b;">Official Guardian Notification</span>
      </div>
      <p style="font-size: 15px; margin-bottom: 8px;">Dear <b>${guardianName || 'Parent / Guardian'}</b>,</p>
      ${studentName ? `<p style="font-size: 14px; color: #475569; margin-top: 0;">Regarding Student: <b>${studentName}</b></p>` : ''}
      <div style="background-color: #f8fafc; border-left: 4px solid #3b82f6; padding: 16px; margin: 20px 0; border-radius: 4px; font-size: 15px; line-height: 1.6; color: #334155;">
        ${bodyText.replace(/\n/g, '<br/>')}
      </div>
      <p style="font-size: 13px; color: #94a3b8; margin-top: 30px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
        This is an automated notification from ${schoolName}. Please contact the school administration office if you have any questions.
      </p>
    </div>
  `

  // 1. Try Resend if configured
  const resendKey = process.env.RESEND_API_KEY
  if (resendKey) {
    try {
      const fromAddress = process.env.RESEND_FROM || 'School Portal <onboarding@resend.dev>'
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromAddress,
          to: [safeTo],
          subject: emailSubject,
          html: bodyHtml,
          text: bodyText,
        }),
      })
      const data = (await res.json()) as { id?: string; message?: string }
      if (res.ok) {
        return { success: true }
      }
      console.warn(`[guardian-email] Resend API error:`, data.message)
    } catch (err) {
      console.warn(`[guardian-email] Resend fetch failed:`, err)
    }
  }

  // 2. Try Nodemailer SMTP if configured
  const smtpUser = process.env.CONTACT_USER
  const smtpPass = process.env.CONTACT_PASS
  if (smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: smtpUser, pass: smtpPass },
      })
      await transporter.sendMail({
        from: `"${schoolName}" <${smtpUser}>`,
        to: safeTo,
        subject: emailSubject,
        text: bodyText,
        html: bodyHtml,
      })
      return { success: true }
    } catch (err) {
      console.warn(`[guardian-email] SMTP transport error:`, err)
    }
  }

  // 3. Fallback / simulated in development
  console.log(`[guardian-email-simulated] To: ${safeTo} | Subject: ${emailSubject}`)
  return { success: true, simulated: true }
}

/**
 * Sends a Telegram message notice to a student's guardian chat ID.
 * Prefers tenant's custom bot if registered, otherwise falls back to system bot.
 */
export async function sendGuardianTelegram({
  chatId,
  message,
  tenantId,
  schoolName = 'School Management',
  studentName,
}: {
  chatId: string | number
  message: string
  tenantId?: string
  schoolName?: string
  studentName?: string
}): Promise<SendResult> {
  const targetChatId = String(chatId).trim()
  if (!targetChatId) {
    return { success: false, error: 'Missing Telegram chat ID' }
  }

  const formattedMessage =
    `🏫 <b>${schoolName}</b>\n` +
    (studentName ? `👤 <i>Student: ${studentName}</i>\n\n` : '\n') +
    `${message}`

  // 1. Check if tenant has their own active bot in tenant_bots
  if (tenantId) {
    try {
      const tenantBot = await queryOne<{ bot_token: string; is_active: boolean }>(
        `SELECT bot_token, is_active FROM tenant_bots WHERE tenant_id = $1 AND is_active = true LIMIT 1`,
        [tenantId]
      )
      if (tenantBot?.bot_token) {
        const res = await fetch(`https://api.telegram.org/bot${tenantBot.bot_token}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: targetChatId,
            text: formattedMessage,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        })
        const json = (await res.json()) as { ok: boolean; description?: string }
        if (json.ok) {
          return { success: true }
        }
        console.warn(`[guardian-telegram] Tenant bot sendMessage failed:`, json.description)
      }
    } catch (err) {
      console.warn(`[guardian-telegram] Tenant bot error:`, err)
    }
  }

  // 2. Fallback to system Telegram bot
  if (telegramEnabled()) {
    try {
      await sendSystemTelegramMessage(targetChatId, formattedMessage)
      return { success: true }
    } catch (err) {
      console.warn(`[guardian-telegram] System bot send failed:`, err)
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  console.log(`[guardian-telegram-simulated] Chat: ${targetChatId} | Message: ${formattedMessage}`)
  return { success: true, simulated: true }
}

/**
 * Record an audit row into guardian_notifications
 */
export async function logGuardianNotification({
  tenantId,
  studentId,
  channel,
  recipient,
  title,
  message,
  status,
  error,
}: {
  tenantId: string
  studentId?: string | null
  channel: 'email' | 'telegram'
  recipient: string
  title: string
  message: string
  status: 'sent' | 'failed' | 'skipped' | 'simulated'
  error?: string | null
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO guardian_notifications (tenant_id, student_id, channel, recipient, title, message, status, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, studentId || null, channel, recipient, title, message, status, error || null]
    )
  } catch (err) {
    console.error(`[guardianNotifier] Failed to log notification:`, err)
  }
}

/**
 * Broadcast an announcement to all matching guardians via Email and/or Telegram
 */
export async function broadcastAnnouncementToGuardians({
  tenantId,
  announcementId,
  title,
  body,
  targetType,
  classId,
  sendEmail,
  sendTelegram,
}: {
  tenantId: string
  announcementId: string
  title: string
  body: string
  targetType: 'all' | 'class' | 'staff'
  classId?: string | null
  sendEmail: boolean
  sendTelegram: boolean
}): Promise<{
  emailSent: number
  emailFailed: number
  telegramSent: number
  telegramFailed: number
  totalTargeted: number
}> {
  if (targetType === 'staff' || (!sendEmail && !sendTelegram)) {
    return { emailSent: 0, emailFailed: 0, telegramSent: 0, telegramFailed: 0, totalTargeted: 0 }
  }

  // Lookup tenant display name
  const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [tenantId])
  const schoolName = tenant?.name || 'School'

  // Fetch eligible students
  let queryStr = `
    SELECT s.id, s.code, s.first_name, s.last_name, s.guardian_name, s.guardian_email, s.guardian_telegram_chat_id, c.name AS class_name
    FROM students s
    LEFT JOIN classes c ON c.id = s.class_id
    WHERE s.tenant_id = $1 AND s.status = 'active'
  `
  const params: unknown[] = [tenantId]

  if (targetType === 'class' && classId) {
    params.push(classId)
    queryStr += ` AND s.class_id = $2`
  }

  const students = await query<{
    id: string
    code: string
    first_name: string
    last_name: string
    guardian_name: string | null
    guardian_email: string | null
    guardian_telegram_chat_id: string | null
    class_name: string | null
  }>(queryStr, params)

  let emailSent = 0
  let emailFailed = 0
  let telegramSent = 0
  let telegramFailed = 0

  for (const s of students) {
    const studentFullName = `${s.first_name} ${s.last_name}`.trim()

    // 1. Send Email if requested and available
    if (sendEmail && s.guardian_email) {
      const emailRes = await sendGuardianEmail({
        to: s.guardian_email,
        subject: title,
        text: body,
        studentName: studentFullName,
        guardianName: s.guardian_name || undefined,
        schoolName,
      })
      if (emailRes.success) {
        emailSent++
        await logGuardianNotification({
          tenantId,
          studentId: s.id,
          channel: 'email',
          recipient: s.guardian_email,
          title,
          message: body,
          status: emailRes.simulated ? 'simulated' : 'sent',
        })
      } else {
        emailFailed++
        await logGuardianNotification({
          tenantId,
          studentId: s.id,
          channel: 'email',
          recipient: s.guardian_email,
          title,
          message: body,
          status: 'failed',
          error: emailRes.error,
        })
      }
    }

    // 2. Send Telegram if requested and available
    if (sendTelegram && s.guardian_telegram_chat_id) {
      const tgRes = await sendGuardianTelegram({
        chatId: s.guardian_telegram_chat_id,
        message: `📢 <b>${title}</b>\n\n${body}`,
        tenantId,
        schoolName,
        studentName: studentFullName,
      })
      if (tgRes.success) {
        telegramSent++
        await logGuardianNotification({
          tenantId,
          studentId: s.id,
          channel: 'telegram',
          recipient: s.guardian_telegram_chat_id,
          title,
          message: body,
          status: tgRes.simulated ? 'simulated' : 'sent',
        })
      } else {
        telegramFailed++
        await logGuardianNotification({
          tenantId,
          studentId: s.id,
          channel: 'telegram',
          recipient: s.guardian_telegram_chat_id,
          title,
          message: body,
          status: 'failed',
          error: tgRes.error,
        })
      }
    }
  }

  // Update announcement with delivery statistics
  const stats = {
    totalTargeted: students.length,
    emailSent,
    emailFailed,
    telegramSent,
    telegramFailed,
    completedAt: new Date().toISOString(),
  }

  await pool.query(
    `UPDATE announcements
     SET sent_email = $1, sent_telegram = $2, delivery_stats = $3
     WHERE id = $4 AND tenant_id = $5`,
    [sendEmail, sendTelegram, JSON.stringify(stats), announcementId, tenantId]
  )

  return {
    emailSent,
    emailFailed,
    telegramSent,
    telegramFailed,
    totalTargeted: students.length,
  }
}

/**
 * Send a direct 1-on-1 notice to a student's guardian
 */
export async function notifySingleGuardian({
  tenantId,
  studentId,
  title,
  message,
  channel = 'both',
}: GuardianNoticePayload): Promise<{
  emailStatus?: 'sent' | 'failed' | 'not_configured' | 'simulated'
  telegramStatus?: 'sent' | 'failed' | 'not_configured' | 'simulated'
  studentName: string
  guardianName: string | null
}> {
  const student = await queryOne<{
    id: string
    code: string
    first_name: string
    last_name: string
    guardian_name: string | null
    guardian_email: string | null
    guardian_telegram_chat_id: string | null
  }>(`SELECT id, code, first_name, last_name, guardian_name, guardian_email, guardian_telegram_chat_id FROM students WHERE id = $1 AND tenant_id = $2`, [
    studentId,
    tenantId,
  ])

  if (!student) {
    throw new Error('Student not found')
  }

  const tenant = await queryOne<{ name: string }>(`SELECT name FROM tenants WHERE id = $1`, [tenantId])
  const schoolName = tenant?.name || 'School'
  const studentFullName = `${student.first_name} ${student.last_name}`.trim()

  let emailStatus: 'sent' | 'failed' | 'not_configured' | 'simulated' | undefined
  let telegramStatus: 'sent' | 'failed' | 'not_configured' | 'simulated' | undefined

  if (channel === 'email' || channel === 'both') {
    if (student.guardian_email) {
      const res = await sendGuardianEmail({
        to: student.guardian_email,
        subject: title,
        text: message,
        studentName: studentFullName,
        guardianName: student.guardian_name || undefined,
        schoolName,
      })
      emailStatus = res.success ? (res.simulated ? 'simulated' : 'sent') : 'failed'
      await logGuardianNotification({
        tenantId,
        studentId: student.id,
        channel: 'email',
        recipient: student.guardian_email,
        title,
        message,
        status: emailStatus,
        error: res.error,
      })
    } else {
      emailStatus = 'not_configured'
    }
  }

  if (channel === 'telegram' || channel === 'both') {
    if (student.guardian_telegram_chat_id) {
      const res = await sendGuardianTelegram({
        chatId: student.guardian_telegram_chat_id,
        message: `📌 <b>${title}</b>\n\n${message}`,
        tenantId,
        schoolName,
        studentName: studentFullName,
      })
      telegramStatus = res.success ? (res.simulated ? 'simulated' : 'sent') : 'failed'
      await logGuardianNotification({
        tenantId,
        studentId: student.id,
        channel: 'telegram',
        recipient: student.guardian_telegram_chat_id,
        title,
        message,
        status: telegramStatus,
        error: res.error,
      })
    } else {
      telegramStatus = 'not_configured'
    }
  }

  return {
    emailStatus,
    telegramStatus,
    studentName: studentFullName,
    guardianName: student.guardian_name,
  }
}
