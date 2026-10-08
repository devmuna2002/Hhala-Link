const { Pool: PostgresPool } = require("pg");
const mysql = require("mysql2/promise");
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
const optionalTables = new Set(["reviews", "contact_submissions"]);
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
const batchSize = 50;

function quotePostgresIdentifier(value) {
    return `"${value.replace(/"/g, '""')}"`;
}

function quoteMySqlIdentifier(value) {
    return `\`${value.replace(/`/g, "``")}\``;
}

function toMySqlValue(value, jsonColumns) {
    if (value == null) return null;
    if (Buffer.isBuffer(value)) return value;
    if (Array.isArray(value) || (typeof value === "object" && value instanceof Date === false)) {
        return jsonColumns ? JSON.stringify(value) : value;
    }
    return value;
}

async function listSourceTables(source) {
    const result = await source.query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = $1",
        [schema]
    );
    return new Set(result.rows.map(row => row.table_name));
}

async function listTargetColumns(target, table) {
    const [columns] = await target.query(`SHOW COLUMNS FROM ${quoteMySqlIdentifier(table)}`);
    return columns;
}

async function assertEmptyTarget(target) {
    for (const table of tables) {
        if (table === "subscription_plans") continue;
        const [rows] = await target.query(`SELECT COUNT(*) AS count FROM ${quoteMySqlIdentifier(table)}`);
        if (Number(rows[0].count) > 0) {
            throw new Error(`Target table ${table} is not empty; use a new MySQL database for the migration.`);
        }
    }
}

// Supabase transaction-mode pooler occasionally drops idle connections.
async function querySourceWithRetry(source, sql, params, attempts = 4) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await source.query(sql, params);
        } catch (error) {
            lastError = error;
            await new Promise(resolve => setTimeout(resolve, 1000 * (attempt + 1)));
        }
    }
    throw lastError;
}

async function migrateTable(source, target, table) {
    const sourceTable = `${quotePostgresIdentifier(schema)}.${quotePostgresIdentifier(table)}`;
    const targetTable = quoteMySqlIdentifier(table);
    const columnMetadata = await listTargetColumns(target, table);
    const targetColumns = new Set(columnMetadata.map(column => column.Field));
    const jsonColumns = new Set(jsonColumnsByTable[table] || []);
    const sourceColumnResult = await source.query(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [schema, table]
    );
    const pgColumns = sourceColumnResult.rows.map(row => row.column_name);
    const missingColumns = pgColumns.filter(column => !targetColumns.has(column));
    if (missingColumns.length) {
        throw new Error(`Target table ${table} is missing source columns: ${missingColumns.join(", ")}`);
    }
    // Target columns absent from Postgres are synthesized in mapRow().
    const sourceColumns = pgColumns.concat(extraColumnsFor(table, pgColumns));
    const columnsSql = sourceColumns.map(quoteMySqlIdentifier).join(", ");
    const rowPlaceholder = `(${sourceColumns.map(() => "?").join(", ")})`;
    let offset = 0;
    let migrated = 0;
    const isProfiles = table === "profiles";
    // Password hashes + fallback emails live in auth.users, not profiles.
    const batchFrom = isProfiles
        ? `${quotePostgresIdentifier(schema)}."profiles" p LEFT JOIN auth.users au ON au.id = p.id`
        : sourceTable;
    const batchSelect = isProfiles ? "p.*, au.encrypted_password AS auth_password_hash, au.email AS auth_email" : "*";
    const orderBy = orderColumns[table].map(column => (isProfiles ? "p." : "") + quotePostgresIdentifier(column)).join(", ");

    while (true) {
        const result = await querySourceWithRetry(source,
            `SELECT ${batchSelect} FROM ${batchFrom} ORDER BY ${orderBy} LIMIT $1 OFFSET $2`,
            [batchSize, offset]
        );
        if (result.rows.length === 0) break;

        const values = result.rows.flatMap(raw => {
            const row = mapRow(table, raw);
            return sourceColumns.map(column => toMySqlValue(row[column], jsonColumns.has(column)));
        });
        const placeholders = Array.from({ length: result.rows.length }, () => rowPlaceholder).join(", ");
        if (table === "subscription_plans") {
            const updates = sourceColumns.filter(column => column !== "plan")
                .map(column => `${quoteMySqlIdentifier(column)} = VALUES(${quoteMySqlIdentifier(column)})`)
                .join(", ");
            await target.query(
                `INSERT INTO ${targetTable} (${columnsSql}) VALUES ${placeholders} ON DUPLICATE KEY UPDATE ${updates}`,
                values
            );
        } else {
            await target.query(`INSERT INTO ${targetTable} (${columnsSql}) VALUES ${placeholders}`, values);
        }

        migrated += result.rows.length;
        offset += result.rows.length;
    }

    return migrated;
}

async function migratePostgresToMySql() {
    if (!process.env.SOURCE_DATABASE_URL || !process.env.MYSQL_URL) {
        throw new Error("Set SOURCE_DATABASE_URL and MYSQL_URL in the local environment before migrating.");
    }

    const source = new PostgresPool({ connectionString: process.env.SOURCE_DATABASE_URL });
    let sourceClient;
    let target;

    try {
        sourceClient = await source.connect();
        await sourceClient.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
        target = await mysql.createConnection(process.env.MYSQL_URL);

        const sourceTables = await listSourceTables(sourceClient);
        const missingTables = tables.filter(table => !optionalTables.has(table) && !sourceTables.has(table));
        if (missingTables.length) {
            throw new Error(`Source PostgreSQL database is missing expected tables: ${missingTables.join(", ")}`);
        }

        await assertEmptyTarget(target);
        const totals = {};
        await target.beginTransaction();
        try {
            for (const table of tables) {
                if (!sourceTables.has(table)) {
                    console.log(`Skipped optional source table ${table}; it does not exist.`);
                    continue;
                }
                totals[table] = await migrateTable(sourceClient, target, table);
                console.log(`Migrated ${totals[table]} rows from ${table}.`);
            }
            if (totals.reviews !== undefined) {
                await target.query("UPDATE reviews SET comment = COALESCE(comment, body) WHERE comment IS NULL");
            }
            await target.commit();
        } catch (error) {
            await target.rollback();
            throw error;
        }
        console.log("PostgreSQL-to-MySQL migration completed. Source data was not modified.");
        await sourceClient.query("COMMIT");
        return totals;
    } catch (error) {
        if (sourceClient) await sourceClient.query("ROLLBACK").catch(() => {});
        throw error;
    } finally {
        if (sourceClient) sourceClient.release();
        await Promise.all([source.end(), target?.end()]);
    }
}

if (require.main === module) {
    require("dotenv").config();
    migratePostgresToMySql().catch(error => {
        console.error("Data migration stopped:", error.message);
        process.exitCode = 1;
    });
}

module.exports = { migratePostgresToMySql };