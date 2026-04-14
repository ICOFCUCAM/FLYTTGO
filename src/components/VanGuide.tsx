import React, { useState, useMemo } from 'react';
import { VAN_TYPES, INVENTORY_ITEMS, PROPERTY_PRESETS, recommendVan } from '../lib/constants';
import { useApp } from '../lib/store';

export default function VanGuide() {
  const { setPage, setBookingData } = useApp();
  const [activeTab, setActiveTab] = useState<'guide' | 'calculator'>('guide');
  const [inventory, setInventory] = useState<Record<string, number>>({});
  const [selectedPreset, setSelectedPreset] = useState('');

  const totalVolume = useMemo(() => {
    let vol = 0;
    const allItems = Object.values(INVENTORY_ITEMS).flat();
    Object.entries(inventory).forEach(([name, qty]) => {
      const item = allItems.find(i => i.name === name);
      if (item) vol += item.volume * qty;
    });
    return Math.round(vol * 100) / 100;
  }, [inventory]);

  const totalWeight = useMemo(() => {
    let w = 0;
    const allItems = Object.values(INVENTORY_ITEMS).flat();
    Object.entries(inventory).forEach(([name, qty]) => {
      const item = allItems.find(i => i.name === name);
      if (item) w += item.weight * qty;
    });
    return Math.round(w);
  }, [inventory]);

  const recVan = recommendVan(totalVolume);
  const recVanData = VAN_TYPES.find(v => v.id === recVan);

  const updateItem = (name: string, delta: number) => {
    setInventory(prev => {
      const n = { ...prev };
      const qty = (n[name] || 0) + delta;
      if (qty <= 0) delete n[name];
      else n[name] = qty;
      return n;
    });
  };

  const loadPreset = (preset: string) => {
    setSelectedPreset(preset);
    setInventory({ ...PROPERTY_PRESETS[preset] });
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-br from-gray-900 to-gray-800 text-white py-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl sm:text-5xl font-bold mb-4">Van Size Guide & Calculator</h1>
          <p className="text-lg text-gray-300 max-w-2xl mx-auto">Find the perfect van for your move. Compare sizes or use our smart calculator to get an instant recommendation.</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex gap-1 mb-8 bg-gray-100 rounded-xl p-1 max-w-sm mx-auto">
          <button onClick={() => setActiveTab('guide')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${activeTab === 'guide' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Van Size Guide</button>
          <button onClick={() => setActiveTab('calculator')} className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition ${activeTab === 'calculator' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Calculator</button>
        </div>

        {activeTab === 'guide' && (
          <div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
              {VAN_TYPES.map(van => (
                <div key={van.id} className="bg-white rounded-2xl overflow-hidden border border-gray-100 hover:shadow-xl transition group">
                  <div className="aspect-[4/3] overflow-hidden">
                    <img src={van.image} alt={van.name} width={600} height={450} loading="lazy" decoding="async" className="w-full h-full object-cover group-hover:scale-105 transition duration-500" />
                  </div>
                  <div className="p-5">
                    <h3 className="text-xl font-bold text-gray-900 mb-2">{van.name}</h3>
                    <div className="space-y-2 mb-4">
                      <div className="flex justify-between text-sm"><span className="text-gray-500">Load Volume</span><span className="font-medium text-gray-900">{van.capacity}</span></div>
                      <div className="flex justify-between text-sm"><span className="text-gray-500">Payload</span><span className="font-medium text-gray-900">{van.payload}</span></div>
                    </div>
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 uppercase font-medium mb-2">Best For</p>
                      <div className="flex flex-wrap gap-1">
                        {van.bestFor.map(b => (<span key={b} className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-xs">{b}</span>))}
                      </div>
                    </div>
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 uppercase font-medium mb-2">Example Items</p>
                      <p className="text-sm text-gray-600">{van.items.join(', ')}</p>
                    </div>
                    <div className="mb-4">
                      <p className="text-xs text-gray-500 uppercase font-medium mb-2">Vehicle Examples</p>
                      <p className="text-sm text-gray-600">{van.examples.join(', ')}</p>
                    </div>
                    <p className="text-lg font-bold text-emerald-600 mb-3">From {van.pricePerHour} NOK/hr</p>
                    <button onClick={() => { setBookingData({ vanType: van.id }); setPage('booking'); }}
                      className="w-full py-2.5 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 transition text-sm">
                      Book {van.name}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="bg-white rounded-2xl border border-gray-100 p-6 overflow-x-auto">
              <h2 className="text-2xl font-bold text-gray-900 mb-6">Quick Comparison</h2>
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left py-3 px-4 font-semibold">Feature</th>
                    {VAN_TYPES.map(v => <th key={v.id} className="text-center py-3 px-4 font-semibold">{v.name}</th>)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  <tr><td className="py-3 px-4 text-gray-600">Capacity</td>{VAN_TYPES.map(v => <td key={v.id} className="text-center py-3 px-4 font-medium">{v.capacity}</td>)}</tr>
                  <tr><td className="py-3 px-4 text-gray-600">Payload</td>{VAN_TYPES.map(v => <td key={v.id} className="text-center py-3 px-4 font-medium">{v.payload}</td>)}</tr>
                  <tr><td className="py-3 px-4 text-gray-600">Price/hr</td>{VAN_TYPES.map(v => <td key={v.id} className="text-center py-3 px-4 font-medium text-emerald-600">{v.pricePerHour} NOK</td>)}</tr>
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'calculator' && (
          <div className="grid lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white rounded-xl p-6 border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-4">Property Size Presets</h3>
                <div className="flex flex-wrap gap-2">
                  {Object.keys(PROPERTY_PRESETS).map(p => (
                    <button key={p} onClick={() => loadPreset(p)}
                      className={`px-4 py-2 rounded-lg text-sm font-medium transition ${selectedPreset === p ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>{p}</button>
                  ))}
                </div>
              </div>
              <div className="bg-white rounded-xl p-6 border border-gray-100">
                <h3 className="font-bold text-gray-900 mb-4">Add Items</h3>
                {Object.entries(INVENTORY_ITEMS).map(([cat, items]) => (
                  <details key={cat} className="mb-3">
                    <summary className="cursor-pointer font-medium text-gray-700 hover:text-emerald-600 py-2">{cat}</summary>
                    <div className="grid sm:grid-cols-2 gap-2 mt-2 pl-4">
                      {items.map(item => (
                        <div key={item.name} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2">
                          <div>
                            <span className="text-sm text-gray-700">{item.name}</span>
                            <span className="text-xs text-gray-400 ml-2">{item.volume} m³</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <button onClick={() => updateItem(item.name, -1)} className="w-7 h-7 rounded bg-white border hover:bg-gray-100 flex items-center justify-center text-sm font-bold text-gray-600">-</button>
                            <span className="w-6 text-center text-sm font-medium">{inventory[item.name] || 0}</span>
                            <button onClick={() => updateItem(item.name, 1)} className="w-7 h-7 rounded bg-emerald-100 hover:bg-emerald-200 flex items-center justify-center text-sm font-bold text-emerald-700">+</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </div>
            <div className="space-y-6">
              <div className="bg-white rounded-xl p-6 border border-gray-100 sticky top-20">
                <h3 className="font-bold text-gray-900 mb-4">Van Recommendation</h3>
                {recVanData && (
                  <>
                    <img src={recVanData.image} alt={recVanData.name} width={600} height={450} loading="lazy" decoding="async" className="w-full rounded-lg mb-4" />
                    <h4 className="text-xl font-bold text-emerald-600 mb-1">{recVanData.name}</h4>
                    <p className="text-sm text-gray-500 mb-4">Capacity: {recVanData.capacity}</p>
                    <div className="space-y-3 mb-4">
                      <div>
                        <div className="flex justify-between text-sm mb-1"><span className="text-gray-600">Volume</span><span className="font-medium">{totalVolume} m³</span></div>
                        <div className="w-full bg-gray-200 rounded-full h-4">
                          <div className={`h-4 rounded-full transition-all ${totalVolume > parseFloat(recVanData.capacity) ? 'bg-red-500' : 'bg-emerald-500'}`}
                            style={{ width: `${Math.min(100, (totalVolume / parseFloat(recVanData.capacity)) * 100)}%` }} />
                        </div>
                      </div>
                      <div className="flex justify-between text-sm"><span className="text-gray-600">Total Weight</span><span className="font-medium">{totalWeight} kg</span></div>
                      <div className="flex justify-between text-sm"><span className="text-gray-600">Items</span><span className="font-medium">{Object.values(inventory).reduce((a, b) => a + b, 0)}</span></div>
                    </div>
                    {totalVolume > parseFloat(recVanData.capacity) && (
                      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700 mb-4">Your items may exceed this van's capacity. Consider upgrading to a larger vehicle.</div>
                    )}
                    <p className="text-lg font-bold text-gray-900 mb-4">From {recVanData.pricePerHour} NOK/hr</p>
                    <button onClick={() => { setBookingData({ vanType: recVan, inventory, estimatedVolume: totalVolume }); setPage('booking'); }}
                      className="w-full py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 transition">Book This Van</button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
