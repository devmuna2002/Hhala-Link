#!/usr/bin/env node
/* ================================================================
   HLALA LINK — SUPABASE TO STANDALONE MIGRATION TOOL
   
   Step 1: Export CSVs from the Supabase Dashboard
   Step 2: Place them in standalone-database/migration/csv/
   Step 3: Run: node standalone-database/migrate-from-supabase.js
   ================================================================ */

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'data', 'hlala_link.db');
const CSV_DIR = path.join(__dirname, 'migration', 'csv');

// Ensure DB directory exists
if (!fs.existsSync(path.join(__dirname, 'data'))) {
    fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
}

if (!fs.existsSync(CSV_DIR)) {
    fs.mkdirSync(CSV_DIR, { recursive: true });
}

const db = new DatabaseSync(DB_FILE);
// Enable WAL mode for concurrent access without locking
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;');

// ── PATCH DB SCHEMA: add any missing columns before migrating ─────
const patchStatements = [
    `ALTER TABLE notifications ADD COLUMN actor_id TEXT`,
    `ALTER TABLE notifications ADD COLUMN reference_id TEXT`,
    `ALTER TABLE movers ADD COLUMN phone TEXT`,
    `ALTER TABLE movers ADD COLUMN whatsapp TEXT`,
    `ALTER TABLE movers ADD COLUMN email TEXT`,
    `ALTER TABLE movers ADD COLUMN website TEXT`,
    `ALTER TABLE movers ADD COLUMN logo_url TEXT`,
    `ALTER TABLE movers ADD COLUMN avatar_url TEXT`,
    `ALTER TABLE movers ADD COLUMN updated_at TEXT`,
    `ALTER TABLE properties ADD COLUMN province TEXT`,
    `ALTER TABLE properties ADD COLUMN country TEXT DEFAULT 'Zimbabwe'`,
    `ALTER TABLE properties ADD COLUMN latitude REAL`,
    `ALTER TABLE properties ADD COLUMN longitude REAL`,
    `ALTER TABLE properties ADD COLUMN floor_level INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN is_furnished INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN pets_allowed INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN available_from TEXT`,
    `ALTER TABLE properties ADD COLUMN utilities_inc INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN has_wifi INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN has_pool INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN has_gym INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN has_borehole INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN has_solar INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN has_security INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN has_generator INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN has_water_tank INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN has_garden INTEGER DEFAULT 0`,
    `ALTER TABLE properties ADD COLUMN water_source TEXT`,
    `ALTER TABLE properties ADD COLUMN sale_price_usd REAL`,
    `ALTER TABLE properties ADD COLUMN listing_purpose TEXT DEFAULT 'rent'`,
    `ALTER TABLE property_images ADD COLUMN storage_path TEXT`,
];
for (const sql of patchStatements) {
    try { db.exec(sql); } catch (_) { /* column already exists */ }
}

// ── STATS TRACKING ────────────────────────────────────────────────
const stats = {
    tables: {},
    errors: [],
    warnings: []
};

function log(msg) { console.log('[MIGRATE]', msg); }
function warn(msg) { console.warn('[WARN]   ', msg); stats.warnings.push(msg); }
function err(msg) { console.error('[ERROR]  ', msg); stats.errors.push(msg); }

// ── CSV PARSER ────────────────────────────────────────────────────
function parseCSV(filePath) {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    if (lines.length < 2) return [];

    const headers = parseCSVLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const values = parseCSVLine(line);
        if (values.length === 0) continue;
        const row = {};
        headers.forEach((h, idx) => {
            row[h] = values[idx] !== undefined ? values[idx] : null;
        });
        rows.push(row);
    }
    return rows;
}

function parseCSVLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++;
            } else {
                inQuotes = !inQuotes;
            }
        } else if (ch === ',' && !inQuotes) {
            result.push(current === '' ? null : current);
            current = '';
        } else {
            current += ch;
        }
    }
    result.push(current === '' ? null : current);
    return result;
}

