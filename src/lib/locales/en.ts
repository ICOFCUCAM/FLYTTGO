/**
 * FlyttGo — English translations.
 *
 * Keep keys nested by surface (header / footer / home / etc.) so it's
 * easy to find them. When you add a string, add the same key to no.ts
 * with the Norwegian translation, otherwise i18next will fall back to
 * English (which is fine but defeats the point).
 */
export const en = {
  /* ─── Header / nav ─── */
  header: {
    home:         'Home',
    services:     'Services',
    movingTools:  'Moving Tools',
    becomeDriver: 'Become a Driver',
    companies:    'Companies',
    bookNow:      'Book Now',
    signIn:       'Sign In',
    signUp:       'Sign Up',
    dashboard:    'Dashboard',
    myBookings:   'My Bookings',
    driverPortal: 'Driver Portal',
    adminDash:    'Admin Dashboard',
    signOut:      'Sign Out',
    profile:      'Profile',
    notifications: 'Notifications',
    notificationsEmpty: "You're all caught up",
    notificationsHint:  'New booking updates will appear here.',
    tagline:      'Smart Moving & Transport Services',
    corporate:    'Corporate Logistics Portal',
    createCorp:   'Create Corporate Account →',
  },

  /* ─── Footer ─── */
  footer: {
    services:    'Services',
    cities:      'Cities',
    company:     'Company',
    corporateCol:'Corporate',
    companyLabel:    'Company',
    vatLabel:        'VAT',
    insuranceLabel:  'Insurance',
    supportLabel:    'Support',
    mvaRegistered:   'MVA registered',
    insuranceLine1:  'Goods-in-transit cover',
    insuranceLine2:  'up to 500 000 NOK per booking',
    supportHours:    'Mon–Sun · 08:00–22:00',
    rights:          '© 2026 FlyttGo AS. All rights reserved.',
    privacy:         'Privacy Policy',
    terms:           'Terms of Service',
    liability:       'Liability',
    chatWithUs:      'Chat with us',
    norwayMarketplace: "Norway's #1 moving platform. Smart moving and transport services connecting you with verified drivers.",
  },

  /* ─── Auth modal ─── */
  auth: {
    signInTitle:    'Sign In',
    signInWelcome:  'Welcome back to FlyttGo.',
    signInWithGoogle: 'Sign in with Google',
    signInWithApple:  'Sign in with Apple',
    continueWithGoogle: 'Continue with Google',
    continueWithApple:  'Continue with Apple',
    orContinueEmail: 'or continue with email',
    email:        'Email',
    password:     'Password',
    forgot:       'Forgot?',
    signInBtn:    'Sign In',
    pleaseWait:   'Please wait…',
    noAccount:    "Don't have an account?",
    haveAccount:  'Already have an account?',
    createAccount:    'Create Account',
    chooseAccountType: 'Choose your account type to get started.',
    rolePersonal:     'Personal',
    rolePersonalDesc: 'Book moves and deliveries for yourself',
    roleDriver:       'Driver',
    roleDriverDesc:   'Earn money with your van',
    roleBusiness:     'Business',
    roleBusinessDesc: 'Corporate logistics at scale',
    joinPersonal:    'Join as a personal customer.',
    joinDriver:      'Start earning with FlyttGo.',
    joinBusiness:    'Set up your corporate account.',
    firstName:    'First name',
    lastName:     'Last name',
    createBtn:    'Create Account',
    back:         'Back',
    backToSignIn: 'Back to sign in',
    resetTitle:   'Reset password',
    resetIntro:   "Enter your email and we'll send you a link to reset your password.",
    sending:      'Sending…',
    sendResetLink: 'Send reset link',
    resetSentTitle: 'Check your inbox',
    resetSentBody1: 'If an account exists for',
    resetSentBody2: 'a reset link is on its way.',
  },

  /* ─── Home page ─── */
  home: {
    /* Hero */
    heroBadge:    "Norway's #1 Moving Platform",
    vanSizeGuide: 'Van Size Guide',

    /* Booking widget */
    quoteTitle:   'Get an Instant Moving Quote',
    quoteSubtitle:'Norway-wide · free estimate · no commitment',
    insured:      'Insured',
    twoHrMin:     '2hr min',
    mvaIncl:      'MVA incl.',
    pickup:       'Pickup',
    delivery:     'Delivery',
    moveType:     'Move Type',
    movingDate:   'Moving Date',
    pickupAddress:   'Pickup address',
    deliveryAddress: 'Delivery address',
    moveSingleItem: 'Single Item',
    moveStudent:    'Student Move',
    moveApartment:  'Apartment Move',
    moveHouse:      'House Move',
    moveOffice:     'Office Relocation',
    estFrom:       'Est. from',
    getEstimate:   'Get Estimate',
    bookNow:       'Book Now',

    /* Trust bar */
    trustVerifiedTitle: 'Verified drivers',
    trustVerifiedDesc:  'Every driver passes ID + insurance checks',
    trustEscrowTitle:   'Secure escrow',
    trustEscrowDesc:    'Payment held until delivery confirmed',
    trustInsuredTitle:  'Insured deliveries',
    trustInsuredDesc:   'Goods-in-transit cover up to 500 000 NOK',
    trustRegisteredTitle: 'Brønnøysund-registered',
    trustRegisteredDesc:  'Norwegian companies only · MVA included',

    /* Stats */
    statDeliveries: 'Deliveries Completed',
    statDrivers:    'Verified Drivers',
    statRating:     'Average Rating',
    statCities:     'Cities Covered',
    badgeVerifiedDrivers: 'Verified Drivers',
    badgeSecurePay:       'Secure Payments',
    badgeDispute:         'Dispute Protection',
    badgeChatOnly:        'In-App Chat Only',

    /* How it works */
    howTitle:    'How FlyttGo Works',
    howSubtitle: 'Book your move in under 60 seconds',

    /* Driver CTA */
    driverCtaTitle:    'Become a FlyttGo Driver',
    driverCtaSubtitle: 'Earn money on your own schedule. Join thousands of drivers across Norway.',
    driverFeature1:    'Flexible working hours',
    driverFeature2:    'Earn up to 30,000 NOK/month',
    driverFeature3:    'Weekly payouts via Stripe',
    driverFeature4:    'Choose your own jobs',
    driverFeature5:    'Free to join — upgrade anytime',
    applyNow:          'Apply Now',
  },

  /* ─── Services page ─── */
  services: {
    heroBadge:   "Norway's #1 Moving Marketplace · 25,000+ Jobs Completed",
    heroTitle1:  'Every Moving Service',
    heroTitle2:  'Across Norway',
    heroSubtitle:'Book verified, insured transport providers for any move. Transparent pricing, real-time tracking, and secure escrow payment.',
    badge1:  '✅ Verified companies only',
    badge2:  '🔒 Escrow payment',
    badge3:  '📍 GPS tracking',
    badge4:  '⭐ 4.8/5 rating',
    cta:     'Get Instant Prices →',
    sectionTitle:    'Our Services',
    sectionSubtitle: 'All services delivered by registered Norwegian companies with mandatory goods-in-transit insurance.',
    availableNow:    'Available now',
    bookPrefix:      'Book',
    howTitle:        'How It Works',
    how1Title:       'Book Online',
    how1Desc:        'Enter your addresses, choose a service, pick a time. Takes under 3 minutes.',
    how2Title:       'Get Matched',
    how2Desc:        'A verified, insured driver near you accepts your job and confirms details.',
    how3Title:       'Move Safely',
    how3Desc:        'Track in real time. Payment held in escrow — only released on delivery confirmation.',
    ctaTitle:        'Ready to Move?',
    ctaSubtitle:     'Book any service in under 3 minutes. Verified drivers, secure payment.',
    ctaBookNow:      'Book Now — Instant Prices',
    ctaWhichVan:     'Which Van Do I Need?',
  },

  /* ─── Cookie consent ─── */
  cookies: {
    title:   'We use cookies',
    body:    "FlyttGo uses essential cookies to keep you signed in and your booking flow working. We'd also like to use analytics cookies to understand how customers use the site so we can make it better. You can change your choice any time.",
    essential: 'Essential only',
    accept:    'Accept all',
    seeMore:   'See our',
    privacyPolicy: 'privacy policy',
    forDetails: 'for details.',
    rejectAria: 'Reject non-essential cookies',
  },

  /* ─── Error boundary ─── */
  errors: {
    title:   'Something went wrong',
    body:    'FlyttGo ran into an unexpected error. Reloading the page should fix it.',
    reload:  'Reload',
    backToHome: 'Back to home',
    contact:    'If this keeps happening, contact',
  },
};

/**
 * Recursively widen literal string values in the translation tree to
 * plain `string`, so locale files (like no.ts) with different values
 * still satisfy the same shape as en.ts.
 */
type Widen<T> = T extends string ? string : { [K in keyof T]: Widen<T[K]> };
export type TranslationKeys = Widen<typeof en>;
