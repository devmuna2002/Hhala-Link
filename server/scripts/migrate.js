const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const pool = require("../db");

async function migrate() {
    const schemaPath = path.resolve(__dirname, "../schema_postgres.sql");
    const migrationPath = path.resolve(__dirname, "../migrations/001_api_compatibility.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");
    const sql = fs.readFileSync(migrationPath, "utf8");
    const client = await pool.connect();

    try {
        await client.query("SET search_path TO public");
        const result = await client.query("SELECT to_regclass('public.profiles') IS NOT NULL AS initialized");
        if (!result.rows[0].initialized) {
            console.log("No public.profiles table found; applying the base PostgreSQL schema.");
            await client.query(schema);
        }
        await client.query(sql);
        console.log("PostgreSQL compatibility migration completed.");
    } catch (error) {
        throw error;
    } finally {
        client.release();
    }
}

if (require.main === module) {
    migrate()
        .then(() => pool.end())
        .catch(async (error) => {
            console.error("PostgreSQL migration failed:", error.message);
            process.exitCode = 1;
            await pool.end();
        });
}

module.exports = migrate;