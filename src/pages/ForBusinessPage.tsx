import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WhatsAppButton from '@/components/WhatsAppButton';
import { toast } from '@/components/ui/use-toast';
import {
  Building2, RotateCcw, Users, BarChart3, Truck, Shield, Clock,
  CreditCard, ArrowRight, CheckCircle2, Zap, Globe
} from 'lucide-react';

const ForBusinessPage: React.FC = () => {
  const [form, setForm] = useState({ company: '', name: '', email: '', phone: '', needs: '' });
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.company || !form.email) {
      toast({ title: 'Missing Fields', description: 'Please fill in required fields.', variant: 'destructive' });
      return;
    }
    setSubmitted(true);
    toast({ title: 'Request Submitted!', description: 'Our business team will contact you within 24 hours.' });
  };

  const features = [
    { icon: Building2, title: 'Bulk Transport', desc: 'Move large quantities efficiently with our fleet.' },
    { icon: RotateCcw, title: 'Recurring Deliveries', desc: 'Set up scheduled routes for regular needs.' },
    { icon: Users, title: 'Dedicated Drivers', desc: 'Assigned drivers who know your business.' },
    { icon: BarChart3, title: 'Business Dashboard', desc: 'Track all deliveries and costs in real-time.' },
    { icon: CreditCard, title: 'Invoice Billing', desc: 'Monthly invoicing with detailed reports.' },
    { icon: Zap, title: 'API Access', desc: 'Integrate FlyttGo into your systems.' },
    { icon: Shield, title: 'Priority Support', desc: 'Dedicated account manager.' },
    { icon: Globe, title: 'Multi-City', desc: 'Operate across all Norwegian cities.' },
  ];

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <section className="pt-32 pb-20 bg-gradient-to-br from-[#0B2E59] to-[#0B2E59]/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <span className="inline-block px-4 py-1.5 bg-[#F2B705]/10 text-[#F2B705] text-sm font-semibold rounded-full mb-6 border border-[#F2B705]/20">
                For Businesses
              </span>
              <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6 leading-tight">
                Logistics Solutions for <span className="text-[#F2B705]">Businesses</span>
              </h1>
              <p className="text-white/70 text-lg mb-8">
                Streamline your business logistics with FlyttGo's corporate platform. Volume discounts, dedicated drivers, and powerful analytics.
              </p>
              <div className="flex flex-wrap gap-3">
                {['500+ Business Accounts', 'Volume Discounts', 'API Integration'].map((s) => (
                  <span key={s} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white/10 rounded-full text-white/80 text-sm border border-white/20">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#F2B705]" />
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-2xl p-6 shadow-2xl">
              {submitted ? (
                <div className="text-center py-12">
                  <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  </div>
                  <h3 className="text-xl font-bold text-[#0B2E59] mb-2">Request Submitted!</h3>
                  <p className="text-gray-600">Our business team will contact you within 24 hours.</p>
                </div>
              ) : (
                <>
                  <h3 className="text-xl font-bold text-[#0B2E59] mb-1">Open Business Account</h3>
                  <p className="text-gray-500 text-sm mb-6">Tell us about your logistics needs.</p>
                  <form onSubmit={handleSubmit} className="space-y-4">
                    <input type="text" placeholder="Company Name *" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                    <input type="text" placeholder="Contact Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                    <input type="email" placeholder="Business Email *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                    <input type="tel" placeholder="Phone Number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                    <textarea placeholder="Describe your logistics needs..." value={form.needs} onChange={(e) => setForm({ ...form, needs: e.target.value })} rows={3} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none resize-none" />
                    <button type="submit" className="w-full py-3.5 bg-[#0B2E59] text-white font-bold rounded-xl hover:bg-[#0B2E59]/90 transition-all text-lg">
                      Request Business Account
                    </button>
                  </form>
                </>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-extrabold text-[#0B2E59] mb-4">Enterprise Features</h2>
            <p className="text-gray-600">Everything your business needs for efficient logistics.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f) => (
              <div key={f.title} className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-lg transition-all text-center">
                <div className="w-12 h-12 bg-[#0B2E59]/5 rounded-xl flex items-center justify-center mx-auto mb-4">
                  <f.icon className="w-6 h-6 text-[#0B2E59]" />
                </div>
                <h4 className="font-bold text-[#0B2E59] mb-1">{f.title}</h4>
                <p className="text-gray-500 text-sm">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
      <WhatsAppButton />
    </div>
  );
};

export default ForBusinessPage;
