import React from 'react';
import Navbar from '@/components/Navbar';
import Footer from '@/components/Footer';
import WhatsAppButton from '@/components/WhatsAppButton';
import { Link } from 'react-router-dom';
import { MapPin, Users, Package, Star, ArrowRight, CheckCircle2 } from 'lucide-react';

const cities = [
  { name: 'Oslo', slug: 'oslo', drivers: 3200, bookings: '45,000+', rating: 4.9, population: '1M+', description: 'Norway\'s capital and largest city. FlyttGo\'s biggest market with thousands of daily deliveries.' },
  { name: 'Bergen', slug: 'bergen', drivers: 1800, bookings: '22,000+', rating: 4.8, population: '285K', description: 'Norway\'s second-largest city. Serving the west coast with reliable transport services.' },
  { name: 'Trondheim', slug: 'trondheim', drivers: 1200, bookings: '15,000+', rating: 4.9, population: '210K', description: 'Technology hub of Norway. Fast-growing market with high demand for logistics.' },
  { name: 'Stavanger', slug: 'stavanger', drivers: 950, bookings: '12,000+', rating: 4.8, population: '145K', description: 'Oil capital of Norway. Strong business logistics demand.' },
  { name: 'Drammen', slug: 'drammen', drivers: 600, bookings: '8,000+', rating: 4.7, population: '100K', description: 'Growing city near Oslo. Excellent coverage for residential moves.' },
  { name: 'Fredrikstad', slug: 'fredrikstad', drivers: 450, bookings: '5,000+', rating: 4.8, population: '83K', description: 'Historic city with growing logistics needs.' },
  { name: 'Kristiansand', slug: 'kristiansand', drivers: 500, bookings: '6,000+', rating: 4.7, population: '112K', description: 'Southern Norway\'s largest city. Serving the Sørlandet region.' },
  { name: 'Tromsø', slug: 'tromso', drivers: 350, bookings: '4,000+', rating: 4.9, population: '77K', description: 'Arctic city with unique logistics challenges. We deliver anywhere.' },
  { name: 'Sandnes', slug: 'sandnes', drivers: 400, bookings: '5,500+', rating: 4.7, population: '80K', description: 'Twin city of Stavanger. Full coverage for the Rogaland region.' },
  { name: 'Bodø', slug: 'bodo', drivers: 200, bookings: '2,500+', rating: 4.8, population: '53K', description: 'Northern Norway gateway. Reliable transport in challenging conditions.' },
  { name: 'Ålesund', slug: 'alesund', drivers: 250, bookings: '3,000+', rating: 4.8, population: '50K', description: 'Art Nouveau city on the west coast. Growing logistics market.' },
  { name: 'Tønsberg', slug: 'tonsberg', drivers: 300, bookings: '3,500+', rating: 4.7, population: '56K', description: 'Norway\'s oldest city. Comprehensive moving services.' },
];

const CitiesPage: React.FC = () => {
  return (
    <div className="min-h-screen bg-white">
      <Navbar />

      <section className="pt-32 pb-16 bg-gradient-to-br from-[#0B2E59] to-[#0B2E59]/90 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <img src="https://d64gsuwffb70l.cloudfront.net/69aebba0474664f5e219add9_1773059247855_ab941e67.png" alt="" className="w-full h-full object-cover" />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
          <h1 className="text-4xl sm:text-5xl font-extrabold text-white mb-6">Cities We Serve</h1>
          <p className="text-white/70 text-lg max-w-2xl mx-auto">
            FlyttGo is available across Norway's major cities with thousands of verified drivers ready to help. Flyttehjelp wherever you need it.
          </p>
          <div className="flex justify-center gap-6 mt-8">
            {[
              { value: '12+', label: 'Cities' },
              { value: '10,000+', label: 'Drivers' },
              { value: '250,000+', label: 'Deliveries' },
            ].map((s) => (
              <div key={s.label} className="text-center">
                <div className="text-2xl font-extrabold text-[#F2B705]">{s.value}</div>
                <div className="text-white/60 text-sm">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="py-20">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {cities.map((city) => (
              <div key={city.slug} className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-xl transition-all overflow-hidden group">
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-10 h-10 bg-[#0B2E59]/5 rounded-xl flex items-center justify-center">
                      <MapPin className="w-5 h-5 text-[#F2B705]" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-[#0B2E59] group-hover:text-[#F2B705] transition-colors">{city.name}</h3>
                      <span className="text-xs text-gray-500">Pop. {city.population}</span>
                    </div>
                  </div>
                  <p className="text-gray-600 text-sm mb-4">{city.description}</p>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Users className="w-3.5 h-3.5 text-[#0B2E59]" />
                        <span className="text-sm font-bold text-[#0B2E59]">{city.drivers}</span>
                      </div>
                      <span className="text-xs text-gray-500">Drivers</span>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Package className="w-3.5 h-3.5 text-[#0B2E59]" />
                        <span className="text-sm font-bold text-[#0B2E59]">{city.bookings}</span>
                      </div>
                      <span className="text-xs text-gray-500">Bookings</span>
                    </div>
                    <div className="text-center">
                      <div className="flex items-center justify-center gap-1">
                        <Star className="w-3.5 h-3.5 text-[#F2B705]" />
                        <span className="text-sm font-bold text-[#0B2E59]">{city.rating}</span>
                      </div>
                      <span className="text-xs text-gray-500">Rating</span>
                    </div>
                  </div>
                  <Link to="/book" className="flex items-center justify-center gap-1 w-full py-2.5 bg-[#0B2E59] text-white font-semibold rounded-xl text-sm hover:bg-[#0B2E59]/90 transition-all">
                    Flyttehjelp {city.name} <ArrowRight className="w-4 h-4" />
                  </Link>
                </div>
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

export default CitiesPage;

