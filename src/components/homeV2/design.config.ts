/**
 * The one source of the restructured homepage's design settings (docs/HOMEPAGE_RESTRUCTURE.md):
 * design tokens, section compositions and the selected headline. HomeV2Page applies the selected
 * configuration; the private Design Refinement Studio (/preview/lab, never on production hosts)
 * applies trial configurations to the same page. homeV2.css reads every token as a CSS custom
 * property and every composition as a data attribute on the .fgv2 root, so one change here, or
 * in the studio, updates the whole page consistently. lab/decisions.ts records why each selected
 * value won.
 */

/* ── Typefaces the studio can compare (Google Fonts, as the page already loads its faces) ── */
export const FONTS: Record<string, { stack: string; google?: string }> = {
  'Manrope': { stack: 'Manrope, sans-serif', google: 'Manrope:wght@400;500;600;700;800' },
  'Instrument Sans': { stack: '"Instrument Sans", sans-serif', google: 'Instrument+Sans:wght@400;500;600;700' },
  'Bricolage Grotesque': { stack: '"Bricolage Grotesque", sans-serif', google: 'Bricolage+Grotesque:opsz,wght@12..96,400..800' },
  'Inter Tight': { stack: '"Inter Tight", sans-serif', google: 'Inter+Tight:wght@400;500;600;700;800' },
  'DM Sans': { stack: '"DM Sans", sans-serif', google: 'DM+Sans:wght@400;500;600;700' },
  'Inter': { stack: 'Inter, sans-serif', google: 'Inter:wght@400;500;600;700' },
  'Newsreader': { stack: 'Newsreader, Georgia, serif', google: 'Newsreader:ital,opsz,wght@0,6..72,400..700;1,6..72,400..700' },
  'Instrument Serif': { stack: '"Instrument Serif", Georgia, serif', google: 'Instrument+Serif:ital@0;1' },
  'Fraunces': { stack: 'Fraunces, Georgia, serif', google: 'Fraunces:ital,opsz,wght@0,9..144,300..800;1,9..144,300..800' },
  'Georgia': { stack: 'Georgia, "Times New Roman", serif' },
};
export const DISPLAY_FONTS = ['Manrope', 'Instrument Sans', 'Bricolage Grotesque', 'Inter Tight', 'Fraunces', 'Newsreader'];
export const BODY_FONTS = ['DM Sans', 'Inter', 'Instrument Sans', 'Manrope'];
export const ACCENT_FONTS = ['Newsreader', 'Instrument Serif', 'Fraunces', 'Georgia'];

export type DesignTokens = {
  /* colour */
  blue: string; forest: string; evergreen: string; gold: string; paper: string; white: string; ink: string;
  /* typography */
  fontDisplay: string; fontBody: string; fontAccent: string;
  heroScale: number; heroWeight: number; heroLeading: number; heroTracking: number;
  typeScale: number; headWeight: number; headLeading: number; headTracking: number; bodySize: number;
  /* space and grid */
  spaceScale: number; innerScale: number; wrapMax: number; split: number;
  /* images */
  imgSat: number; imgWarm: number; imgContrast: number; imgPosX: number; imgPosY: number; heroHeight: number;
  /* surfaces */
  radius: number; corner: number; depth: number; hairline: number; density: number;
  /* motion */
  motionDistance: number; motionDuration: number;
};

type ABC = 'a' | 'b' | 'c';
export type DesignVariants = {
  hero: ABC; headline: ABC; journeys: ABC; market: ABC; moving: ABC; booking: ABC; workspace: ABC; finance: ABC;
  industries: ABC; corporate: ABC; providers: ABC; studio: ABC; trust: ABC; closing: ABC;
  grounds: 'alternate' | 'quiet' | 'banded'; photo: 'natural' | 'editorial' | 'documentary'; motion: 'on' | 'off';
};

