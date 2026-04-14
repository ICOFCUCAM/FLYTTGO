import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useApp } from '../lib/store';

interface FaqItem { q: string; a: string; }
interface FaqSection { title: string; items: FaqItem[]; }

const SECTIONS: FaqSection[] = [
  {
    title: 'Booking a move',
    items: [
      { q: 'How far in advance should I book?',
        a: 'Most local moves can be booked for the next day — sometimes the same day. For house moves during peak season (May–August) we recommend 5–7 days in advance to get the best drivers.' },
      { q: 'Can I get a quote without creating an account?',
        a: 'Yes. The booking widget on our homepage gives an instant estimate based on distance and move type without requiring sign-up. You only need an account when you confirm the booking.' },
      { q: 'How is the price calculated?',
        a: 'Pricing is hourly based on your selected van type, with a two-hour minimum. Distance, number of helpers, and optional extras (packing, assembly, storage) adjust the total. 25% MVA is always included in the displayed price.' },
      { q: 'Can I book a move outside business hours?',
        a: 'Yes — most drivers are available seven days a week from 07:00 to 22:00. Outside these hours an out-of-hours surcharge applies, which is shown upfront in the booking flow.' },
    ],
  },
  {
    title: 'Payment & invoices',
    items: [
      { q: 'When am I charged?',
        a: 'We pre-authorise the estimated amount on your card when you confirm the booking, but the money is only captured once the delivery is completed and you confirm you received everything. Until then it sits in escrow.' },
      { q: 'Which payment methods do you accept?',
        a: 'All major cards (Visa, Mastercard, American Express), plus Vipps and monthly invoicing for verified corporate customers.' },
      { q: 'Do you issue MVA-compliant invoices?',
        a: 'Yes. Every completed job generates a Norwegian MVA-compliant receipt in your account, and corporate customers receive one consolidated invoice per month.' },
      { q: 'What if the final price is different from the estimate?',
        a: 'The driver can only adjust the price while you watch, with a written reason (e.g. additional inventory, extra stairs). You must approve any change before the job is marked complete.' },
    ],
  },
  {
    title: 'Drivers & insurance',
    items: [
      { q: 'Are your drivers insured?',
        a: 'Every driver on FlyttGo operates as a registered Norwegian business with mandatory goods-in-transit insurance covering up to 500,000 NOK per booking. We verify the policy before they can accept jobs.' },
      { q: 'How are drivers vetted?',
        a: 'Every driver submits a valid Norwegian driver license, vehicle registration, company registration number (organisasjonsnummer), and proof of insurance. We run a background check and require a personal interview before activation.' },
      { q: 'What if my goods get damaged?',
        a: 'Open a claim from your booking page within 48 hours of delivery. The driver\u2019s insurance covers most damage, and FlyttGo will mediate if the process stalls. See our Safety & Insurance page for details.' },
      { q: 'Can I request a specific driver I\u2019ve used before?',
        a: 'Yes — once you\u2019ve had a great job with a driver you can favourite them from your dashboard and request them first on your next booking.' },
    ],
  },
  {
    title: 'Managing a booking',
    items: [
      { q: 'Can I change the date after I\u2019ve booked?',
        a: 'Yes. You can reschedule up to 12 hours before the pickup window at no charge. Changes made later than that incur a 20% fee to compensate the driver who reserved the slot.' },
      { q: 'What\u2019s your cancellation policy?',
        a: 'Free cancellation up to 24 hours before pickup. Cancellations within 24 hours are charged 50% of the booking total. No-shows are charged the full amount.' },
      { q: 'Can I track my driver in real time?',
        a: 'Yes. Once the driver accepts your job you\u2019ll see their live location on a map, an ETA, and the current stage of the delivery.' },
      { q: 'What if I need to add more items on the day?',
        a: 'No problem — let the driver know when they arrive. They\u2019ll adjust the quote on the spot and you can approve it in the app before they start loading.' },
    ],
  },
  {
    title: 'Drivers joining FlyttGo',
    items: [
      { q: 'How much can I earn?',
        a: 'Earnings vary by city, van size and subscription tier, but active full-time drivers typically earn 25,000–40,000 NOK/month after commission. We publish transparent earnings data in the Driver Portal.' },
      { q: 'What does it cost to join?',
        a: 'Signing up is free. You can start on the pay-as-you-go tier with 20% commission. Paid subscription tiers lower that commission and give you higher dispatch priority.' },
      { q: 'Do I need my own van?',
        a: 'Yes — FlyttGo is a marketplace, not a rental company. You need a registered Norwegian business, a van with valid insurance, and a clean driving record to start accepting jobs.' },
      { q: 'When do I get paid?',
        a: 'We pay out weekly on Tuesdays for all jobs completed the previous week, directly to your registered business bank account.' },
    ],
  },
];

