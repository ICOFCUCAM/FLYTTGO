import React, { useState } from 'react';
import { useApp } from '../lib/store';

const LAST_UPDATED = 'March 31, 2026';
const EFFECTIVE_DATE = 'March 31, 2026';

export default function TermsPage() {
  const { setPage } = useApp();
  const [activeSection, setActiveSection] = useState('');

  const sections = [
    { id: 'overview', title: '1. Platform Overview & Legal Status' },
    { id: 'marketplace', title: '2. Marketplace-Only Status (Critical)' },
    { id: 'eligibility', title: '3. Eligibility & Account Registration' },
    { id: 'user-obligations', title: '4. User Obligations' },
    { id: 'services', title: '5. Services & Booking' },
    { id: 'payment', title: '6. Payment Terms & Escrow' },
    { id: 'liability', title: '7. Limitation of Liability' },
    { id: 'disputes', title: '8. Dispute Resolution' },
    { id: 'suspension', title: '9. Account Suspension & Termination' },
    { id: 'intellectual', title: '10. Intellectual Property' },
    { id: 'governing', title: '11. Governing Law & Jurisdiction' },
    { id: 'changes', title: '12. Changes to These Terms' },
    { id: 'contact', title: '13. Contact Information' },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#0B2E59] to-[#0B2E59]/90 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full mb-4">
            Legal Document
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-3">Terms & Conditions</h1>
          <p className="text-white/60 text-sm">Last updated: {LAST_UPDATED} · Effective: {EFFECTIVE_DATE}</p>
          <div className="mt-6 bg-yellow-400/20 border border-yellow-400/40 rounded-xl px-5 py-4">
            <p className="text-yellow-200 text-sm font-semibold">
              ⚠️ IMPORTANT NOTICE: FlyttGo is a digital marketplace platform only. FlyttGo does NOT provide transport services and bears ZERO liability for goods, damage, loss, or delay. All liability rests with the registered transport provider (driver's company).
            </p>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 flex gap-10">
        {/* Sidebar navigation */}
        <aside className="hidden lg:block w-64 flex-shrink-0">
          <div className="sticky top-6">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Contents</div>
            <nav className="space-y-1">
              {sections.map(s => (
                <a key={s.id} href={`#${s.id}`}
                  className="block text-xs text-gray-600 hover:text-[#0B2E59] py-1.5 border-l-2 border-gray-100 pl-3 hover:border-[#0B2E59] transition-all">
                  {s.title}
                </a>
              ))}
            </nav>
          </div>
        </aside>

        {/* Main content */}
        <main className="flex-1 min-w-0 prose prose-sm max-w-none prose-headings:text-[#0B2E59] prose-headings:font-bold">

          <section id="overview" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">1. Platform Overview & Legal Status</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              These Terms and Conditions ("Terms") constitute a legally binding agreement between you ("User," "Customer," or "Driver") and FlyttGo AS ("FlyttGo," "we," "us," or "our"), a company registered in Norway. By accessing or using the FlyttGo platform, website, or mobile application (collectively, the "Platform"), you agree to be bound by these Terms in their entirety.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              FlyttGo operates as a technology-enabled digital marketplace. The Platform facilitates connections between customers seeking transport and moving services ("Customers") and independent transport providers operating under registered companies ("Drivers" or "Transport Providers"). FlyttGo is not a transport company and does not provide any transport, moving, or logistics services directly.
            </p>
            <p className="text-gray-700 leading-relaxed">
              If you do not agree with any part of these Terms, you must immediately cease use of the Platform. Continued use constitutes full acceptance of these Terms.
            </p>
          </section>

          <section id="marketplace" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">2. Marketplace-Only Status (Critical Legal Disclaimer)</h2>
            <div className="bg-red-50 border-l-4 border-red-500 px-5 py-4 rounded-r-xl mb-5">
              <p className="font-bold text-red-800 mb-2">CRITICAL: READ THIS SECTION CAREFULLY</p>
              <ul className="space-y-2 text-red-700 text-sm">
                <li>• <strong>FlyttGo IS NOT a transport company.</strong> FlyttGo does not employ drivers, own vehicles, or provide logistics services.</li>
                <li>• <strong>FlyttGo bears ZERO liability</strong> for the loss, damage, theft, delay, or non-delivery of any goods transported through services booked via the Platform.</li>
                <li>• <strong>ALL liability for goods in transit rests exclusively</strong> with the Transport Provider (driver's registered company).</li>
                <li>• FlyttGo provides <strong>NO insurance coverage</strong> of any kind for transported goods or third-party liability.</li>
                <li>• Any claim arising from a transport booking must be directed exclusively to the Transport Provider's registered company and their insurer.</li>
              </ul>
            </div>
            <p className="text-gray-700 leading-relaxed mb-4">
              FlyttGo's role is strictly limited to: (a) operating the technology platform; (b) facilitating the connection between Customers and Transport Providers; (c) processing payments as an intermediary; (d) providing customer support for platform-related issues only; and (e) verifying that Transport Providers meet minimum onboarding requirements.
            </p>
            <p className="text-gray-700 leading-relaxed">
              Verification of Transport Providers by FlyttGo does not constitute an endorsement, guarantee of quality, or assumption of liability for any services provided by those Transport Providers. FlyttGo makes no representations or warranties regarding the competence, qualifications, insurance coverage adequacy, or service quality of any Transport Provider listed on the Platform.
            </p>
          </section>

          <section id="eligibility" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">3. Eligibility & Account Registration</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              To use the Platform, you must be at least 18 years of age and have the legal capacity to enter into binding contracts under Norwegian law. By registering an account, you represent and warrant that all information you provide is accurate, current, and complete.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              You are responsible for maintaining the security of your account credentials. You must notify FlyttGo immediately at support@flyttgo.com if you suspect any unauthorized access to your account. FlyttGo is not liable for any loss or damage arising from your failure to maintain account security.
            </p>
            <p className="text-gray-700 leading-relaxed">
              One person may only maintain one active account. FlyttGo reserves the right to merge, suspend, or permanently terminate duplicate accounts. Corporate accounts must be registered under the legal entity's name and authorized by a duly authorized representative.
            </p>
          </section>

          <section id="user-obligations" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">4. User Obligations</h2>
            <h3 className="font-bold text-gray-800 mb-2 text-base">4.1 All Users</h3>
            <p className="text-gray-700 leading-relaxed mb-3">All users of the Platform agree to:</p>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-5">
              <li>Provide accurate, truthful, and complete information at all times;</li>
              <li>Not use the Platform for any unlawful purpose or in violation of these Terms;</li>
              <li>Not attempt to circumvent the Platform by arranging off-platform payments with Drivers or Customers met through the Platform;</li>
              <li>Not engage in fraud, misrepresentation, harassment, or abusive conduct toward any other user;</li>
              <li>Not reverse-engineer, scrape, or attempt to extract data from the Platform;</li>
              <li>Comply with all applicable Norwegian and EU laws and regulations.</li>
            </ul>
            <h3 className="font-bold text-gray-800 mb-2 text-base">4.2 Customers</h3>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-5">
              <li>Provide accurate pickup and delivery addresses, item descriptions, weights, and special requirements;</li>
              <li>Ensure that items presented for transport are accurately described and do not include prohibited goods;</li>
              <li>Be present or ensure an authorized representative is present at pickup and delivery;</li>
              <li>Acknowledge that incorrect information may result in additional charges or cancellation;</li>
              <li>Direct all claims for damage or loss to the Transport Provider's company, not to FlyttGo.</li>
            </ul>
            <h3 className="font-bold text-gray-800 mb-2 text-base">4.3 Transport Providers (Drivers)</h3>
            <ul className="list-disc pl-6 space-y-2 text-gray-700">
              <li>Operate exclusively under a validly registered company (AS, ENK, or equivalent) with a current Norwegian organization number;</li>
              <li>Maintain valid, comprehensive insurance covering goods in transit and public liability at all times;</li>
              <li>Comply with all Norwegian road transport laws and regulations;</li>
              <li>Not subcontract jobs without prior Customer consent;</li>
              <li>Accept full and exclusive liability for goods in their care.</li>
            </ul>
          </section>

          <section id="services" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">5. Services & Booking</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              When a Customer submits a booking through the Platform, they are entering into a direct service contract with the selected Transport Provider. FlyttGo is not a party to that service contract. The contract for transport services exists solely between the Customer and the Transport Provider's registered company.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              FlyttGo facilitates the booking process and payment but is not responsible for the actual performance of transport services. The estimated prices displayed on the Platform are indicative only and may vary based on actual time, distance, and scope of work as agreed between Customer and Transport Provider.
            </p>
            <h3 className="font-bold text-gray-800 mb-2 text-base">5.1 Prohibited Items</h3>
            <p className="text-gray-700 leading-relaxed mb-3">The following items may NOT be transported via the Platform:</p>
            <ul className="list-disc pl-6 space-y-1 text-gray-700 mb-4">
              <li>Illegal substances, narcotics, or controlled substances;</li>
              <li>Weapons, ammunition, or explosives;</li>
              <li>Hazardous materials requiring specialist handling;</li>
              <li>Live animals (without prior written agreement);</li>
              <li>Human remains;</li>
              <li>Cash, negotiable instruments, or high-value jewelry above 50,000 NOK.</li>
            </ul>
            <p className="text-gray-700 leading-relaxed">
              Transport of prohibited items releases FlyttGo from any and all liability. The Customer and Transport Provider bear exclusive responsibility for compliance with applicable laws.
            </p>
          </section>

          <section id="payment" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">6. Payment Terms & Escrow</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              FlyttGo operates an escrow payment system. Upon booking confirmation, the Customer's payment is held securely by FlyttGo until both parties confirm job completion. Payment is released to the Transport Provider only upon mutual confirmation of successful delivery.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              All prices on the Platform are displayed excluding 25% Norwegian VAT (MVA) unless otherwise stated. The final invoice will include applicable VAT. FlyttGo charges a platform commission from the Transport Provider's earnings; this does not affect the Customer's quoted price.
            </p>
            <h3 className="font-bold text-gray-800 mb-2 text-base">6.1 Cancellation Policy</h3>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-4">
              <li><strong>More than 24 hours before scheduled pickup:</strong> Full refund, no charge.</li>
              <li><strong>Within 24 hours of scheduled pickup:</strong> 50% cancellation fee applies.</li>
              <li><strong>No-show by Customer:</strong> Full booking amount is charged.</li>
              <li><strong>Transport Provider cancellation:</strong> Full refund to Customer; Transport Provider may be subject to penalty.</li>
            </ul>
            <h3 className="font-bold text-gray-800 mb-2 text-base">6.2 Refunds</h3>
            <p className="text-gray-700 leading-relaxed">
              Refunds for disputed jobs are processed according to FlyttGo's Dispute Resolution process. FlyttGo's maximum liability in any refund scenario is limited to the platform commission collected; FlyttGo does not refund amounts attributable to Transport Provider earnings where services were partially rendered.
            </p>
          </section>

          <section id="liability" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">7. Limitation of Liability</h2>
            <div className="bg-red-50 border border-red-200 rounded-xl px-5 py-4 mb-5">
              <p className="font-bold text-red-800 mb-3">ABSOLUTE LIABILITY EXCLUSION</p>
              <p className="text-red-700 text-sm leading-relaxed">
                TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE NORWEGIAN LAW, FLYTTGO, ITS DIRECTORS, EMPLOYEES, AGENTS, AFFILIATES, AND TECHNOLOGY PARTNERS SHALL NOT BE LIABLE FOR ANY LOSS OR DAMAGE OF GOODS, PERSONAL INJURY, PROPERTY DAMAGE, LOSS OF PROFIT, LOSS OF REVENUE, LOSS OF DATA, OR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING FROM OR RELATED TO TRANSPORT SERVICES BOOKED THROUGH THE PLATFORM.
              </p>
            </div>
            <p className="text-gray-700 leading-relaxed mb-4">
              Where FlyttGo's liability cannot be wholly excluded under applicable law (including the Norwegian Consumer Protection Act), FlyttGo's total aggregate liability to any user shall not exceed the platform commission paid by the Transport Provider in respect of the specific transaction giving rise to the claim, or NOK 500, whichever is lower.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              FlyttGo is not liable for: service failures caused by force majeure; Transport Provider non-performance, negligence, or misconduct; damage to goods during transit; incorrect addresses or information provided by users; delays due to traffic, weather, or circumstances beyond a Transport Provider's reasonable control; or any loss arising from reliance on reviews or ratings displayed on the Platform.
            </p>
            <p className="text-gray-700 leading-relaxed">
              The Platform is provided "as is" and "as available." FlyttGo makes no warranty that the Platform will be uninterrupted, error-free, or free from viruses or other harmful components.
            </p>
          </section>

          <section id="disputes" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">8. Dispute Resolution</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              In the event of a dispute between a Customer and a Transport Provider, the parties are encouraged to resolve the matter directly in the first instance. FlyttGo may, at its sole discretion, facilitate communication between parties but is under no obligation to mediate or arbitrate disputes.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              Where a dispute involves a payment held in escrow, FlyttGo will review documentation provided by both parties and make a final determination on escrow release. FlyttGo's decision on escrow matters is final and binding. This process does not affect statutory rights.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              Claims for damage, loss, or inadequate service must be raised by the Customer directly against the Transport Provider's registered company and their insurer. FlyttGo will provide Customer with available contact details for the Transport Provider to facilitate this process, but FlyttGo is not a party to any such claim.
            </p>
            <p className="text-gray-700 leading-relaxed">
              Any unresolved dispute between a user and FlyttGo shall be submitted to the Oslo District Court (Oslo tingrett) as the agreed court of first instance. Norwegian law governs all disputes. Consumer users may also refer disputes to Forbrukerrådet (the Norwegian Consumer Authority).
            </p>
          </section>

          <section id="suspension" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">9. Account Suspension & Termination</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              FlyttGo reserves the right to suspend or permanently terminate any account, at any time and without prior notice, where FlyttGo reasonably believes that a user has: (a) violated these Terms; (b) engaged in fraudulent activity; (c) received multiple legitimate complaints; (d) failed to maintain required insurance or company registration (Transport Providers); or (e) posed a risk to other users, FlyttGo, or the public.
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              Transport Providers whose accounts are suspended during an active booking may have their escrowed earnings withheld pending investigation. FlyttGo's decision to suspend or terminate an account does not entitle any user to compensation beyond outstanding escrowed amounts owed for completed services.
            </p>
            <p className="text-gray-700 leading-relaxed">
              Users may terminate their own accounts at any time by contacting support@flyttgo.com. Termination does not affect obligations arising from completed transactions.
            </p>
          </section>

          <section id="intellectual" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">10. Intellectual Property</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              All content on the Platform, including but not limited to software, design, logos, trademarks, text, and graphics, is the exclusive property of FlyttGo AS or its licensors and is protected by Norwegian and international intellectual property law. No user is granted any licence to use FlyttGo's intellectual property without express written consent.
            </p>
            <p className="text-gray-700 leading-relaxed">
              By submitting reviews, photos, or other content to the Platform, users grant FlyttGo a non-exclusive, royalty-free, worldwide licence to use, reproduce, and display such content for platform operation and marketing purposes.
            </p>
          </section>

          <section id="governing" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">11. Governing Law & Jurisdiction</h2>
            <p className="text-gray-700 leading-relaxed">
              These Terms are governed by and construed in accordance with Norwegian law. The Oslo District Court (Oslo tingrett) shall have exclusive jurisdiction over all disputes arising from or relating to these Terms, save where mandatory EU or Norwegian consumer protection law provides otherwise. If any provision of these Terms is found to be invalid or unenforceable, the remaining provisions shall continue in full force and effect.
            </p>
          </section>

          <section id="changes" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">12. Changes to These Terms</h2>
            <p className="text-gray-700 leading-relaxed">
              FlyttGo reserves the right to update these Terms at any time. Material changes will be notified to registered users by email and/or Platform notification at least 14 days before they take effect. Continued use of the Platform after the effective date constitutes acceptance of the revised Terms.
            </p>
          </section>

          <section id="contact" className="mb-10">
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">13. Contact Information</h2>
            <div className="bg-gray-50 rounded-xl p-5">
              <p className="font-bold text-gray-800 mb-2">FlyttGo AS</p>
              <p className="text-gray-600 text-sm">Oslo, Norway</p>
              <p className="text-gray-600 text-sm">Legal & Compliance: legal@flyttgo.com</p>
              <p className="text-gray-600 text-sm">Customer Support: support@flyttgo.com</p>
              <p className="text-gray-600 text-sm">Phone: +44 7432 112438</p>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
