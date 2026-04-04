/**
 * seoData.ts
 * FlyttGo Programmatic SEO Engine
 * Defines all cities, services, and combinations for auto-generation.
 */

export const SEO_CITIES = [
  {
    slug: 'oslo',
    name: 'Oslo',
    county: 'Oslo',
    population: 717710,
    lat: 59.9139,
    lng: 10.7522,
    drivers: 300,
    bookings: '12,000+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'Norway\'s capital and largest city. Excellent coverage across all districts including Frogner, Grünerløkka, Østensjø, and more.',
    localTips: [
      'Book early for moves in May–August — peak moving season in Oslo',
      'Most Oslo apartments have lifts, but confirm floor access when booking',
      'Parking permits (parkeringstillatelse) may be needed near city centre',
      'Many drivers cover Akershus county at no extra charge',
    ],
    testimonials: [
      { name: 'Lars Eriksen', rating: 5, text: 'Perfect move from Grünerløkka to Frogner. Driver arrived on time and handled everything.' },
      { name: 'Amina Rashid', rating: 5, text: 'Student move at Oslo Met was incredibly easy with FlyttGo. Very affordable!' },
    ],
    phone: '+47 21 00 00 01',
    coverage: ['Sentrum', 'Frogner', 'Grünerløkka', 'St. Hanshaugen', 'Sagene', 'Bjerke', 'Grorud', 'Stovner', 'Alna', 'Østensjø', 'Nordre Aker', 'Nordstrand', 'Søndre Nordstrand', 'Ullern', 'Vestre Aker'],
  },
  {
    slug: 'bergen',
    name: 'Bergen',
    county: 'Vestland',
    population: 285911,
    lat: 60.3913,
    lng: 5.3221,
    drivers: 120,
    bookings: '5,200+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766928662_87629067.jpg',
    description: 'Western Norway\'s largest city. Full coverage from Bergenhus to Fana, Ytrebygda, and surrounding municipalities.',
    localTips: [
      'Bergen\'s hilly terrain means some addresses may require extra time',
      'Rain-protect your items — Bergen is one of Europe\'s wettest cities',
      'Many moves involve narrow streets in the historic Bryggen area',
      'Tunnels (bomringen) tolls apply for some routes',
    ],
    testimonials: [
      { name: 'Ingrid Voss', rating: 5, text: 'Excellent service moving across Bergen. The driver knew all the narrow streets perfectly.' },
      { name: 'Sindre Bakke', rating: 4, text: 'Quick student move near UiB. Very reasonable pricing.' },
    ],
    phone: '+47 55 00 00 02',
    coverage: ['Bergenhus', 'Fana', 'Ytrebygda', 'Arna', 'Åsane', 'Fyllingsdalen', 'Laksevåg', 'Sandviken'],
  },
  {
    slug: 'trondheim',
    name: 'Trondheim',
    county: 'Trøndelag',
    population: 213877,
    lat: 63.4305,
    lng: 10.3951,
    drivers: 80,
    bookings: '3,800+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766947844_0aef96e0.jpg',
    description: 'Norway\'s third largest city and technology capital. Coverage across Midtbyen, Heimdal, Byåsen, and NTNU campus areas.',
    localTips: [
      'NTNU student moves peak in July–August — book at least 2 weeks ahead',
      'Many student areas (Moholt, Bergheim) are quick to access',
      'Snow clearing may affect access in winter months',
    ],
    testimonials: [
      { name: 'Marius Strand', rating: 5, text: 'Fast and professional move near NTNU. Will use again next semester.' },
      { name: 'Kari Moe', rating: 5, text: 'Office relocation downtown Trondheim was seamless.' },
    ],
    phone: '+47 73 00 00 03',
    coverage: ['Midtbyen', 'Heimdal', 'Byåsen', 'Lerkendal', 'Saupstad', 'Moholt', 'Lade', 'Ranheim'],
  },
  {
    slug: 'stavanger',
    name: 'Stavanger',
    county: 'Rogaland',
    population: 144975,
    lat: 58.9700,
    lng: 5.7331,
    drivers: 60,
    bookings: '2,400+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'Norway\'s oil capital. Service across Stavanger, Sandnes, Sola, and the greater Jæren region.',
    localTips: [
      'Stavanger and Sandnes are often treated as one metro area',
      'Oil industry relocations are common — we handle commercial moves',
      'Access to Rennesøy and Finnøy available with advance booking',
    ],
    testimonials: [
      { name: 'Rolf Torgersen', rating: 5, text: 'Moved from Sandnes to Stavanger sentrum in record time.' },
      { name: 'Silje Nygård', rating: 4, text: 'Good service for a last-minute furniture delivery.' },
    ],
    phone: '+47 51 00 00 04',
    coverage: ['Stavanger sentrum', 'Sandnes', 'Sola', 'Randaberg', 'Hinna', 'Madla', 'Storhaug', 'Hillevåg'],
  },
  {
    slug: 'drammen',
    name: 'Drammen',
    county: 'Viken',
    population: 100211,
    lat: 59.7440,
    lng: 10.2045,
    drivers: 35,
    bookings: '1,200+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'Growing city in Viken. Excellent connections to Oslo and surrounding Numedal and Eiker districts.',
    localTips: ['Close proximity to Oslo means many cross-city moves are common'],
    testimonials: [
      { name: 'Tor Haugen', rating: 5, text: 'Brilliant service moving from Drammen to Oslo centrum.' },
    ],
    phone: '+47 32 00 00 05',
    coverage: ['Bragernes', 'Strømsø', 'Åskollen', 'Konnerud', 'Gulskogen', 'Danvik'],
  },
  {
    slug: 'fredrikstad',
    name: 'Fredrikstad',
    county: 'Viken',
    population: 83227,
    lat: 59.2181,
    lng: 10.9298,
    drivers: 30,
    bookings: '900+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'Historic city in eastern Norway. Coverage across Fredrikstad and neighbouring Sarpsborg.',
    localTips: ['Old Town (Gamlebyen) has restricted access — confirm route when booking'],
    testimonials: [
      { name: 'Anne Lie', rating: 5, text: 'Smooth apartment move in the town centre.' },
    ],
    phone: '+47 69 00 00 06',
    coverage: ['Sentrum', 'Rolvsøy', 'Onsøy', 'Borge', 'Gamlebyen'],
  },
  {
    slug: 'tromso',
    name: 'Tromsø',
    county: 'Troms',
    population: 77620,
    lat: 69.6492,
    lng: 18.9553,
    drivers: 25,
    bookings: '600+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'Gateway to the Arctic. Moving and delivery services across Tromsøya, Kvaløya, and Ringvassøya.',
    localTips: ['Winter darkness and snow require advance planning', 'Arctic weather may occasionally delay services'],
    testimonials: [
      { name: 'Henrik Nordvang', rating: 5, text: 'Reliable moving service even in winter conditions.' },
    ],
    phone: '+47 77 00 00 07',
    coverage: ['Tromsø sentrum', 'Tromsdalen', 'Kvaløya', 'Kroken', 'Langnes'],
  },
  {
    slug: 'kristiansand',
    name: 'Kristiansand',
    county: 'Agder',
    population: 115000,
    lat: 58.1462,
    lng: 7.9957,
    drivers: 28,
    bookings: '750+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'South Norway\'s main city. Service throughout Kvadraturen, Sørlandsparken, and surrounding areas.',
    localTips: ['Summer cabin moves are popular in June–July in Agder'],
    testimonials: [
      { name: 'Vibeke Sand', rating: 4, text: 'Good and efficient service in the city centre.' },
    ],
    phone: '+47 38 00 00 08',
    coverage: ['Kvadraturen', 'Lund', 'Vågsbygd', 'Randesund', 'Songdalen'],
  },
  {
    slug: 'bodo',
    name: 'Bodø',
    county: 'Nordland',
    population: 55000,
    lat: 67.2804,
    lng: 14.4049,
    drivers: 18,
    bookings: '380+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'Northern Norway commercial hub. Coverage across Bodø and Fauske.',
    localTips: ['Arctic weather in winter — wrap fragile items carefully'],
    testimonials: [{ name: 'Jan Arild', rating: 5, text: 'Reliable northern Norway service.' }],
    phone: '+47 75 00 00 09',
    coverage: ['Bodø sentrum', 'Mørkved', 'Tverlandet', 'Saltstraumen'],
  },
  {
    slug: 'sandnes',
    name: 'Sandnes',
    county: 'Rogaland',
    population: 80000,
    lat: 58.8520,
    lng: 5.7353,
    drivers: 22,
    bookings: '500+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'Part of the Stavanger-Sandnes metropolitan area. Fast service connections between both cities.',
    localTips: ['Sandnes and Stavanger are treated as one zone — no extra charge'],
    testimonials: [{ name: 'Ole Haaland', rating: 5, text: 'Quick cross-city move with no surprises.' }],
    phone: '+47 51 00 00 10',
    coverage: ['Sentrum', 'Riska', 'Høle', 'Ganddal'],
  },
  {
    slug: 'hamar',
    name: 'Hamar',
    county: 'Innlandet',
    population: 34000,
    lat: 60.7945,
    lng: 11.0678,
    drivers: 12,
    bookings: '280+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'Inland Norway\'s key city on Lake Mjøsa. Moving services from Hamar to Lillehammer and Gjøvik.',
    localTips: ['Weekend moves are very popular — book ahead'],
    testimonials: [{ name: 'Eva Stenseth', rating: 4, text: 'Smooth move near the lake area.' }],
    phone: '+47 62 00 00 11',
    coverage: ['Sentrum', 'Stange', 'Ringsaker', 'Løten'],
  },
  {
    slug: 'tonsberg',
    name: 'Tønsberg',
    county: 'Vestfold',
    population: 55000,
    lat: 59.2671,
    lng: 10.4075,
    drivers: 15,
    bookings: '320+',
    image: 'https://d64gsuwffb70l.cloudfront.net/69b9877aa085bb4df2a9da28_1773766910648_024dec32.jpg',
    description: 'Norway\'s oldest city in Vestfold. Coverage from Tønsberg to Sandefjord and Larvik.',
    localTips: ['Viking heritage area — access to harbour area requires care'],
    testimonials: [{ name: 'Berit Helgestad', rating: 5, text: 'Great service along the Vestfold coast.' }],
    phone: '+47 33 00 00 12',
    coverage: ['Sentrum', 'Nøtterøy', 'Tjøme', 'Sem'],
  },
];

