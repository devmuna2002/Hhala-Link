const { Pool } = require("pg");
require("dotenv").config();

// Shared hosting / cPanel + managed Postgres (e.g. Supabase):
// Supabase and most managed Postgres providers require SSL.
// SSL is enabled automatically when DATABASE_URL is set,
// or when DB_SSL=true.
const useSsl =
    Boolean(process.env.DATABASE_URL) ||
    String(process.env.DB_SSL || "").toLowerCase() === "true";

const pool = new Pool({
    ...(process.env.DATABASE_URL
        ? {
            connectionString: process.env.DATABASE_URL,
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

module.exports = pool;
