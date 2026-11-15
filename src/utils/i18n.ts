export type LanguageCode = 'en' | 'am' | 'om' | 'ti';

export interface LanguageOption {
  code: LanguageCode;
  shortLabel: string;
  nativeLabel: string;
  englishName: string;
}

export const LANGUAGES: readonly LanguageOption[] = [
  { code: 'en', shortLabel: 'EN', nativeLabel: 'English', englishName: 'English' },
  { code: 'am', shortLabel: 'አማ', nativeLabel: 'አማርኛ', englishName: 'Amharic' },
  { code: 'om', shortLabel: 'OM', nativeLabel: 'Afaan Oromoo', englishName: 'Oromifa' },
  { code: 'ti', shortLabel: 'ትግ', nativeLabel: 'ትግርኛ', englishName: 'Tigrigna' },
] as const;

const EN_STRINGS = {
  // Navigation
  'nav.home': 'Home',
  'nav.showcase': 'Showcase',
  'nav.process': 'Process',
  'nav.about': 'About',
  'nav.reviews': 'Reviews',
  'nav.contact': 'Contact',
  'nav.services': 'Services',
  'nav.products': 'Products',
  'nav.languageLabel': 'Select website language',

  // Hero
  'hero.titleLine1': 'We build digital systems',
  'hero.titleLine2': 'that run your business.',
  'hero.sub':
    'Based in Addis Ababa. From websites to full ERP platforms — we design and build the tools that help Ethiopian businesses grow, automate, and compete.',
  'hero.ctaStart': 'Start a Project',
  'hero.ctaWork': 'See Our Work',

  // Showcase
  'showcase.title': "What we've built",
  'showcase.monthlyOverview': 'Monthly Overview',
  'showcase.recentActivity': 'Recent Activity',
  'showcase.ctaLaunch': 'Launch Live ERP Demo',
  'showcase.ctaCompare': 'Compare All Systems',

  // What We Do
  'whatWeDo.title': 'What We Do',
  'whatWeDo.intro': 'We design, build, and launch digital systems — from marketing sites to full enterprise platforms.',
  'whatWeDo.0.title': 'Websites & Web Apps',
  'whatWeDo.0.desc': 'Landing pages, portfolios, corporate sites, blogs, and e-commerce platforms.',
  'whatWeDo.1.title': 'Business Systems',
  'whatWeDo.1.desc': 'ERP, HR & Payroll, POS, Inventory, School Management, and Hotel PMS.',
  'whatWeDo.2.title': 'Mobile & Full Platforms',
  'whatWeDo.2.desc': 'iOS & Android apps, custom dashboards, and end-to-end digital platforms.',
  'whatWeDo.ctaAll': 'View All Services & Pricing',

  // Process
  'process.title': 'Our Process',
  'process.0.title': 'Discovery Call',
  'process.0.desc': 'We start with a free call to understand your goals, your customers, and what success looks like for you.',
  'process.1.title': 'Design & Prototype',
  'process.1.desc': 'We craft wireframes and a visual prototype for your approval before writing a single line of code.',
  'process.2.title': 'Development',
  'process.2.desc': 'We build your project with clean, fast, secure and scalable code.',
  'process.3.title': 'Launch & Support',
  'process.3.desc': 'We launch it, show you how it works, and stick around.',

  // Why Us
  'whyus.title': "We're not a template shop.",
  'whyus.0.title': 'Fast Delivery',
  'whyus.0.desc': 'Most projects delivered in 2–6 weeks with daily progress updates.',
  'whyus.1.title': 'Secure by default',
  'whyus.1.desc': 'SSL, security hardening, and backups on every project.',
  'whyus.2.title': 'Honest pricing',
  'whyus.2.desc': 'Fixed quotes. No hidden fees, ever.',
  'whyus.3.title': 'Growth focused',
  'whyus.3.desc': 'We build for performance, SEO and conversions — not just looks.',
  'whyus.4.title': 'Custom design',
  'whyus.4.desc': 'No templates. Every project is designed uniquely for your brand.',
  'whyus.5.title': 'We stick around',
  'whyus.5.desc': "Dedicated support channel after launch — we don't disappear.",

  // About
  'about.title': 'About Us',
  'about.quote':
    "We're a small studio from Addis Ababa. We've been building websites since 2020 — not because it's trending, but because we believe Ethiopian businesses deserve quality digital tools, not rushed templates.",
  'about.meta': 'With years of expertise, we build high-performance websites and apps that help businesses grow locally and globally.',

  // Reviews
  'reviews.title': 'What Our Clients Say',

  // Contact
  'contact.title': "Let's talk.",
  'contact.sub': 'We reply within 24 hours — usually faster.',
  'contact.phone': 'Phone',
  'contact.whatsapp': 'WhatsApp',
  'contact.telegram': 'Telegram',
  'contact.email': 'Email',
  'contact.location': 'Location',
  'contact.locationVal': 'Addis Ababa, Ethiopia',
  'contact.nameLabel': 'Full Name',
  'contact.emailLabel': 'Email',
  'contact.phoneLabel': 'Phone Number',
  'contact.optional': '(optional)',
  'contact.messageLabel': 'What are you building?',
  'contact.messagePlaceholder': 'Tell us about your project, goals, and timeline...',
  'contact.submit': 'Send Message',
  'contact.sending': 'Sending…',
  'contact.readyToSend': 'Ready to send',
  'contact.looksGood': 'Looks good',
  'contact.validEmail': 'Valid email format',

  // Footer
  'footer.copy': '© 2026 · Made in Addis Ababa',

  // Products page
  'products.eyebrow': 'AFRO Suite · Enterprise ERP & Sector Systems',
  'products.titleStart': "Don't just see our work — ",
  'products.titleHighlight': 'run your business',
  'products.titleEnd': ' on it today',
  'products.sub':
    'Powered by double-entry accounting, multi-warehouse stock ledgers, CRM pipelines, and sector-specific workflows. Free for 45 days, or explore the pre-seeded workspace right now.',
  'products.openDemo': 'Open Live Demo',
  'products.startTrial': 'Start 45-day Free Trial',
  'products.signIn': 'Company Sign in',
  'products.startFree': 'Start Free',
  'products.liveDemo': 'Live Demo',
  'products.howTitle': 'How AFRO Suite works',
  'products.how0.title': 'Launch instantly',
  'products.how0.desc': 'Explore the live demo workspace with sample ERP data or create your own company in 30 seconds.',
  'products.how1.title': 'Connect operations & books',
  'products.how1.desc': 'Every sale, purchase, work order, clinic bill, and tuition fee posts straight to your General Ledger.',
  'products.how2.title': 'Scale on your terms',
  'products.how2.desc': 'Add branches, warehouses, Telegram bots, and team roles cleanly in one isolated tenant workspace.',
  'products.sys.pharmacy.name': 'Pharmacy Management',
  'products.sys.pharmacy.tagline': 'Run your pharmacy like a chain — with ERP-grade accounting & stock.',
  'products.sys.store.name': 'Store & Manufacturing ERP',
  'products.sys.store.tagline': 'Commerce, BOM production, warehouses, and accounting in one place.',
  'products.sys.hospital.name': 'Hospital / Clinic Management',
  'products.sys.hospital.tagline': 'From reception triage to EMR charting and instant billing.',
  'products.sys.school.name': 'School Management',
  'products.sys.school.tagline': 'Enrollment, timetable, teaching monitor, and accounting.',

  // Services page
  'servicesPage.backHome': 'Back to Home',
  'servicesPage.title': 'Services & Pricing',
  'servicesPage.sub': 'From simple landing pages to full enterprise platforms — transparent pricing, no hidden fees.',
  'servicesPage.all': 'All',
  'servicesPage.getQuote': 'Get a Quote',
  'servicesPage.allInclude': 'All projects include:',
  'servicesPage.whatsIncluded': "What's Included",
  'servicesPage.feature': 'Feature',
  'servicesPage.readyTitle': 'Ready to start?',
  'servicesPage.readySub': "Tell us about your project and we'll send you a detailed proposal within 24 hours.",
  'servicesPage.whatsappUs': 'WhatsApp Us',
} as const;

