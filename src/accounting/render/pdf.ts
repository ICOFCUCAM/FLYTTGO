/**
 * PDF (1.4) from a document: A4, Helvetica in WinAnsi (Norwegian letters
 * included), tables that continue on the next page with their header, page
 * numbers. No dependencies.
 */
import type { Block, Doc } from '../documents/model';

const W = 595.28, H = 841.89, M = 42;
const BODY = 9, SMALL = 7.5;

// Helvetica glyph widths (1/1000 em) for ASCII 32–126.
const ASCII = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const EXTRA: Record<string, number> = { 'æ': 889, 'ø': 611, 'å': 556, 'Æ': 1000, 'Ø': 778, 'Å': 667, 'é': 556, 'ü': 556, 'ö': 556, 'ä': 556,
  '–': 556, '—': 1000, '…': 1000, '·': 278, '×': 584, '§': 556, '€': 556, '’': 222, '“': 333, '”': 333, '•': 350 };

function glyph(ch: string, bold: boolean): number {
  const c = ch.charCodeAt(0);
  const w = c >= 32 && c <= 126 ? ASCII[c - 32] : EXTRA[ch] ?? 556;
  return bold ? w * 1.06 : w;
}
export function textWidth(s: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of s.replace(/\u2212/g, '-')) w += glyph(ch, bold);
  return (w * size) / 1000;
}

// WinAnsi bytes for the characters a Norwegian document uses.
const WINANSI: Record<string, number> = { '€': 0x80, '…': 0x85, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97 };
function encode(s: string): string {
  let out = '';
  // nb-NO numbers use a no-break space and the minus sign (U+2212); WinAnsi has neither.
  for (const ch of s.replace(/[\u00a0\u202f]/g, ' ').replace(/\u2212/g, '-')) {
    let b = WINANSI[ch] ?? ch.charCodeAt(0);
    if (b > 255) b = 0x3f;                       // not in WinAnsi: '?'
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out;
}

function fit(s: string, max: number, size: number, bold = false): string {
  if (textWidth(s, size, bold) <= max) return s;
  let t = s;
  while (t.length > 1 && textWidth(t + '…', size, bold) > max) t = t.slice(0, -1);
  return t + '…';
}

function wrap(s: string, max: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  for (const para of s.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      const next = line ? line + ' ' + word : word;
      if (textWidth(next, size, bold) > max && line) { lines.push(line); line = word; } else line = next;
    }
    lines.push(line);
  }
  return lines;
}

class Pages {
  pages: string[][] = [];
  y = 0;
  constructor(private doc: Doc) { this.newPage(); }
  get cur() { return this.pages[this.pages.length - 1]; }
  newPage() {
    this.pages.push([]);
    this.y = H - M;
    this.text(this.doc.company + (this.doc.orgNumber ? `  ·  ${this.doc.orgNumber}` : ''), M, this.y, SMALL, false, 0.4);
    this.text(fit(this.doc.title, 260, SMALL), W - M - textWidth(fit(this.doc.title, 260, SMALL), SMALL), this.y, SMALL, false, 0.4);
    this.y -= 18;
  }
  need(h: number) { if (this.y - h < M + 24) this.newPage(); }
  text(s: string, x: number, y: number, size: number, bold = false, grey = 0) {
    this.cur.push(`BT ${grey ? `${grey} g ` : ''}/${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${encode(s)}) Tj ET${grey ? ' 0 g' : ''}`);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, grey = 0.6) {
    this.cur.push(`${grey} G ${width} w ${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S 0 G`);
  }
  rect(x: number, y: number, w: number, h: number, grey: number) {
    this.cur.push(`${grey} g ${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`);
  }
}

