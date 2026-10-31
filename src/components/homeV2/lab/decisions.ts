/**
 * The visual decision log for /preview/home: each comparison, the alternatives considered, what was
 * chosen and why it is stronger (owner, 31 October 2026: record every hero, photograph, font pairing,
 * section composition and interaction choice). design.config.ts DEFAULT_VARIANTS follows the latest decision for each section. Decisions
 * recorded in the lab itself are kept in the browser and can be exported; the ones below are the
 * reviewed record, compared at identical viewports (1440 × 900 and 390 × 844); later entries supersede
 * earlier ones for the same section.
 */
export type Decision = {
  date: string;
  /* what kind of choice: hero, headline, typography, photograph, composition, interaction, tokens */
  category?: string;
  section: string;
  compared: string[];
  chosen: string;
  reason: string;
};

const D = '2026-10-31';
const C = 'compared in the real preview at 1440 × 900 and 390 × 844';
/* Newest first. Earlier decisions stay as the record of what was replaced. */
export const DECISIONS: Decision[] = [
  { date: D, category: 'hero', section: 'hero', compared: ['A · Editorial platform', 'B · Connected business', 'C · Signature statement'], chosen: 'A · Editorial platform',
    reason: `Supersedes the earlier choice of B; ${C}. A is the only direction whose first screen holds the headline, proposition, actions, all three journeys (as a ruled index under the copy) and a photograph. B is the most immersive but its journeys band falls below the fold and the photograph reads as a moving company. C has the strongest identity (the rising flight line) but its journeys and photograph fall below the fold. C's motif is kept in the studio for a later round.` },
  { date: D, category: 'headline', section: 'headline', compared: ['A · Assisting Companies to Fly High.', 'B · Book services. Run your company. Grow with FlyttGo.', 'C · The platform behind every service business.'], chosen: 'B (owner: “b is more practical”)',
    reason: 'B names the three journeys in the order a visitor meets them, so the hero explains FlyttGo before the proposition line is read. A is the owner’s slogan: memorable, but it says how FlyttGo feels, not what it does; it stays as the signature line above the headline. C is accurate but abstract and speaks only to businesses.' },
  { date: D, category: 'typography', section: 'fonts', compared: ['Manrope / DM Sans / Georgia (fallback)', 'Manrope / DM Sans / Newsreader', 'Instrument Sans / Inter / Instrument Serif', 'Fraunces / DM Sans'], chosen: 'Manrope / DM Sans / Newsreader',
    reason: `${C}. Newsreader replaces a fallback face with a chosen editorial italic and keeps the grotesk’s continuity, so the page changes in voice, not in identity. Instrument looks of its moment and will date; Fraunces at display size reads as a magazine, too heavy for a platform. Heading tracking eased from −0.045 to −0.035em, hero to −0.04em.` },
  { date: D, category: 'photograph', section: 'photo', compared: ['Natural grade', 'Editorial: warm, lifted, softer contrast', 'Documentary: cooler, firmer'], chosen: 'Editorial',
    reason: 'The editorial grade brings photographs of different origin and light closer together and sits with the ivory grounds. Documentary made the interiors cold. The differences are small because the limit is the photographs themselves (a mixed collection); a commissioned or curated set is the real fix.' },
  { date: D, category: 'composition', section: 'moving', compared: ['A · Four-column grid', 'B · Feature and list', 'C · Picture-led pairs'], chosen: 'B',
    reason: 'The marketplace above is already picture-led; B changes pace with one large picture and a ruled list, so moving reads as one vertical, not a second gallery. A repeated the card grid; C doubled the page length.' },
  { date: D, category: 'composition', section: 'booking', compared: ['A · Framed under the hero', 'B · Split with promise', 'C · Deep-blue band'], chosen: 'B',
    reason: 'B states the promise in display type beside the real widget, so booking feels like the first step rather than a form dropped under the hero. C added a third dark band. Below 1000 px B stacks like A.' },
  { date: D, category: 'composition', section: 'industries', compared: ['A · Selector above the panel', 'B · Vertical index beside the panel', 'C · Full-width demonstration'], chosen: 'B',
    reason: 'The vertical index reads as a list of industries and keeps the selected one visible beside the workflow that changes; it also breaks the run of horizontal tab rows on the page. C was handsome but its large tabs competed with the section heading.' },
  { date: D, category: 'composition', section: 'corporate', compared: ['A · Copy beside the dashboard', 'B · Dashboard first, copy below', 'C · Ivory ledger with ruled features'], chosen: 'C',
    reason: 'C gives corporate its own ivory chapter and turns the feature checklist into ruled lines at a readable size. B left a large empty gap between copy and features; A kept the features as small chips.' },
  { date: D, category: 'composition', section: 'providers', compared: ['A · Deep-blue picture panel', 'B · Typographic band', 'C · Evergreen card'], chosen: 'B',
    reason: 'B keeps the middle of the page light (the business workspace is the one dark stage) and sets the invitation large. A repeated the blue panel; C borrowed evergreen, which belongs to finance.' },
  { date: D, category: 'composition', section: 'trust', compared: ['A · Diagram in a panel', 'B · Copy beside the diagram', 'C · Three tiers as columns'], chosen: 'C',
    reason: 'C shows operators, the shared core and providers side by side, the clearest picture of boundaries. B squeezed the four principles into narrow columns (grid collapse).' },
  { date: D, category: 'composition', section: 'closing', compared: ['A · Deep-blue centred', 'B · Ivory with three journeys', 'C · Split statement'], chosen: 'B',
    reason: 'B ends on the three journeys as large equal links, returning to the hero’s promise, and keeps the page light at both ends. A and C were the usual dark closing band.' },
  { date: '2026-10-30', section: 'hero', compared: ['A · editorial split', 'B · full-bleed photograph', 'C · typographic statement'], chosen: 'B',
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