// ── SAFE INSERT: insert or ignore duplicate IDs ───────────────────
function safeInsert(table, row) {
    try {
        const cols = Object.keys(row).filter(k => row[k] !== undefined && row[k] !== null);
        if (cols.length === 0) return false;

        const vals = cols.map(c => {
            const v = row[c];
            if (v === 'true' || v === true) return 1;
            if (v === 'false' || v === false) return 0;
            if (v === '' || v === 'null') return null;
            return v;
        });

        const colStr = cols.map(c => `"${c}"`).join(', ');
        const phStr = cols.map(() => '?').join(', ');
        db.prepare(`INSERT OR IGNORE INTO "${table}" (${colStr}) VALUES (${phStr})`).run(...vals);
        return true;
    } catch (e) {
        err(`Insert into ${table}: ${e.message} | row: ${JSON.stringify(row).slice(0, 120)}`);
        return false;
    }
}

// ── BATCH MIGRATE: wraps all inserts in a single transaction ──────
function batchMigrate(tableName, rows, mapFn) {
    log(`Migrating ${rows.length} ${tableName}...`);
    let ok = 0;
    const insert = db.prepare.bind(db);
    try {
        db.exec('BEGIN TRANSACTION');
        for (const r of rows) {
            const row = mapFn(r);
            if (row && safeInsert(tableName, row)) ok++;
        }
        db.exec('COMMIT');
    } catch (e) {
        db.exec('ROLLBACK');
        err(`Transaction failed for ${tableName}: ${e.message}`);
    }
    stats.tables[tableName] = { total: rows.length, inserted: ok };
    log(`  ✓ ${tableName}: ${ok}/${rows.length} imported`);
}

// ── MIGRATION FUNCTIONS ───────────────────────────────────────────
const now = new Date().toISOString();
const boolVal = v => (v === 'true' || v === '1' || v === true) ? 1 : 0;
const intVal = (v, def=0) => parseInt(v || def) || def;
const floatVal = (v, def=0) => parseFloat(v || def) || def;
const strOrNull = v => (!v || v === 'null' || v === '{}' || v === '[]') ? null : v;

function migrateProfiles(rows) {
    batchMigrate('profiles', rows, r => ({
        id: r.id,
        role: r.role || 'tenant',
        first_name: r.first_name || '',
        last_name: r.last_name || '',
        email: strOrNull(r.email),
        phone_number: strOrNull(r.phone_number),
        avatar_url: strOrNull(r.avatar_url),
        bio: strOrNull(r.bio),
        city: r.city || 'Harare',
        business_name: strOrNull(r.business_name),
        push_token: null, // device-specific, not migrated
        id_verified: boolVal(r.id_verified),
        is_active: r.is_active === 'false' || r.is_active === '0' ? 0 : 1,
        followers_count: intVal(r.followers_count),
        average_rating: floatVal(r.average_rating),
        review_count: intVal(r.review_count),
        approval_status: r.approval_status || 'approved',
        last_seen: r.last_seen || now,
        created_at: r.created_at || now,
        updated_at: r.updated_at || now,
    }));
}

function migrateProperties(rows) {
    batchMigrate('properties', rows, r => ({
        id: r.id,
        owner_id: r.owner_id || null,
        user_id: r.owner_id || null,
        title: r.title || 'Untitled',
        description: strOrNull(r.description),
        property_type: r.property_type || 'apartment',
        status: r.status || 'available',
        address: strOrNull(r.address),
        suburb: strOrNull(r.suburb),
        city: r.city || 'Harare',
        province: strOrNull(r.province),
        country: r.country || 'Zimbabwe',
        latitude: floatVal(r.latitude),
        longitude: floatVal(r.longitude),
        bedrooms: intVal(r.bedrooms),
        bathrooms: intVal(r.bathrooms),
        area_sqm: floatVal(r.area_sqm),
        floor_level: intVal(r.floor_level),
        parking_spots: intVal(r.parking_spots),
        is_furnished: boolVal(r.is_furnished),
        pets_allowed: boolVal(r.pets_allowed),
        available_from: strOrNull(r.available_from),
        rent_usd: floatVal(r.rent_usd),
        deposit_usd: floatVal(r.deposit_usd),
        utilities_inc: boolVal(r.utilities_inc),
        has_wifi: boolVal(r.has_wifi),
        has_pool: boolVal(r.has_pool),
        has_gym: boolVal(r.has_gym),
        has_borehole: boolVal(r.has_borehole),
        has_solar: boolVal(r.has_solar),
        has_security: boolVal(r.has_security),
        has_generator: boolVal(r.has_generator),
        has_water_tank: boolVal(r.has_water_tank),
        has_garden: boolVal(r.has_garden),
        views: intVal(r.views),
        is_featured: boolVal(r.featured || r.is_featured),
        water_source: strOrNull(r.water_source),
        sale_price_usd: floatVal(r.sale_price_usd),
        listing_purpose: r.listing_purpose || 'rent',
        created_at: r.created_at || now,
        updated_at: r.updated_at || now,
    }));
}

