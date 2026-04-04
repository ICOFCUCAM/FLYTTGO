import React from 'react';
import { useApp } from '../lib/store';

const LAST_UPDATED = 'March 31, 2026';

export default function DriverTermsPage() {
  const { setPage } = useApp();

  return (
    <div className="min-h-screen bg-white">
      <div className="bg-gradient-to-br from-[#0B2E59] to-[#0B2E59]/90 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full mb-4">
            Legal Document · Transport Providers Only
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-3">Driver Terms & Onboarding Agreement</h1>
          <p className="text-white/60 text-sm">Last updated: {LAST_UPDATED}</p>
          <div className="mt-6 bg-red-500/20 border border-red-400/40 rounded-xl px-5 py-4">
            <p className="text-red-200 text-sm font-bold">
              🚨 BINDING AGREEMENT: By operating as a Transport Provider on FlyttGo, you enter into this legally binding agreement. FlyttGo bears ZERO liability for transported goods. You and your registered company bear full and exclusive liability.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="prose prose-sm max-w-none prose-headings:text-[#0B2E59] prose-headings:font-bold space-y-10">

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">1. Agreement Overview</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              This Driver Terms and Onboarding Agreement ("Driver Agreement") is entered into between FlyttGo AS ("FlyttGo") and the Transport Provider (the registered company and individual operator accessing the Platform as a driver). This Driver Agreement supplements and incorporates by reference FlyttGo's main Terms and Conditions and Liability & Insurance Policy, all of which are binding on the Transport Provider.
            </p>
            <p className="text-gray-700 leading-relaxed">
              The Transport Provider acknowledges that by completing onboarding and accessing the Platform, they are entering into this binding agreement. No access to job listings or customer bookings is granted until all onboarding requirements are satisfied and this Agreement is accepted.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">2. Mandatory Company Registration</h2>
            <div className="bg-red-50 border-l-4 border-red-600 px-5 py-4 rounded-r-xl mb-5">
              <p className="font-bold text-red-800 mb-2">NON-NEGOTIABLE REQUIREMENT</p>
              <p className="text-red-700 text-sm leading-relaxed">
                Operating on the FlyttGo Platform as an individual without a registered company is strictly prohibited and constitutes a breach of this Agreement. FlyttGo will immediately terminate access upon discovery of non-compliance.
              </p>
            </div>
            <p className="text-gray-700 leading-relaxed mb-4">The Transport Provider MUST:</p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
              <li>Be a validly registered Norwegian legal entity (Aksjeselskap/AS, Enkeltpersonforetak/ENK, or equivalent);</li>
              <li>Hold a valid Norwegian organization number (organisasjonsnummer) from Brønnøysundregistrene;</li>
              <li>Maintain valid VAT registration if annual turnover exceeds the Norwegian VAT threshold;</li>
              <li>Ensure all transport activities are conducted under the registered company entity;</li>
              <li>Notify FlyttGo immediately of any change to company registration status, dissolution, or insolvency proceedings.</li>
            </ul>
            <p className="text-gray-700 leading-relaxed">
              FlyttGo verifies company registration at onboarding and reserves the right to conduct re-verification at any time. Providing false company registration information is a criminal offence under Norwegian law and will be reported to relevant authorities.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">3. Mandatory Insurance Requirements</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              The Transport Provider must maintain the following insurance policies at all times during their activity on the Platform.
            </p>
            <div className="space-y-4">
              {[
                { title: 'Goods in Transit Insurance', points: ['Minimum coverage: NOK 500,000 per consignment;', 'Must cover commercial transport operations;', 'Must include third-party claims arising from goods damage;', "Must be in the name of the Transport Provider's registered company;", 'Must not be limited to personal/private use only.'] },
                { title: 'Public Liability Insurance', points: ['Minimum coverage: NOK 5,000,000 per incident;', 'Must cover property damage and personal injury;', 'Must extend to customer premises during loading and unloading;', 'Must cover all vehicle types used for commercial operations.'] },
                { title: 'Commercial Vehicle Insurance (Comprehensive)', points: ['Comprehensive (kasko) cover for all vehicles used commercially;', 'Policy must explicitly cover commercial goods transport;', 'Must be in the name of the registered company;', 'Any additional driver must also be covered under the policy.'] },
              ].map(item => (
                <div key={item.title} className="bg-gray-50 rounded-xl p-5">
                  <h3 className="font-bold text-gray-800 text-sm mb-3">{item.title}</h3>
                  <ul className="space-y-1.5">
                    {item.points.map((point, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                        <span className="text-[#0B2E59] font-bold flex-shrink-0 mt-0.5">→</span>
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
            <div className="mt-4 bg-red-50 rounded-xl p-4">
              <p className="text-red-700 text-xs font-semibold">
                LAPSED INSURANCE: If the Transport Provider's insurance lapses, expires, or is cancelled, they must immediately cease accepting new jobs and notify FlyttGo. Failure to maintain required insurance is grounds for immediate account suspension.
              </p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">4. Document Verification Requirements</h2>
            <p className="text-gray-700 leading-relaxed mb-4">The following documents must be submitted and verified before Platform access is granted:</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { doc: 'Company Registration Certificate', desc: 'Firmaatest or equivalent from Brønnøysundregistrene, issued within 3 months.' },
                { doc: 'Proof of Insurance', desc: 'Current certificate of insurance for all mandatory policies, showing coverage amounts and expiry dates.' },
                { doc: "Driver's Licence", desc: 'Valid Norwegian or EU/EEA driving licence appropriate for vehicle category.' },
                { doc: 'Vehicle Registration', desc: 'Current vognkort (vehicle registration document) for all vehicles to be used.' },
                { doc: 'Profile Photograph', desc: 'Recent, clear photograph of the driver for identity verification and Customer safety.' },
                { doc: 'Background Check Consent', desc: 'Signed consent for a criminal record check (politiattest) to be obtained.' },
              ].map(item => (
                <div key={item.doc} className="border border-gray-200 rounded-xl p-4">
                  <p className="font-semibold text-gray-800 text-xs mb-1">{item.doc}</p>
                  <p className="text-gray-500 text-xs">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">5. Full Liability Acceptance</h2>
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-5 mb-5">
              <p className="font-bold text-red-800 mb-3">ABSOLUTE LIABILITY ACCEPTANCE</p>
              <p className="text-red-700 text-sm leading-relaxed">By accepting this Agreement, the Transport Provider irrevocably and unconditionally accepts full and exclusive liability for:</p>
              <ul className="mt-3 space-y-2 text-red-700 text-sm">
                <li>• All goods accepted into their custody from the moment of pickup to the moment of confirmed delivery;</li>
                <li>• Any damage, loss, theft, or destruction of goods while in their care;</li>
                <li>• Any delay in collection or delivery caused by themselves, their employees, or subcontractors;</li>
                <li>• Any property damage caused at customer premises during loading or unloading;</li>
                <li>• Any personal injury caused to Customers, bystanders, or third parties during service delivery;</li>
                <li>• All claims arising from their failure to maintain required insurance or company registration;</li>
                <li>• Compliance with all applicable Norwegian road transport and employment laws.</li>
              </ul>
            </div>
            <p className="text-gray-700 leading-relaxed">
              The Transport Provider expressly agrees that FlyttGo bears no liability whatsoever for any of the above. The Transport Provider agrees to indemnify and hold harmless FlyttGo AS from any claims, damages, costs, or expenses arising from the Transport Provider's services, regardless of cause.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">6. Platform Relationship — Not Employment</h2>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
              <li>Is not an employee, worker, or agent of FlyttGo;</li>
              <li>Is solely responsible for all tax obligations arising from their earnings;</li>
              <li>Has the freedom to accept or decline jobs;</li>
              <li>Is responsible for all operating costs (fuel, vehicle maintenance, insurance premiums);</li>
              <li>Receives payment via the Platform's escrow system after job completion confirmation.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">7. Subscription Plans & Commission</h2>
            <p className="text-gray-700 leading-relaxed">
              Access to jobs and dispatch priority is governed by the Transport Provider's subscription plan. Commission rates deducted from earnings vary by plan. Disputes regarding commission amounts must be raised within 7 days of payment to support@flyttgo.com.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">8. Conduct Standards</h2>
            <ul className="list-disc pl-6 space-y-2 text-gray-700">
              <li>Treat Customers with professionalism and courtesy;</li>
              <li>Arrive at scheduled pickup times or provide advance notice of delay;</li>
              <li>Handle all goods with reasonable care and skill;</li>
              <li>Not transport prohibited items (see Terms & Conditions);</li>
              <li>Communicate through Platform channels only;</li>
              <li>Comply with all Norwegian road traffic laws.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">9. Suspension & Termination</h2>
            <p className="text-gray-700 leading-relaxed">
              FlyttGo may immediately suspend or terminate Platform access where the Transport Provider fails to maintain required company registration or insurance; receives multiple Customer complaints; engages in fraudulent activity; or breaches any provision of this Agreement. The Transport Provider may appeal suspension decisions by contacting legal@flyttgo.com within 14 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">10. Contact & Compliance</h2>
            <div className="bg-gray-50 rounded-xl p-5">
              <p className="font-bold text-gray-800 mb-2">FlyttGo AS — Driver Compliance Team</p>
              <p className="text-gray-600 text-sm">Driver Support: drivers@flyttgo.com</p>
              <p className="text-gray-600 text-sm">Compliance & Legal: legal@flyttgo.com</p>
              <p className="text-gray-600 text-sm">Document Submissions: verification@flyttgo.com</p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
