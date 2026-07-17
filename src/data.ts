export const services = [
  { id:1,  icon:'fa-solid fa-rocket',        type:'Landing Page',           price:'10,000 – 18,000',  best:'Single product or service promo with a high-conversion contact form.',   features:['1–3 Sections','Contact Form','Mobile Responsive','SEO Ready'],              tier:'starter'            },
  { id:2,  icon:'fa-solid fa-user-tie',       type:'Personal Portfolio',     price:'15,000 – 25,000',  best:'Freelancers, designers, developers and professionals.',                  features:['Portfolio Gallery','About & CV','Contact Form','Blog Ready'],                tier:'starter'            },
  { id:3,  icon:'fa-solid fa-store',          type:'Small Business Website', price:'25,000 – 50,000',  best:'Local businesses with About, Contact, Blog and Google Maps.',           features:['5–8 Pages','Google Maps','WhatsApp Button','Blog Module'],                   tier:'starter'            },
  { id:4,  icon:'fa-solid fa-building',       type:'Corporate Website',      price:'70,000 – 160,000', best:'Full brand presentation with advanced pages, CMS and analytics.',       features:['Unlimited Pages','Admin Dashboard','Team & Career','Analytics'],             tier:'popular', featured:true },
  { id:5,  icon:'fa-solid fa-newspaper',      type:'Blog / News Portal',     price:'20,000 – 45,000',  best:'News websites, magazines and content-driven platforms.',                features:['CMS Powered','Categories & Tags','Author Profiles','Newsletter'],            tier:'starter'            },
  { id:6,  icon:'fa-solid fa-cart-shopping',  type:'E-Commerce Platform',    price:'60,000 – 100,000', best:'Online stores with product catalog, cart, checkout and payments.',      features:['Product Catalog','Cart & Checkout','Order Management','Payments'],           tier:'pro'                },
  { id:7,  icon:'fa-solid fa-graduation-cap', type:'School Management / LMS',price:'90,000 – 250,000', best:'Student management, grading, attendance, and online courses.',         features:['Student Portal','Grade Book','Attendance','Online Courses'],                tier:'pro'                },
  { id:8,  icon:'fa-solid fa-hotel',          type:'Hotel / PMS',            price:'80,000 – 200,000', best:'Property management, reservations, room tracking and billing.',        features:['Room Management','Booking Calendar','Guest Portal','Billing'],               tier:'pro'                },
  { id:9,  icon:'fa-solid fa-briefcase',      type:'ERP System',             price:'280,000 – 800,000',best:'Full business management — inventory, accounting, HR, and reporting.', features:['Inventory','Accounting','HR Module','Reporting Dashboard'],                  tier:'enterprise', featured:true },
  { id:10, icon:'fa-solid fa-warehouse',      type:'Inventory & Warehouse',  price:'70,000 – 150,000', best:'Stock tracking, warehouse operations, and supply chain visibility.',   features:['Stock Tracking','Warehouse Zones','Barcode Scanning','Alerts'],              tier:'pro'                },
  { id:11, icon:'fa-solid fa-users-gear',     type:'HR & Payroll Platform',  price:'80,000 – 180,000', best:'Employee records, payroll processing, and attendance management.',     features:['Employee Database','Payroll','Leave Management','Reports'],                  tier:'pro'                },
  { id:12, icon:'fa-solid fa-cash-register',  type:'Point-of-Sale (POS)',    price:'50,000 – 120,000', best:'Retail and restaurant POS with inventory sync and reporting.',         features:['Product Scanner','Payment Processing','Receipt Printing','Reports'],        tier:'pro'                },
  { id:13, icon:'fa-solid fa-mobile-screen',  type:'Mobile App + Web System',price:'280,000 – 1M+',    best:'Full digital platforms combining mobile app and web dashboard.',        features:['iOS & Android','Web Dashboard','Push Notifications','API Integration'],      tier:'enterprise'         },
];

export const tierLabels: Record<string,string> = { starter:'Starter', popular:'Most Popular', pro:'Professional', enterprise:'Enterprise' };
export const tierColors: Record<string,string> = { starter:'#60a5fa', popular:'#c8963c',      pro:'#c084fc',      enterprise:'#34d399'   };

export const whatWeDo = [
  {
    title: 'Websites & Web Apps',
    desc: 'Landing pages, portfolios, corporate sites, blogs, and e-commerce platforms.',
    icon: 'fa-solid fa-globe',
    color: '#60a5fa',
  },
  {
    title: 'Business Systems',
    desc: 'ERP, HR & Payroll, POS, Inventory, School Management, and Hotel PMS.',
    icon: 'fa-solid fa-server',
    color: '#c8963c',
  },
  {
    title: 'Mobile & Full Platforms',
    desc: 'iOS & Android apps, custom dashboards, and end-to-end digital platforms.',
    icon: 'fa-solid fa-mobile-screen',
    color: '#c084fc',
  },
];
