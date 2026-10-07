/* ================================================================
   HLALA LINK — Firebase Seed Script
   Seeds movers + static property listings to Firestore.

   Usage:
     node database/seed_firebase.js

   Requires:
     - firebase-config.js values filled in (uses firebase-admin)
     - GOOGLE_APPLICATION_CREDENTIALS env var pointing to a
       service account JSON, OR set FIREBASE_PROJECT_ID below.

   Get a service account key:
     Firebase Console → Project Settings → Service Accounts
     → Generate new private key → save as service-account.json
   ================================================================ */

const admin = require('firebase-admin');
const path  = require('path');

// ── Load service account ─────────────────────────────────────────
let serviceAccount;
try {
    serviceAccount = require(path.join(__dirname, '..', 'service-account.json'));
} catch (e) {
    console.error('⚠  Could not load service-account.json.');
    console.error('   Download it from Firebase Console → Project Settings → Service Accounts');
    console.error('   Save it as service-account.json in the project root (next to package.json).');
    process.exit(1);
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId:  serviceAccount.project_id,
});

const db   = admin.firestore();
const auth = admin.auth();

/* ── Mover data (same as seed_movers.js) ─────────────────────── */
const MOVER_PASSWORD = 'HLala@Mover1';
const MOVERS = [
    {
        fullName: 'Tafadzwa Mambo', company: 'Swift Relocations', city: 'Harare',
        email: 'swift.relocations@hlala.co.zw', phone: '+263 77 111 2222',
        areas: ['Harare', 'Chitungwiza'], vehicles: ['bakkie', 'truck'],
        base: 80, perKm: 2.50, rating: 4.9, reviews: 128, jobs: 210, verified: true,
        desc: "Harare's premier moving company with modern fleet and professional handlers.",
    },
    {
        fullName: 'Nkosana Dube', company: 'ZimMove Pros', city: 'Bulawayo',
        email: 'zimmove.pros@hlala.co.zw', phone: '+263 77 333 4444',
        areas: ['Bulawayo', 'Gweru'], vehicles: ['van', 'truck'],
        base: 60, perKm: 2.00, rating: 4.7, reviews: 94, jobs: 156, verified: true,
        desc: 'Bulawayo-based movers specializing in residential and commercial relocations.',
    },
    {
        fullName: 'Faith Chirwa', company: 'National Movers', city: 'Harare',
        email: 'national.movers@hlala.co.zw', phone: '+263 77 555 6666',
        areas: ['Harare', 'Mutare', 'Gweru', 'Bulawayo'], vehicles: ['truck', 'trailer'],
        base: 100, perKm: 3.00, rating: 4.8, reviews: 210, jobs: 380, verified: true,
        desc: 'Zimbabwe-wide moving services with insured cargo and experienced teams.',
    },
    {
        fullName: 'Ruvarashe Ncube', company: 'EasyMove Mutare', city: 'Mutare',
        email: 'easymove.mutare@hlala.co.zw', phone: '+263 77 777 8888',
        areas: ['Mutare', 'Nyanga'], vehicles: ['bakkie', 'van'],
        base: 50, perKm: 1.50, rating: 4.5, reviews: 42, jobs: 88, verified: false,
        desc: 'Affordable movers serving Mutare and eastern Zimbabwe.',
    },
    {
        fullName: 'Blessing Tafirenyika', company: 'Express Load Harare', city: 'Harare',
        email: 'express.load@hlala.co.zw', phone: '+263 77 999 0000',
        areas: ['Harare'], vehicles: ['bakkie'],
        base: 40, perKm: 1.20, rating: 4.3, reviews: 29, jobs: 55, verified: false,
        desc: 'Fast and affordable bakkie hire for small moves and student relocations.',
    },
    {
        fullName: 'Kudzai Musindo', company: 'Gweru Transport Co', city: 'Gweru',
        email: 'gweru.transport@hlala.co.zw', phone: '+263 77 111 3333',
        areas: ['Gweru', 'Kwekwe'], vehicles: ['truck', 'van'],
        base: 70, perKm: 2.20, rating: 4.6, reviews: 58, jobs: 122, verified: true,
        desc: 'Midlands-region movers with full packing and unpacking services.',
    },
];