function AccordionItem({ item, open, onClick }: { item: FaqItem; open: boolean; onClick: () => void }) {
  return (
    <div className={`bg-white rounded-2xl border transition ${open ? 'border-emerald-200 shadow-md' : 'border-gray-100'}`}>
      <button onClick={onClick} className="w-full flex items-start justify-between gap-4 p-5 text-left">
        <h3 className="text-sm sm:text-base font-semibold text-[#0B2E59] pr-4">{item.q}</h3>
        <svg className={`w-5 h-5 flex-shrink-0 text-emerald-600 transition-transform ${open ? 'rotate-45' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
        </svg>
      </button>
      <div className={`grid transition-all duration-300 ease-out ${open ? 'grid-rows-[1fr] opacity-100 pb-5' : 'grid-rows-[0fr] opacity-0'}`}>
        <div className="overflow-hidden">
          <p className="px-5 text-sm text-gray-600 leading-relaxed">{item.a}</p>
        </div>
      </div>
    </div>
  );
}

export default function FaqPage() {
  const { setPage } = useApp();
  const { t } = useTranslation();
  const [openId, setOpenId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const filtered = SECTIONS
    .map(section => ({
      ...section,
      items: search
        ? section.items.filter(i =>
            i.q.toLowerCase().includes(search.toLowerCase()) ||
            i.a.toLowerCase().includes(search.toLowerCase()),
          )
        : section.items,
    }))
    .filter(s => s.items.length > 0);

  return (
    <div className="min-h-screen bg-white">

      {/* HERO */}
      <section className="bg-gradient-to-br from-[#0B2E59] to-[#1a4a8a] text-white py-20">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <div className="inline-flex items-center gap-2 bg-white/10 text-white/80 text-xs font-medium px-4 py-2 rounded-full mb-6">
            ❓ {t('faq.heroBadge')}
          </div>
          <h1 className="text-5xl font-extrabold mb-5 leading-tight">{t('faq.heroTitle')}</h1>
          <p className="text-white/75 text-lg mb-8">{t('faq.heroSubtitle')}</p>
          <div className="relative max-w-xl mx-auto">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
            </svg>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={t('faq.searchPlaceholder')}
              className="w-full pl-12 pr-4 py-4 rounded-2xl bg-white text-gray-900 placeholder-gray-400 focus:ring-4 focus:ring-emerald-400 outline-none shadow-xl"
            />
          </div>
        </div>
      </section>

      {/* SECTIONS */}
      <section className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        {filtered.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-gray-500 mb-4">{t('faq.noResults')}</p>
            <button onClick={() => setSearch('')} className="text-emerald-700 text-sm font-semibold hover:underline">{t('faq.clearSearch')}</button>
          </div>
        ) : (
          filtered.map(section => (
            <div key={section.title} className="mb-10">
              <h2 className="text-xl font-extrabold text-[#0B2E59] mb-4">{section.title}</h2>
              <div className="space-y-3">
                {section.items.map((item, i) => {
                  const id = `${section.title}-${i}`;
                  return (
                    <AccordionItem key={id} item={item} open={openId === id}
                      onClick={() => setOpenId(openId === id ? null : id)}/>
                  );
                })}
              </div>
            </div>
          ))
        )}
      </section>

      {/* STILL STUCK */}
      <section className="bg-gray-50 py-16">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <h2 className="text-2xl font-extrabold text-[#0B2E59] mb-2">{t('faq.stillTitle')}</h2>
          <p className="text-gray-600 mb-6">{t('faq.stillBody')}</p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button onClick={() => setPage('contact')}
              className="px-7 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition shadow-lg">
              {t('faq.contactCta')}
            </button>
            <button onClick={() => setPage('help')}
              className="px-7 py-3 bg-white border border-gray-200 text-gray-700 rounded-xl font-semibold hover:border-gray-300 transition">
              {t('faq.helpCta')}
            </button>
          </div>
        </div>
      </section>

    </div>
  );
}
