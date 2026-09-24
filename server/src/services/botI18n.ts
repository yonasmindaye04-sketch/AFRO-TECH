/**
 * Tenant-bot i18n (ported from the yekis project's bot locale layer,
 * apps/backend/src/modules/bot/locales, adapted to a plain dictionary
 * instead of Grammy middleware).
 *
 * Covers the tenant bot's system copy (menus, confirmations, prompts).
 * Owner-authored content (welcome message, custom command responses) is
 * intentionally NOT translated — the owner writes it in their own language.
 */

export type BotLang = 'en' | 'am'

export function isBotLang(v: unknown): v is BotLang {
  return v === 'en' || v === 'am'
}

const STRINGS = {
  en: {
    // menu + buttons
    menu_title: 'What can I help you with?',
    btn_today: "Today's summary",
    btn_lowstock: 'Low stock',
    btn_expiring: 'Expiring soon',
    btn_shift: 'My shift',
    btn_child: 'My children',
    btn_fees: 'Fee status',
    btn_language: 'Language / ቋንቋ',
    btn_receipt: 'Submit payment receipt',
    btn_open_app: 'Open workspace app',
    btn_cancel: 'Cancel',
    btn_english: 'English',
    btn_amharic: 'አማርኛ',

    // language
    lang_prompt: 'Choose your language / ቋንቋ ይምረጡ:',
    lang_saved_am: 'ቋንቋ ወደ አማርኛ ተቀይሯል። ዋና ሜኑን ለማየት /menu ይላኩ።',
    lang_saved_en: 'Language switched to English. Send /menu anytime.',

    // generic
    unknown_command: "Unknown command. Send /menu to see what I can do.",
    staff_only_prefix: 'This command is for staff of',
    staff_only_suffix: 'Send /link CODE to link your work account.',
    link_prompt: 'To link your account, send: /link CODE\n\nGenerate your 6-character code in your web app under Settings → Telegram.',
    link_invalid: 'That code is invalid or expired. Please generate a fresh one in Settings → Telegram.',
    link_wrong_workspace: 'This link code belongs to another workspace.',
    linked_welcome: 'Welcome aboard! Your account is now connected.',
    try_commands: 'Send /menu to see your options, or tap the menu button to open the app.',
    unlinked_staff_notice: 'Are you a staff member? Open Settings → Telegram in the app to generate a code, then send /link CODE here.',
    not_linked: "This chat isn't linked yet. Send /start to see how to link your staff or parent account.",
    unlinked_done: 'Unlinked. You will no longer receive staff alerts here.',
    subscribed: 'You are subscribed to updates!',
    unsubscribed: 'You have unsubscribed. Send /start any time to rejoin.',

    // receipts
    receipt_ask: 'Please send a photo of your payment receipt now (Telebirr / CBE Birr / bank transfer).',
    receipt_received: 'Thank you! Your receipt has been received — our team will review it shortly.',
    receipt_confirmed: 'Good news! Your payment receipt has been confirmed. Thank you!',
    receipt_rejected: 'Your payment receipt could not be verified. Please check with the office or send a clearer photo.',
    action_cancelled: 'Cancelled. Send /menu to start over.',

    // parent flows
    parent_prompt: "Please provide your child's student code.\nExample: /parent STU-00001\n\n(Ask the school administration if you don't have it.)",
    parent_not_found: 'No active student found with that code. Please check the code and try again.',
    parent_linked: 'Successfully linked as guardian! School announcements and fee updates will arrive in this chat.',
    no_students_linked: 'No students are linked to this chat yet. Send /parent STUDENT_CODE to link your child.',
    no_fees: 'No fee records found for your linked student(s).',

    // staff/parent result labels
    today_appointments: 'appointments scheduled today',
    today_attendance: 'attendance entries recorded today',
    todays_sales: "Today's sales",
    receipts_count: 'Receipts',
    all_stock_ok: 'All inventory levels look healthy — nothing to reorder.',
    low_stock_title: 'Low stock items',
    items_left: 'left',
    min: 'min',
    nothing_expiring: 'No products expiring within the next 60 days.',
    expiring_title: 'Expiring within 60 days',
    units: 'units',
    expires: 'expires',
    no_open_shift: 'No open drawer shift found for you. Start a shift from the Cash Drawer page.',
    open_shift: 'Open shift',
    cash_sales: 'Cash sales',
    expenses: 'Expenses',
    expected_in_drawer: 'Expected in drawer',
    total: 'Total',
    paid: 'Paid',
    status: 'Status',
    due: 'Due',
    class: 'Class',
  },
  am: {
    menu_title: 'ምን ልረዳዎት?',
    btn_today: 'የዛሬ ማጠቃለያ',
    btn_lowstock: 'ዝቅተኛ ክምችት',
    btn_expiring: 'ቀጠሮ የሚያልቁ ምርቶች',
    btn_shift: 'የእኔ ሺፍት',
    btn_child: 'ልጆቼ',
    btn_fees: 'የክፍያ ሁኔታ',
    btn_language: 'ቋንቋ / English',
    btn_receipt: 'የክፍያ ደረሰኝ ላክ',
    btn_open_app: 'መተግበሪያን ክፈት',
    btn_cancel: 'ሰርዝ',
    btn_english: 'English',
    btn_amharic: 'አማርኛ',

    lang_prompt: 'ቋንቋ ይምረጡ / Choose your language:',
    lang_saved_am: 'ቋንቋ ወደ አማርኛ ተቀይሯል። ዋና ሜኑን ለማየት /menu ይላኩ።',
    lang_saved_en: 'Language switched to English. Send /menu anytime.',

    unknown_command: 'ያልታወቀ ትእዛዝ። ምን ማድረግ እንደምችል ለማየት /menu ይላኩ።',
    staff_only_prefix: 'ይህ ትእዛዝ የ',
    staff_only_suffix: 'ሰራተኞች ብቻ ነው። የስራ መለያዎትን ለማገናኘት /link CODE ይላኩ።',
    link_prompt: 'መለያዎን ለማገናኘት /link CODE ይላኩ።\n\n6-ፊደል ኮዱን ከመተግበሪያው ቅንብሮች → Telegram ይፍጠሩ።',
    link_invalid: 'ኮዱ ልክ አይደለም ወይም ጊዜው አልፎበታል። እባክዎ ከቅንብሮች → Telegram አዲስ ኮድ ይፍጠሩ።',
    link_wrong_workspace: 'ይህ ኮድ ለሌላ ድርጅት ነው።',
    linked_welcome: 'እንኳን ደህና መጡ! መለያዎ ተገናኝቷል።',
    try_commands: 'የሚገኙ አማራጮችን ለማየት /menu ይላኩ፣ ወይም ከታች ያለውን ማውጫ ቁልፍ ይጫኑ።',
    unlinked_staff_notice: 'ሰራተኛ ከሆኑ፣ ከመተግበሪያው ቅንብሮች → Telegram ኮድ ይፍጠሩና እዚህ /link CODE ይላኩ።',
    not_linked: 'ይህ ቻት እስካሁን አልተገናኘም። እንዴት ማገናኝት እንደሚችሉ ለማየት /start ይላኩ።',
    unlinked_done: 'ግንኙነቱ ተቋርጧል። ከአሁን በኋላ የሰራተኛ ማስታወቂያዎችን አታገኛላችሁ።',
    subscribed: 'ለዝማኔዎች ተመዝግበዋል!',
    unsubscribed: 'ምዝገባ ተቋርጧል። እንደገና ለመመዝገብ /start ይላኩ።',

    receipt_ask: 'እባክዎ አሁን የክፍያ ደረሰኝዎን ፎቶ ይላኩ (ቴሌብር / ሲቢኢ ብር / የባንክ ማስተላለፊያ)።',
    receipt_received: 'እናመሰግናለን! ደረሰኝዎ ደርሷል — ቡድናችን በቅርቡ ያረጋግገዋል።',
    receipt_confirmed: 'እንኳን ደስ አለዎት! የክፍያ ደረሰኝዎ ተረጋግጧል። እናመሰግናለን!',
    receipt_rejected: 'ደረሰኝዎ መረጋገጥ አልቻለም። እባክዎ ከቢሮው ጋር ይነጋገሩ ወይም ግልጽ ፎቶ እንደገና ይላኩ።',
    action_cancelled: 'ተሰርዟል። እንደገና ለመጀመር /menu ይላኩ።',

    parent_prompt: 'የልጅዎን የተማሪ ኮድ ይፃፉ።\nምሳሌ፦ /parent STU-00001\n\n(ኮዱን ከትምህርት ቤት አስተዳደር ማግኘት ይችላሉ።)',
    parent_not_found: 'በዚህ ኮድ ንቁ ተማሪ አልተገኘም። እባክዎ ኮዱን አረጋግተው እንደገና ይሞክሩ።',
    parent_linked: 'እንደ አሳዳጊ በተሳካ ሁኔታ ተገናኝተዋል! የትምህርት ቤት መግለጫዎች እና የክፍያ ዝማኔዎች በዚህ ውይይት ይደርሳሉ።',
    no_students_linked: 'እስካሁን ምንም ተማሪ አልተገናኘም። ለማገናኘት /parent STUDENT_CODE ይላኩ።',
    no_fees: 'ለተገናኘው ልጅዎ ምንም የክፍያ መዝገብ የለም።',

    today_appointments: 'የዛሬ ቀጠሮዎች',
    today_attendance: 'የዛሬ የአቴንዳንስ መዝገቦች',
    todays_sales: 'የዛሬ ሽያጮች',
    receipts_count: 'ደረሰኞች',
    all_stock_ok: 'የክምት መጠኖች ጤናማ ናቸው — የሚጠየቅ ምንም የለም።',
    low_stock_title: 'ዝቅተኛ ክምችት ያላቸው እቃዎች',
    items_left: 'ቀርተዋል',
    min: 'ዝቅተኛ',
    nothing_expiring: 'በቀጣዩ 60 ቀናት ውስጥ ማብቂያ የሚያርቅ ምርት የለም።',
    expiring_title: 'በ60 ቀናት ውስጥ የሚያልቁ',
    units: 'ቁጥር',
    expires: 'ማብቂያ',
    no_open_shift: 'ክፍት ሺፍት የለዎትም። ከገንዘብ መዝገብ ገፅ ሺፍት ይጀምሩ።',
    open_shift: 'ክፍት ሺፍት',
    cash_sales: 'የገንዘብ ሽያጭ',
    expenses: 'ወጪዎች',
    expected_in_drawer: 'በመዝገብ ውስጥ መጠበቅ ያለው',
    total: 'ጠቅላላ',
    paid: 'ተከፍያል',
    status: 'ሁኔታ',
    due: 'መክፈያ ቀን',
    class: 'ክፍል',
  },
} as const

export type BotTextKey = keyof (typeof STRINGS)['en']

/** Translate a tenant-bot string. Falls back to English for unknown codes. */
export function bt(lang: BotLang | null | undefined, key: BotTextKey): string {
  if (lang === 'am') return STRINGS.am[key]
  return STRINGS.en[key]
}
