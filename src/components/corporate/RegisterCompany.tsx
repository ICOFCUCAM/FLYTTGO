/**
 * Register a company (create_organization, 00005): the signed-in person
 * becomes its owner. It starts 'Awaiting verification' until FlyttGo
 * checks it (Brønnøysundregistrene) and activates it.
 */
import { useState, type FormEvent } from 'react';
import { createOrganization, suggestSlug } from '../../lib/organizations';

export default function RegisterCompany({ onCreated }: { onCreated: () => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [orgNumber, setOrgNumber] = useState('');
  const [billingEmail, setBillingEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const { error } = await createOrganization(name.trim(), (slugTouched ? slug : suggestSlug(name)).trim(),
      orgNumber.replace(/\s/g, '') || null, billingEmail.trim() || null);
    setBusy(false);
    if (error) {
      setError(/organizations_org_number_valid/.test(error.message) ? 'That organisation number is not valid.'
        : /duplicate key/.test(error.message) ? 'A company with that address or organisation number is already registered.'
        : error.message);
      return;
    }
    onCreated();
  }

  const field = 'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-emerald-500 outline-none';
  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-gray-100 p-6 space-y-4 max-w-xl">
      <div>
        <h3 className="font-bold text-gray-900">Register your company</h3>
        <p className="text-sm text-gray-500 mt-1">
          You become the company's owner. FlyttGo checks the company in Brønnøysundregistrene before bookings and invoicing are switched on;
          until then you can set up your team.
        </p>
      </div>
      <label className="block text-sm">
        <span className="text-gray-600">Company name</span>
        <input required minLength={2} value={name} onChange={e => setName(e.target.value)} className={field} placeholder="Acme Logistikk AS" />
      </label>
      <label className="block text-sm">
        <span className="text-gray-600">Organisation number</span>
        <input value={orgNumber} onChange={e => setOrgNumber(e.target.value)} className={field} placeholder="9 digits" inputMode="numeric" />
      </label>
      <label className="block text-sm">
        <span className="text-gray-600">Short name (your company's address on FlyttGo)</span>
        <input value={slugTouched ? slug : suggestSlug(name)} onChange={e => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }}
          className={field} pattern="[a-z0-9](?:[a-z0-9\-]{1,61}[a-z0-9])" title="Lower-case letters, digits and dashes, 3 to 63 characters" />
      </label>
      <label className="block text-sm">
        <span className="text-gray-600">Billing email</span>
        <input type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)} className={field} placeholder="faktura@company.no" />
      </label>
      {error && <div className="rounded-xl px-4 py-3 text-sm bg-red-50 text-red-700">{error}</div>}
      <button disabled={busy} className="px-6 py-2.5 bg-[#0B2E59] text-white rounded-xl text-sm font-semibold disabled:opacity-50">Register company</button>
    </form>
  );
}
