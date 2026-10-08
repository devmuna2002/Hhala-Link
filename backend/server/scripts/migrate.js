const fs = require("node:fs");
const path = require("node:path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const pool = require("../db");

async function migrate() {
    const schemaPath = path.resolve(__dirname, "../schema_mysql.sql");
    const schema = fs.readFileSync(schemaPath, "utf8");
    const statements = schema.split(/;\s*(?=\r?\n|$)/).map(statement => statement.trim()).filter(Boolean);

    try {
        await pool.query("SELECT 1 AS connected");
        for (const statement of statements) {
            await pool.query(statement);
        }
        console.log(`MySQL schema ready (${statements.length} statements).`);
    } catch (error) {
        throw error;
    }
}

if (require.main === module) {
    migrate()
        .then(() => pool.end())
        .catch(async (error) => {
            console.error("MySQL migration failed:", error.message);
            process.exitCode = 1;
            await pool.end();
        });
}

module.exports = migrate;