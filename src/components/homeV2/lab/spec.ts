/**
 * The design specification the Design Refinement Studio exports: the approved tokens (with the CSS
 * custom property each is written to), the typography, spacing and surface rules, the selected
 * composition of each section, and the decision log. JSON for implementation, Markdown for review.
 * Applying an approved version to the site is a code change to design.config.ts, never automatic.
 */
import { cssValue, cssVar, FONTS, RANGE_GROUPS, VARIANT_OPTIONS, type DesignTokens, type DesignVariants } from '../design.config';
import type { Decision } from './decisions';

export type Version = { id: string; name: string; at: string; tokens: DesignTokens; variants: DesignVariants; note: string; from?: string };

export function specJson(v: Version, decisions: Decision[]) {
  return {
    name: v.name, approvedAt: v.at, note: v.note,
    tokens: Object.fromEntries((Object.keys(v.tokens) as (keyof DesignTokens)[]).map(k => [k, { value: v.tokens[k], css: `${cssVar(k)}: ${cssValue(k, v.tokens[k])}` }])),
    fonts: { display: FONTS[v.tokens.fontDisplay], body: FONTS[v.tokens.fontBody], accent: FONTS[v.tokens.fontAccent] },
    compositions: Object.fromEntries(VARIANT_OPTIONS.map(o => [o.key, { value: v.variants[o.key], label: o.options.find(x => x.value === v.variants[o.key])?.label }])),
    decisions,
  };
}

export function specMarkdown(v: Version, decisions: Decision[]) {
  const t = v.tokens;
  const lines = [
    `# FlyttGo homepage design specification: ${v.name}`, '',
    `Approved ${v.at.slice(0, 16).replace('T', ' ')} UTC. ${v.note}`, '',
    '## Colour', '', '| Role | Value | CSS |', '|---|---|---|',
    ...(['blue', 'forest', 'evergreen', 'gold', 'paper', 'white', 'ink'] as const).map(k => `| ${k} | ${t[k]} | \`${cssVar(k)}\` |`), '',
    '## Typography', '',
    `- Display: ${t.fontDisplay} (\`${FONTS[t.fontDisplay]?.stack}\`)`,
    `- Text: ${t.fontBody} (\`${FONTS[t.fontBody]?.stack}\`)`,
    `- Accent serif: ${t.fontAccent} (\`${FONTS[t.fontAccent]?.stack}\`)`, '',
    ...RANGE_GROUPS.flatMap(g => [`## ${g.title}`, '', '| Setting | Value | CSS |', '|---|---|---|',
      ...g.ranges.map(r => `| ${r.label} | ${t[r.key]}${r.unit ?? ''} | \`${cssVar(r.key)}: ${cssValue(r.key, t[r.key])}\` |`), '']),
    '## Components', '',
    `- Buttons: ${t.radius}px corners, 52px tall, display face at 14px/700; primary deep blue, secondary outlined.`,
    `- Labels: display face, 11px uppercase, 0.2em tracking, a 28px champagne hairline before.`,
    `- Product frames: one warm hairline (strength ${t.hairline}×), shadow depth ${t.depth}×, deep-blue title bar; evergreen for finance.`,
    `- Cards: padding 28px × ${t.density}; gaps 16px × ${t.innerScale}.`, '',
    '## Section compositions', '', '| Section | Selected |', '|---|---|',
    ...VARIANT_OPTIONS.map(o => `| ${o.label} | ${o.options.find(x => x.value === v.variants[o.key])?.label ?? v.variants[o.key]} |`), '',
    '## Decision log', '',
    ...decisions.map(d => `- **${d.section}** (${d.category ?? 'composition'}, ${d.date}): chose ${d.chosen} over ${d.compared.join(', ')}. ${d.reason}`),
  ];
  return lines.join('\n') + '\n';
}

export function download(name: string, text: string, type: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
