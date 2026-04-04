import React from 'react';
import { useApp } from '../lib/store';

const LAST_UPDATED = 'March 31, 2026';

export default function PrivacyPage() {
  const { setPage } = useApp();

  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <div className="bg-gradient-to-br from-[#0B2E59] to-[#0B2E59]/90 py-16">
        <div className="max-w-4xl mx-auto px-4 sm:px-6">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-3 py-1.5 rounded-full mb-4">
            GDPR Compliant · Norway/EU
          </div>
          <h1 className="text-4xl font-extrabold text-white mb-3">Privacy Policy</h1>
          <p className="text-white/60 text-sm">Last updated: {LAST_UPDATED}</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <div className="prose prose-sm max-w-none prose-headings:text-[#0B2E59] prose-headings:font-bold space-y-10">

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">1. Introduction & Data Controller</h2>
            <p className="text-gray-700 leading-relaxed mb-4">
              FlyttGo AS ("FlyttGo," "we," "us," or "our") is committed to protecting your personal data. This Privacy Policy explains how we collect, use, store, share, and protect information about you when you use the FlyttGo platform, website, and mobile application (the "Platform").
            </p>
            <p className="text-gray-700 leading-relaxed mb-4">
              FlyttGo AS is the Data Controller for personal data processed through the Platform, as defined under Regulation (EU) 2016/679 (the General Data Protection Regulation, "GDPR") as implemented in Norway through the Personal Data Act (Personopplysningsloven).
            </p>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="font-bold text-gray-800 mb-1">Data Controller Contact</p>
              <p className="text-gray-600 text-sm">FlyttGo AS · Oslo, Norway</p>
              <p className="text-gray-600 text-sm">Data Protection Officer: privacy@flyttgo.com</p>
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">2. Data We Collect</h2>
            <h3 className="font-bold text-gray-800 mb-2 text-base">2.1 Data You Provide Directly</h3>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-5">
              <li><strong>Identity Data:</strong> Full name, date of birth, email address, phone number, profile photograph.</li>
              <li><strong>Account Data:</strong> Username, password (hashed), account preferences, communication preferences.</li>
              <li><strong>Booking Data:</strong> Pickup/delivery addresses, item descriptions, scheduling information, special instructions, booking history.</li>
              <li><strong>Payment Data:</strong> Payment card details (processed and stored by Stripe — FlyttGo does not store raw card data), billing address, transaction history.</li>
              <li><strong>Driver-Specific Data:</strong> Company registration number, vehicle registration, driver's licence details, insurance policy information, background check results, bank account details for payouts.</li>
              <li><strong>Communications:</strong> Messages exchanged through the in-app chat system, support correspondence.</li>
            </ul>
            <h3 className="font-bold text-gray-800 mb-2 text-base">2.2 Data Collected Automatically</h3>
            <ul className="list-disc pl-6 space-y-2 text-gray-700 mb-5">
              <li><strong>Location Data:</strong> GPS coordinates during active bookings for real-time tracking (Driver app); approximate location for service availability (Customer app). Collection can be disabled in device settings, though this will limit functionality.</li>
              <li><strong>Device & Technical Data:</strong> IP address, device identifiers, operating system, browser type and version, app version, crash reports.</li>
              <li><strong>Usage Data:</strong> Pages visited, features used, search queries, booking funnel progression, session duration, click patterns.</li>
              <li><strong>Cookies and Tracking:</strong> See Section 9 (Cookie Policy) below.</li>
            </ul>
            <h3 className="font-bold text-gray-800 mb-2 text-base">2.3 Data From Third Parties</h3>
            <ul className="list-disc pl-6 space-y-2 text-gray-700">
              <li>Identity verification data from third-party verification services;</li>
              <li>Background check results from authorized screening providers;</li>
              <li>Payment verification data from Stripe and Vipps;</li>
              <li>Company registration data from Brønnøysundregistrene (Norwegian Business Registry).</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">3. Legal Basis for Processing</h2>
            <p className="text-gray-700 leading-relaxed mb-4">We process your personal data on the following legal bases under GDPR Article 6:</p>
            <div className="space-y-3">
              {[
                { basis: 'Contract Performance (Art. 6(1)(b))', desc: 'Processing necessary to fulfil our contractual obligations to you, including account management, booking facilitation, and payment processing.' },
                { basis: 'Legal Obligation (Art. 6(1)(c))', desc: 'Processing required to comply with Norwegian tax law, anti-money laundering regulations, and transport regulations.' },
                { basis: 'Legitimate Interests (Art. 6(1)(f))', desc: 'Platform security, fraud prevention, service improvement, and business analytics, where these interests are not overridden by your rights.' },
                { basis: 'Consent (Art. 6(1)(a))', desc: 'Marketing communications (email/SMS), optional analytics cookies, and location data beyond operational requirements. Consent may be withdrawn at any time.' },
              ].map(item => (
                <div key={item.basis} className="bg-gray-50 rounded-xl p-4">
                  <p className="font-semibold text-gray-800 text-sm mb-1">{item.basis}</p>
                  <p className="text-gray-600 text-sm">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">4. How We Use Your Data</h2>
            <ul className="list-disc pl-6 space-y-2 text-gray-700">
              <li>Creating and managing your user account;</li>
              <li>Matching Customers with Transport Providers and facilitating bookings;</li>
              <li>Processing payments and managing escrow;</li>
              <li>Providing real-time GPS tracking during active bookings;</li>
              <li>Verifying Driver credentials, company registration, and insurance;</li>
              <li>Detecting and preventing fraud, abuse, and safety incidents;</li>
              <li>Sending booking confirmations, service updates, and operational notifications;</li>
              <li>Sending marketing communications (with consent only);</li>
              <li>Improving Platform functionality through usage analytics;</li>
              <li>Complying with legal and regulatory obligations;</li>
              <li>Resolving disputes and enforcing our Terms.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">5. Data Sharing & Recipients</h2>
            <p className="text-gray-700 leading-relaxed mb-4">FlyttGo does not sell your personal data. We share data only as described below:</p>
            <ul className="list-disc pl-6 space-y-3 text-gray-700">
              <li><strong>Between Customers and Transport Providers:</strong> We share necessary booking details (name, contact information, addresses) to facilitate service delivery.</li>
              <li><strong>Payment Processors:</strong> Stripe (card payments) and Vipps (Norwegian mobile payments) receive payment data necessary to process transactions. These providers are independently certified under PCI-DSS.</li>
              <li><strong>Background Check Providers:</strong> Driver applicant data is shared with authorized screening partners for mandatory verification.</li>
              <li><strong>Cloud Infrastructure:</strong> Data is hosted on secure cloud servers within the European Economic Area (EEA).</li>
              <li><strong>Analytics Providers:</strong> Anonymized or pseudonymized usage data may be shared with analytics platforms.</li>
              <li><strong>Legal Authorities:</strong> We may disclose data to Norwegian or EU authorities where required by law, court order, or to protect the safety of users or the public.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">6. International Data Transfers</h2>
            <p className="text-gray-700 leading-relaxed">
              Where personal data is transferred outside the EEA, FlyttGo ensures appropriate safeguards are in place in accordance with GDPR Chapter V, including Standard Contractual Clauses (SCCs) approved by the European Commission or reliance on an EU adequacy decision. No transfers occur to countries without adequate data protection levels without your explicit consent or applicable legal justification.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">7. Data Retention</h2>
            <div className="space-y-3">
              {[
                { category: 'Account Data', retention: 'Duration of account plus 3 years after closure (for legal dispute purposes).' },
                { category: 'Booking & Transaction Records', retention: '5 years from transaction date (Norwegian accounting law requirement).' },
                { category: 'Driver Credential Documents', retention: '3 years after Driver account termination.' },
                { category: 'Marketing Communications', retention: 'Until consent is withdrawn.' },
                { category: 'GPS/Location Data', retention: 'Maximum 90 days post-booking completion.' },
                { category: 'Support Communications', retention: '2 years from last interaction.' },
              ].map(item => (
                <div key={item.category} className="flex gap-4 text-sm border-b border-gray-100 pb-3">
                  <span className="font-medium text-gray-800 w-48 flex-shrink-0">{item.category}</span>
                  <span className="text-gray-600">{item.retention}</span>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">8. Your GDPR Rights</h2>
            <p className="text-gray-700 leading-relaxed mb-4">Under GDPR, you have the following rights. To exercise any of these rights, contact privacy@flyttgo.com. We will respond within 30 days.</p>
            <div className="grid sm:grid-cols-2 gap-3">
              {[
                { right: 'Right of Access (Art. 15)', desc: 'Obtain a copy of all personal data we hold about you.' },
                { right: 'Right to Rectification (Art. 16)', desc: 'Correct inaccurate or incomplete personal data.' },
                { right: 'Right to Erasure (Art. 17)', desc: 'Request deletion of your data where no legal basis exists for continued processing.' },
                { right: 'Right to Restriction (Art. 18)', desc: 'Restrict processing of your data in certain circumstances.' },
                { right: 'Right to Portability (Art. 20)', desc: 'Receive your data in a structured, machine-readable format.' },
                { right: 'Right to Object (Art. 21)', desc: 'Object to processing based on legitimate interests or for direct marketing.' },
                { right: 'Right to Withdraw Consent', desc: 'Withdraw consent for consent-based processing at any time without affecting prior processing.' },
                { right: 'Right to Lodge a Complaint', desc: 'File a complaint with Datatilsynet (datatilsynet.no), Norway\'s data protection authority.' },
              ].map(item => (
                <div key={item.right} className="bg-gray-50 rounded-xl p-4">
                  <p className="font-semibold text-gray-800 text-sm mb-1">{item.right}</p>
                  <p className="text-gray-500 text-xs">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">9. Cookie Policy</h2>
            <p className="text-gray-700 leading-relaxed mb-4">We use cookies and similar tracking technologies. You can manage your cookie preferences at any time through our Cookie Settings.</p>
            <div className="space-y-3">
              {[
                { type: 'Strictly Necessary Cookies', legal: 'No consent required', desc: 'Essential for Platform operation: authentication, session management, security. Cannot be disabled.' },
                { type: 'Functional Cookies', legal: 'Consent required', desc: 'Remember your preferences and settings (language, saved addresses).' },
                { type: 'Analytics Cookies', legal: 'Consent required', desc: 'Understand how users interact with the Platform (page views, feature usage). Data is anonymized.' },
                { type: 'Marketing Cookies', legal: 'Consent required', desc: 'Serve relevant advertisements on third-party platforms. May involve cross-site tracking.' },
              ].map(item => (
                <div key={item.type} className="border border-gray-200 rounded-xl p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-semibold text-gray-800 text-sm">{item.type}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.legal === 'No consent required' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                      {item.legal}
                    </span>
                  </div>
                  <p className="text-gray-600 text-xs">{item.desc}</p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">10. Data Security</h2>
            <p className="text-gray-700 leading-relaxed">
              FlyttGo implements appropriate technical and organizational measures to protect your personal data against unauthorized access, alteration, disclosure, or destruction. These measures include TLS/SSL encryption for data in transit, AES-256 encryption for sensitive data at rest, access controls and role-based permissions, regular security audits and penetration testing, and incident response procedures compliant with GDPR Article 33 breach notification requirements (72-hour notification to Datatilsynet where required).
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">11. Children's Privacy</h2>
            <p className="text-gray-700 leading-relaxed">
              The Platform is not directed to persons under 18 years of age. We do not knowingly collect personal data from minors. If you believe we have inadvertently collected data from a minor, please contact privacy@flyttgo.com immediately and we will delete such data promptly.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-[#0B2E59] mb-4">12. Changes to This Policy</h2>
            <p className="text-gray-700 leading-relaxed">
              We may update this Privacy Policy to reflect changes in our practices or applicable law. Material changes will be communicated by email or Platform notification at least 14 days before they take effect. The current version is always available at this URL.
            </p>
          </section>

        </div>
      </div>
    </div>
  );
}