function migratePropertyImages(rows) {
    batchMigrate('property_images', rows, r => ({
        id: r.id || crypto.randomUUID(),
        property_id: r.property_id,
        url: strOrNull(r.url),
        image_url: strOrNull(r.url),
        storage_path: strOrNull(r.storage_path),
        alt_text: strOrNull(r.alt_text),
        is_cover: boolVal(r.is_cover),
        is_featured: boolVal(r.is_cover),
        display_order: intVal(r.sort_order || r.display_order),
        created_at: r.uploaded_at || r.created_at || now,
    }));
}

function migrateMovers(rows) {
    batchMigrate('movers', rows, r => ({
        id: r.id,
        owner_id: r.owner_id || null,
        profile_id: r.profile_id || r.owner_id || null,
        user_id: r.owner_id || null,
        company_name: r.company_name || 'Mover',
        name: r.company_name || 'Mover',
        description: strOrNull(r.description),
        city: r.city || 'Harare',
        service_areas: (r.service_areas && r.service_areas.startsWith('[')) ? r.service_areas : JSON.stringify([r.city || 'Harare']),
        vehicle_types: (r.vehicle_types && r.vehicle_types.startsWith('[')) ? r.vehicle_types : JSON.stringify(['truck']),
        base_price_usd: floatVal(r.base_price_usd),
        price_per_km_usd: floatVal(r.price_per_km || r.price_per_km_usd),
        phone: strOrNull(r.phone),
        phone_number: strOrNull(r.phone),
        whatsapp: strOrNull(r.whatsapp),
        email: strOrNull(r.email),
        website: strOrNull(r.website),
        avatar_url: strOrNull(r.avatar_url),
        logo_url: strOrNull(r.logo_url),
        rating: floatVal(r.rating) || 5.0,
        total_reviews: intVal(r.total_reviews),
        total_jobs: intVal(r.total_jobs),
        is_active: r.is_active === 'false' || r.is_active === '0' ? 0 : 1,
        is_verified: boolVal(r.is_verified),
        approval_status: 'approved',
        created_at: r.created_at || now,
        updated_at: r.updated_at || now,
    }));
}

function migrateMoverBookings(rows) {
    batchMigrate('mover_bookings', rows, r => ({
        id: r.id || crypto.randomUUID(),
        user_id: r.user_id || r.client_id || null,
        client_id: r.client_id || r.user_id || null,
        mover_id: r.mover_id,
        pickup_address: strOrNull(r.pickup_address),
        dropoff_address: strOrNull(r.dropoff_address),
        moving_date: strOrNull(r.moving_date || r.pickup_date),
        pickup_date: strOrNull(r.pickup_date || r.moving_date),
        vehicle_type: strOrNull(r.vehicle_type),
        estimated_cost_usd: floatVal(r.estimated_cost_usd || r.total_cost),
        status: r.status || 'pending',
        created_at: r.created_at || now,
    }));
}

function migrateNotifications(rows) {
    batchMigrate('notifications', rows, r => ({
        id: r.id || crypto.randomUUID(),
        user_id: r.user_id,
        title: r.title || 'Notification',
        message: r.message || r.body || '',
        type: r.type || 'general',
        actor_id: strOrNull(r.actor_id),
        reference_id: strOrNull(r.reference_id),
        is_read: boolVal(r.is_read),
        data: strOrNull(r.data),
        created_at: r.created_at || now,
    }));
}

function migrateConversations(rows) {
    log(`Migrating ${rows.length} conversations...`);
    let ok = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
        const row = {
            id: r.id,
            property_id: r.property_id || null,
            buyer_id: r.buyer_id || r.participant_a || null,
            seller_id: r.seller_id || r.participant_b || null,
            participant_a: r.participant_a || r.buyer_id || null,
            participant_b: r.participant_b || r.seller_id || null,
            last_message_at: r.last_message_at || r.updated_at || now,
            created_at: r.created_at || now,
            updated_at: r.updated_at || now,
        };
        if (safeInsert('conversations', row)) ok++;
    }
    stats.tables['conversations'] = { total: rows.length, inserted: ok };
    log(`  ✓ conversations: ${ok}/${rows.length} imported`);
}