export const SEO_SERVICES = [
  {
    slug: 'flyttehjelp',
    name: 'Flyttehjelp',
    englishName: 'Moving Help',
    icon: '🚛',
    description: 'Professional moving help with van and driver for apartments, houses, and offices across Norway.',
    longDescription: 'Get expert moving help from verified Norwegian transport providers. Our drivers help with loading, transport, and unloading — fully insured and professionally trained.',
    priceFrom: 850,
    popularFor: ['Apartment moves', 'House moves', 'Student accommodation'],
    keywords: ['flyttehjelp', 'moving help norway', 'moving service norway'],
    schema: {
      serviceType: 'Moving Service',
      category: 'Residential Moving',
    }
  },
  {
    slug: 'man-and-van',
    name: 'Man and Van',
    englishName: 'Man and Van',
    icon: '🚐',
    description: 'One driver, one van — the most affordable moving option for single-item transport, small moves, and deliveries.',
    longDescription: 'Our man and van service is the most cost-effective solution for smaller moves. Perfect for transporting a few items, single-room moves, or furniture deliveries.',
    priceFrom: 850,
    popularFor: ['Single items', 'Small moves', 'Furniture pickup'],
    keywords: ['man and van norway', 'man and van oslo', 'single item transport'],
    schema: {
      serviceType: 'Man and Van',
      category: 'Light Removal',
    }
  },
  {
    slug: 'furniture-transport',
    name: 'Furniture Transport',
    englishName: 'Furniture Transport',
    icon: '🛋️',
    description: 'Safe and careful transport of individual furniture items, sofas, wardrobes, and beds across Norway.',
    longDescription: 'Specialist furniture transport by experienced Norwegian drivers. We handle large sofas, flat-pack furniture, antiques, and gym equipment with care.',
    priceFrom: 950,
    popularFor: ['Sofas', 'Beds', 'Wardrobes', 'Dining tables'],
    keywords: ['furniture transport norway', 'sofa transport oslo', 'furniture delivery norway'],
    schema: {
      serviceType: 'Furniture Transport',
      category: 'Specialist Removal',
    }
  },
  {
    slug: 'student-moving',
    name: 'Student Moving',
    englishName: 'Student Moving',
    icon: '🎓',
    description: 'Affordable student moving services for university accommodation across Norway. Quick, easy, and budget-friendly.',
    longDescription: 'Moving to or from student accommodation? FlyttGo offers affordable student moving packages designed for Norwegian universities and student towns. Book online in minutes.',
    priceFrom: 750,
    popularFor: ['University dorms', 'Student flats', 'Semester moves'],
    keywords: ['student moving norway', 'student flytte oslo', 'university move norway'],
    schema: {
      serviceType: 'Student Moving',
      category: 'Budget Removal',
    }
  },
  {
    slug: 'office-relocation',
    name: 'Office Relocation',
    englishName: 'Office Relocation',
    icon: '💼',
    description: 'Professional office relocation services for businesses across Norway. Minimal downtime, maximum care.',
    longDescription: 'Relocate your office with minimal disruption using FlyttGo\'s professional office moving service. We handle desks, servers, filing cabinets, and sensitive equipment.',
    priceFrom: 1500,
    popularFor: ['Small offices', 'Corporate moves', 'Co-working spaces'],
    keywords: ['office relocation norway', 'office move oslo', 'business moving norway'],
    schema: {
      serviceType: 'Office Relocation',
      category: 'Commercial Moving',
    }
  },
  {
    slug: 'apartment-moving',
    name: 'Apartment Moving',
    englishName: 'Apartment Moving',
    icon: '🏢',
    description: 'Full apartment moving service — van, driver, and helpers. Available across all Norwegian cities.',
    longDescription: 'Moving apartment? Let FlyttGo take care of everything. Choose your van size, add helpers, and book a time that suits you. Real-time tracking included.',
    priceFrom: 1150,
    popularFor: ['Studio flats', '1-2 bedroom apartments', 'Penthouse moves'],
    keywords: ['apartment moving norway', 'leilighetsflytting oslo', 'apartment removal norway'],
    schema: {
      serviceType: 'Apartment Moving',
      category: 'Residential Moving',
    }
  },
  {
    slug: 'same-day-delivery',
    name: 'Same Day Delivery',
    englishName: 'Same Day Delivery',
    icon: '⚡',
    description: 'Urgent same-day transport and delivery services across Norwegian cities. Booked and dispatched within the hour.',
    longDescription: 'Need something moved or delivered today? FlyttGo\'s same-day service connects you with available drivers in your area for instant dispatch.',
    priceFrom: 950,
    popularFor: ['Urgent deliveries', 'Last-minute moves', 'Business shipments'],
    keywords: ['same day delivery norway', 'same day transport oslo', 'express delivery norway'],
    schema: {
      serviceType: 'Same Day Delivery',
      category: 'Express Transport',
    }
  },
  {
    slug: 'piano-transport',
    name: 'Piano Transport',
    englishName: 'Piano Transport',
    icon: '🎹',
    description: 'Specialist piano transport across Norway by trained movers with the right equipment.',
    longDescription: 'Moving a piano requires specialist knowledge, equipment, and care. FlyttGo connects you with trained piano movers available across Norwegian cities.',
    priceFrom: 2000,
    popularFor: ['Upright pianos', 'Grand pianos', 'Keyboard transport'],
    keywords: ['piano transport norway', 'piano moving oslo', 'piano removal norway'],
    schema: {
      serviceType: 'Piano Transport',
      category: 'Specialist Removal',
    }
  },
];

