/**
 * Figures from the Driver Terms & Onboarding Agreement (src/pages/DriverTermsPage.tsx), kept in one place so the
 * plain-language summary on /become-a-driver (owner, 31 October 2026, item 12) always says what the agreement says.
 * src/test/driver-page.test.ts checks the agreement page still states each of them.
 */
export const DRIVER_TERMS = {
  lastUpdated: 'March 31, 2026',
  goodsInTransitMinNok: 500_000,
  publicLiabilityMinNok: 5_000_000,
  commissionDisputeDays: 7,
} as const;

/** The summary's points, in the agreement's order, with the section of the full text each one comes from. */
export const TERMS_SUMMARY = [
  { key: 'company', section: 2 },
  { key: 'insurance', section: 3 },
  { key: 'documents', section: 4 },
  { key: 'liability', section: 5 },
  { key: 'independent', section: 6 },
  { key: 'paid', section: 6 },
  { key: 'commission', section: 7 },
  { key: 'conduct', section: 8 },
  { key: 'suspension', section: 9 },
] as const;
