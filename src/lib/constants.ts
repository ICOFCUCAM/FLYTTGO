export const IMAGES = {
  hero: {
    truck:    'https://d64gsuwffb70l.cloudfront.net/69b48d1c24a3a59014dde38a_1773440407421_d3f9f76f.jpg',
    students: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766787761_26698bc2.jpg',
    office:   'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766806786_1db52f56.jpg',
    truck1:   'https://d64gsuwffb70l.cloudfront.net/69bc733e874094bcf729aca5_1773958078738_546d64ee.png',
    students1:'https://d64gsuwffb70l.cloudfront.net/69b4405628b40c8fdc7aad59_1773420774101_dae0e521.jpg',
    truck2:   'https://d64gsuwffb70l.cloudfront.net/69b087fd736aea2f6794825c_1773176964888_38e0b100.png',
    office1:  'https://d64gsuwffb70l.cloudfront.net/69b4405628b40c8fdc7aad59_1773420953628_819790d3.png',
  },
  vans: {
    small:  'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766826645_9815a390.jpg',
    medium: 'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254090722_f15449ab.jpg',
    large:  'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766864624_6c352d16.jpg',
    luton:  'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766884259_1c23e623.jpg',
  },
  cities: {
    oslo:      'https://d64gsuwffb70l.cloudfront.net/69b1b470fdd1af7483a60acc_1773254219729_b5ff9b2f.png',
    bergen:    'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766928662_87629067.jpg',
    trondheim: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766947844_0aef96e0.jpg',
  },
  movers: 'https://d64gsuwffb70l.cloudfront.net/69b087fd736aea2f6794825c_1773177274288_a53014fe.jpg',
};

export const HERO_SLIDES = [
  { image: IMAGES.hero.truck,    title: 'Smart Moving & Transport Services',        subtitle: 'Book professional movers and cargo transport in seconds. Real-time tracking, transparent pricing, and verified drivers across Norway.', cta: 'Book a Van' },
  { image: IMAGES.hero.students, title: 'Student Moving Made Simple',               subtitle: 'Affordable moving solutions for students and small apartments. Fast, reliable, and budget-friendly.', cta: 'Get Price Estimate' },
  { image: IMAGES.hero.office,   title: 'Business Logistics & Office Moving',       subtitle: 'Professional moving services for offices and commercial logistics. Trusted by businesses across Norway.', cta: 'Schedule Delivery' },
  { image: IMAGES.hero.truck1,   title: 'Smart Moving & Transport Services',        subtitle: 'Book professional movers and cargo transport in seconds. Real-time tracking, transparent pricing, and verified drivers across Norway.', cta: 'Book a Van' },
  { image: IMAGES.hero.students1,title: 'Student Moving Made Simple',               subtitle: 'Affordable moving solutions for students and small apartments. Fast, reliable, and budget-friendly.', cta: 'Get Price Estimate' },
  { image: IMAGES.hero.truck2,   title: 'Smart Moving & Transport Services',        subtitle: 'Book professional movers and cargo transport in seconds. Real-time tracking, transparent pricing, and verified drivers across Norway.', cta: 'Book a Van' },
  { image: IMAGES.hero.office,   title: 'Business Logistics & Office Moving',       subtitle: 'Professional moving services for offices and commercial logistics. Trusted by businesses across Norway.', cta: 'Schedule Delivery' },
];

export const VAN_TYPES = [
  { id: 'small_van',  name: 'Small Van',   image: IMAGES.vans.small,  capacity: '3–4 m³',   payload: '500–900 kg',    examples: ['Ford Transit Connect','Citroën Berlingo','VW Caddy'],          bestFor: ['Small deliveries','Student moves','Luggage transport'],        items: ['Suitcases','Small boxes','Chairs','TV'],              pricePerHour: 850 },
  { id: 'medium_van', name: 'Medium Van',  image: IMAGES.vans.medium, capacity: '6–9 m³',   payload: '900–1200 kg',   examples: ['Ford Transit Custom','Mercedes Vito','VW Transporter'],        bestFor: ['Studio moves','Small apartment moves','Furniture delivery'],    items: ['Sofa','Fridge','Bed frame','10–15 boxes'],            pricePerHour: 1150 },
  { id: 'large_van',  name: 'Large Van',   image: IMAGES.vans.large,  capacity: '11–15 m³', payload: '1200–1500 kg',  examples: ['Mercedes Sprinter','Ford Transit LWB','VW Crafter'],          bestFor: ['1–2 bedroom moves','Large furniture','Storage unit transport'], items: ['Wardrobe','Dining table','Bed','25 boxes'],           pricePerHour: 1500 },
  { id: 'luton_van',  name: 'Luton Van',   image: IMAGES.vans.luton,  capacity: '18–20 m³', payload: '1000–1200 kg',  examples: ['Luton Box Truck with Tail Lift'],                              bestFor: ['2–3 bedroom house moves','Office relocation','Heavy furniture'], items: ['Beds','Wardrobes','Large sofas','35+ boxes'],         pricePerHour: 1900 },
];

