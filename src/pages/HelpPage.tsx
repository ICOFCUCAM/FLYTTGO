import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WhatsAppButton from '@/components/WhatsAppButton';
import { toast } from '@/components/ui/use-toast';
import {
  Search, HelpCircle, MessageCircle, Phone, Mail, MapPin,
  Package, CreditCard, Users, Shield, Clock, Truck, ChevronRight
} from 'lucide-react';

const HelpPage: React.FC = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [contactForm, setContactForm] = useState({ name: '', email: '', subject: '', message: '' });

  const categories = [
    { icon: Package, title: 'Bookings', count: 12, topics: ['How to book', 'Cancel booking', 'Modify booking', 'Multiple stops'] },
    { icon: CreditCard, title: 'Payments', count: 8, topics: ['Payment methods', 'Refunds', 'Invoices', 'Pricing'] },
    { icon: Users, title: 'For Drivers', count: 10, topics: ['How to join', 'Earnings', 'Driver app', 'Requirements'] },
    { icon: Shield, title: 'Safety', count: 6, topics: ['Insurance', 'Background checks', 'Dispute resolution', 'GDPR'] },
    { icon: Clock, title: 'Tracking', count: 5, topics: ['Live tracking', 'ETA updates', 'Driver contact', 'Delivery proof'] },
    { icon: Truck, title: 'Services', count: 9, topics: ['Service types', 'Vehicle sizes', 'Extra services', 'Coverage areas'] },
  ];

  const faqs = [
    { q: 'How do I book a transport?', a: 'Simply enter your pickup and delivery addresses, select your item type and vehicle size, choose a date and time, and get an instant price. The whole process takes under 60 seconds.' },
    { q: 'What payment methods do you accept?', a: 'We accept credit cards, Apple Pay, Google Pay, Vipps, and Stripe. All payments are processed securely.' },
    { q: 'Can I cancel my booking?', a: 'Free cancellation up to 24 hours before the scheduled time. Cancellations within 24 hours incur a 50% charge.' },
    { q: 'How does driver matching work?', a: 'Our AI dispatch engine matches you with the best available driver based on proximity, rating, vehicle capacity, and estimated arrival time. Average match time is under 30 seconds.' },
    { q: 'Is my delivery insured?', a: 'Yes, all transports are covered by comprehensive insurance up to 100,000 NOK. Additional coverage is available.' },
    { q: 'How do I become a driver?', a: 'Visit our For Drivers page and fill out the application form. You\'ll need a valid driving license, your own van, and to pass a background check.' },
    { q: 'What are the pricing rates?', a: '1 driver + van starts at 850 NOK/hour. 2 movers + van starts at 1,150 NOK/hour. Minimum booking is 2 hours. First 20 km included.' },
    { q: 'Do you offer business accounts?', a: 'Yes! We offer corporate logistics accounts with volume discounts, dedicated drivers, invoice billing, and business dashboards.' },
  ];

  const filteredFaqs = faqs.filter(
    (faq) => faq.q.toLowerCase().includes(searchQuery.toLowerCase()) || faq.a.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleContact = (e: React.FormEvent) => {
    e.preventDefault();
    if (!contactForm.email || !contactForm.message) {
      toast({ title: 'Missing Fields', description: 'Please fill in all required fields.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Message Sent!', description: 'We\'ll get back to you within 24 hours.' });
    setContactForm({ name: '', email: '', subject: '', message: '' });
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <section className="pt-32 pb-16 bg-gradient-to-br from-[#0B2E59] to-[#0B2E59]/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6">Help Center</h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto mb-8">
            Find answers to common questions or contact our support team.
          </p>
          <div className="max-w-xl mx-auto relative">
            <Search className="absolute left-4 top-4 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search for help..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-4 rounded-2xl text-sm border-0 shadow-xl focus:ring-2 focus:ring-[#F2B705] outline-none"
            />
          </div>
        </div>
      </section>

      {/* Categories */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <h2 className="text-2xl font-bold text-[#0B2E59] mb-8">Browse by Category</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {categories.map((cat) => (
              <div key={cat.title} className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm hover:shadow-lg transition-all cursor-pointer group">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 bg-[#0B2E59]/5 rounded-xl flex items-center justify-center">
                    <cat.icon className="w-5 h-5 text-[#0B2E59]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-[#0B2E59]">{cat.title}</h3>
                    <span className="text-xs text-gray-500">{cat.count} articles</span>
                  </div>
                </div>
                <ul className="space-y-1.5">
                  {cat.topics.map((t) => (
                    <li key={t} className="flex items-center gap-2 text-sm text-gray-600 hover:text-[#0B2E59] cursor-pointer">
                      <ChevronRight className="w-3 h-3" />
                      {t}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-16 bg-gray-50">
        <div className="max-w-3xl mx-auto px-4">
          <h2 className="text-2xl font-bold text-[#0B2E59] mb-8 text-center">Frequently Asked Questions</h2>
          <div className="space-y-3">
            {filteredFaqs.map((faq) => (
              <details key={faq.q} className="bg-white rounded-xl border border-gray-100 shadow-sm group">
                <summary className="px-6 py-4 cursor-pointer flex items-center justify-between font-medium text-[#0B2E59]">
                  {faq.q}
                  <HelpCircle className="w-5 h-5 text-gray-400 group-open:text-[#F2B705] flex-shrink-0" />
                </summary>
                <div className="px-6 pb-4 text-gray-600 text-sm">{faq.a}</div>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Contact */}
      <section className="py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
            <div>
              <h2 className="text-2xl font-bold text-[#0B2E59] mb-6">Contact Us</h2>
              <div className="space-y-4 mb-8">
                <a href="https://wa.me/447432112438" target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-4 bg-green-50 rounded-xl hover:bg-green-100 transition-colors">
                  <MessageCircle className="w-6 h-6 text-green-600" />
                  <div>
                    <div className="font-bold text-green-800">WhatsApp Support</div>
                    <div className="text-green-600 text-sm">+44 7432 112438</div>
                  </div>
                </a>
                <div className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl">
                  <Mail className="w-6 h-6 text-blue-600" />
                  <div>
                    <div className="font-bold text-blue-800">Email</div>
                    <div className="text-blue-600 text-sm">support@flyttgo.com</div>
                  </div>
                </div>
                <div className="flex items-center gap-4 p-4 bg-purple-50 rounded-xl">
                  <Phone className="w-6 h-6 text-purple-600" />
                  <div>
                    <div className="font-bold text-purple-800">Phone</div>
                    <div className="text-purple-600 text-sm">+44 7432 112438</div>
                  </div>
                </div>
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-bold text-[#0B2E59] mb-6">Send a Message</h2>
              <form onSubmit={handleContact} className="space-y-4">
                <input type="text" placeholder="Your Name" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                <input type="email" placeholder="Email Address *" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                <input type="text" placeholder="Subject" value={contactForm.subject} onChange={(e) => setContactForm({ ...contactForm, subject: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                <textarea placeholder="Your message *" value={contactForm.message} onChange={(e) => setContactForm({ ...contactForm, message: e.target.value })} rows={4} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none resize-none" />
                <button type="submit" className="w-full py-3.5 bg-[#0B2E59] text-white font-bold rounded-xl hover:bg-[#0B2E59]/90 transition-all">
                  Send Message
                </button>
              </form>
            </div>
          </div>
        </div>
      </section>

      <Footer />
      <WhatsAppButton />
    </div>
  );
};

export default HelpPage;

