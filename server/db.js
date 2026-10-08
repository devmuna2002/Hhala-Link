const { Pool } = require("pg");
require("dotenv").config();

// Shared hosting / cPanel + managed Postgres (e.g. Supabase):
// Supabase and most managed Postgres providers require SSL.
// SSL is enabled automatically when DATABASE_URL is set,
// or when DB_SSL=true.
//
// NOTE: strip any `sslmode` query param from DATABASE_URL first.
// pg v9 treats sslmode=require as verify-full, which rejects the
// pooler's certificate chain. The `ssl` object below already
// enforces encrypted-but-unverified TLS, which is what we want.
function stripSslMode(connectionString) {
    let out = String(connectionString || "").replace(/([?&])sslmode=[^&#]*/i, "");
    out = out.replace(/(\?|&)$/, "");
    if (!out.includes("?") && out.includes("&")) out = out.replace("&", "?");
    return out.replace("?&", "?");
}

const databaseUrl = process.env.DATABASE_URL
    ? stripSslMode(process.env.DATABASE_URL)
    : null;
const useSsl =
    Boolean(process.env.DATABASE_URL) ||
    String(process.env.DB_SSL || "").toLowerCase() === "true";

const pool = new Pool({
    ...(databaseUrl
        ? {
            connectionString: databaseUrl,
            ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
        }
        : {
            host: process.env.DB_HOST || "localhost",
            port: Number(process.env.DB_PORT || 5432),
            database: process.env.DB_NAME,
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            ...(useSsl ? { ssl: { rejectUnauthorized: false } } : {}),
        }),
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
});

pool.on("error", (err) => {
    console.error("Unexpected PostgreSQL error:", err);
});

// Boot log: show WHERE we connect (host only, never credentials)
// so a missing/mistyped DATABASE_URL is obvious in stderr.log.
try {
    const target = databaseUrl
        ? databaseUrl.replace(/:\/\/[^@]*@/, "://***@")
        : `${process.env.DB_HOST || "localhost"}:${Number(process.env.DB_PORT || 5432)}/${process.env.DB_NAME || "(no DB_NAME)"}`;
    console.log(`[db] target=${target} ssl=${useSsl}`);
} catch (e) { /* logging must never break startup */ }

module.exports = pool;