export const SUBSCRIPTION_PLANS = [
  { id: 'free',      name: 'Free',      price: 0,    period: '',       jobVisibility: 'Jobs up to 500 NOK', commission: { '0-500': 0 },                                      dispatchPriority: 'Standard',  priorityLevel: 1, features: ['Access to jobs up to 500 NOK','0% commission on visible jobs','Standard dispatch priority','Basic support'],                                                                                          popular: false, color: 'gray' },
  { id: 'basic',     name: 'Basic',     price: 0,    period: '',       jobVisibility: 'All jobs',           commission: { '501-1500': 20, '1501-5000': 15, '5000+': 10 },    dispatchPriority: 'Moderate',  priorityLevel: 2, features: ['Access to all jobs','Moderate dispatch priority','20% commission (501-1500 NOK)','15% commission (1501-5000 NOK)','10% commission (5000+ NOK)'],                                                  popular: false, color: 'blue' },
  { id: 'pro_mini',  name: 'Pro Mini',  price: 149,  period: '/day',   jobVisibility: 'All jobs',           commission: { '501-1500': 10, '1501-5000': 5, '5000+': 4 },      dispatchPriority: 'High',      priorityLevel: 3, features: ['Access to all jobs','High dispatch priority','10% commission (501-1500 NOK)','5% commission (1501-5000 NOK)','3-5% commission (5000+ NOK)','Priority support'],                                 popular: true,  color: 'green' },
  { id: 'pro',       name: 'Pro',       price: 1500, period: '/month', jobVisibility: 'All jobs',           commission: { '501-1500': 10, '1501-5000': 5, '5000+': 4 },      dispatchPriority: 'Very High', priorityLevel: 4, features: ['Access to all jobs','Very high dispatch priority','10% commission (501-1500 NOK)','5% commission (1501-5000 NOK)','3-5% commission (5000+ NOK)','Premium support','Priority job matching'],    popular: false, color: 'purple' },
  { id: 'unlimited', name: 'Unlimited', price: 2449, period: '/month', jobVisibility: 'All jobs',           commission: { all: 0 },                                          dispatchPriority: 'Highest',   priorityLevel: 5, features: ['Access to all jobs','Highest dispatch priority','0% commission on ALL jobs','VIP support','Priority job matching','Earnings maximized'],                                                          popular: false, color: 'amber' },
];

export const CITIES = [
  { name: 'Oslo',      slug: 'oslo',      image: IMAGES.cities.oslo,      drivers: 300, bookings: '12,000+' },
  { name: 'Bergen',    slug: 'bergen',    image: IMAGES.cities.bergen,    drivers: 120, bookings: '5,200+' },
  { name: 'Trondheim', slug: 'trondheim', image: IMAGES.cities.trondheim, drivers: 80,  bookings: '3,800+' },
  { name: 'Stavanger', slug: 'stavanger', image: IMAGES.cities.oslo,      drivers: 60,  bookings: '2,400+' },
];

export const SERVICES = [
  { name: 'Moving Services',     icon: 'truck',      description: 'Full house and apartment moving with professional movers and vehicles.' },
  { name: 'Furniture Transport', icon: 'sofa',       description: 'Safe transport of individual furniture items across Norway.' },
  { name: 'Office Relocation',   icon: 'building',   description: 'Professional office moving with minimal business disruption.' },
  { name: 'Student Moving',      icon: 'graduation', description: 'Affordable moving solutions designed for students.' },
  { name: 'Same-Day Delivery',   icon: 'clock',      description: 'Urgent deliveries completed within the same day.' },
  { name: 'Storage Transport',   icon: 'box',        description: 'Moving items to and from storage units efficiently.' },
];