export type TranslationKey = keyof typeof EN_STRINGS;

const AM_STRINGS: Record<TranslationKey, string> = {
  // Navigation
  'nav.home': 'መነሻ',
  'nav.showcase': 'ስራዎቻችን',
  'nav.process': 'አሰራራችን',
  'nav.about': 'ስለ እኛ',
  'nav.reviews': 'አስተያየቶች',
  'nav.contact': 'ያግኙን',
  'nav.services': 'አገልግሎቶች',
  'nav.products': 'ሲስተሞች',
  'nav.languageLabel': 'የድረ-ገጹን ቋንቋ ይምረጡ',

  // Hero
  'hero.titleLine1': 'ንግድዎን የሚያንቀሳቅሱ',
  'hero.titleLine2': 'ዲጂታል ሲስተሞችን እንገነባለን።',
  'hero.sub':
    'መቀመጫችን አዲስ አበባ ነው። ከድረ-ገጽ እስከ ሙሉ ERP ሲስተሞች — የኢትዮጵያ ንግዶች እንዲያድጉ፣ ስራቸውን እንዲያቀላጥፉ እና እንዲወዳደሩ እንረዳለን።',
  'hero.ctaStart': 'ፕሮጀክት ይጀምሩ',
  'hero.ctaWork': 'ስራዎቻችንን ይመልከቱ',

  // Showcase
  'showcase.title': 'የገነባናቸው ስራዎች',
  'showcase.monthlyOverview': 'ወርሃዊ እይታ',
  'showcase.recentActivity': 'የቅርብ ጊዜ እንቅስቃሴ',
  'showcase.ctaLaunch': 'ቀጥታ ERP ዴሞ ይክፈቱ',
  'showcase.ctaCompare': 'ሁሉንም ሲስተሞች ያወዳድሩ',

  // What We Do
  'whatWeDo.title': 'የምንሰራው',
  'whatWeDo.intro': 'ከማርኬቲንግ ድረ-ገጾች እስከ ሙሉ የድርጅት ሲስተሞች ድረስ ዲጂታል መፍትሄዎችን እንቀርጻለን እና እንገነባለን።',
  'whatWeDo.0.title': 'ድረ-ገጾች እና የዌብ አፖች',
  'whatWeDo.0.desc': 'ላንዲንግ ፔጆች፣ ፖርትፎሊዮዎች፣ የድርጅት ድረ-ገጾች፣ ብሎጎች እና የኢ-ኮሜርስ መድረኮች።',
  'whatWeDo.1.title': 'የቢዝነስ ሲስተሞች',
  'whatWeDo.1.desc': 'ERP፣ የሰራተኛና ደመወዝ (HR & Payroll)፣ POS፣ ንብረት አስተዳደር፣ የትምህርት ቤት እና የሆቴል ሲስተሞች።',
  'whatWeDo.2.title': 'ሞባይል እና ሙሉ መድረኮች',
  'whatWeDo.2.desc': 'የ iOS እና Android አፖች፣ ብጁ ዳሽቦርዶች እና ሙሉ ዲጂታል ሲስተሞች።',
  'whatWeDo.ctaAll': 'ሁሉንም አገልግሎቶችና ዋጋ ይመልከቱ',

  // Process
  'process.title': 'የአሰራር ሂደታችን',
  'process.0.title': 'የመጀመሪያ ውይይት',
  'process.0.desc': 'ግቦችዎን፣ ደንበኞችዎን እና የሚፈልጉትን ውጤት ለመረዳት በነጻ የምክክር ጥሪ እንጀምራለን።',
  'process.1.title': 'ዲዛይን እና ፕሮቶታይፕ',
  'process.1.desc': 'ኮድ ከመጻፋችን በፊት ለእይታዎ እና ለፈቃድዎ ዲዛይን እና ፕሮቶታይፕ እናዘጋጃለን።',
  'process.2.title': 'ግንባታ (Development)',
  'process.2.desc': 'ፕሮጀክትዎን በንጹህ፣ ፈጣን፣ ደህንነቱ የተጠበቀ እና ሊያድግ በሚችል ኮድ እንገነባለን።',
  'process.3.title': 'ማስጀመር እና ድጋፍ',
  'process.3.desc': 'ሲስተሙን እናስጀምራለን፣ አጠቃቀሙን እናሳያለን፣ እና ከጎንዎ እንቆማለን።',

  // Why Us
  'whyus.title': 'ዝግጁ ቴምፕሌት አንሸጥም።',
  'whyus.0.title': 'ፈጣን አቅርቦት',
  'whyus.0.desc': 'አብዛኛዎቹ ፕሮጀክቶች በየቀኑ ሪፖርት በ2–6 ሳምንታት ይጠናቀቃሉ።',
  'whyus.1.title': 'በነባሪ ደህንነቱ የተጠበቀ',
  'whyus.1.desc': 'በእያንዳንዱ ፕሮጀክት SSL፣ የደህንነት ጥበቃ እና ባክአፕ ይካተታል።',
  'whyus.2.title': 'ግልጽ ዋጋ',
  'whyus.2.desc': 'የተወሰነ ዋጋ። ምንም የተደበቀ ክፍያ የለም።',
  'whyus.3.title': 'ለእድገት የተገነባ',
  'whyus.3.desc': 'ለፍጥነት፣ ለSEO እና ለሽያጭ ውጤታማነት እንገነባለን።',
  'whyus.4.title': 'ብጁ ዲዛይን',
  'whyus.4.desc': 'ቴምፕሌት የለም። እያንዳንዱ ፕሮጀክት ለእርስዎ ብራንድ ብቻ ይቀረጻል።',
  'whyus.5.title': 'ሁሌም ከጎንዎ ነን',
  'whyus.5.desc': 'ከተመረቀ በኋላ ቀጣይነት ያለው የድጋፍ መስመር አለን።',

  // About
  'about.title': 'ስለ እኛ',
  'about.quote':
    'ከ2012 ዓ.ም (2020) ጀምሮ በአዲስ አበባ ውስጥ ዲጂታል ስራዎችን የምንሰራ ስቱዲዮ ነን — የኢትዮጵያ ንግዶች ከቸኮሉ ቴምፕሌቶች ይልቅ ጥራት ያለው ዲጂታል መሳሪያ ይገባቸዋል ብለን ስለምናምን ነው።',
  'about.meta': 'በዓመታት ልምድ፣ ንግዶች በሀገር ውስጥና በዓለም አቀፍ ደረጃ እንዲያድጉ የሚያግዙ ፈጣን ድረ-ገጾችንና ሲስተሞችን እንገነባለን።',

  // Reviews
  'reviews.title': 'ደንበኞቻችን ምን ይላሉ',

  // Contact
  'contact.title': 'እንነጋገር።',
  'contact.sub': 'በ24 ሰዓታት ውስጥ መልስ እንሰጣለን — ብዙውን ጊዜ በፍጥነት።',
  'contact.phone': 'ስልክ',
  'contact.whatsapp': 'ዋትስአፕ',
  'contact.telegram': 'ቴሌግራም',
  'contact.email': 'ኢሜይል',
  'contact.location': 'አድራሻ',
  'contact.locationVal': 'አዲስ አበባ፣ ኢትዮጵያ',
  'contact.nameLabel': 'ሙሉ ስም',
  'contact.emailLabel': 'ኢሜይል',
  'contact.phoneLabel': 'ስልክ ቁጥር',
  'contact.optional': '(አማራጭ)',
  'contact.messageLabel': 'ምን ማሰራት ይፈልጋሉ?',
  'contact.messagePlaceholder': 'ስለ ፕሮጀክትዎ፣ ግብዎ እና የጊዜ ሰሌዳዎ ይንገሩን...',
  'contact.submit': 'መልእክት ላክ',
  'contact.sending': 'በመላክ ላይ…',
  'contact.readyToSend': 'ለመላክ ዝግጁ ነው',
  'contact.looksGood': 'ጥሩ ነው',
  'contact.validEmail': 'ትክክለኛ የኢሜይል ቅርጽ',

  // Footer
  'footer.copy': '© 2026 · አዲስ አበባ የተሰራ',

  // Products page
  'products.eyebrow': 'AFRO Suite · የድርጅት ERP እና ዘርፍ-ተኮር ሲስተሞች',
  'products.titleStart': 'ስራችንን ብቻ አይመልከቱ — ',
  'products.titleHighlight': 'ንግድዎን',
  'products.titleEnd': ' ዛሬውኑ ያስተዳድሩበት',
  'products.sub':
    'ባለሁለት-ጎን ሂሳብ መዝገብ፣ የብዙ-መጋዘን ክምችት፣ የደንበኞች CRM እና ዘርፍ-ተኮር አሰራሮችን ያካተተ። ለ45 ቀናት በነጻ ይሞክሩ ወይም ቀጥታ ዴሞውን ይክፈቱ።',
  'products.openDemo': 'ቀጥታ ዴሞ ይክፈቱ',
  'products.startTrial': 'የ45 ቀን ነጻ ሙከራ ይጀምሩ',
  'products.signIn': 'ወደ ድርጅትዎ ይግቡ',
  'products.startFree': 'በነጻ ይጀምሩ',
  'products.liveDemo': 'ቀጥታ ዴሞ',
  'products.howTitle': 'AFRO Suite እንዴት ይሰራል',
  'products.how0.title': 'ወዲያውኑ ይጀምሩ',
  'products.how0.desc': 'በተዘጋጀው ዴሞ ሲስተም ውስጥ ERPን ይመልከቱ ወይም በ30 ሰከንድ ውስጥ የራስዎን ድርጅት ይፍጠሩ።',
  'products.how1.title': 'ስራንና ሂሳብን ያገናኙ',
  'products.how1.desc': 'እያንዳንዱ ሽያጭ፣ ግዥ፣ የምርት ትዕዛዝ፣ የክሊኒክ ሂሳብ እና የትምህርት ክፍያ በቀጥታ ወደ ዋናው መዝገብ ይገባል።',
  'products.how2.title': 'በፈለጉት መጠን ያሳድጉ',
  'products.how2.desc': 'ቅርንጫፎችን፣ መጋዘኖችን፣ የቴሌግራም ቦቶችን እና የቡድን ሚናዎችን በአንድ ደህንነቱ የተጠበቀ ሲስተም ያክሉ።',
  'products.sys.pharmacy.name': 'የፋርማሲ አስተዳደር',
  'products.sys.pharmacy.tagline': 'ፋርማሲዎን እንደ ቼይን ድርጅት — በሙሉ የሂሳብና የክምችት ቁጥጥር ያስተዳድሩ።',
  'products.sys.store.name': 'የሱቅ እና የማምረቻ ERP',
  'products.sys.store.tagline': 'ሽያጭ፣ የBOM ምርት፣ መጋዘኖች እና ሂሳብ በአንድ ቦታ።',
  'products.sys.hospital.name': 'የሆስፒታል / ክሊኒክ አስተዳደር',
  'products.sys.hospital.tagline': 'ከታካሚ መቀበያ እስከ ህክምና መዝገብ (EMR) እና ፈጣን ክፍያ።',
  'products.sys.school.name': 'የትምህርት ቤት አስተዳደር',
  'products.sys.school.tagline': 'ምዝገባ፣ የጊዜ ሰሌዳ፣ የመምህራን ክትትል እና የክፍያ ሂሳብ።',

  // Services page
  'servicesPage.backHome': 'ወደ መነሻ ተመለስ',
  'servicesPage.title': 'አገልግሎቶች እና ዋጋ',
  'servicesPage.sub': 'ከቀላል ላንዲንግ ፔጅ እስከ ሙሉ የድርጅት ሲስተሞች — ግልጽ ዋጋ፣ ምንም የተደበቀ ክፍያ የለም።',
  'servicesPage.all': 'ሁሉም',
  'servicesPage.getQuote': 'ዋጋ ይጠይቁ',
  'servicesPage.allInclude': 'ሁሉም ፕሮጀክቶች የሚያካትቱት:',
  'servicesPage.whatsIncluded': 'የሚካተቱ ባህሪያት',
  'servicesPage.feature': 'ባህሪ',
  'servicesPage.readyTitle': 'ለመጀመር ዝግጁ ነዎት?',
  'servicesPage.readySub': 'ስለ ፕሮጀክትዎ ይንገሩን እና በ24 ሰዓታት ውስጥ ዝርዝር ፕሮፖዛል እንልክልዎታለን።',
  'servicesPage.whatsappUs': 'በዋትስአፕ ያግኙን',
};

