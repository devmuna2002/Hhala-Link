// Shared Supabase-Postgres -> MySQL import mapping.
// Used by migrate-postgres-to-mysql.js (live import) and
// dump-postgres-to-mysql-file.js (phpMyAdmin .sql dump).
// The live Supabase schema drifted from schema_postgres.sql, so several
// columns must be synthesized from fallbacks during import. All rules live
// here so both importers behave identically.

// Target columns that do not exist in the Postgres source at all.
const EXTRA_TARGET_COLUMNS = {
    conversations: ["participant_one", "participant_two", "participant_low", "participant_high"]
};

// Target columns that may be missing from a drifted Postgres source and are
// synthesized by mapRow() below. Only those absent from the source are added.
const SYNTHESIZED_COLUMNS = {
    profiles: ["password_hash", "full_name", "phone"],
    properties: ["price", "currency", "listing_type", "images", "amenities"],
    movers: ["user_id", "business_name", "service_area", "price_from", "currency"],
    mover_bookings: ["customer_id", "booking_date", "destination_address", "price", "currency"],
    messages: ["message", "is_read"],
    reviews: ["comment"]
};

function extraColumnsFor(table, sourceColumns) {
    const wanted = (EXTRA_TARGET_COLUMNS[table] || [])
        .concat(SYNTHESIZED_COLUMNS[table] || []);
    return wanted.filter((col, i) => !sourceColumns.includes(col) && wanted.indexOf(col) === i);
}

function firstItem(value) {
    return Array.isArray(value) && value.length ? value[0] : null;
}

// Returns a new row object with every target column populated.
// `row` may additionally carry auth_password_hash / auth_email when the
// profiles query joins auth.users (see the importer scripts).
function mapRow(table, row) {
    const out = { ...row };
    switch (table) {
        case "profiles": {
            out.password_hash = row.auth_password_hash ?? null;
            out.email = row.email ?? row.auth_email ?? null;
            const built = [row.first_name, row.last_name].filter(Boolean).join(" ").trim();
            out.full_name = row.full_name && String(row.full_name).trim() ? row.full_name : built;
            out.phone = row.phone ?? row.phone_number ?? null;
            delete out.auth_password_hash;
            delete out.auth_email;
            break;
        }
        case "properties": {
            out.title = row.title ?? "";
            out.address = row.address ?? "";
            out.city = row.city ?? "Harare";
            out.price = row.price ?? row.rent_usd ?? row.sale_price_usd ?? 0;
            out.currency = row.currency ?? "USD";
            out.listing_type = row.listing_type
                ?? (row.rent_usd == null && row.sale_price_usd != null ? "sale" : "rent");
            out.images = row.images ?? [];
            out.amenities = row.amenities ?? [];
            break;
        }
        case "movers": {
            out.company_name = row.company_name ?? row.business_name ?? "";
            out.user_id = row.user_id ?? row.profile_id ?? row.owner_id ?? null;
            out.owner_id = row.owner_id ?? row.profile_id ?? row.user_id ?? null;
            out.business_name = row.business_name ?? row.company_name ?? null;
            out.service_area = row.service_area ?? firstItem(row.service_areas);
            out.price_from = row.price_from ?? row.base_price_usd ?? null;
            out.currency = row.currency ?? "USD";
            break;
        }
        case "mover_bookings": {
            out.customer_id = row.customer_id ?? row.client_id ?? null;
            const created = row.created_at instanceof Date ? row.created_at
                : row.created_at ? new Date(row.created_at) : null;
            out.booking_date = row.booking_date ?? created;
            out.destination_address = row.destination_address ?? row.drop_address ?? "";
            out.price = row.price ?? row.estimated_price ?? null;
            out.currency = row.currency ?? "USD";
            break;
        }
        case "messages": {
            out.message = row.message ?? row.body ?? "";
            out.body = row.body ?? row.message ?? "";
            out.is_read = row.is_read ?? (row.status === "read");
            break;
        }
        case "conversations": {
            const one = row.participant_one ?? row.participant_a;
            const two = row.participant_two ?? row.participant_b;
            out.participant_one = one;
            out.participant_two = two;
            const pair = [one, two].sort();
            out.participant_low = pair[0];
            out.participant_high = pair[1];
            break;
        }
        case "reviews": {
            out.comment = row.comment ?? row.body ?? null;
            break;
        }
        case "notifications": {
            out.message = row.message ?? row.body ?? "";
            out.body = row.body ?? row.message ?? "";
            out.title = row.title ?? "";
            break;
        }
        default:
            break;
    }
    return out;
}

module.exports = { EXTRA_TARGET_COLUMNS, SYNTHESIZED_COLUMNS, extraColumnsFor, mapRow };