export const TESTIMONIALS = [
  { name: 'Erik Hansen',   city: 'Oslo',      rating: 5, text: 'FlyttGo made our apartment move incredibly smooth. The driver was professional and on time. Highly recommend!' },
  { name: 'Ingrid Larsen', city: 'Bergen',    rating: 5, text: 'Used FlyttGo for office relocation. Excellent service, transparent pricing, and careful handling of equipment.' },
  { name: 'Magnus Olsen',  city: 'Trondheim', rating: 5, text: 'As a student, FlyttGo was perfect. Affordable, fast, and the driver helped carry boxes up 3 flights of stairs.' },
  { name: 'Sofie Berg',    city: 'Stavanger', rating: 4, text: 'Great platform for furniture delivery. Real-time tracking was very helpful. Will use again!' },
];

export const HOW_IT_WORKS = [
  { step: 1, title: 'Enter Your Details',      description: 'Tell us where you are moving from and to, what items you need transported, and when.' },
  { step: 2, title: 'Get Instant Price',       description: 'Our smart pricing engine calculates a fair price based on distance, items, and services needed.' },
  { step: 3, title: 'Book & Pay Securely',     description: 'Confirm your booking and pay securely. Funds are held in escrow until delivery is complete.' },
  { step: 4, title: 'Track Your Delivery',     description: 'Follow your driver in real-time from pickup to delivery with live GPS tracking.' },
];

export const PRICING = {
  hourlyRates: {
    '1_driver_van':  { min: 850,  max: 950  },
    '2_movers_van':  { min: 1150, max: 1300 },
    '3_movers_van':  { min: 1500, max: 1900 },
  },
  minimumHours: 2,
  distancePricing: { includedKm: 20, extraPerKm: 8 },
  extras: { extra_helper: 350, furniture_assembly: 250, cleaning: 400, parking_assistance: 200, packing_service: 500, furniture_dismantling: 300 },
  vat: 0.25,
};

export function calculateCommission(jobPrice: number, plan: string) {
  const safePrice = Number(jobPrice ?? 0);
  if (safePrice <= 500) return { rate: 0, commission: 0, earning: safePrice };
  const planData = SUBSCRIPTION_PLANS.find(p => p.id === plan);
  if (!planData) return { rate: 0, commission: 0, earning: safePrice };
  if (plan === 'unlimited') return { rate: 0, commission: 0, earning: safePrice };
  if (plan === 'free') return { rate: -1, commission: 0, earning: 0 };
  let rate = 0;
  if (safePrice <= 1500) rate = Number((planData.commission as any)['501-1500'] ?? 0);
  else if (safePrice <= 5000) rate = Number((planData.commission as any)['1501-5000'] ?? 0);
  else rate = Number((planData.commission as any)['5000+'] ?? 0);
  const commission = safePrice * (rate / 100);
  return { rate, commission, earning: safePrice - commission };
}

export function calculatePrice(vanType: string, hours: number, distanceKm: number, helpers: number, extras: string[]) {
  const van = VAN_TYPES.find(v => v.id === vanType);
  const safeHours = Math.max(hours ?? 0, PRICING.minimumHours);
  const extraKm = Math.max(0, distanceKm - PRICING.distancePricing.includedKm);
  const basePrice = (van?.pricePerHour ?? 850) * safeHours;
  const distanceCharge = extraKm * PRICING.distancePricing.extraPerKm;
  const helpersCharge = helpers * PRICING.extras.extra_helper * safeHours;
  const extrasCharge = extras.reduce((sum, extra) => sum + ((PRICING.extras as any)[extra] ?? 0), 0);
  const subtotal = basePrice + distanceCharge + helpersCharge + extrasCharge;
  const vat = subtotal * PRICING.vat;
  return { basePrice, distanceCharge, helpersCharge, extrasCharge, subtotal, vat, total: subtotal + vat };
}

