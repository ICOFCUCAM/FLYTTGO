/**
 * A one-page PDF of plain text lines (owner, 31 October 2026: the price checker's summary to show a partner or
 * accountant). Built by hand so the site carries no PDF library: standard Helvetica fonts in WinAnsi encoding,
 * which covers Norwegian letters (æ ø å) and the dash; anything outside it becomes "?".
 */
export interface PdfLine { text: string; size?: number; bold?: boolean; gap?: number; right?: string }

const WIN_ANSI_EXTRA: Record<string, number> = { '–': 0x96, '—': 0x97, '’': 0x92, '‘': 0x91, '“': 0x93, '”': 0x94, '•': 0x95, '€': 0x80, ' ': 0x20, ' ': 0x20 };

/** A PDF string literal for `s`: WinAnsi bytes, with ( ) \ escaped and other bytes above 126 as octal. */
export function pdfString(s: string): string {
  let out = '(';
  for (const ch of s) {
    let code = ch.codePointAt(0)!;
    if (WIN_ANSI_EXTRA[ch] !== undefined) code = WIN_ANSI_EXTRA[ch];
    else if (code > 255 || (code > 126 && code < 160)) code = 63; // "?"
    if (code === 40 || code === 41 || code === 92) out += '\\' + String.fromCharCode(code);
    else if (code < 32 || code > 126) out += '\\' + code.toString(8).padStart(3, '0');
    else out += String.fromCharCode(code);
  }
  return out + ')';
}

/* Helvetica widths (per 1000 em) for right-aligning figures; digits, space and the usual punctuation. */
const W: Record<string, number> = { ' ': 278, ',': 278, '.': 278, '-': 333, '%': 889, N: 722, O: 778, K: 667, ':': 278, '/': 278 };
function width(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += /[0-9]/.test(ch) ? 556 : (W[ch] ?? 600);
  return (w / 1000) * size;
}

/** The PDF file's bytes for an A4 page of the given lines, top to bottom. */
export function buildPdf(lines: PdfLine[], opts: { title?: string } = {}): Uint8Array {
  const left = 56, right = 595 - 56;
  let y = 842 - 64;
  const ops: string[] = [];
  for (const l of lines) {
    const size = l.size ?? 11;
    y -= l.gap ?? size * 1.5;
    const font = l.bold ? '/F2' : '/F1';
    ops.push(`BT ${font} ${size} Tf ${left} ${y.toFixed(1)} Td ${pdfString(l.text)} Tj ET`);
    if (l.right) ops.push(`BT ${font} ${size} Tf ${(right - width(l.right, size)).toFixed(1)} ${y.toFixed(1)} Td ${pdfString(l.right)} Tj ET`);
  }
  const content = ops.join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    `<< /Title ${pdfString(opts.title ?? 'FlyttGo')} /Producer (FlyttGo) >>`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = new Uint8Array(pdf.length);
  for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
  return bytes;
}

/** Offers the PDF to the visitor as a download. */
export function downloadPdf(bytes: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' }));
  const a = document.createElement('a');
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
