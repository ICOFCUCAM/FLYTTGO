/**
 * Admin → Accounting: approve or decline companies' requests for the add-on
 * (on the price list, or at an agreed price for the Enterprise band), see
 * every ledger's band, and keep FlyttGo's own books. FlyttGo's
 * administrators never see a company's books (00015).
 */
import { useCallback, useEffect, useState } from 'react';
import { money } from '../../accounting/i18n';
import type { Ledger, TierInfo } from '../../accounting/types';
import AccountingOffice from '../../accounting/ui/AccountingOffice';
import { accountingApi } from '../../lib/accounting';

const btn = 'px-3 py-1.5 rounded-lg text-sm font-semibold disabled:opacity-50';

export default function AccountingAdminPanel() {
  const [ledgers, setLedgers] = useState<Ledger[]>([]);
  const [tiers, setTiers] = useState<Record<string, TierInfo | null>>({});
  const [house, setHouse] = useState<Ledger | null | undefined>(undefined);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState({ name: 'FlyttGo AS', org: '', start: `${new Date().getFullYear()}-01-01` });

  const reload = useCallback(async () => {
    const all = await accountingApi.allLedgers();
    setLedgers(all.filter(l => l.tenant_id));
    setHouse(all.find(l => !l.tenant_id) ?? null);
    const t: Record<string, TierInfo | null> = {};
    for (const l of all.filter(x => x.tenant_id)) t[l.id] = await accountingApi.host.tier!(l.id);
    setTiers(t);
  }, []);
  useEffect(() => { reload(); }, [reload]);

  async function act(fn: () => Promise<{ error: string | null }>, ok: string) {
    setBusy(true); setMsg(null);
    const r = await fn();
    setBusy(false);
    setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: ok });
    await reload();
  }

  return (
    <div className="space-y-6">
      {msg && <div className={`rounded-xl px-4 py-2.5 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}
      <section className="bg-white rounded-2xl border p-5">
        <h3 className="font-bold mb-1">Companies' accounting</h3>
        <p className="text-xs text-gray-500 mb-3">Priced by the company's turnover band; an agreed price overrides it (required in the Enterprise band). You see the request and the band, never the books.</p>
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b"><th className="py-1.5">Company</th><th>Status</th><th>Band (basis)</th><th className="text-right">Monthly</th><th /></tr></thead>
          <tbody>{ledgers.map(l => {
            const tier = tiers[l.id];
            return (
              <tr key={l.id} className="border-b border-gray-100">
                <td className="py-2">{l.legal_name}<div className="text-xs text-gray-500">{l.org_number}</div></td>
                <td>{l.status}</td>
                <td>{tier?.tier ?? '—'} <span className="text-xs text-gray-500">({money(tier?.turnover ?? 0, 'en')}, {tier?.basis})</span></td>
                <td className="text-right tabular-nums">{tier?.monthly_fee !== null && tier?.monthly_fee !== undefined ? money(tier.monthly_fee, 'en') : 'to agree'}{l.monthly_fee !== null ? ' (agreed)' : ''}</td>
                <td className="text-right space-x-2 whitespace-nowrap">
                  {l.status === 'requested' && <>
                    <button disabled={busy} className={`${btn} bg-emerald-600 text-white`} onClick={() => {
                      const agreed = tier?.list_fee === null ? prompt('Enterprise band: agreed monthly price (NOK excl. MVA)') : prompt('Agreed monthly price, or leave empty for the price list', '');
                      if (agreed === null) return;
                      if (tier?.list_fee === null && !agreed) return;
                      act(() => accountingApi.decide(l.id, true, agreed ? Number(agreed) : null, ''), 'Approved.');
                    }}>Approve</button>
                    <button disabled={busy} className={`${btn} bg-gray-100`} onClick={() => {
                      const why = prompt('Reason for declining'); if (why) act(() => accountingApi.decide(l.id, false, null, why), 'Declined.');
                    }}>Decline</button>
                  </>}
                </td>
              </tr>
            );
          })}</tbody>
        </table>
        {ledgers.length === 0 && <p className="text-sm text-gray-500 py-2">No requests yet.</p>}
      </section>

      <section className="bg-white rounded-2xl border p-5">
        <h3 className="font-bold mb-3">FlyttGo's own books</h3>
        {house === undefined ? <p className="text-sm text-gray-500">Loading…</p> : house ? (
          <AccountingOffice api={accountingApi} ledgerId={house.id} host={{ software: { company: 'FlyttGo AS', id: 'FlyttGo Regnskap', version: '1.0' }, company: {} }} />
        ) : (
          <div className="flex flex-wrap items-end gap-3 text-sm">
            <p className="w-full text-gray-600">FlyttGo's own invoices (bookings on invoice, plans, the accounting add-on) are posted here once the books are open.</p>
            <label className="flex flex-col">Legal name<input className="border rounded-lg px-2 py-1.5" value={open.name} onChange={e => setOpen({ ...open, name: e.target.value })} /></label>
            <label className="flex flex-col">Organisation number<input className="border rounded-lg px-2 py-1.5" value={open.org} onChange={e => setOpen({ ...open, org: e.target.value })} /></label>
            <label className="flex flex-col">Books start<input type="date" className="border rounded-lg px-2 py-1.5" value={open.start} onChange={e => setOpen({ ...open, start: e.target.value })} /></label>
            <button disabled={busy} className={`${btn} bg-gray-900 text-white`} onClick={() =>
              act(() => accountingApi.openHouse(open.name, open.org, open.start.slice(0, 8) + '01', 'bimonthly'), 'FlyttGo\'s books are open.')}>Open the books</button>
          </div>
        )}
      </section>
    </div>
  );
}