export function recommendVan(totalVolume: number): string {
  if (totalVolume <= 4) return 'small_van';
  if (totalVolume <= 9) return 'medium_van';
  if (totalVolume <= 15) return 'large_van';
  return 'luton_van';
}

export const INVENTORY_ITEMS: Record<string, { name: string; volume: number; weight: number }[]> = {
  'Living Room': [
    { name: 'Sofa (3-seater)', volume: 1.44, weight: 60 }, { name: 'Sofa (2-seater)', volume: 1.0, weight: 40 },
    { name: 'Armchair', volume: 0.6, weight: 25 }, { name: 'Coffee Table', volume: 0.3, weight: 15 },
    { name: 'TV Stand', volume: 0.4, weight: 20 }, { name: 'Bookshelf', volume: 0.8, weight: 35 },
    { name: 'TV (Large)', volume: 0.15, weight: 10 },
  ],
  'Kitchen': [
    { name: 'Fridge/Freezer', volume: 0.8, weight: 70 }, { name: 'Washing Machine', volume: 0.5, weight: 80 },
    { name: 'Dishwasher', volume: 0.4, weight: 50 }, { name: 'Microwave', volume: 0.05, weight: 12 },
    { name: 'Dining Table', volume: 0.6, weight: 30 }, { name: 'Dining Chair', volume: 0.15, weight: 5 },
  ],
  'Bedroom': [
    { name: 'Double Bed', volume: 1.2, weight: 50 }, { name: 'Single Bed', volume: 0.8, weight: 30 },
    { name: 'Wardrobe (Large)', volume: 1.5, weight: 70 }, { name: 'Wardrobe (Small)', volume: 0.8, weight: 40 },
    { name: 'Chest of Drawers', volume: 0.5, weight: 30 }, { name: 'Bedside Table', volume: 0.1, weight: 8 },
    { name: 'Desk', volume: 0.5, weight: 25 },
  ],
  'Packing': [
    { name: 'Moving Box (Small)', volume: 0.03, weight: 5 }, { name: 'Moving Box (Medium)', volume: 0.06, weight: 10 },
    { name: 'Moving Box (Large)', volume: 0.1, weight: 15 }, { name: 'Suitcase', volume: 0.08, weight: 15 },
  ],
  'Office': [
    { name: 'Office Desk', volume: 0.8, weight: 35 }, { name: 'Office Chair', volume: 0.4, weight: 15 },
    { name: 'Filing Cabinet', volume: 0.3, weight: 25 }, { name: 'Monitor', volume: 0.05, weight: 5 },
    { name: 'Printer', volume: 0.1, weight: 10 },
  ],
  'Garden': [
    { name: 'Garden Table', volume: 0.5, weight: 20 }, { name: 'Garden Chair', volume: 0.2, weight: 5 },
    { name: 'BBQ Grill', volume: 0.4, weight: 25 }, { name: 'Plant Pot (Large)', volume: 0.1, weight: 15 },
  ],
};

export const PROPERTY_PRESETS: Record<string, Record<string, number>> = {
  'Studio':       { 'Single Bed': 1, 'Wardrobe (Small)': 1, 'Desk': 1, 'Moving Box (Medium)': 10, 'Suitcase': 2 },
  '1 Bedroom':    { 'Double Bed': 1, 'Wardrobe (Large)': 1, 'Sofa (2-seater)': 1, 'Dining Table': 1, 'Fridge/Freezer': 1, 'Moving Box (Medium)': 15 },
  '2 Bedrooms':   { 'Double Bed': 2, 'Wardrobe (Large)': 2, 'Sofa (3-seater)': 1, 'Dining Table': 1, 'Fridge/Freezer': 1, 'Washing Machine': 1, 'Moving Box (Medium)': 25 },
  '3 Bedrooms':   { 'Double Bed': 2, 'Single Bed': 1, 'Wardrobe (Large)': 3, 'Sofa (3-seater)': 1, 'Armchair': 2, 'Dining Table': 1, 'Fridge/Freezer': 1, 'Washing Machine': 1, 'Dishwasher': 1, 'Moving Box (Large)': 35 },
  'Office Move':  { 'Office Desk': 4, 'Office Chair': 4, 'Filing Cabinet': 2, 'Monitor': 4, 'Printer': 1, 'Moving Box (Large)': 20 },
};