/* ── Static property listings ─────────────────────────────────── */
const PROPERTIES = [
    { title: 'Modern 2-Bed Apartment', city: 'Harare', suburb: 'Avondale', rent_usd: 450, bedrooms: 2, bathrooms: 1, area_sqm: 70, parking_spots: 1, property_type: 'apartment', status: 'available', description: 'Bright apartment with open plan living, parking and garden access.', owner_name: 'TM Properties', views: 238 },
    { title: 'Cozy Cottage with Garden', city: 'Bulawayo', suburb: 'Suburbs', rent_usd: 350, bedrooms: 2, bathrooms: 1, area_sqm: 65, parking_spots: 1, property_type: 'cottage', status: 'available', description: 'Charming cottage with large garden, security and covered parking.', owner_name: 'BW Estates', views: 145 },
    { title: 'Spacious Family House', city: 'Harare', suburb: 'Borrowdale', rent_usd: 1200, bedrooms: 4, bathrooms: 2, area_sqm: 220, parking_spots: 2, property_type: 'house', status: 'available', description: 'Executive 4-bedroom home in prestigious Borrowdale with pool.', owner_name: 'Elite Homes', views: 512 },
    { title: 'Studio Apartment', city: 'Harare', suburb: 'Eastlea', rent_usd: 280, bedrooms: 1, bathrooms: 1, area_sqm: 35, parking_spots: 0, property_type: 'studio', status: 'available', description: 'Compact studio ideal for students or working professionals.', owner_name: 'CityPads HRE', views: 89 },
    { title: '3-Bed Townhouse', city: 'Harare', suburb: 'Greendale', rent_usd: 600, bedrooms: 3, bathrooms: 2, area_sqm: 140, parking_spots: 2, property_type: 'townhouse', status: 'available', description: 'Well-maintained townhouse in a secure complex with 24hr security.', owner_name: 'GreenGate Props', views: 321 },
    { title: 'Semi-Detached House', city: 'Mutare', suburb: 'CBD', rent_usd: 500, bedrooms: 3, bathrooms: 1, area_sqm: 110, parking_spots: 2, property_type: 'house', status: 'available', description: 'Spacious semi-detached with solar backup and borehole.', owner_name: 'Mutare Realty', views: 176 },
    { title: 'Single Room En-Suite', city: 'Harare', suburb: 'Kuwadzana', rent_usd: 190, bedrooms: 1, bathrooms: 1, area_sqm: 18, parking_spots: 0, property_type: 'room', status: 'available', description: 'Self-contained room with en-suite bathroom and prepaid electricity.', owner_name: 'Local Host', views: 60 },
    { title: 'Luxury 3-Bed Apartment', city: 'Harare', suburb: 'Msasa', rent_usd: 750, bedrooms: 3, bathrooms: 2, area_sqm: 165, parking_spots: 1, property_type: 'apartment', status: 'available', description: 'High-spec apartment with pool, gym, 24hr security and fibre internet.', owner_name: 'Msasa Luxury', views: 411 },
];

/* ── Helpers ──────────────────────────────────────────────────── */
async function getOrCreateUser(email, fullName) {
    const [first, ...rest] = fullName.split(' ');
    const last = rest.join(' ');
    try {
        const existing = await auth.getUserByEmail(email);
        console.log(`  ↩  User exists: ${email} (${existing.uid})`);
        return existing;
    } catch (e) {
        if (e.code !== 'auth/user-not-found') throw e;
        const user = await auth.createUser({
            email,
            password:    MOVER_PASSWORD,
            displayName: fullName,
        });
        console.log(`  ✅ Created user: ${email} (${user.uid})`);
        return user;
    }
}

/* ── Main ─────────────────────────────────────────────────────── */
async function main() {
    console.log('\n🔥 Hlala Link — Firebase Seed Script\n');

    /* ── Seed Movers ── */
    console.log('── Seeding Movers ──────────────────────────────────');
    for (const m of MOVERS) {
        const [first, ...rest] = m.fullName.split(' ');
        const last = rest.join(' ');

        const user = await getOrCreateUser(m.email, m.fullName);
        const uid  = user.uid;

        // Write profile
        await db.collection('profiles').doc(uid).set({
            id:           uid,
            email:        m.email,
            role:         'mover',
            first_name:   first,
            last_name:    last,
            phone_number: m.phone,
            city:         m.city,
            bio:          m.desc,
            is_verified:  m.verified,
            created_at:   admin.firestore.FieldValue.serverTimestamp(),
            updated_at:   admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        // Write mover listing
        await db.collection('movers').doc(uid).set({
            id:             uid,
            owner_id:       uid,
            profile_id:     uid,
            company_name:   m.company,
            description:    m.desc,
            city:           m.city,
            service_areas:  m.areas,
            vehicle_types:  m.vehicles,
            base_price_usd: m.base,
            price_per_km:   m.perKm,
            phone:          m.phone,
            whatsapp:       m.phone,
            email:          m.email,
            rating:         m.rating,
            total_reviews:  m.reviews,
            total_jobs:     m.jobs,
            is_verified:    m.verified,
            is_active:      true,
            created_at:     admin.firestore.FieldValue.serverTimestamp(),
            updated_at:     admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });

        console.log(`  ✅ Seeded mover: ${m.company} | ${m.city} | ${m.verified ? 'verified' : 'unverified'}`);
    }

    /* ── Seed Properties ── */
    console.log('\n── Seeding Properties ──────────────────────────────');
    for (const p of PROPERTIES) {
        const ref = await db.collection('properties').add({
            ...p,
            listing_purpose: 'rent',
            property_images: [],
            created_at: admin.firestore.FieldValue.serverTimestamp(),
            updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`  ✅ Seeded: ${p.title} | ${p.city} | $${p.rent_usd}/mo  (${ref.id})`);
    }

    /* ── Summary ── */
    const moverCount = (await db.collection('movers').get()).size;
    const propCount  = (await db.collection('properties').get()).size;
    console.log('\n══ SEED COMPLETE ══════════════════════════════════');
    console.log(`  Movers:     ${moverCount}`);
    console.log(`  Properties: ${propCount}`);
    console.log('══════════════════════════════════════════════════\n');
}

main()
    .then(() => process.exit(0))
    .catch(e => { console.error('\n❌ SEED FAILED:', e.message); process.exit(1); });