function migrateMessages(rows) {
    log(`Migrating ${rows.length} messages...`);
    let ok = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
        const row = {
            id: r.id || crypto.randomUUID(),
            conversation_id: r.conversation_id,
            sender_id: r.sender_id,
            receiver_id: r.receiver_id || null,
            content: r.content || r.body || '',
            body: r.body || r.content || '',
            status: r.status || 'sent',
            is_read: r.is_read === 'true' || r.is_read === '1' ? 1 : 0,
            created_at: r.created_at || now,
        };
        if (safeInsert('messages', row)) ok++;
    }
    stats.tables['messages'] = { total: rows.length, inserted: ok };
    log(`  ✓ messages: ${ok}/${rows.length} imported`);
}

function migrateSavedProperties(rows) {
    log(`Migrating ${rows.length} saved properties...`);
    let ok = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
        const row = {
            id: r.id || crypto.randomUUID(),
            user_id: r.user_id,
            property_id: r.property_id,
            created_at: r.created_at || now,
        };
        if (safeInsert('saved_properties', row)) ok++;
    }
    stats.tables['saved_properties'] = { total: rows.length, inserted: ok };
    log(`  ✓ saved_properties: ${ok}/${rows.length} imported`);
}

function migrateApplications(rows) {
    log(`Migrating ${rows.length} applications...`);
    let ok = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
        const row = {
            id: r.id || crypto.randomUUID(),
            property_id: r.property_id,
            applicant_id: r.applicant_id || r.user_id,
            status: r.status || 'pending',
            notes: r.notes || r.message || null,
            created_at: r.created_at || now,
        };
        if (safeInsert('applications', row)) ok++;
    }
    stats.tables['applications'] = { total: rows.length, inserted: ok };
    log(`  ✓ applications: ${ok}/${rows.length} imported`);
}

function migrateUserFollows(rows) {
    log(`Migrating ${rows.length} user follows...`);
    let ok = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
        try {
            db.prepare(`INSERT OR REPLACE INTO user_follows (follower_id, following_id, created_at) VALUES (?, ?, ?)`)
              .run(r.follower_id, r.following_id, r.created_at || now);
            ok++;
        } catch (e) {
            err(`user_follows: ${e.message}`);
        }
    }
    stats.tables['user_follows'] = { total: rows.length, inserted: ok };
    log(`  ✓ user_follows: ${ok}/${rows.length} imported`);
}

function migrateContactSubmissions(rows) {
    log(`Migrating ${rows.length} contact submissions...`);
    let ok = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
        const row = {
            id: r.id || crypto.randomUUID(),
            name: r.name || null,
            email: r.email || null,
            phone: r.phone || r.phone_number || null,
            message: r.message || null,
            created_at: r.created_at || now,
        };
        if (safeInsert('contact_submissions', row)) ok++;
    }
    stats.tables['contact_submissions'] = { total: rows.length, inserted: ok };
    log(`  ✓ contact_submissions: ${ok}/${rows.length} imported`);
}

function migrateReviews(rows) {
    log(`Migrating ${rows.length} reviews...`);
    let ok = 0;
    const now = new Date().toISOString();
    for (const r of rows) {
        const row = {
            id: r.id || crypto.randomUUID(),
            property_id: r.property_id || null,
            mover_id: r.mover_id || null,
            user_id: r.user_id || r.reviewer_id || null,
            rating: parseFloat(r.rating || '5') || 5,
            comment: r.comment || r.body || null,
            created_at: r.created_at || now,
        };
        if (safeInsert('reviews', row)) ok++;
    }
    stats.tables['reviews'] = { total: rows.length, inserted: ok };
    log(`  ✓ reviews: ${ok}/${rows.length} imported`);
}