/* The approved palette and the type of #21, kept as the baseline every trial is compared with. */
export const BASELINE_TOKENS: DesignTokens = {
  blue: '#203F68', forest: '#24513B', evergreen: '#20352B', gold: '#C3A66C', paper: '#F5F3EB', white: '#FFFEFA', ink: '#17212E',
  fontDisplay: 'Manrope', fontBody: 'DM Sans', fontAccent: 'Georgia',
  heroScale: 1, heroWeight: 650, heroLeading: 0.98, heroTracking: -0.045,
  typeScale: 1, headWeight: 650, headLeading: 1.04, headTracking: -0.045, bodySize: 16,
  spaceScale: 1, innerScale: 1, wrapMax: 1320, split: 46,
  imgSat: 0.86, imgWarm: 0.05, imgContrast: 1.03, imgPosX: 50, imgPosY: 50, heroHeight: 1,
  radius: 2, corner: 64, depth: 1, hairline: 1, density: 1,
  motionDistance: 28, motionDuration: 0.9,
};
export const BASELINE_VARIANTS: DesignVariants = {
  hero: 'b', headline: 'a', journeys: 'a', market: 'a', moving: 'a', booking: 'a', workspace: 'b', finance: 'a',
  industries: 'a', corporate: 'a', providers: 'a', studio: 'a', trust: 'a', closing: 'a',
  grounds: 'alternate', photo: 'natural', motion: 'on',
};

/* The selected design (lab/decisions.ts gives the alternatives and reasons for each value). */
export const DEFAULT_TOKENS: DesignTokens = { ...BASELINE_TOKENS, heroTracking: -0.04, headTracking: -0.035 };
export const DEFAULT_VARIANTS: DesignVariants = {
  ...BASELINE_VARIANTS, hero: 'a', headline: 'b', photo: 'natural',
  moving: 'b', booking: 'b', industries: 'b', corporate: 'c', providers: 'b', trust: 'c', closing: 'b',
};

type Range = { key: keyof DesignTokens; label: string; min: number; max: number; step: number; unit?: string };

export const COLOUR_CONTROLS: { key: keyof DesignTokens; label: string }[] = [
  { key: 'blue', label: 'Deep blue · brand, actions, dark panels' },
  { key: 'forest', label: 'Forest · positive states, booking' },
  { key: 'evergreen', label: 'Evergreen · financial identity' },
  { key: 'gold', label: 'Champagne · hairlines, numerals' },
  { key: 'paper', label: 'Ivory · alternate ground' },
  { key: 'white', label: 'Soft white · main ground' },
  { key: 'ink', label: 'Ink · body text' },
];

export const FONT_CONTROLS: { key: 'fontDisplay' | 'fontBody' | 'fontAccent'; label: string; options: string[] }[] = [
  { key: 'fontDisplay', label: 'Display face · headings, labels', options: DISPLAY_FONTS },
  { key: 'fontBody', label: 'Text face · paragraphs, tables', options: BODY_FONTS },
  { key: 'fontAccent', label: 'Accent serif · second heading line', options: ACCENT_FONTS },
];

