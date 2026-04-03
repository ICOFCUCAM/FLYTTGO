import React, { useState } from 'react';
import { useApp } from '../lib/store';

const CHECKLIST_SECTIONS = [
  { title: '4–6 Weeks Before Moving', subtitle: 'Plan Your Move Early', items: ['Confirm your moving date','Book your FlyttGo moving van','Create a moving timeline','Declutter and sort belongings (keep, donate, sell)','Order packing supplies (boxes, tape, bubble wrap)','Research moving insurance options','Start collecting important documents'] },
  { title: '3–4 Weeks Before Moving', subtitle: 'Handle the Admin', items: ['Set up mail redirection service','Notify banks and credit cards of address change','Update government agencies and vehicle registration','Contact utility providers (electricity, water, gas, internet)','Inform schools or childcare providers','Update insurance providers','Cancel or transfer subscriptions'] },
  { title: '2–3 Weeks Before Moving', subtitle: 'Start Packing', items: ['Pack one room at a time, starting with least used','Label every box with room name and contents','Prepare an essentials box (kettle, toiletries, chargers)','Wrap fragile items with bubble wrap or towels','Dismantle large furniture if possible','Take photos of electronics setup before disconnecting','Arrange storage if needed'] },
  { title: '1 Week Before Moving', subtitle: 'Final Preparations', items: ['Confirm your FlyttGo booking details','Defrost fridge and freezer (24 hours before)','Prepare important documents folder','Arrange childcare or pet care for moving day','Plan parking and building access for moving van','Pack remaining everyday items','Clean areas as you pack them'] },
  { title: 'Moving Day', subtitle: 'The Big Day', items: ['Do final walkthrough of entire home','Take final meter readings (electricity, gas, water)','Turn off all appliances and utilities','Supervise loading of the van','Keep fragile items and essentials separate','Lock all windows and doors','Hand over keys to landlord or agent'] },
  { title: 'Arriving at New Home', subtitle: 'Settling In', items: ['Inspect new property before unloading','Check utilities are working','Direct movers where each box should go','Unpack essentials first (kitchen, bedroom, bathroom)','Update local registrations and healthcare','Meet your new neighbours','Celebrate your successful move!'] },
];

export default function MovingChecklist() {
  const { setPage } = useApp();
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = (item: string) => {
    setChecked(prev => { const next = new Set(prev); if (next.has(item)) next.delete(item); else next.add(item); return next; });
  };

  const totalItems = CHECKLIST_SECTIONS.reduce((s, sec) => s + sec.items.length, 0);
  const progress = Math.round((checked.size / totalItems) * 100);

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-emerald-700 to-emerald-900 text-white py-16">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">Ultimate Moving House Checklist</h1>
          <p className="text-lg text-emerald-100 max-w-2xl mx-auto">The complete guide to a stress-free move. Track your progress with our interactive checklist.</p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-xl p-6 border border-gray-100 mb-8 sticky top-16 z-10">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-gray-900">Your Progress</h3>
            <span className="text-sm font-medium text-emerald-600">{checked.size}/{totalItems} completed ({progress}%)</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-3">
            <div className="bg-emerald-500 h-3 rounded-full transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        </div>

        <div className="space-y-8">
          {CHECKLIST_SECTIONS.map((section, si) => {
            const sectionChecked = section.items.filter(i => checked.has(i)).length;
            return (
              <div key={si} className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100 bg-gray-50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-gray-900">{section.title}</h2>
                      <p className="text-sm text-gray-600">{section.subtitle}</p>
                    </div>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${sectionChecked === section.items.length ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-200 text-gray-600'}`}>
                      {sectionChecked}/{section.items.length}
                    </span>
                  </div>
                </div>
                <div className="divide-y divide-gray-100">
                  {section.items.map(item => (
                    <label key={item} className="flex items-center gap-3 p-4 hover:bg-gray-50 cursor-pointer">
                      <input type="checkbox" checked={checked.has(item)} onChange={() => toggle(item)}
                        className="w-5 h-5 text-emerald-600 rounded focus:ring-emerald-500 flex-shrink-0" />
                      <span className={`text-sm ${checked.has(item) ? 'text-gray-400 line-through' : 'text-gray-700'}`}>{item}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-12 bg-emerald-600 rounded-2xl p-8 text-center text-white">
          <h2 className="text-2xl font-bold mb-2">Ready to Move?</h2>
          <p className="text-emerald-100 mb-6">Book a FlyttGo driver and make your move stress-free</p>
          <div className="flex flex-wrap justify-center gap-4">
            <button onClick={() => setPage('van-guide')} className="px-6 py-3 bg-white text-emerald-700 rounded-xl font-semibold hover:bg-emerald-50 transition">Van Size Calculator</button>
            <button onClick={() => setPage('booking')} className="px-6 py-3 bg-emerald-700 text-white rounded-xl font-semibold hover:bg-emerald-800 transition border border-emerald-500">Book a Driver</button>
          </div>
        </div>
      </div>
    </div>
  );
}
