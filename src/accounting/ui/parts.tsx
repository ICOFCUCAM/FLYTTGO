/** Small components the accounting screens share (React + Tailwind only). */
import type { ReactNode } from 'react';

export function Card({ title, children, actions }: { title?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="bg-white border border-gray-200 rounded-2xl p-5">
      {(title || actions) && <div className="flex items-center justify-between gap-3 mb-3">{title && <h3 className="font-bold text-gray-900">{title}</h3>}{actions}</div>}
      {children}
    </section>
  );
}

export function Message({ msg }: { msg: { ok: boolean; text: string } | null }) {
  if (!msg) return null;
  return <div role="status" className={`rounded-xl px-4 py-2.5 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>;
}

export function Table({ head, rows, right = [], foot }: { head: string[]; rows: ReactNode[][]; right?: number[]; foot?: ReactNode[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-500 border-b">{head.map((h, i) => <th key={i} className={`py-1.5 px-2 font-medium ${right.includes(i) ? 'text-right' : ''}`}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, ri) => <tr key={ri} className="border-b border-gray-100">{r.map((c, i) => <td key={i} className={`py-1.5 px-2 ${right.includes(i) ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr>)}</tbody>
        {foot && <tfoot><tr className="font-semibold border-t-2">{foot.map((c, i) => <td key={i} className={`py-1.5 px-2 ${right.includes(i) ? 'text-right tabular-nums' : ''}`}>{c}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}