export const RANGE_GROUPS: { title: string; ranges: Range[] }[] = [
  { title: 'Hero typography', ranges: [
    { key: 'heroScale', label: 'Headline size', min: 0.7, max: 1.3, step: 0.01, unit: '×' },
    { key: 'heroWeight', label: 'Headline weight', min: 300, max: 800, step: 50 },
    { key: 'heroLeading', label: 'Headline line height', min: 0.85, max: 1.25, step: 0.01 },
    { key: 'heroTracking', label: 'Headline letter spacing', min: -0.08, max: 0.02, step: 0.005, unit: 'em' },
  ] },
  { title: 'Section typography', ranges: [
    { key: 'typeScale', label: 'Heading size', min: 0.75, max: 1.3, step: 0.01, unit: '×' },
    { key: 'headWeight', label: 'Heading weight', min: 300, max: 800, step: 50 },
    { key: 'headLeading', label: 'Heading line height', min: 0.9, max: 1.3, step: 0.01 },
    { key: 'headTracking', label: 'Heading letter spacing', min: -0.08, max: 0.02, step: 0.005, unit: 'em' },
    { key: 'bodySize', label: 'Intro text size', min: 14, max: 20, step: 0.5, unit: 'px' },
  ] },
  { title: 'Space and grid', ranges: [
    { key: 'spaceScale', label: 'Section spacing', min: 0.5, max: 1.5, step: 0.05, unit: '×' },
    { key: 'innerScale', label: 'Spacing inside components', min: 0.6, max: 1.5, step: 0.05, unit: '×' },
    { key: 'wrapMax', label: 'Content width', min: 1040, max: 1560, step: 10, unit: 'px' },
    { key: 'split', label: 'Copy share of split layouts', min: 32, max: 60, step: 1, unit: '%' },
  ] },
  { title: 'Photography', ranges: [
    { key: 'imgSat', label: 'Saturation', min: 0.4, max: 1.15, step: 0.01 },
    { key: 'imgWarm', label: 'Warmth', min: 0, max: 0.3, step: 0.01 },
    { key: 'imgContrast', label: 'Contrast', min: 0.85, max: 1.25, step: 0.01 },
    { key: 'imgPosX', label: 'Crop focus, horizontal', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'imgPosY', label: 'Crop focus, vertical', min: 0, max: 100, step: 1, unit: '%' },
    { key: 'heroHeight', label: 'Hero picture height', min: 0.7, max: 1.3, step: 0.01, unit: '×' },
  ] },
  { title: 'Surfaces', ranges: [
    { key: 'radius', label: 'Corner radius', min: 0, max: 20, step: 1, unit: 'px' },
    { key: 'corner', label: 'Signature corner', min: 0, max: 140, step: 4, unit: 'px' },
    { key: 'depth', label: 'Shadow depth', min: 0, max: 2, step: 0.1, unit: '×' },
    { key: 'hairline', label: 'Hairline strength', min: 0, max: 2, step: 0.1, unit: '×' },
    { key: 'density', label: 'Card density (padding)', min: 0.6, max: 1.5, step: 0.05, unit: '×' },
  ] },
  { title: 'Motion', ranges: [
    { key: 'motionDistance', label: 'Entrance distance', min: 0, max: 60, step: 2, unit: 'px' },
    { key: 'motionDuration', label: 'Transition duration', min: 0.2, max: 1.6, step: 0.05, unit: 's' },
  ] },
];

const o = (value: string, label: string) => ({ value, label });
export const VARIANT_OPTIONS: { key: keyof DesignVariants; label: string; section: string; options: { value: string; label: string }[] }[] = [
  { key: 'hero', label: 'Hero', section: '', options: [o('a', 'A · Editorial platform'), o('b', 'B · Connected business'), o('c', 'C · Signature statement')] },
  { key: 'headline', label: 'Headline', section: '', options: [o('a', 'A · Assisting Companies to Fly High'), o('b', 'B · Book services. Run your company. Grow.'), o('c', 'C · The platform behind every service business')] },
  { key: 'journeys', label: 'Visitor journeys', section: 'entry-points', options: [o('a', 'A · Two routes and a panel'), o('b', 'B · Editorial index'), o('c', 'C · Three equal columns')] },
  { key: 'market', label: 'Marketplace', section: 'marketplace', options: [o('a', 'A · One dominant picture, four beside'), o('b', 'B · Film strip'), o('c', 'C · Catalogue rows')] },
  { key: 'moving', label: 'Moving and transport', section: 'moving-services', options: [o('a', 'A · Four-column service grid'), o('b', 'B · Feature and list'), o('c', 'C · Picture-led pairs')] },
  { key: 'booking', label: 'Booking experience', section: 'booking', options: [o('a', 'A · Framed under the hero'), o('b', 'B · Split with promise'), o('c', 'C · Deep-blue band')] },
  { key: 'workspace', label: 'Business workspace', section: 'business-workspace', options: [o('a', 'A · Framed on ivory'), o('b', 'B · Deep-blue stage'), o('c', 'C · Centred, wider application')] },
  { key: 'finance', label: 'Financial workspace', section: 'financial-administration', options: [o('a', 'A · Evergreen title bar'), o('b', 'B · Paper ledger'), o('c', 'C · Evergreen ground')] },
  { key: 'industries', label: 'Industry experiences', section: 'industry-experiences', options: [o('a', 'A · Selector above the panel'), o('b', 'B · Vertical index beside the panel'), o('c', 'C · Full-width demonstration')] },
  { key: 'corporate', label: 'Corporate services', section: 'business', options: [o('a', 'A · Copy beside the dashboard'), o('b', 'B · Dashboard first, copy below'), o('c', 'C · Ivory ledger with ruled features')] },
  { key: 'providers', label: 'Provider network', section: 'driver-network', options: [o('a', 'A · Picture panel'), o('b', 'B · Typographic band'), o('c', 'C · Evergreen card')] },
  { key: 'studio', label: 'Marketplace Studio', section: 'white-label-builder', options: [o('a', 'A · Settings beside the storefront'), o('b', 'B · Storefront first'), o('c', 'C · Settings as a toolbar')] },
  { key: 'trust', label: 'Trust and infrastructure', section: 'marketplace-network-experience', options: [o('a', 'A · Diagram in a panel'), o('b', 'B · Copy beside the diagram'), o('c', 'C · Three tiers as columns')] },
  { key: 'closing', label: 'Closing section', section: 'final-cta', options: [o('a', 'A · Deep-blue centred'), o('b', 'B · Ivory with three journeys'), o('c', 'C · Split statement')] },
  { key: 'grounds', label: 'Background treatment', section: '', options: [o('alternate', 'Alternate white and ivory'), o('quiet', 'Quiet: all soft white, hairlines only'), o('banded', 'Banded: ivory chapters, white demos')] },
  { key: 'photo', label: 'Photography direction', section: 'marketplace', options: [o('natural', 'Natural (current grade)'), o('editorial', 'Editorial: warm, lifted, softer contrast'), o('documentary', 'Documentary: cooler, firmer, less colour')] },
  { key: 'motion', label: 'Motion', section: '', options: [o('on', 'On (reduced motion respected)'), o('off', 'Off')] },
];

