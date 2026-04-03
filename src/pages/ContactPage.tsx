import React, { useState } from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WhatsAppButton from '@/components/WhatsAppButton';
import { toast } from '@/components/ui/use-toast';
import { MessageCircle, Mail, Phone, MapPin, Clock, Send } from 'lucide-react';

const ContactPage: React.FC = () => {
  const [form, setForm] = useState({ name: '', email: '', phone: '', subject: '', message: '' });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.email || !form.message) {
      toast({ title: 'Missing Fields', description: 'Please fill in email and message.', variant: 'destructive' });
      return;
    }
    toast({ title: 'Message Sent!', description: 'We\'ll respond within 24 hours.' });
    setForm({ name: '', email: '', phone: '', subject: '', message: '' });
  };

  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <section className="pt-32 pb-16 bg-gradient-to-br from-[#0B2E59] to-[#0B2E59]/90">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6">Contact Us</h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto">
            Have a question? We're here to help. Reach out through any of our channels.
          </p>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {/* Contact Info */}
            <div className="space-y-4">
              <h2 className="text-2xl font-bold text-[#0B2E59] mb-6">Get in Touch</h2>
              <a href="https://wa.me/447432112438" target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 p-5 bg-green-50 rounded-2xl hover:bg-green-100 transition-colors">
                <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                  <MessageCircle className="w-6 h-6 text-green-600" />
                </div>
                <div>
                  <div className="font-bold text-green-800">WhatsApp</div>
                  <div className="text-green-600 text-sm">+44 7432 112438</div>
                </div>
              </a>
              <div className="flex items-center gap-4 p-5 bg-blue-50 rounded-2xl">
                <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                  <Mail className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <div className="font-bold text-blue-800">Email</div>
                  <div className="text-blue-600 text-sm">support@flyttgo.com</div>
                </div>
              </div>
              <div className="flex items-center gap-4 p-5 bg-purple-50 rounded-2xl">
                <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                  <Phone className="w-6 h-6 text-purple-600" />
                </div>
                <div>
                  <div className="font-bold text-purple-800">Phone</div>
                  <div className="text-purple-600 text-sm">+44 7432 112438</div>
                </div>
              </div>
              <div className="flex items-center gap-4 p-5 bg-orange-50 rounded-2xl">
                <div className="w-12 h-12 bg-orange-100 rounded-xl flex items-center justify-center">
                  <MapPin className="w-6 h-6 text-orange-600" />
                </div>
                <div>
                  <div className="font-bold text-orange-800">Address</div>
                  <div className="text-orange-600 text-sm">Oslo, Norway</div>
                </div>
              </div>
              <div className="flex items-center gap-4 p-5 bg-gray-50 rounded-2xl">
                <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center">
                  <Clock className="w-6 h-6 text-gray-600" />
                </div>
                <div>
                  <div className="font-bold text-gray-800">Hours</div>
                  <div className="text-gray-600 text-sm">24/7 Support Available</div>
                </div>
              </div>
            </div>

            {/* Contact Form */}
            <div className="lg:col-span-2">
              <div className="bg-white rounded-2xl p-8 border border-gray-100 shadow-lg">
                <h2 className="text-2xl font-bold text-[#0B2E59] mb-6">Send Us a Message</h2>
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input type="text" placeholder="Your Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                    <input type="email" placeholder="Email Address *" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <input type="tel" placeholder="Phone Number" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none" />
                    <select value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none bg-white">
                      <option value="">Select Subject</option>
                      <option>Booking Inquiry</option>
                      <option>Driver Application</option>
                      <option>Business Account</option>
                      <option>Payment Issue</option>
                      <option>General Question</option>
                    </select>
                  </div>
                  <textarea placeholder="Your message *" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} rows={6} className="w-full px-4 py-3 border-2 border-gray-200 rounded-xl text-sm focus:border-[#0B2E59] outline-none resize-none" />
                  <button type="submit" className="inline-flex items-center gap-2 px-8 py-3.5 bg-[#0B2E59] text-white font-bold rounded-xl hover:bg-[#0B2E59]/90 transition-all">
                    <Send className="w-5 h-5" />
                    Send Message
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      </section>

      <Footer />
      <WhatsAppButton />
    </div>
  );
};

export default ContactPage;
