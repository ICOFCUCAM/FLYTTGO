/**
 * A document as both renderers see it: a title block, then headings,
 * paragraphs, facts and tables. The PDF and the Word file are made from
 * the same document, so they always say the same.
 */

export type Lang = 'en' | 'no';

export interface Column {
  label: string;
  /** Share of the page width. */
  width: number;
  align?: 'left' | 'right';
}

export type Block =
  | { kind: 'heading'; text: string }
  | { kind: 'text'; text: string; tone?: 'normal' | 'note' | 'warning' }
  | { kind: 'facts'; items: Array<[string, string]> }
  | { kind: 'table'; columns: Column[]; rows: string[][]; total?: string[]; emphasis?: number[] }
  | { kind: 'signature'; lines: string[] };

export interface Doc {
  /** File name without extension. */
  name: string;
  title: string;
  subtitle?: string;
  company: string;
  orgNumber?: string | null;
  period: string;
  generated: string;
  lang: Lang;
  blocks: Block[];
  footer: string;
}
