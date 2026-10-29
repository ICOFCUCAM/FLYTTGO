/**
 * The data processing agreement for white label, Model B (plan Own
 * seller): the company is the data controller for its customers, FlyttGo
 * the processor (GDPR art. 28). Version DPA_VERSION; an owner accepts it in
 * the company dashboard (accept_white_label_dpa). Marked as a draft until a
 * lawyer has reviewed it (docs/WHITE_LABEL.md).
 */
import { DPA_VERSION } from '../lib/whiteLabel';

const SECTIONS: [string, string[]][] = [
  ['1. Parties and roles', [
    'The company that has chosen the plan Own seller ("the controller") sells moving and delivery services to its customers under its own name. FlyttGo AS ("the processor") carries out the services as its subcontractor and runs the booking system on its behalf.',
    'For the personal data of the controller\'s customers handled through its booking page, the controller is the data controller and FlyttGo the data processor, under the General Data Protection Regulation (GDPR) article 28 and the Norwegian Personal Data Act.',
    'Where FlyttGo must keep data for its own legal duties (bookkeeping of its own invoices, driver payments, insurance and claims, fraud prevention), FlyttGo is the controller for that use.',
  ]],
  ['2. What is processed, and why', [
    'Purpose: taking and carrying out the controller\'s customers\' bookings: pricing, payment through the controller\'s own payment account, dispatch to drivers, tracking, messages about the booking, cancellations and refunds.',
    'Customers (data subjects): people and businesses who book on the controller\'s page.',
    'Data: name, email, phone, pickup and drop-off addresses and their coordinates, move date and time, inventory and notes the customer gives, booking and payment status, the driver\'s location during the job, and messages about the booking. No special categories of personal data are asked for.',
    'Duration: while the plan is active, and afterwards as section 8 says.',
  ]],
  ['3. Instructions', [
    'FlyttGo processes the data only on the controller\'s documented instructions: this agreement, the plan and the settings the controller makes in its dashboard. FlyttGo tells the controller if it believes an instruction breaks data protection law.',
  ]],
  ['4. Confidentiality and security', [
    'Everyone at FlyttGo, and every driver, who may see the data is bound to confidentiality. Drivers see a customer\'s contact details only for the jobs they carry out.',
    'FlyttGo keeps appropriate technical and organisational measures (GDPR article 32): encryption in transit, access limited by role in the database (row-level security), separation between companies, logging of administrative changes, and backups.',
  ]],
  ['5. Sub-processors', [
    'The controller accepts these sub-processors: Supabase (database, file storage and server functions; EU region), Vercel (hosting of the web application), Resend (sending email), and the map and routing services used to price and route a move. The controller\'s own payment provider (Stripe) is the controller\'s, not FlyttGo\'s, processor.',
    'FlyttGo informs the controller of a planned new or replacement sub-processor at least 30 days before it is used; the controller may object, and if no solution is found may end the plan. Sub-processors are bound by the same duties. Transfers outside the EEA rely on an adequacy decision or the EU standard contractual clauses.',
  ]],
  ['6. Helping the controller', [
    'FlyttGo helps the controller answer customers who use their rights (access, correction, deletion, restriction, portability, objection), with impact assessments and with prior consultation, to the extent the processing allows.',
  ]],
  ['7. Personal data breaches', [
    'FlyttGo notifies the controller without undue delay, and where possible within 24 hours, after becoming aware of a breach affecting the controller\'s customers\' data, with what is known and what is being done. The controller decides on notification to Datatilsynet and to customers.',
  ]],
  ['8. When the plan ends', [
    'Within 30 days after the plan ends, FlyttGo gives the controller its customers\' booking data in a common format on request, and then deletes or anonymises it, except what FlyttGo must keep under section 1 or by law (for example bookkeeping, 5 years).',
  ]],
  ['9. Audits', [
    'FlyttGo makes available the information needed to show it meets this agreement and allows audits by the controller or an auditor it appoints, with reasonable notice and confidentiality.',
  ]],
  ['10. Precedence and law', [
    'If this agreement and other terms between the parties conflict on personal data, this agreement applies. Norwegian law applies; disputes go to the courts of FlyttGo\'s registered office.',
  ]],
];

export default function WhiteLabelDpaPage() {
  return (
    <div className="bg-white min-h-screen">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="text-sm text-gray-500 mb-2">FlyttGo Business · White label · Plan Own seller</p>
        <h1 className="text-3xl font-extrabold text-gray-900 mb-2">Data processing agreement</h1>
        <p className="text-sm text-gray-500 mb-6">Version {DPA_VERSION}</p>
        <div className="mb-8 rounded-xl border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          Draft: this agreement has not yet been reviewed by a lawyer. It will be replaced by a reviewed version before the plan
          Own seller is offered, and companies will be asked to accept the new version.
        </div>
        {SECTIONS.map(([title, paras]) => (
          <section key={title} className="mb-6">
            <h2 className="text-lg font-bold text-gray-900 mb-2">{title}</h2>
            {paras.map((p, i) => <p key={i} className="text-sm text-gray-700 leading-relaxed mb-2">{p}</p>)}
          </section>
        ))}
        <p className="text-sm text-gray-500 mt-8">
          An owner of the company accepts this agreement in the company dashboard (White label). The acceptance is recorded with
          the version, the person and the time.
        </p>
      </div>
    </div>
  );
}
