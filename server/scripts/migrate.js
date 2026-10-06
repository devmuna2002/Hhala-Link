const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const pool = require("../db");

async function migrate() {
    const migrationPath = path.resolve(__dirname, "../migrations/001_api_compatibility.sql");
    const sql = fs.readFileSync(migrationPath, "utf8");
    const client = await pool.connect();

    try {
        await client.query(sql);
        console.log("PostgreSQL compatibility migration completed.");
    } catch (error) {
        console.error("PostgreSQL migration failed:", error.message);
        process.exitCode = 1;
    } finally {
        client.release();
        await pool.end();
    }
}

migrate();