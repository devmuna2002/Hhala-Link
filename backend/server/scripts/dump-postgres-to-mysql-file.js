// One-off: dump Supabase (Postgres) data to a MySQL .sql file for phpMyAdmin import.
// Usage (PowerShell):
//   $env:SOURCE_DATABASE_URL="postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres"
//   $env:MYSQL_DUMP_OUTPUT="C:\path\to\hlala-mysql-data.sql"
//   node scripts/dump-postgres-to-mysql-file.js
// The file contains INSERTs only (schema is created separately by schema_mysql.sql).
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Pool: PostgresPool } = require("pg");
const mysql = require("mysql2");
const { extraColumnsFor, mapRow } = require("./migration-mapping");

const schema = process.env.SOURCE_SCHEMA || "public";
const tables = [
    "subscription_plans",
    "profiles",
    "properties",
    "movers",
    "property_images",
    "saved_properties",
    "saved_searches",
    "subscriptions",
    "applications",
    "user_follows",
    "conversations",
    "messages",
    "mover_bookings",
    "mover_reviews",
    "reviews",
    "notifications",
    "contact_submissions"
];
const orderColumns = {
    subscription_plans: ["plan"],
    profiles: ["id"],
    properties: ["id"],
    movers: ["id"],
    property_images: ["id"],
    saved_properties: ["user_id", "property_id"],
    saved_searches: ["id"],
    subscriptions: ["id"],
    applications: ["id"],
    user_follows: ["follower_id", "following_id"],
    conversations: ["id"],
    messages: ["id"],
    mover_bookings: ["id"],
    mover_reviews: ["id"],
    reviews: ["id"],
    notifications: ["id"],
    contact_submissions: ["id"]
};
const jsonColumnsByTable = {
    profiles: ["vehicle_details", "vehicle_photos"],
    subscription_plans: ["features"],
    properties: ["images", "amenities"],
    movers: ["service_areas", "vehicle_types"],
    notifications: ["data"]
};
const dateOnlyColumns = new Set(["available_from", "booking_date", "moving_date"]);
const batchSize = 100;

function pad(n, w = 2) { return String(n).padStart(w, "0"); }
function formatDateTime(d) {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} `
        + `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}`;
}
function formatDate(d) {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}
function toSqlLiteral(column, value, isJson) {
    if (value === null || value === undefined) return "NULL";
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    if (value instanceof Date) {
        return mysql.escape(dateOnlyColumns.has(column) ? formatDate(value) : formatDateTime(value));
    }
    if (isJson) return mysql.escape(typeof value === "string" ? value : JSON.stringify(value));
    if (typeof value === "object") return mysql.escape(JSON.stringify(value));
    return mysql.escape(value);
}
function quoteId(value) { return `\`${value.replace(/`/g, "``")}\``; }

// Supabase transaction-mode pooler occasionally drops idle connections;
// retry the batch read a few times before giving up.
async function queryWithRetry(source, sql, params, attempts = 4) {
    let lastError;
    for (let i = 0; i < attempts; i++) {
        try {
            return await source.query(sql, params);
        } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
        }
    }
    throw lastError;
}

async function dump() {
    if (!process.env.SOURCE_DATABASE_URL) throw new Error("Set SOURCE_DATABASE_URL first.");
    const output = process.env.MYSQL_DUMP_OUTPUT || path.join(os.tmpdir(), "hlala-mysql-data.sql");
    const source = new PostgresPool({
        connectionString: process.env.SOURCE_DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    const lines = [
        "-- Hlala Link MySQL data import (generated from Supabase).",
        "-- Import AFTER schema_mysql.sql has created the tables, via phpMyAdmin > Import.",
        "SET FOREIGN_KEY_CHECKS=0;",
        ""
    ];
    const totals = {};
    try {
        const existing = await source.query(
            "SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [schema]);
        const present = new Set(existing.rows.map(r => r.table_name));
        for (const table of tables) {
            if (!present.has(table)) { console.log(`Skipped ${table} (not in source).`); continue; }
            const cols = (await source.query(
                "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 ORDER BY ordinal_position",
                [schema, table])).rows.map(r => r.column_name);
            const jsonCols = new Set(jsonColumnsByTable[table] || []);
            const useCols = cols.concat(extraColumnsFor(table, cols));
            const colSql = useCols.map(quoteId).join(", ");
            let offset = 0, count = 0;
            const isProfiles = table === "profiles";
            while (true) {
                const orderBy = orderColumns[table].map(c => `${isProfiles ? "p." : ""}"${c}"`).join(", ");
                const fromSql = isProfiles
                    ? `"${schema}"."profiles" p LEFT JOIN auth.users au ON au.id = p.id`
                    : `"${schema}"."${table}"`;
                const selectSql = isProfiles
                    ? "p.*, au.encrypted_password AS auth_password_hash, au.email AS auth_email"
                    : "*";
                const res = await queryWithRetry(source,
                    `SELECT ${selectSql} FROM ${fromSql} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
                    [batchSize, offset]);
                if (!res.rows.length) break;
                for (const raw of res.rows) {
                    const row = mapRow(table, raw);
                    const vals = useCols.map(col => toSqlLiteral(col, row[col], jsonCols.has(col)));
                    const upsert = table === "subscription_plans"
                        ? ` ON DUPLICATE KEY UPDATE ${cols.filter(c => c !== "plan").map(c => `${quoteId(c)} = VALUES(${quoteId(c)})`).join(", ")}`
                        : "";
                    lines.push(`INSERT INTO ${quoteId(table)} (${colSql}) VALUES (${vals.join(", ")});`);
                    count++;
                }
                offset += res.rows.length;
            }
            totals[table] = count;
            console.log(`${table}: ${count} rows.`);
        }
        lines.push("", "SET FOREIGN_KEY_CHECKS=1;");
        fs.writeFileSync(output, lines.join("\n"));
        console.log(`Wrote ${output}`);
    } finally {
        await source.end();
    }
    return totals;
}

if (require.main === module) {
    dump().catch(error => {
        console.error("Dump stopped:", error.message.split("\n")[0]);
        process.exitCode = 1;
    });
}

module.exports = { dump };