export type SeoCity = typeof SEO_CITIES[number];
export type SeoService = typeof SEO_SERVICES[number];

/* ─────────────────────────────────────────────
   FAQ SCHEMA GENERATOR
───────────────────────────────────────────── */

export function generateFAQSchema(service: SeoService, city: SeoCity) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    'mainEntity': [
      {
        '@type': 'Question',
        'name': `How much does ${service.name} cost in ${city.name}?`,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': `${service.name} in ${city.name} starts from ${service.priceFrom} NOK per hour. Prices vary based on distance, number of items, and helpers needed. Use our instant price calculator for an exact quote.`,
        },
      },
      {
        '@type': 'Question',
        'name': `How do I book ${service.name.toLowerCase()} in ${city.name}?`,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': `Booking is simple. Enter your pickup and delivery address, choose your van size, select a date, and confirm payment. Drivers are typically matched within minutes in ${city.name}.`,
        },
      },
      {
        '@type': 'Question',
        'name': `Are FlyttGo drivers verified in ${city.name}?`,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': `Yes. All FlyttGo drivers in ${city.name} are verified with valid company registration, comprehensive transport insurance, and background checks. FlyttGo is a marketplace — liability for transport rests with the provider's company.`,
        },
      },
      {
        '@type': 'Question',
        'name': `What van sizes are available in ${city.name}?`,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': `FlyttGo offers Small Vans (3–4 m³), Medium Vans (6–9 m³), Large Vans (11–15 m³), and Luton Vans (18–20 m³) in ${city.name}. Our calculator helps you choose the right size.`,
        },
      },
      {
        '@type': 'Question',
        'name': `Can I cancel my ${service.name.toLowerCase()} booking in ${city.name}?`,
        'acceptedAnswer': {
          '@type': 'Answer',
          'text': `Yes. Cancellations more than 24 hours before your booking are free of charge. Cancellations within 24 hours incur a 50% fee. Payment is held in escrow and released only after delivery confirmation.`,
        },
      },
    ],
  };
}

/* ─────────────────────────────────────────────
   LOCAL BUSINESS SCHEMA GENERATOR
───────────────────────────────────────────── */

export function generateLocalBusinessSchema(city: SeoCity) {
  return {
    '@context': 'https://schema.org',
    '@type': 'MovingCompany',
    'name': `FlyttGo ${city.name}`,
    'description': `Professional moving and transport marketplace in ${city.name}, Norway.`,
    'url': `https://flyttgo.no/services/flyttehjelp/${city.slug}`,
    'telephone': city.phone,
    'address': {
      '@type': 'PostalAddress',
      'addressLocality': city.name,
      'addressRegion': city.county,
      'addressCountry': 'NO',
    },
    'geo': {
      '@type': 'GeoCoordinates',
      'latitude': city.lat,
      'longitude': city.lng,
    },
    'aggregateRating': {
      '@type': 'AggregateRating',
      'ratingValue': '4.8',
      'reviewCount': city.bookings.replace(/[^0-9]/g, ''),
    },
    'areaServed': city.coverage.map(area => ({
      '@type': 'City',
      'name': area,
      'containedInPlace': city.name,
    })),
  };
}

/* ─────────────────────────────────────────────
   INTERNAL LINK GRAPH
───────────────────────────────────────────── */

export function getRelatedServiceLinks(currentService: SeoService, currentCity: SeoCity) {
  return {
    // Same city, different services
    sameCity: SEO_SERVICES
      .filter(s => s.slug !== currentService.slug)
      .slice(0, 4)
      .map(s => ({
        label: `${s.name} in ${currentCity.name}`,
        path: `/services/${s.slug}/${currentCity.slug}`,
      })),
    // Same service, different cities
    sameService: SEO_CITIES
      .filter(c => c.slug !== currentCity.slug)
      .slice(0, 5)
      .map(c => ({
        label: `${currentService.name} in ${c.name}`,
        path: `/services/${currentService.slug}/${c.slug}`,
      })),
    // Core platform links
    core: [
      { label: 'Get Instant Price', path: '/booking' },
      { label: 'Van Size Guide', path: '/van-guide' },
      { label: 'Subscription Plans for Drivers', path: '/subscriptions' },
      { label: 'Moving Checklist', path: '/checklist' },
    ],
  };
}
