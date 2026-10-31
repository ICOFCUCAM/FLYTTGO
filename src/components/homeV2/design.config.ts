/**
 * The one source of the restructured homepage's design settings (docs/HOMEPAGE_RESTRUCTURE.md):
 * the design tokens and the composition variants. HomeV2Page applies the defaults; the private
 * design lab (/preview/lab, never on production hosts) applies trial settings to the same page.
 * homeV2.css reads every token as a CSS custom property and every variant as a data attribute on
 * the .fgv2 root, so a change here, or in the lab, updates the whole page consistently.
 */

export type DesignTokens = {
  blue: string; forest: string; gold: string; paper: string; white: string; ink: string;
  typeScale: number; heroScale: number; spaceScale: number; wrapMax: number;
  radius: number; corner: number; depth: number; imgSat: number; imgWarm: number;
};

type ABC = 'a' | 'b' | 'c';
export type DesignVariants = {
  hero: ABC; journeys: ABC; market: ABC; workspace: ABC; finance: ABC; studio: ABC; motion: 'on' | 'off';
};

export const DEFAULT_TOKENS: DesignTokens = {
  blue: '#203F68', forest: '#24513B', gold: '#C3A66C', paper: '#F5F3EB', white: '#FFFEFA', ink: '#17212E',
  typeScale: 1, heroScale: 1, spaceScale: 1, wrapMax: 1320,
  radius: 2, corner: 64, depth: 1, imgSat: 0.86, imgWarm: 0.05,
};

/* The selected composition of each section (decisions.ts records why). */
export const DEFAULT_VARIANTS: DesignVariants = { hero: 'b', journeys: 'a', market: 'a', workspace: 'b', finance: 'a', studio: 'a', motion: 'on' };

type Range = { key: keyof DesignTokens; label: string; min: number; max: number; step: number; unit?: string };
type Colour = { key: keyof DesignTokens; label: string };

export const COLOUR_CONTROLS: Colour[] = [
  { key: 'blue', label: 'Deep blue · brand, actions, dark panels' },
  { key: 'forest', label: 'Forest · positive states, booking' },
  { key: 'gold', label: 'Champagne · hairlines, numerals' },
  { key: 'paper', label: 'Ivory · alternate ground' },
  { key: 'white', label: 'Soft white · main ground' },
  { key: 'ink', label: 'Ink · body text' },
];

export const RANGE_CONTROLS: Range[] = [
  { key: 'typeScale', label: 'Section headings scale', min: 0.8, max: 1.25, step: 0.01, unit: '×' },
  { key: 'heroScale', label: 'Hero headline scale', min: 0.8, max: 1.2, step: 0.01, unit: '×' },
  { key: 'spaceScale', label: 'Section spacing', min: 0.6, max: 1.4, step: 0.05, unit: '×' },
  { key: 'wrapMax', label: 'Content width', min: 1080, max: 1520, step: 10, unit: 'px' },
  { key: 'radius', label: 'Corner radius', min: 0, max: 16, step: 1, unit: 'px' },
  { key: 'corner', label: 'Signature corner', min: 0, max: 120, step: 4, unit: 'px' },
  { key: 'depth', label: 'Surface depth (shadow)', min: 0, max: 2, step: 0.1, unit: '×' },
  { key: 'imgSat', label: 'Photo saturation', min: 0.5, max: 1.1, step: 0.01 },
  { key: 'imgWarm', label: 'Photo warmth', min: 0, max: 0.25, step: 0.01 },
];

export const VARIANT_OPTIONS: { key: keyof DesignVariants; label: string; options: { value: string; label: string }[] }[] = [
  { key: 'hero', label: 'Hero', options: [
    { value: 'a', label: 'A · Editorial split' },
    { value: 'b', label: 'B · Full-bleed photograph' },
    { value: 'c', label: 'C · Typographic statement' },
  ] },
  { key: 'journeys', label: 'Journeys', options: [
    { value: 'a', label: 'A · Two routes and a panel' },
    { value: 'b', label: 'B · Editorial index' },
    { value: 'c', label: 'C · Three equal columns' },
  ] },
  { key: 'market', label: 'Marketplace', options: [
    { value: 'a', label: 'A · One dominant picture, four beside' },
    { value: 'b', label: 'B · Film strip' },
    { value: 'c', label: 'C · Catalogue rows' },
  ] },
  { key: 'workspace', label: 'Business workspace', options: [
    { value: 'a', label: 'A · Framed application on ivory' },
    { value: 'b', label: 'B · Deep-blue stage' },
    { value: 'c', label: 'C · Centred, wider application' },
  ] },
  { key: 'finance', label: 'Financial workspace', options: [
    { value: 'a', label: 'A · Evergreen title bar' },
    { value: 'b', label: 'B · Paper ledger' },
    { value: 'c', label: 'C · Evergreen ground' },
  ] },
  { key: 'studio', label: 'Marketplace Studio', options: [
    { value: 'a', label: 'A · Settings beside the storefront' },
    { value: 'b', label: 'B · Storefront first' },
    { value: 'c', label: 'C · Settings as a toolbar' },
  ] },
  { key: 'motion', label: 'Motion', options: [{ value: 'on', label: 'On (reduced motion respected)' }, { value: 'off', label: 'Off' }] },
];

const PX: (keyof DesignTokens)[] = ['wrapMax', 'radius', 'corner'];
const VAR: Record<keyof DesignTokens, string> = {
  blue: '--blue', forest: '--forest', gold: '--gold', paper: '--paper', white: '--white', ink: '--ink',
  typeScale: '--type-scale', heroScale: '--hero-scale', spaceScale: '--space-scale', wrapMax: '--wrap-max',
  radius: '--radius', corner: '--corner', depth: '--depth', imgSat: '--img-sat', imgWarm: '--img-warm',
};

/** Writes tokens as custom properties and variants as data attributes on the page root. */
export function applyDesign(el: HTMLElement, tokens: DesignTokens, variants: DesignVariants) {
  (Object.keys(VAR) as (keyof DesignTokens)[]).forEach(k => {
    const v = tokens[k];
    el.style.setProperty(VAR[k], typeof v === 'number' && PX.includes(k) ? `${v}px` : String(v));
  });
  (Object.keys(variants) as (keyof DesignVariants)[]).forEach(k => { el.dataset[k] = variants[k]; });
}

/** The message the lab sends to the preview in its frames. */
export type LabMessage = { type: 'flyttgo-design'; tokens: DesignTokens; variants: DesignVariants };
export const isLabMessage = (d: unknown): d is LabMessage =>
  !!d && typeof d === 'object' && (d as { type?: string }).type === 'flyttgo-design';