const OM_STRINGS: Record<TranslationKey, string> = {
  // Navigation
  'nav.home': 'Fuula Duraa',
  'nav.showcase': 'Hojii Keenya',
  'nav.process': 'Adeemsa',
  'nav.about': 'Waa’ee Keenya',
  'nav.reviews': 'Yaada Maamilaa',
  'nav.contact': 'Nu Quunnamaa',
  'nav.services': 'Tajaajila',
  'nav.products': 'Sirnoota',
  'nav.languageLabel': 'Afaan weebsaayitii filadhaa',

  // Hero
  'hero.titleLine1': 'Sirnoota dijitaalaa daldala',
  'hero.titleLine2': 'keessan gaggeessan ijaarra.',
  'hero.sub':
    'Finfinnee keessa teenyee hojjenna. Weebsaayitii irraa hanga sirna ERP guutuutti — meeshaalee daldaltoonni Itoophiyaa ittiin guddatan, hojii salphisanii fi dorgoman ni ijaarra.',
  'hero.ctaStart': 'Pirojektii Jalqabaa',
  'hero.ctaWork': 'Hojii Keenya Ilaalaa',

  // Showcase
  'showcase.title': 'Waan ijaarre',
  'showcase.monthlyOverview': 'Cuunfaa Ji’aa',
  'showcase.recentActivity': 'Sochii Dhihoo',
  'showcase.ctaLaunch': 'Deemoo ERP Kallattii Banaa',
  'showcase.ctaCompare': 'Sirnoota Hunda Madaalaa',

  // What We Do
  'whatWeDo.title': 'Waan Hojjennu',
  'whatWeDo.intro': 'Weebsaayitii beeksisaa irraa hanga sirna dhaabbataa guutuutti sirnoota dijitaalaa ni saxaxna, ni ijaarra, ni eegalsiisna.',
  'whatWeDo.0.title': 'Weebsaayitii & Appii Weebii',
  'whatWeDo.0.desc': 'Fuulota eegalsiisaa, poortifooliyoo, weebsaayitii dhaabbataa, biloogii fi gabaa elektirooniksii.',
  'whatWeDo.1.title': 'Sirnoota Daldalaa',
  'whatWeDo.1.desc': 'ERP, HR fi Mindaa, POS, Kuusaa Meeshaa, Bulchiinsa Mana Barumsaa fi Hoteelaa.',
  'whatWeDo.2.title': 'Mobaayilii fi Sirna Guutuu',
  'whatWeDo.2.desc': 'Appii iOS fi Android, daashboordii addaa fi sirnoota dijitaalaa guutuu.',
  'whatWeDo.ctaAll': 'Tajaajila & Gatii Hunda Ilaalaa',

  // Process
  'process.title': 'Adeemsa Hojii Keenya',
  'process.0.title': 'Marii Jalqabaa',
  'process.0.desc': 'Kaayyoo keessan, maamiltoota keessanii fi milkaa’ina barbaaddan hubachuuf bilbila bilisaatiin jalqabna.',
  'process.1.title': 'Saxaxaa fi Fakkeenya',
  'process.1.desc': 'Koodii barreessuun dura hayyama keessaniif saxaxaa fi fakkeenya mul’atu qopheessina.',
  'process.2.title': 'Ijaarsa (Development)',
  'process.2.desc': 'Pirojektii keessan koodii qulqulluu, saffisaa, nageenya qabuu fi guddachuu danda’uun ijaarra.',
  'process.3.title': 'Eegalsiisuu fi Deeggarsa',
  'process.3.desc': 'Ni eegalsiisna, akkaataa itti fayyadamaa isin barsiifna, yeroo hundas isin waliin dhaabbanna.',

  // Why Us
  'whyus.title': 'Nuti suuqii teempileetii miti.',
  'whyus.0.title': 'Saffisaan Dhiyeessuu',
  'whyus.0.desc': 'Pirojektoonni hedduun hordoffii guyyaa guyyaan torban 2–6 keessatti xumuramu.',
  'whyus.1.title': 'Nageenya Amansiisaa',
  'whyus.1.desc': 'Pirojektii hunda irratti SSL, eegumsa nageenyaa fi baakaappii ni qabaata.',
  'whyus.2.title': 'Gatii Ifa Ta’e',
  'whyus.2.desc': 'Gatii murtaa’e. Kaffaltiin dhokataan gonkumaa hin jiru.',
  'whyus.3.title': 'Guddina Irratti Xiyyeeffata',
  'whyus.3.desc': 'Saffisa, SEO fi bu’aa daldalaaf ijaarra — bifa qofaaf miti.',
  'whyus.4.title': 'Saxaxa Addaa',
  'whyus.4.desc': 'Teempileetii hin fayyadamnu. Pirojektiin hundi maqaa keessaniif qofa qophaa’a.',
  'whyus.5.title': 'Isin Waliin Turra',
  'whyus.5.desc': 'Erga xumuramee boodas toora deeggarsa addaa qabna.',

  // About
  'about.title': 'Waa’ee Keenya',
  'about.quote':
    'Nuti istuudiyoo xiqqaa Finfinnee irraa bara 2020 irraa eegalee hojjetudha — daldaltoonni Itoophiyaa teempileetii jarjaraan hojjetame osoo hin taane meeshaa dijitaalaa qulqulluu argachuu qabu jennee amanna.',
  'about.meta': 'Muuxannoo waggoota hedduutiin weebsaayitii fi appii saffisoo daldala biyya keessaa fi addunyaatti guddisan ijaarra.',

  // Reviews
  'reviews.title': 'Maamiltoonni Keenya Maal Jedhu',

  // Contact
  'contact.title': 'Haa haasofnu.',
  'contact.sub': 'Sa’aatii 24 keessatti deebii kennina — yeroo baay’ee sana caalaa saffisna.',
  'contact.phone': 'Bilbila',
  'contact.whatsapp': 'WhatsApp',
  'contact.telegram': 'Telegram',
  'contact.email': 'Imeelii',
  'contact.location': 'Teessoo',
  'contact.locationVal': 'Finfinnee, Itoophiyaa',
  'contact.nameLabel': 'Maqaa Guutuu',
  'contact.emailLabel': 'Imeelii',
  'contact.phoneLabel': 'Lakkoofsa Bilbilaa',
  'contact.optional': '(dirqama miti)',
  'contact.messageLabel': 'Maal ijaaraa jirtu?',
  'contact.messagePlaceholder': 'Waa’ee pirojektii, kaayyoo fi yeroo keessanii nuuf barreessaa...',
  'contact.submit': 'Ergaa Ergaa',
  'contact.sending': 'Ergaa jira…',
  'contact.readyToSend': 'Erguuf qophii dha',
  'contact.looksGood': 'Gaarii dha',
  'contact.validEmail': 'Bifti imeelii sirrii dha',

  // Footer
  'footer.copy': '© 2026 · Finfinneetti hojjetame',

  // Products page
  'products.eyebrow': 'AFRO Suite · Sirna ERP fi Dhaabbilee',
  'products.titleStart': 'Hojii keenya ilaaluu qofa miti — ',
  'products.titleHighlight': 'daldala keessan ittiin gaggeessaa',
  'products.titleEnd': ' har’uma',
  'products.sub':
    'Herrega double-entry, kuusaa meeshaa hedduu, CRM fi adeemsa hojii sektaraatiin kan deeggarame. Guyyaa 45f bilisaan yaalaa ykn amma deemoo qophaa’e banaa.',
  'products.openDemo': 'Deemoo Kallattii Banaa',
  'products.startTrial': 'Yaalii Bilisaa Guyyaa 45 Jalqabaa',
  'products.signIn': 'Seensa Dhaabbataa',
  'products.startFree': 'Bilisaan Jalqabaa',
  'products.liveDemo': 'Deemoo Kallattii',
  'products.howTitle': 'AFRO Suite akkamitti hojjeta',
  'products.how0.title': 'Battalumatti jalqabaa',
  'products.how0.desc': 'Deemoo ERP data fakkeenya qabu daawwadhaa ykn sekondii 30 keessatti dhaabbata keessan uumaa.',
  'products.how1.title': 'Hojii fi herrega walqabsiisaa',
  'products.how1.desc': 'Gurgurtaan, bittaan, ajajni oomishaa, kaffaltiin kilinikaa fi mana barumsaa kallattiin galmee herregaatti seena.',
  'products.how2.title': 'Akka barbaaddanitti guddisaa',
  'products.how2.desc': 'Dameewwan, kuusaalee, bootii Telegram fi gahee hojjettootaa iddoo tokkotti dabalaa.',
  'products.sys.pharmacy.name': 'Bulchiinsa Faarmaasii',
  'products.sys.pharmacy.tagline': 'Faarmaasii keessan akka dhaabbata guddaatti — herregaa fi kuusaa ERP waliin gaggeessaa.',
  'products.sys.store.name': 'ERP Suuqii fi Oomishaa',
  'products.sys.store.tagline': 'Daldala, oomisha BOM, kuusaalee fi herrega bakka tokkotti.',
  'products.sys.hospital.name': 'Bulchiinsa Hospitaalaa / Kilinikaa',
  'products.sys.hospital.tagline': 'Simannaa dhukkubsataa irraa hanga galmee yaalaa (EMR) fi kaffaltii saffisaatti.',
  'products.sys.school.name': 'Bulchiinsa Mana Barumsaa',
  'products.sys.school.tagline': 'Galmee barattootaa, sagantaa, hordoffii barsiisaa fi kaffaltii.',

  // Services page
  'servicesPage.backHome': 'Gara Fuula Duraatti Deebi’aa',
  'servicesPage.title': 'Tajaajilaa fi Gatii',
  'servicesPage.sub': 'Fuula salphaa irraa hanga sirna dhaabbataa guutuutti — gatii ifa ta’e, kaffaltiin dhokataan hin jiru.',
  'servicesPage.all': 'Hunda',
  'servicesPage.getQuote': 'Gatii Gaafadhaa',
  'servicesPage.allInclude': 'Pirojektoonni hundi ni qabu:',
  'servicesPage.whatsIncluded': 'Waan Keessa Jiru',
  'servicesPage.feature': 'Amaloota',
  'servicesPage.readyTitle': 'Jalqabuuf qophii dhaa?',
  'servicesPage.readySub': 'Waa’ee pirojektii keessanii nuuf himaa, sa’aatii 24 keessatti yaada bal’aa isiniif ergina.',
  'servicesPage.whatsappUs': 'WhatsApp Nuuf Ergaa',
};

