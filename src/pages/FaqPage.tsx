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
        a: 'You choose the date and start time when you book. Whether the job is taken depends on which approved drivers are available at that time.' },
    ],
  },
  {
    title: 'Payment & invoices',
    items: [
      { q: 'When am I charged?',
        a: 'Card payments are taken when you confirm the booking, on Stripe\u2019s secure checkout page. With Vipps the amount is reserved when you book and taken when the job is confirmed as done. FlyttGo pays the driver after the job is confirmed. If you cancel more than 24 hours before pickup you get everything back; within 24 hours, 50 % is refunded.' },
      { q: 'Which payment methods do you accept?',
        a: 'Cards through Stripe\u2019s checkout page (where Google Pay may also be offered), Vipps, and invoice for company bookings once FlyttGo has switched on invoicing for the company.' },
      { q: 'Do you issue MVA-compliant invoices?',
        a: 'Yes. Prices include 25 % MVA, and companies paying on invoice are invoiced per booking or once a month, as they choose.' },
      { q: 'What if the final price is different from the estimate?',
        a: 'The driver can only adjust the price while you watch, with a written reason (e.g. additional inventory, extra stairs). You must approve any change before the job is marked complete.' },
    ],
  },
  {
    title: 'Drivers & insurance',
    items: [
      { q: 'Are your drivers insured?',
        a: 'Each driver uploads proof of insurance when they apply, and FlyttGo reviews it before approving the driver. What is covered depends on the driver\u2019s own policy; FlyttGo itself provides no insurance. See the Liability page for who is responsible for what.' },
      { q: 'How are drivers vetted?',
        a: 'Every driver uploads an ID document, a valid driving licence, the vehicle registration and proof of insurance. A FlyttGo administrator reviews the application before the driver can take jobs.' },
      { q: 'What if my goods get damaged?',
        a: 'Contact us within 48 hours of delivery through the contact form (choose \u201cClaim or complaint\u201d) with your booking reference. FlyttGo passes the claim to the driver, who may refer it to their insurance. See the Safety & Insurance and Liability pages for details.' },
      { q: 'Can I request a specific driver I\u2019ve used before?',
        a: 'Not yet. Each job goes to an approved driver who accepts it. You can mention a wish in the special instructions, but it cannot be promised.' },
    ],
  },
  {
    title: 'Managing a booking',
    items: [
      { q: 'Can I change the date after I\u2019ve booked?',
        a: 'Contact us as early as you can through the contact form. If the new date does not work out, cancelling follows the cancellation policy below.' },
      { q: 'What\u2019s your cancellation policy?',
        a: 'Free cancellation up to 24 hours before pickup. Cancellations within 24 hours are charged 50% of the booking total. No-shows are charged the full amount. Cancel in your account until the driver arrives: the refund goes back automatically to the card or Vipps account you paid with. If the driver or FlyttGo cancels, you get everything back.' },
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
        a: 'It depends on the jobs you accept and your subscription plan\u2019s commission. The earnings calculator in the Driver Portal shows what you keep from a job before you accept it.' },
      { q: 'What does it cost to join?',
        a: 'Signing up is free. You can start on the pay-as-you-go tier with 20% commission. Paid subscription tiers lower that commission and give you higher dispatch priority.' },
      { q: 'Do I need my own van?',
        a: 'Yes — FlyttGo is a marketplace, not a rental company. You need a registered Norwegian business, a van with valid insurance, and a clean driving record to start accepting jobs.' },
      { q: 'When do I get paid?',
        a: 'Your share of a job goes to your wallet in the Driver Portal once the job is confirmed as done. From there you request a payout to your bank account.' },
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
