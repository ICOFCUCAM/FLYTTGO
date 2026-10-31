/**
 * The design decision history for /preview/home: each comparison the lab ran, what was chosen and
 * why. design.config.ts DEFAULT_VARIANTS follows the latest decision for each section. Decisions
 * recorded in the lab itself are kept in the browser and can be exported; the ones below are the
 * reviewed record, compared at identical viewports (1440 × 900 and 390 × 844).
 */
export type Decision = {
  date: string;
  section: string;
  compared: string[];
  chosen: string;
  reason: string;
};

const D = '2026-10-31';
export const DECISIONS: Decision[] = [
  { date: D, section: 'hero', compared: ['A · editorial split', 'B · full-bleed photograph', 'C · typographic statement'], chosen: 'B',
    reason: 'B gives the photography the whole width and keeps the brand phrase, proposition and actions together on one ivory card: three clear levels. A left the headline small beside a dominant picture; C pushed the slideshow below the fold at 1440 × 900 and separated the lede from the actions. All three stack the same way at 390, so mobile is unaffected.' },
  { date: D, section: 'journeys', compared: ['A · two routes and a panel', 'B · editorial index', 'C · three equal columns'], chosen: 'A',
    reason: 'A matches how people actually arrive: most come to book or to run their company, so those two routes lead and For Organisations is a quieter panel. C gave all three equal weight; B read as a table of contents and lost each route\u2019s colour cue.' },
  { date: D, section: 'market', compared: ['A · one dominant picture, four beside', 'B · film strip', 'C · catalogue rows'], chosen: 'A',
    reason: 'A has a clear first focus and shows all five categories without scrolling. B hid two categories off-screen at 1440; C made the photographs too small to carry the section.' },
  { date: D, section: 'workspace', compared: ['A · framed application on ivory', 'B · deep-blue stage', 'C · centred, wider application'], chosen: 'B',
    reason: 'The business workspace is the flagship demonstration; the deep-blue stage marks it as the turning point of the page and lifts the application off the ground. It is the only dark section in the middle of the page (finance stays light), so the page is not dark-heavy. Readable at 390.' },
  { date: D, section: 'finance', compared: ['A · evergreen title bar', 'B · paper ledger', 'C · evergreen ground'], chosen: 'A',
    reason: 'A keeps finance its own identity (evergreen) while staying light directly after the blue workspace. C made two dark sections in a row; B was too close to the workspace frame to read as a separate workspace.' },
  { date: D, section: 'studio', compared: ['A · settings beside the storefront', 'B · storefront first', 'C · settings as a toolbar'], chosen: 'A',
    reason: 'With the settings beside the storefront, every change is visible at once without scrolling, which is the point of the demonstration. C pushed the storefront below the settings at 1440 × 900; B put the controls at the far edge, away from where people read first.' },
];