const TI_STRINGS: Record<TranslationKey, string> = {
  // Navigation
  'nav.home': 'መበገሲ',
  'nav.showcase': 'ስራሕትና',
  'nav.process': 'ኣሰራርሓና',
  'nav.about': 'ብዛዕባና',
  'nav.reviews': 'ርእይቶታት',
  'nav.contact': 'ርኸቡና',
  'nav.services': 'ኣገልግሎታት',
  'nav.products': 'ሲስተማት',
  'nav.languageLabel': 'ቋንቋ መርበብ ሓበሬታ ምረጹ',

  // Hero
  'hero.titleLine1': 'ንግድኹም ዘንቀሳቕሱ',
  'hero.titleLine2': 'ዲጂታል ሲስተማት ንሃንጽ።',
  'hero.sub':
    'መደበርና ኣዲስ ኣበባ እዩ። ካብ መርበባት ሓበሬታ ክሳብ ምሉእ ERP ሲስተማት — ትካላት ኢትዮጵያ ክዓብያ፣ ስራሐን ከቃልላን ክወዳደራን ዝሕግዙ መሳርሒታት ንሰርሕ።',
  'hero.ctaStart': 'ፕሮጀክት ጀምሩ',
  'hero.ctaWork': 'ስራሕትና ርኣዩ',

  // Showcase
  'showcase.title': 'ዝሃነጽናዮም ስራሕቲ',
  'showcase.monthlyOverview': 'ወርሓዊ ትዕዝብቲ',
  'showcase.recentActivity': 'ናይ ቀረባ እዋን ምንቅስቓስ',
  'showcase.ctaLaunch': 'ቀጥታ ERP ዴሞ ክፈቱ',
  'showcase.ctaCompare': 'ኩሎም ሲስተማት ኣወዳድሩ',

  // What We Do
  'whatWeDo.title': 'እንሰርሖ',
  'whatWeDo.intro': 'ካብ መርበባት መወዓውዒ ክሳብ ምሉእ ናይ ትካል ሲስተማት ዲጂታል መፍትሒታት ንነድፍ፣ ንሃንጽን ነጀምርን።',
  'whatWeDo.0.title': 'መርበባት ሓበሬታን ዌብ ኣፕን',
  'whatWeDo.0.desc': 'ላንዲንግ ፔጃት፣ ፖርትፎሊዮታት፣ መርበባት ትካላት፣ ብሎጋትን ኢ-ኮሜርስን።',
  'whatWeDo.1.title': 'ሲስተማት ንግዲ',
  'whatWeDo.1.desc': 'ERP፣ ሰራሕተኛን ደሞዝን (HR & Payroll)፣ POS፣ ንብረት፣ ቤት ትምህርትን ሆቴልን።',
  'whatWeDo.2.title': 'ሞባይልን ምሉእ መድረኻትን',
  'whatWeDo.2.desc': 'ናይ iOS ከምኡውን Android ኣፓት፣ ብጁ ዳሽቦርዳትን ምሉእ ዲጂታል ሲስተማትን።',
  'whatWeDo.ctaAll': 'ኩሎም ኣገልግሎታትን ዋጋን ርኣዩ',

  // Process
  'process.title': 'ኣሰራርሓና',
  'process.0.title': 'መጀመርታ ዝርርብ',
  'process.0.desc': 'ዕላማኹም፣ ዓማዊልኩምን ትደልይዎ ዓወትን ንምርዳእ ብናጻ ናይ ምኽሪ ጻውዒት ንጅምር።',
  'process.1.title': 'ዲዛይንን ፕሮቶታይፕን',
  'process.1.desc': 'ኮድ ቅድሚ ምጽሓፍና ንርእይቶኹምን ፍቓድኩምን ዲዛይንን መርኣዪን ነዳሉ።',
  'process.2.title': 'ህንጸት (Development)',
  'process.2.desc': 'ፕሮጀክትኹም ብጽሩይ፣ ቅልጡፍ፣ ውሑስን ክዓቢ ዝኽእልን ኮድ ንሃንጾ።',
  'process.3.title': 'ምጅማርን ደገፍን',
  'process.3.desc': 'ነጀምሮ፣ ኣጠቓቕምኡ ነርኢ፣ ወትሩ ድማ ኣብ ጎድንኹም ንጸንሕ።',

  // Why Us
  'whyus.title': 'ድሉው ቴምፕሌት ኣይንሸይጥን።',
  'whyus.0.title': 'ቅልጡፍ ምቕራብ',
  'whyus.0.desc': 'መብዛሕትኦም ፕሮጀክታት ብመዓልታዊ ጸብጻብ ኣብ 2–6 ሰሙናት ይዛዘሙ።',
  'whyus.1.title': 'ብነባሪ ውሑስ',
  'whyus.1.desc': 'ኣብ ነፍሲ ወከፍ ፕሮጀክት SSL፣ ሓለዋ ድሕንነትን ባክኣፕን ይካተት።',
  'whyus.2.title': 'ንጹር ዋጋ',
  'whyus.2.desc': 'ዝተወሰነ ዋጋ። ዝተሓብአ ክፍሊት የለን።',
  'whyus.3.title': 'ናብ ዕብየት ዘተኮረ',
  'whyus.3.desc': 'ንፍጥነት፣ SEO ከምኡውን ውጽኢት ንግዲ ንሃንጽ።',
  'whyus.4.title': 'ፍሉይ ዲዛይን',
  'whyus.4.desc': 'ቴምፕሌት የለን። ነፍሲ ወከፍ ፕሮጀክት ንብራንድኹም ጥራይ ይንደፍ።',
  'whyus.5.title': 'ወትሩ ምሳኹም',
  'whyus.5.desc': 'ድሕሪ ምጅማር እውን ቀጻሊ ናይ ደገፍ መስመር ኣለና።',

  // About
  'about.title': 'ብዛዕባና',
  'about.quote':
    'ካብ 2020 ጀሚርና ኣብ ኣዲስ ኣበባ መርበባት ሓበሬታን ሲስተማትን እንሃንጽ ስቱድዮ ኢና — ትካላት ኢትዮጵያ ህጹጽ ቴምፕሌት ዘይኮነስ ጽሬት ዘለዎም ዲጂታል መሳርሒታት ይግብኦም ብዝብል እምነት።',
  'about.meta': 'ብናይ ዓመታት ልምዲ፣ ንግድታት ኣብ ውሽጢ ሃገርን ዓለምን ክዓብያ ዝሕግዙ ቅልጡፋት መርበባትን ኣፓትን ንሃንጽ።',

  // Reviews
  'reviews.title': 'ዓማዊልና እንታይ ይብሉ',

  // Contact
  'contact.title': 'ንዘራረብ።',
  'contact.sub': 'ኣብ ውሽጢ 24 ሰዓታት መልሲ ንህብ — ብዙሕ ግዜ ዝቐልጠፈ።',
  'contact.phone': 'ስልኪ',
  'contact.whatsapp': 'ዋትስኣፕ',
  'contact.telegram': 'ቴሌግራም',
  'contact.email': 'ኢሜይል',
  'contact.location': 'ኣድራሻ',
  'contact.locationVal': 'ኣዲስ ኣበባ፣ ኢትዮጵያ',
  'contact.nameLabel': 'ምሉእ ስም',
  'contact.emailLabel': 'ኢሜይል',
  'contact.phoneLabel': 'ቁጽሪ ስልኪ',
  'contact.optional': '(ኣማራጺ)',
  'contact.messageLabel': 'እንታይ ክትሃንጹ ትደልዩ?',
  'contact.messagePlaceholder': 'ብዛዕባ ፕሮጀክትኹም፣ ዕላማኹምን ግዜኹምን ንገሩና...',
  'contact.submit': 'መልእኽቲ ስደዱ',
  'contact.sending': 'ይስደድ ኣሎ…',
  'contact.readyToSend': 'ንምስዳድ ድሉው እዩ',
  'contact.looksGood': 'ጽቡቕ ኣሎ',
  'contact.validEmail': 'ቅኑዕ ቅርጺ ኢሜይል',

  // Footer
  'footer.copy': '© 2026 · ኣብ ኣዲስ ኣበባ ዝተሰርሐ',

  // Products page
  'products.eyebrow': 'AFRO Suite · ናይ ትካል ERP ከምኡውን ሲስተማት ዓውዲ',
  'products.titleStart': 'ስራሕና ምርኣይ ጥራይ ዘይኮነስ — ',
  'products.titleHighlight': 'ንግድኹም',
  'products.titleEnd': ' ሎሚ ብእኡ ኣመሓድሩ',
  'products.sub':
    'ብድርብ-ጎኒ ሕሳብ፣ ብዙሕ-መኽዘን ንብረት፣ CRM ከምኡውን ዓውዳዊ ኣሰራርሓታት ዝተደገፈ። ን45 መዓልታት ብናጻ ፈትኑ ወይ ሕጂ ቀጥታ ዴሞ ክፈቱ።',
  'products.openDemo': 'ቀጥታ ዴሞ ክፈቱ',
  'products.startTrial': 'ናይ 45 መዓልቲ ናጻ ፈተነ ጀምሩ',
  'products.signIn': 'ናብ ትካልኩም እተዉ',
  'products.startFree': 'ብናጻ ጀምሩ',
  'products.liveDemo': 'ቀጥታ ዴሞ',
  'products.howTitle': 'AFRO Suite ከመይ ይሰርሕ',
  'products.how0.title': 'ብቕጽበት ጀምሩ',
  'products.how0.desc': 'ብኣብነት ዳታ ዝተዳለወ ዴሞ ERP ርኣዩ ወይ ኣብ 30 ካልኢት ናይ ገዛእ ርእስኹም ትካል ፍጠሩ።',
  'products.how1.title': 'ስራሕን ሕሳብን ኣራኽቡ',
  'products.how1.desc': 'ነፍሲ ወከፍ መሸጣ፣ ዕድጊ፣ ትእዛዝ ምህርቲ፣ ክፍሊት ክሊኒክን ቤት ትምህርትን ብቐጥታ ናብ ዋና መዝገብ ይኣቱ።',
  'products.how2.title': 'ብዓቕምኹም ዓብዩ',
  'products.how2.desc': 'ጨናፍር፣ መኽዘናት፣ ቴሌግራም ቦታትን ግደ ሰራሕተኛታትን ኣብ ሓደ ውሑስ ስፍራ ወስኹ።',
  'products.sys.pharmacy.name': 'ምሕደራ ፋርማሲ',
  'products.sys.pharmacy.tagline': 'ፋርማሲኹም ከም ዓቢ ትካል — ምስ ምሉእ ERP ሕሳብን ክምችትን ኣመሓድሩ።',
  'products.sys.store.name': 'ERP ድኳንን ምህርትን',
  'products.sys.store.tagline': 'ንግዲ፣ ምህርቲ BOM፣ መኽዘናትን ሕሳብን ኣብ ሓደ ቦታ።',
  'products.sys.hospital.name': 'ምሕደራ ሆስፒታል / ክሊኒክ',
  'products.sys.hospital.tagline': 'ካብ መቐበሊ ሕሙማት ክሳብ መዝገብ ሕክምና (EMR) ከምኡውን ቅልጡፍ ክፍሊት።',
  'products.sys.school.name': 'ምሕደራ ቤት ትምህርቲ',
  'products.sys.school.tagline': 'ምዝገባ፣ ሰሌዳ ግዜ፣ ክትትል መምህራንን ሕሳብ ክፍሊትን።',

  // Services page
  'servicesPage.backHome': 'ናብ መበገሲ ተመለሱ',
  'servicesPage.title': 'ኣገልግሎታትን ዋጋን',
  'servicesPage.sub': 'ካብ ቀሊል ላንዲንግ ፔጅ ክሳብ ምሉእ ናይ ትካል ሲስተማት — ግልጺ ዋጋ፣ ዝተሓብአ ክፍሊት የለን።',
  'servicesPage.all': 'ኩሉ',
  'servicesPage.getQuote': 'ዋጋ ሕተቱ',
  'servicesPage.allInclude': 'ኩሎም ፕሮጀክታት ዘካትትዎ:',
  'servicesPage.whatsIncluded': 'እንታይ ይካተት',
  'servicesPage.feature': 'ባህሪ',
  'servicesPage.readyTitle': 'ንምጅማር ድሉዋት ዲኹም?',
  'servicesPage.readySub': 'ብዛዕባ ፕሮጀክትኹም ንገሩና፣ ኣብ ውሽጢ 24 ሰዓታት ዝርዝር እማመ ክንልእከልኩም ኢና።',
  'servicesPage.whatsappUs': 'ብዋትስኣፕ ርኸቡና',
};

const DICTIONARY: Record<LanguageCode, Record<TranslationKey, string>> = {
  en: EN_STRINGS,
  am: AM_STRINGS,
  om: OM_STRINGS,
  ti: TI_STRINGS,
};

export function normalizeLanguage(raw: string | null | undefined): LanguageCode {
  if (!raw) return 'en';
  const code = raw.trim().toLowerCase().split(/[-_]/)[0];
  if (code === 'am' || code === 'om' || code === 'ti' || code === 'en') {
    return code;
  }
  return 'en';
}

export function translateKey(lang: LanguageCode, key: TranslationKey, fallback?: string): string {
  const table = DICTIONARY[lang] ?? EN_STRINGS;
  return table[key] ?? EN_STRINGS[key] ?? fallback ?? key;
}

export function getAllTranslationKeys(): TranslationKey[] {
  return Object.keys(EN_STRINGS) as TranslationKey[];
}