const PX: (keyof DesignTokens)[] = ['wrapMax', 'radius', 'corner', 'bodySize', 'motionDistance'];
const EM: (keyof DesignTokens)[] = ['heroTracking', 'headTracking'];
const PCT: (keyof DesignTokens)[] = ['imgPosX', 'imgPosY', 'split'];
const SEC: (keyof DesignTokens)[] = ['motionDuration'];

/** The custom property each token is written to: --blue, --font-display, --hero-scale … */
export const cssVar = (k: keyof DesignTokens) => '--' + k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());

/** The CSS value a token is written as. */
export function cssValue(k: keyof DesignTokens, v: string | number) {
  if (k === 'fontDisplay' || k === 'fontBody' || k === 'fontAccent') return FONTS[String(v)]?.stack ?? String(v);
  if (typeof v !== 'number') return v;
  return PX.includes(k) ? `${v}px` : EM.includes(k) ? `${v}em` : PCT.includes(k) ? `${v}%` : SEC.includes(k) ? `${v}s` : String(v);
}

/** Writes tokens as custom properties and compositions as data attributes on the page root. */
export function applyDesign(el: HTMLElement, tokens: DesignTokens, variants: DesignVariants) {
  (Object.keys(tokens) as (keyof DesignTokens)[]).forEach(k => el.style.setProperty(cssVar(k), cssValue(k, tokens[k])));
  (Object.keys(variants) as (keyof DesignVariants)[]).forEach(k => { el.dataset[k] = variants[k]; });
}

/** The Google Fonts stylesheet for a set of families. */
export const googleFontsHref = (families: string[]) => {
  const q = [...new Set(families)].map(f => FONTS[f]?.google).filter(Boolean).map(g => `family=${g}`).join('&');
  return q ? `https://fonts.googleapis.com/css2?${q}&display=swap` : '';
};

/* Messages between the studio and the preview frames (same origin only). */
export type LabMessage = { type: 'flyttgo-design'; tokens: DesignTokens; variants: DesignVariants };
export const isLabMessage = (d: unknown): d is LabMessage =>
  !!d && typeof d === 'object' && (d as { type?: string }).type === 'flyttgo-design';
