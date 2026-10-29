/**
 * Corporate dashboard → White label (docs/WHITE_LABEL.md). The company
 * chooses a plan (Model A by default; Model B "Own seller" for companies
 * that sell themselves), sets up its page, and sees what is still needed
 * before FlyttGo approves it. Owners and admins make changes; an owner
 * accepts the data processing agreement and connects Stripe (Model B).
 * Add-on modules on the plan (00022) are listed here; FlyttGo enables them.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useApp } from '../../lib/store';
import type { Membership } from '../../lib/organizations';
import { formatNok } from '../../lib/invoicing';
import {
  ADDON_LABELS, DPA_VERSION, PRICE_STATUS_LABELS, SELLER_LABELS, STATUS_LABELS, acceptDpa, addonPrice, endPlan, loadAddons,
  loadOrgWhiteLabel, loadPlans, loadStats, loadTemplateList, missingFor, requestPlan, saveBrand, setDomain, setSite, stripeConnect, verifyDomain,
  type OrgAddon, type OrgWhiteLabel, type SiteTemplateSummary, type WhiteLabelPlan,
} from '../../lib/whiteLabel';
import { sellerSplit } from '../../../supabase/functions/_shared/white-label';
import { INDUSTRIES, setIndustry } from '../../lib/services';
import TemplateCatalogue from '../whiteLabel/TemplateCatalogue';

const input = 'w-full border border-gray-200 rounded-xl px-3 py-2 text-sm';
const btn = 'px-4 py-2 rounded-xl text-sm font-semibold disabled:opacity-50';

export default function WhiteLabelPanel({ membership }: { membership: Membership }) {
  const { setPage } = useApp();
  const org = membership.organization;
  const role = membership.role;
  const canEdit = role === 'owner' || role === 'admin';
  const [plans, setPlans] = useState<WhiteLabelPlan[]>([]);
  const [wl, setWl] = useState<OrgWhiteLabel | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [templates, setTemplates] = useState<SiteTemplateSummary[]>([]);
  const [stats, setStats] = useState<Awaited<ReturnType<typeof loadStats>>>([]);
  const [addons, setAddons] = useState<OrgAddon[]>([]);
  const [choice, setChoice] = useState<string>('');
  const [brand, setBrand] = useState({ display_name: '', primary_color: '', accent_color: '', tagline: '', support_email: '',
                                       support_phone: '', terms_url: '', privacy_url: '', markup_pct: 0 });
  const [domain, setDomainText] = useState('');
  const [records, setRecords] = useState<{ txt: { name: string; value: string }; cname: { name: string; value: string } } | null>(null);
  const [template, setTemplate] = useState<string>('');
  const [city, setCity] = useState('');
  const [industry, setIndustryValue] = useState<string>(org.industry ?? '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const [p, w, t, a] = await Promise.all([loadPlans(), loadOrgWhiteLabel(org.id), loadTemplateList(), loadAddons(org.id)]);
    setPlans(p); setWl(w); setTemplates(t); setAddons(a);
    setChoice(w?.requested_plan_code ?? w?.plan_code ?? p.find(x => x.is_default)?.code ?? '');
    if (w) {
      setBrand({ display_name: w.display_name ?? '', primary_color: w.primary_color ?? '', accent_color: w.accent_color ?? '',
                 tagline: w.tagline ?? '', support_email: w.support_email ?? '', support_phone: w.support_phone ?? '',
                 terms_url: w.terms_url ?? '', privacy_url: w.privacy_url ?? '', markup_pct: Number(w.price_markup_pct ?? 0) });
      setDomainText(w.custom_domain ?? ''); setTemplate(w.template_id ?? ''); setCity(w.city ?? '');
      setMissing(await missingFor(org.id));
      if (w.started_at) setStats(await loadStats(org.id));
    }
  }, [org.id]);
  useEffect(() => { reload(); }, [reload]);

  /* Back from Stripe's onboarding: read the account's status. */
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get('white_label');
    if (q === 'stripe_return' || q === 'stripe_refresh') {
      stripeConnect(org.id, 'status').then(() => reload());
    }
  }, [org.id, reload]);

  const plan = useMemo(() => plans.find(p => p.code === (wl?.requested_plan_code ?? wl?.plan_code ?? choice)), [plans, wl, choice]);
  const companySells = plan?.seller_model === 'company';

  async function run(fn: () => Promise<string | null>, ok: string) {
    setBusy(true); setMsg(null);
    const e = await fn();
    setBusy(false);
    setMsg(e ? { ok: false, text: e } : { ok: true, text: ok });
    await reload();
  }

  const example = companySells && plan ? sellerSplit(5000, { markup_pct: brand.markup_pct, platform_fee_pct: plan.platform_fee_pct, platform_fee_min: plan.platform_fee_min }) : null;

  return (
    <div className="space-y-6 max-w-4xl">
      {msg && <div className={`rounded-xl px-4 py-3 text-sm ${msg.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>{msg.text}</div>}

      {/* Status */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-bold text-gray-900">Your own booking page</h2>
            <p className="text-sm text-gray-500 mt-1">
              Customers book on your page with your name, logo and colours; FlyttGo's drivers carry out the moves.{' '}
              <button className="underline" onClick={() => setPage('white-label')}>Plans and prices</button>
            </p>
          </div>
          {wl && (
            <div className="text-right text-sm">
              <div className="font-semibold">{plans.find(p => p.code === wl.plan_code)?.name ?? wl.plan_code}</div>
              <div className="text-gray-500">{STATUS_LABELS[wl.status]}{wl.requested_plan_code ? ` · change to ${plans.find(p => p.code === wl.requested_plan_code)?.name} waiting` : ''}</div>
              {wl.status === 'active' && <a className="text-[#0B2E59] underline" href={wl.domain_verified_at && wl.custom_domain ? `https://${wl.custom_domain}` : `/b/${org.slug}`} target="_blank" rel="noopener noreferrer">Open your page</a>}
            </div>
          )}
        </div>
        {wl?.decision_reason && (wl.status === 'declined' || wl.status === 'suspended') && (
          <p className="mt-3 text-sm text-red-700">FlyttGo: {wl.decision_reason}</p>
        )}
        {wl && missing.length > 0 && (wl.status === 'requested' || wl.requested_plan_code) && (
          <div className="mt-4 rounded-xl bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
            Before FlyttGo can approve: {missing.join('; ')}.
          </div>
        )}
        {wl && missing.length === 0 && wl.status === 'requested' && (
          <p className="mt-4 text-sm text-emerald-700">Everything is in place. FlyttGo will review and approve your page.</p>
        )}
      </div>

      {/* Industry: decides which plans fit */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="font-bold text-gray-900 mb-1">Your industry</h3>
        <p className="text-sm text-gray-500 mb-3">FlyttGo sells only moving and delivery. In every other industry your company is the seller, and FlyttGo gives you the booking, invoicing and website.</p>
        <select className={input + ' max-w-md'} disabled={!canEdit} value={industry}
          onChange={e => { const v = e.target.value; run(async () => { const er = await setIndustry(org.id, v); if (!er) setIndustryValue(v); return er; }, 'Industry saved.'); }}>
          <option value="" disabled>Choose…</option>
          {INDUSTRIES.map(i => <option key={i.id} value={i.id}>{i.label}</option>)}
        </select>
      </div>

      {/* Plan */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <h3 className="font-bold text-gray-900 mb-3">Plan: who sells?</h3>
        <div className="grid md:grid-cols-3 gap-3">
          {plans.map(p => (
            <label key={p.code} className={`rounded-xl border-2 p-4 cursor-pointer ${choice === p.code ? 'border-[#0B2E59]' : 'border-gray-200'}`}>
              <input type="radio" name="plan" className="sr-only" checked={choice === p.code} onChange={() => setChoice(p.code)} disabled={!canEdit} />
              <div className="text-xs text-gray-500">{SELLER_LABELS[p.seller_model]}{p.is_default ? ' · default' : ''}</div>
              <div className="font-semibold">{p.name}</div>
              <div className="text-sm mt-1">{formatNok(p.monthly_fee)}/month{p.setup_fee ? ` + ${formatNok(p.setup_fee)} set-up` : ''}</div>
              {p.seller_model === 'company' && <div className="text-xs text-gray-600">+ {String(p.platform_fee_pct).replace('.', ',')} % platform fee, min. {formatNok(p.platform_fee_min)} per booking</div>}
              <div className="text-xs text-gray-400 mt-1">excl. MVA{p.price_status !== 'confirmed' ? ` · ${PRICE_STATUS_LABELS[p.price_status].toLowerCase()}` : ''}</div>
              {p.setup_fee > 0 && (p.setup_fee_includes?.length ?? 0) > 0 && (
                <div className="text-xs text-gray-500 mt-1">Set-up includes: {p.setup_fee_includes!.map(f => f.split(':')[0].toLowerCase()).join(', ')}</div>
              )}
            </label>
          ))}
        </div>
        {plans.find(p => p.code === choice)?.seller_model === 'company' && (
          <p className="text-xs text-gray-600 mt-3">
            Own seller: your company is the seller and is responsible to its customers (consumer rights, MVA, customer service, privacy).
            FlyttGo needs your terms, privacy notice, customer service contacts, a Stripe account and the data processing agreement.
          </p>
        )}
        {canEdit && (
          <div className="mt-4 flex gap-2">
            <button disabled={busy || !choice || (wl?.plan_code === choice && !wl?.requested_plan_code && wl?.status !== 'declined' && wl?.status !== 'ended')}
              onClick={() => run(() => requestPlan(org.id, choice), wl?.status === 'active' ? 'Change requested. Your current plan stays until FlyttGo approves it.' : 'Plan requested.')}
              className={`${btn} bg-[#0B2E59] text-white`}>
              {wl && ['active', 'suspended'].includes(wl.status) ? 'Request this plan' : 'Request plan'}
            </button>
            {wl && ['requested', 'active', 'suspended'].includes(wl.status) && role === 'owner' && (
              <button disabled={busy} onClick={() => { const r = prompt('Why are you ending the plan? (The monthly fee stops after this month.)'); if (r !== null) run(() => endPlan(org.id, r), 'Plan ended.'); }}
                className={`${btn} bg-gray-100 text-gray-700`}>End plan</button>
            )}
          </div>
        )}
      </div>

      {wl && (
        <>
          {/* Brand */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h3 className="font-bold text-gray-900 mb-3">Brand{companySells ? ', contacts and prices' : ''}</h3>
            <div className="grid md:grid-cols-2 gap-3 text-sm">
              <label>Name on the page<input className={input} value={brand.display_name} disabled={!canEdit} onChange={e => setBrand({ ...brand, display_name: e.target.value })} /></label>
              <label>Tagline<input className={input} value={brand.tagline} disabled={!canEdit} onChange={e => setBrand({ ...brand, tagline: e.target.value })} /></label>
              <label>Main colour<div className="flex gap-2"><input type="color" value={brand.primary_color || '#0b2e59'} disabled={!canEdit} onChange={e => setBrand({ ...brand, primary_color: e.target.value })} /><input className={input} value={brand.primary_color} placeholder="#0b2e59" disabled={!canEdit} onChange={e => setBrand({ ...brand, primary_color: e.target.value })} /></div></label>
              <label>Accent colour<div className="flex gap-2"><input type="color" value={brand.accent_color || '#10b981'} disabled={!canEdit} onChange={e => setBrand({ ...brand, accent_color: e.target.value })} /><input className={input} value={brand.accent_color} placeholder="#10b981" disabled={!canEdit} onChange={e => setBrand({ ...brand, accent_color: e.target.value })} /></div></label>
              {companySells && (<>
                <label>Customer service email<input className={input} value={brand.support_email} disabled={!canEdit} onChange={e => setBrand({ ...brand, support_email: e.target.value })} /></label>
                <label>Customer service phone<input className={input} value={brand.support_phone} placeholder="+47 22 33 44 55" disabled={!canEdit} onChange={e => setBrand({ ...brand, support_phone: e.target.value })} /></label>
                <label>Your terms (https://…)<input className={input} value={brand.terms_url} disabled={!canEdit} onChange={e => setBrand({ ...brand, terms_url: e.target.value })} /></label>
                <label>Your privacy notice (https://…)<input className={input} value={brand.privacy_url} disabled={!canEdit} onChange={e => setBrand({ ...brand, privacy_url: e.target.value })} /></label>
                <label>Your markup on FlyttGo's price (%)<input type="number" min={0} max={100} step={0.5} className={input} value={brand.markup_pct} disabled={!canEdit} onChange={e => setBrand({ ...brand, markup_pct: Number(e.target.value) })} /></label>
                {example && (
                  <div className="text-xs text-gray-600 self-end">
                    Example: a move FlyttGo prices at {formatNok(5000)} costs your customer {formatNok(example.customerPrice)}. FlyttGo keeps {formatNok(example.flyttgoPrice)} + {formatNok(example.platformFee)} platform fee; you keep {formatNok(example.customerPrice - example.flyttgoPrice - example.platformFee)} (incl. MVA, before Stripe's fees).
                  </div>
                )}
              </>)}
            </div>
            <p className="text-xs text-gray-500 mt-3">The logo is the one in Invoices → logo (PNG or JPEG).</p>
            {canEdit && <button disabled={busy} onClick={() => run(() => saveBrand(org.id, brand), 'Saved.')} className={`${btn} bg-[#0B2E59] text-white mt-4`}>Save</button>}
          </div>

          {/* Website template */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h3 className="font-bold text-gray-900 mb-1">Website</h3>
            <p className="text-sm text-gray-500 mb-3">Choose a website from FlyttGo's catalogue, by category. Open any of them to see every page in your name and colours. Every "book" button leads to your booking page.</p>
            <TemplateCatalogue templates={templates} selected={template} onSelect={setTemplate} canEdit={canEdit}
              brand={{ name: brand.display_name || org.name, tagline: brand.tagline || null, phone: brand.support_phone || null,
                       email: brand.support_email || null, city: city || null,
                       primaryColor: brand.primary_color || null, accentColor: brand.accent_color || null }}
              sellerNotice="Here your site names who sells what is booked (you or FlyttGo, by your plan)." />
            <label className="block text-sm mt-3 max-w-xs">Town or region your site names<input className={input} value={city} disabled={!canEdit} onChange={e => setCity(e.target.value)} /></label>
            {canEdit && <button disabled={busy} onClick={() => run(() => setSite(org.id, template || null, city), 'Website saved.')} className={`${btn} bg-[#0B2E59] text-white mt-4`}>Save website</button>}
          </div>

          {/* Domain */}
          {plan?.own_domain && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h3 className="font-bold text-gray-900 mb-1">Your domain</h3>
              <p className="text-sm text-gray-500 mb-3">For example booking.yourcompany.no. Until it's connected your page is at flyttgo.no/b/{org.slug}.</p>
              <div className="flex gap-2 max-w-lg">
                <input className={input} value={domain} placeholder="booking.yourcompany.no" disabled={!canEdit} onChange={e => setDomainText(e.target.value)} />
                {canEdit && <button disabled={busy} onClick={() => run(() => setDomain(org.id, domain), 'Domain saved. Add the DNS records below.')} className={`${btn} bg-[#0B2E59] text-white`}>Save</button>}
              </div>
              {wl.custom_domain && wl.domain_token && (
                <div className="mt-4 text-sm">
                  {wl.domain_verified_at ? <p className="text-emerald-700">Verified. FlyttGo connects it to your page.</p> : (
                    <>
                      <p className="mb-2">Add these two records at your domain provider:</p>
                      <table className="text-xs font-mono bg-gray-50 rounded-lg">
                        <tbody>
                          <tr><td className="p-2">TXT</td><td className="p-2">{records?.txt.name ?? `_flyttgo.${wl.custom_domain}`}</td><td className="p-2">{records?.txt.value ?? `flyttgo-verify=${wl.domain_token}`}</td></tr>
                          <tr><td className="p-2">CNAME</td><td className="p-2">{wl.custom_domain}</td><td className="p-2">{records?.cname.value ?? 'cname.vercel-dns.com'}</td></tr>
                        </tbody>
                      </table>
                      {canEdit && <button disabled={busy} onClick={() => run(async () => {
                        const r = await verifyDomain(org.id);
                        if (r.data?.records) setRecords(r.data.records);
                        return r.data?.verified ? null : (r.data?.error ?? 'not verified yet');
                      }, 'Domain verified.')} className={`${btn} bg-gray-100 text-gray-800 mt-3`}>Check DNS</button>}
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Model B: agreement and payments */}
          {companySells && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h3 className="font-bold text-gray-900 mb-3">Selling in your own name</h3>
              <div className="space-y-4 text-sm">
                <div>
                  <div className="font-semibold">Data processing agreement</div>
                  {wl.dpa_version === DPA_VERSION
                    ? <p className="text-emerald-700">Accepted {wl.dpa_accepted_at ? new Date(wl.dpa_accepted_at).toLocaleDateString('nb-NO') : ''} (version {wl.dpa_version}).</p>
                    : <p className="text-gray-600">You are responsible for your customers' data; FlyttGo processes it for you. <button className="underline" onClick={() => setPage('white-label-dpa')}>Read the agreement</button>.</p>}
                  {wl.dpa_version !== DPA_VERSION && role === 'owner' && (
                    <button disabled={busy} onClick={() => { if (confirm(`Accept the data processing agreement, version ${DPA_VERSION}, for ${org.name}?`)) run(() => acceptDpa(org.id), 'Agreement accepted.'); }}
                      className={`${btn} bg-[#0B2E59] text-white mt-2`}>Accept as owner</button>
                  )}
                  {wl.dpa_version !== DPA_VERSION && role !== 'owner' && <p className="text-xs text-gray-500">An owner accepts it.</p>}
                </div>
                <div>
                  <div className="font-semibold">Payments into your Stripe account</div>
                  {wl.stripe_charges_enabled
                    ? <p className="text-emerald-700">Connected ({wl.stripe_account_id}); it can take payments.</p>
                    : <p className="text-gray-600">{wl.stripe_account_id ? 'Connected, but Stripe needs more information before it can take payments.' : 'Not connected.'}</p>}
                  {role === 'owner' && !wl.stripe_charges_enabled && (
                    <button disabled={busy} onClick={() => run(async () => {
                      const r = await stripeConnect(org.id, 'onboard');
                      if (r.data?.url) { window.location.href = r.data.url; return null; }
                      return r.ok ? null : (r.data?.error ?? 'could not start Stripe');
                    }, 'Stripe connected.')} className={`${btn} bg-[#635bff] text-white mt-2`}>
                      {wl.stripe_account_id ? 'Continue with Stripe' : 'Connect Stripe'}
                    </button>
                  )}
                  {role !== 'owner' && !wl.stripe_charges_enabled && <p className="text-xs text-gray-500">An owner connects it.</p>}
                </div>
              </div>
            </div>
          )}

          {/* Add-on modules (00022) */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <h3 className="font-bold text-gray-900 mb-1">Add-on modules</h3>
            <p className="text-sm text-gray-500 mb-3">
              Modules on top of your plan, for example an online shop beside your bookings, or access to the API. They share your company,
              brand, team and booking set-up; each keeps its own settings and permissions. FlyttGo enables them, priced by a written quote.
            </p>
            {addons.filter(a => a.status === 'active').length === 0
              ? <p className="text-sm text-gray-400">None. Ask FlyttGo for a quote.</p>
              : (
                <ul className="divide-y divide-gray-50 text-sm">
                  {addons.filter(a => a.status === 'active').map(a => (
                    <li key={a.id} className="py-2 flex flex-wrap justify-between gap-2">
                      <span className="font-medium">{ADDON_LABELS[a.module] ?? a.module}</span>
                      <span className="text-gray-500 text-xs">{addonPrice(a, formatNok)} · since {new Date(a.enabled_at).toLocaleDateString('nb-NO')}</span>
                      {a.price_note && <span className="basis-full text-xs text-gray-400">{a.price_note}</span>}
                    </li>
                  ))}
                </ul>
              )}
          </div>

          {/* Numbers */}
          {stats.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 p-6">
              <h3 className="font-bold text-gray-900 mb-3">Bookings on your page</h3>
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500"><th className="py-1">Month</th><th>Paid bookings</th><th>Completed</th><th>Cancelled</th>{companySells && <th>Your customers paid</th>}</tr></thead>
                <tbody>{stats.map(s => (
                  <tr key={s.month} className="border-t"><td className="py-1.5">{s.month.slice(0, 7)}</td><td>{s.bookings}</td><td>{s.completed}</td><td>{s.cancelled}</td>{companySells && <td>{s.customer_revenue != null ? formatNok(s.customer_revenue) : '—'}</td>}</tr>
                ))}</tbody>
              </table>
              {!companySells && <p className="text-xs text-gray-500 mt-2">FlyttGo is the seller, so the customers' details stay with FlyttGo.</p>}
            </div>
          )}
        </>
      )}
    </div>
  );
}
