/* Seeding script for the Hlala Link mover marketplace.
 * Creates 6 real mover accounts + listings so the site/app stop
 * falling back to the hardcoded static movers.
 *
 * Run:  node database/seed_movers.js
 * (uses the anon key from supabase.js — safe, mirrors the SQL seed)
 */
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:8000';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6ImhsYWxhLXN0YW5kYWxvbmUiLCJpYXQiOjE3OTA4OTU1MDAsImV4cCI6MjEwNjI1NTUwMH0.6o4swyqP9xKgQcZGU_W1SWMY0vL2ucTOC8P_1O7bfZM';

const MOVER_PASSWORD = 'HLala@Mover1';

const MOVERS = [
  {
    fullName: 'Tafadzwa Mambo', company: 'Swift Relocations', city: 'Harare',
    email: 'swift.relocations@hlala.co.zw', phone: '+263 77 111 2222',
    areas: ['Harare', 'Chitungwiza'], vehicles: ['bakkie', 'truck'],
    base: 80, perKm: 2.50, rating: 4.9, reviews: 128, jobs: 210, verified: true,
    desc: "Harare's premier moving company with modern fleet and professional handlers.",
    website: 'https://swiftrelocations.co.zw',
  },
  {
    fullName: 'Nkosana Dube', company: 'ZimMove Pros', city: 'Bulawayo',
    email: 'zimmove.pros@hlala.co.zw', phone: '+263 77 333 4444',
    areas: ['Bulawayo', 'Gweru'], vehicles: ['van', 'truck'],
    base: 60, perKm: 2.00, rating: 4.7, reviews: 94, jobs: 156, verified: true,
    desc: 'Bulawayo-based movers specializing in residential and commercial relocations.',
    website: 'https://zimmovepros.co.zw',
  },
  {
    fullName: 'Faith Chirwa', company: 'National Movers', city: 'Harare',
    email: 'national.movers@hlala.co.zw', phone: '+263 77 555 6666',
    areas: ['Harare', 'Mutare', 'Gweru', 'Bulawayo'], vehicles: ['truck', 'trailer'],
    base: 100, perKm: 3.00, rating: 4.8, reviews: 210, jobs: 380, verified: true,
    desc: 'Zimbabwe-wide moving services with insured cargo and experienced teams.',
    website: 'https://nationalmovers.co.zw',
  },
  {
    fullName: 'Ruvarashe Ncube', company: 'EasyMove Mutare', city: 'Mutare',
    email: 'easymove.mutare@hlala.co.zw', phone: '+263 77 777 8888',
    areas: ['Mutare', 'Nyanga'], vehicles: ['bakkie', 'van'],
    base: 50, perKm: 1.50, rating: 4.5, reviews: 42, jobs: 88, verified: false,
    desc: 'Affordable movers serving Mutare and eastern Zimbabwe.',
    website: 'https://easymovemutare.co.zw',
  },
  {
    fullName: 'Blessing Tafirenyika', company: 'Express Load Harare', city: 'Harare',
    email: 'express.load@hlala.co.zw', phone: '+263 77 999 0000',
    areas: ['Harare'], vehicles: ['bakkie'],
    base: 40, perKm: 1.20, rating: 4.3, reviews: 29, jobs: 55, verified: false,
    desc: 'Fast and affordable bakkie hire for small moves and student relocations.',
    website: 'https://expressload.co.zw',
  },
  {
    fullName: 'Kudzai Musindo', company: 'Gweru Transport Co', city: 'Gweru',
    email: 'gweru.transport@hlala.co.zw', phone: '+263 77 111 3333',
    areas: ['Gweru', 'Kwekwe'], vehicles: ['truck', 'van'],
    base: 70, perKm: 2.20, rating: 4.6, reviews: 58, jobs: 122, verified: true,
    desc: 'Midlands-region movers with full packing and unpacking services.',
    website: 'https://gwerutransport.co.zw',
  },
];

function authedClient(token) {
  return createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

async function getOrCreateUser(sb, m) {
  const [first, ...rest] = m.fullName.split(' ');
  const last = rest.join(' ');
  const meta = {
    first_name: first, last_name: last, role: 'mover',
    business_name: m.company, phone_number: m.phone, city: m.city, avatar_url: null,
  };

  const { data: login } = await sb.auth.signInWithPassword({
    email: m.email, password: MOVER_PASSWORD,
  });
  if (login?.user) return login.user;

  const { data, error } = await sb.auth.signUp({
    email: m.email,
    password: MOVER_PASSWORD,
    options: { data: meta },
  });
  if (error) throw new Error(`signUp ${m.email}: ${error.message}`);
  return data.user;
}

async function main() {
  let made = [];

  for (const m of MOVERS) {
    const anon = createClient(SUPABASE_URL, ANON_KEY);
    const user = await getOrCreateUser(anon, m);
    const token = (await anon.auth.getSession()).data?.session?.access_token;
    const uid = user.id;

    let alreadyRow = await authedClient(token).from('movers').select('id').eq('owner_id', uid).limit(1);
    const row = {
      id: uid,
      owner_id: uid,
      profile_id: uid,
      company_name: m.company,
      description: m.desc,
      city: m.city,
      service_areas: m.areas,
      vehicle_types: m.vehicles,
      base_price_usd: m.base,
      price_per_km: m.perKm,
      phone: m.phone,
      whatsapp: m.phone,
      email: m.email,
      website: m.website,
      rating: m.rating,
      total_reviews: m.reviews,
      total_jobs: m.jobs,
      is_verified: m.verified,
      is_active: true,
    };

    const api = authedClient(token);
    let res;
    if (alreadyRow.data?.length) {
      res = await api.from('movers').update(row).eq('id', uid);
    } else {
      res = await api.from('movers').insert(row);
    }
    if (res.error) {
      console.log('  ! mover row failed for', m.email, '->', res.error.message);
      continue;
    }

    await api.from('profiles')
      .update({ city: m.city, id_verified: true })
      .eq('id', uid)
      .then(({ error }) => error && console.log('  ! profile update:', error.message));

    made.push(`${m.company} (@${m.email.split('@')[0]})`);
    console.log('  seeded', m.company, '|', m.email, m.verified ? '| verified' : '|');
  }

  const check = createClient(SUPABASE_URL, ANON_KEY);
  const { data, error } = await check
    .from('v_active_movers')
    .select('id, company_name, city, rating, owner_name')
    .order('rating', { ascending: false });
  console.log('\n== RESULT ===========================================');
  if (error) console.log('v_active_movers error:', error.message);
  else {
    console.log(`live mover count: ${data.length}`);
    data.forEach(r => console.log(`  - ${r.company_name} | ${r.city} | ${r.rating} | owner: ${r.owner_name}`));
  }
  console.log('====================================================');
}

main().catch(err => { console.error('SEED FAILED:', err.message); process.exit(1); });