function block(p: Pages, b: Block) {
  const width = W - 2 * M;
  if (b.kind === 'heading') {
    p.need(28); p.y -= 8;
    p.text(b.text, M, p.y, 11.5, true); p.y -= 6;
    p.line(M, p.y, W - M, p.y, 0.6, 0.75); p.y -= 12;
  } else if (b.kind === 'text') {
    const size = b.tone === 'note' ? SMALL + 0.5 : BODY;
    for (const l of wrap(b.text, width, size)) {
      p.need(size + 4);
      p.text(l, M, p.y, size, b.tone === 'warning', b.tone === 'note' ? 0.35 : 0);
      p.y -= size + 3.5;
    }
    p.y -= 4;
  } else if (b.kind === 'facts') {
    for (const [k, v] of b.items) {
      const lines = wrap(v, width * 0.62, BODY);
      p.need(lines.length * (BODY + 3) + 2);
      p.text(fit(k, width * 0.36, BODY, true), M, p.y, BODY, true);
      lines.forEach((l, i) => p.text(l, M + width * 0.38, p.y - i * (BODY + 3), BODY));
      p.y -= lines.length * (BODY + 3) + 2;
    }
    p.y -= 6;
  } else if (b.kind === 'table') {
    const total = b.columns.reduce((n, c) => n + c.width, 0);
    const xs: number[] = []; let x = M;
    for (const c of b.columns) { xs.push(x); x += (c.width / total) * width; }
    const cw = (i: number) => (b.columns[i].width / total) * width - 6;
    const row = (cells: string[], bold: boolean, shade?: number) => {
      p.need(BODY + 6);
      if (shade) p.rect(M, p.y - 3, width, BODY + 5, shade);
      cells.forEach((cell, i) => {
        const s = fit(cell ?? '', cw(i), BODY, bold);
        const tx = b.columns[i].align === 'right' ? xs[i] + cw(i) - textWidth(s, BODY, bold) : xs[i];
        p.text(s, tx, p.y, BODY, bold);
      });
      p.y -= BODY + 5;
    };
    const header = () => { row(b.columns.map(c => c.label), true, 0.92); };
    header();
    b.rows.forEach((r, i) => {
      if (p.y - (BODY + 6) < M + 24) { p.newPage(); header(); }
      row(r, b.emphasis?.includes(i) ?? false);
    });
    if (b.total) { p.line(M, p.y + BODY + 2, W - M, p.y + BODY + 2, 0.8, 0.3); row(b.total, true); }
    p.y -= 8;
  } else if (b.kind === 'signature') {
    p.need(60); p.y -= 24;
    const colW = width / b.lines.length;
    b.lines.forEach((l, i) => {
      p.line(M + i * colW, p.y, M + i * colW + colW - 18, p.y, 0.6, 0.3);
      p.text(l, M + i * colW, p.y - 11, SMALL);
    });
    p.y -= 24;
  }
}

export function renderPdf(doc: Doc): Uint8Array {
  const p = new Pages(doc);
  p.y -= 4;
  p.text(doc.title, M, p.y, 17, true); p.y -= 18;
  if (doc.subtitle) { p.text(doc.subtitle, M, p.y, 10.5, false, 0.3); p.y -= 14; }
  p.text(doc.period, M, p.y, BODY, false, 0.3); p.y -= 20;
  for (const b of doc.blocks) block(p, b);

  const n = p.pages.length;
  p.pages.forEach((ops, i) => {
    const label = `${doc.footer}  ·  ${doc.generated}  ·  ${i + 1} / ${n}`;
    ops.push(`BT 0.45 g /F1 ${SMALL} Tf ${M} ${M - 14} Td (${encode(label)}) Tj ET 0 g`);
  });

  // Objects: 1 catalog, 2 pages, 3–4 fonts, then per page its page and content.
  const objs: string[] = [];
  const kids = p.pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ');
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push(`<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  p.pages.forEach((ops, i) => {
    const stream = ops.join('\n');
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`);
    objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });
  const info = `<< /Title (${encode(doc.title)}) /Author (${encode(doc.company)}) /Producer (FlyttGo Regnskap) >>`;
  objs.push(info);

  let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info ${objs.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(out.length);
  for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
  return bytes;
}
