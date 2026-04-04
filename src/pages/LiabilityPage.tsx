import React from 'react';
import { useApp } from '../lib/store';

const LAST_UPDATED = 'March 31, 2026';

export default function LiabilityPage() {
  const { setPage } = useApp();

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#0B2E59] to-[#0B2E59]/90 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full mb-4">
            Legal Document
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-3">Liability & Insurance Policy</h1>
          <p className="text-white/60 text-sm">Last updated: {LAST_UPDATED}</p>
          <div className="mt-6 bg-red-500/20 border border-red-400/40 rounded-xl px-5 py-4">
            <p className="text-red-200 text-sm font-bold">
              🚨 CRITICAL: FlyttGo provides ZERO insurance coverage for transported goods. FlyttGo is NOT liable for any damage, loss, theft, or delay. ALL liability rests with the Transport Provider's registered company and their insurance policy.
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="prose prose-sm max-w-none prose-headings:text-[#0B2E59] prose-headings:font-bold space-y-10">

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">1. The Platform-Provider Distinction</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              This Liability and Insurance Policy must be read alongside FlyttGo's Terms and Conditions. It sets out, in unambiguous terms, the complete and absolute separation between FlyttGo AS as a technology platform operator and the Transport Providers who deliver actual services to Customers.
            </p>
            <div className="grid sm:grid-cols-2 gap-4 mb-5">
              <div className="bg-blue-50 rounded-xl p-5">
                <p className="font-bold text-[#0B2E59] mb-3">FlyttGo AS — Platform Operator</p>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li>✅ Operates matching technology</li>
                  <li>✅ Processes payments (escrow)</li>
                  <li>✅ Verifies minimum onboarding requirements</li>
                  <li>✅ Provides platform support</li>
                  <li className="text-red-600 font-semibold">❌ Does NOT transport goods</li>
                  <li className="text-red-600 font-semibold">❌ Does NOT insure goods</li>
                  <li className="text-red-600 font-semibold">❌ Is NOT liable for transit damage</li>
                  <li className="text-red-600 font-semibold">❌ Is NOT a party to transport contracts</li>
                </ul>
              </div>
              <div className="bg-gray-50 rounded-xl p-5">
                <p className="font-bold text-gray-800 mb-3">Transport Provider — Service Deliverer</p>
                <ul className="space-y-2 text-sm text-gray-700">
                  <li>✅ Physically transports goods</li>
                  <li>✅ Must hold valid company registration</li>
                  <li>✅ Must hold comprehensive transit insurance</li>
                  <li>✅ Bears full liability for goods in care</li>
                  <li>✅ Party to service contract with Customer</li>
                  <li>✅ Responsible for staff and subcontractors</li>
                  <li>✅ Liable for damage, loss, and delay</li>
                  <li>✅ Subject to Norwegian transport law</li>
                </ul>
              </div>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">2. FlyttGo's Absolute Liability Exclusion</h2>
            <div className="bg-red-50 border-l-4 border-red-600 px-5 py-5 rounded-r-xl mb-5">
              <p className="font-bold text-red-800 mb-3 text-base">ABSOLUTE EXCLUSION OF LIABILITY</p>
              <p className="text-red-700 text-sm leading-relaxed mb-3">
                FlyttGo AS, its shareholders, directors, officers, employees, agents, contractors, and technology partners hereby expressly and irrevocably exclude all liability for:
              </p>
              <ul className="space-y-2 text-red-700 text-sm">
                <li>• Any loss of, damage to, theft of, or destruction of goods, items, or property transported by any Transport Provider found through the Platform;</li>
                <li>• Any delay in collection, transit, or delivery of goods;</li>
                <li>• Any consequential, indirect, or economic loss arising from transport services;</li>
                <li>• Any personal injury caused by a Transport Provider or their employees;</li>
                <li>• Any property damage at pickup or delivery locations caused by a Transport Provider;</li>
                <li>• The adequacy, validity, or currency of any Transport Provider's insurance;</li>
                <li>• The solvency or continued operation of any Transport Provider;</li>
                <li>• Any failure by a Transport Provider to perform services as agreed.</li>
              </ul>
            </div>
            <p className="text-gray-700 leading-relaxed">
              This exclusion applies regardless of how a claim is framed — whether in contract, tort (including negligence), statute, or otherwise — and regardless of whether FlyttGo was advised of the possibility of such loss or damage. Where liability cannot be excluded under mandatory provisions of Norwegian or EU consumer law, FlyttGo's maximum aggregate liability is limited to the platform commission received in respect of the specific transaction giving rise to the claim, or NOK 500, whichever is lower.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">3. Mandatory Insurance Requirements for Transport Providers</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              Every Transport Provider using the FlyttGo Platform is required, as a non-negotiable condition of access, to maintain the following insurance coverage at all times:
            </p>
            <div className="space-y-4">
              {[
                {
                  title: '3.1 Goods in Transit Insurance',
                  content: 'Coverage for loss, damage, or theft of goods while in the Transport Provider\'s custody. Minimum coverage: NOK 500,000 per consignment. Policy must cover commercial transport operations and not be limited to personal use. Third-party claims arising from goods damage must be included.',
                  required: true,
                },
                {
                  title: '3.2 Public Liability Insurance',
                  content: 'Third-party liability for property damage and personal injury arising from transport operations. Minimum coverage: NOK 5,000,000 per incident. Must cover all locations where loading and unloading occurs (including customer premises).',
                  required: true,
                },
                {
                  title: '3.3 Vehicle Insurance (Comprehensive)',
                  content: 'Comprehensive motor insurance for all vehicles used for commercial transport. Must be in the name of the Transport Provider\'s registered company. Must explicitly cover commercial use and goods transport operations.',
                  required: true,
                },
                {
                  title: '3.4 Employer\'s Liability (if applicable)',
                  content: 'Where the Transport Provider employs helpers or additional staff, valid employer\'s liability insurance is mandatory under Norwegian law.',
                  required: false,
                },
              ].map(item => (
                <div key={item.title} className="border border-gray-200 rounded-xl p-5">
                  <div className="flex items-center justify-between mb-2">
                    <h3 className="font-bold text-gray-800 text-sm">{item.title}</h3>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.required ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {item.required ? 'Mandatory' : 'Conditional'}
                    </span>
                  </div>
                  <p className="text-gray-600 text-sm">{item.content}</p>
                </div>
              ))}
            </div>
            <p className="text-gray-700 leading-relaxed mt-5">
              FlyttGo reserves the right to request proof of insurance at any time. Failure to maintain required insurance is grounds for immediate account suspension. The discovery of a lapsed or invalid insurance policy does not create any liability for FlyttGo.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">4. Company Registration Requirement</h2>
            <div className="bg-orange-50 border-l-4 border-orange-500 px-5 py-4 rounded-r-xl mb-5">
              <p className="font-bold text-orange-800 mb-2">STRICT REQUIREMENT — NO EXCEPTIONS</p>
              <p className="text-orange-700 text-sm">
                Every Transport Provider on the FlyttGo Platform MUST operate under a validly registered Norwegian company (Aksjeselskap/AS, Enkeltpersonforetak/ENK, or equivalent legal entity with valid Norwegian organization number). Individual persons operating without company registration are categorically prohibited from providing services through the Platform. This requirement is non-negotiable and non-waivable.
              </p>
            </div>
            <p className="text-gray-700 leading-relaxed mb-4">
              The company registration requirement exists to ensure: (a) the Transport Provider has legal personality capable of bearing liability; (b) the Provider is subject to Norwegian commercial law obligations; (c) legitimate insurance policies can be maintained in the company's name; and (d) tax obligations are properly fulfilled.
            </p>
            <p className="text-gray-700 leading-relaxed">
              FlyttGo verifies company registration status against Brønnøysundregistrene during onboarding. FlyttGo reserves the right to conduct re-verification at any time. Presentation of false registration information is grounds for permanent ban and may be reported to relevant Norwegian authorities.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">5. Claims Process — How to Make a Claim</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              In the event of damage, loss, or unsatisfactory service, Customers must follow this process:
            </p>
            <div className="space-y-3">
              {[
                { step: '1', title: 'Document the Issue', desc: 'Take photographs of damaged goods and the delivery condition immediately. Do not dispose of or repair damaged items before a claim is assessed.' },
                { step: '2', title: 'Report Within 48 Hours', desc: 'Notify FlyttGo via the app or at support@flyttgo.com within 48 hours of delivery. Include booking reference, photographs, and description of damage/loss.' },
                { step: '3', title: 'FlyttGo Provides Transport Provider Details', desc: 'FlyttGo will provide the Customer with the Transport Provider\'s registered company name, address, contact details, and insurer information to facilitate a direct claim.' },
                { step: '4', title: 'File Claim With Transport Provider\'s Insurer', desc: 'The Customer must file a formal claim directly with the Transport Provider\'s insurance company. FlyttGo is not a party to this claim and cannot represent either party.' },
                { step: '5', title: 'Escrow Dispute (Payment Only)', desc: 'Where a dispute relates to escrowed payment, FlyttGo will review evidence from both parties and make a final determination on release. This is limited to the payment dispute only.' },
              ].map(item => (
                <div key={item.step} className="flex gap-4 bg-gray-50 rounded-xl p-4">
                  <div className="w-8 h-8 bg-[#0B2E59] text-white rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {item.step}
                  </div>
                  <div>
                    <p className="font-semibold text-gray-800 text-sm mb-1">{item.title}</p>
                    <p className="text-gray-600 text-xs">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">6. Customer Acknowledgement of Risk</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              By using the Platform to book transport services, Customers expressly acknowledge and accept that:
            </p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700">
              <li>Transport services are provided exclusively by independent third-party companies, not by FlyttGo;</li>
              <li>FlyttGo does not guarantee the quality, safety, or reliability of any Transport Provider;</li>
              <li>Customer bears sole responsibility for ensuring items are adequately packed for transport;</li>
              <li>Customers are advised to obtain independent transit insurance for high-value items;</li>
              <li>Claims for damage or loss must be made against the Transport Provider's company, not FlyttGo;</li>
              <li>FlyttGo's verification of Transport Providers is a minimum-standard check only and does not constitute a guarantee of service quality or insurance adequacy.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">7. High-Value Items Advisory</h2>
            <div className="bg-blue-50 rounded-xl p-5">
              <p className="font-bold text-blue-800 mb-2">Advisory Notice</p>
              <p className="text-blue-700 text-sm leading-relaxed">
                FlyttGo strongly advises Customers transporting items with a value exceeding NOK 50,000 to: (a) obtain independent all-risk transit insurance before booking; (b) confirm in writing with the Transport Provider that their insurance covers the specific value of items being transported; and (c) consider specialist fine art, antique, or high-value goods movers for particularly valuable or irreplaceable items. FlyttGo accepts no liability for high-value items under any circumstances.
              </p>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