// ── TABLE MIGRATION MAP ───────────────────────────────────────────
const TABLE_HANDLERS = {
    'profiles':             migrateProfiles,
    'properties':           migrateProperties,
    'property_images':      migratePropertyImages,
    'movers':               migrateMovers,
    'mover_bookings':       migrateMoverBookings,
    'notifications':        migrateNotifications,
    'conversations':        migrateConversations,
    'messages':             migrateMessages,
    'saved_properties':     migrateSavedProperties,
    'applications':         migrateApplications,
    'user_follows':         migrateUserFollows,
    'contact_submissions':  migrateContactSubmissions,
    'reviews':              migrateReviews,
    // Supabase view exports — map to real tables
    'v_active_movers':      migrateMovers,
    'v_active_properties':  migrateProperties,
    'profiles_full':        migrateProfiles,
    // skip subscription_plans — not used in standalone
    'subscription_plans':   (rows) => { log(`  ⊙ subscription_plans: skipped (${rows.length} rows — not applicable offline)`); },
};

// ── MAIN ENTRY POINT ──────────────────────────────────────────────
function run() {
    console.log('================================================================');
    console.log('  HLALA LINK — SUPABASE TO STANDALONE MIGRATION');
    console.log('================================================================\n');

    const csvFiles = fs.existsSync(CSV_DIR) ? fs.readdirSync(CSV_DIR).filter(f => f.endsWith('.csv')) : [];

    if (csvFiles.length === 0) {
        console.log('📂 No CSV files found in:', CSV_DIR);
        console.log('');
        console.log('To migrate your data, follow these steps:\n');
        console.log('  1. Open the Supabase Dashboard: https://supabase.com/dashboard/project/ntzjjfbmpxgmjuorzwmv');
        console.log('  2. Go to Table Editor (left sidebar)');
        console.log('  3. For each table listed below, click the table then click "Export to CSV":');
        console.log('');
        const tables = Object.keys(TABLE_HANDLERS);
        tables.forEach((t, i) => console.log(`     ${i + 1}. ${t}`));
        console.log('');
        console.log('  4. Save each CSV file into this folder:');
        console.log('     ' + CSV_DIR);
        console.log('');
        console.log('     Name them exactly: profiles.csv, properties.csv, movers.csv, etc.');
        console.log('');
        console.log('  5. Run this script again: node standalone-database/migrate-from-supabase.js');
        console.log('');
        console.log('================================================================');
        console.log('💡 TIP: The project is restricted due to egress quota, but the');
        console.log('   Supabase DASHBOARD (web UI) should still be accessible.');
        console.log('   Just log in at supabase.com and export from there.');
        console.log('================================================================');
        return;
    }

    log(`Found ${csvFiles.length} CSV file(s): ${csvFiles.join(', ')}`);
    console.log('');

    let totalImported = 0;

    for (const file of csvFiles) {
        // Supabase Dashboard exports as "tablename_rows.csv" — strip the suffix
        const tableName = path.basename(file, '.csv').toLowerCase().replace(/-/g, '_').replace(/_rows$/, '');
        const handler = TABLE_HANDLERS[tableName];

        if (!handler) {
            warn(`No handler for table "${tableName}" — skipping ${file}`);
            continue;
        }

        try {
            log(`Processing ${file}...`);
            const rows = parseCSV(path.join(CSV_DIR, file));
            if (rows.length === 0) {
                warn(`${file} is empty or has no data rows — skipping`);
                continue;
            }
            handler(rows);
            totalImported += rows.length;
        } catch (e) {
            err(`Failed to process ${file}: ${e.message}`);
        }
    }

    console.log('');
    console.log('================================================================');
    console.log('  MIGRATION COMPLETE');
    console.log('================================================================');
    Object.entries(stats.tables).forEach(([t, s]) => {
        const status = s.inserted === s.total ? '✓' : `⚠ (${s.total - s.inserted} skipped)`;
        console.log(`  ${status} ${t}: ${s.inserted}/${s.total}`);
    });
    if (stats.warnings.length) {
        console.log('');
        console.log('  Warnings:');
        stats.warnings.forEach(w => console.log('  ⚠', w));
    }
    if (stats.errors.length) {
        console.log('');
        console.log('  Errors:');
        stats.errors.forEach(e => console.log('  ✗', e));
    }
    console.log('');
    console.log('  📌 NOTE: User passwords cannot be migrated from Supabase.');
    console.log('     Existing users will need to use "Forgot Password" or');
    console.log('     register again. All their data (properties, bookings,');
    console.log('     messages) is preserved and linked by their user ID.');
    console.log('================================================================');
}

run();
