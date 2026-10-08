// Static checker: every INSERT/UPDATE column in backend/server/routes must exist
// in backend/server/schema_mysql.sql. Run: node scripts/check-columns.js
const fs = require("node:fs");
const path = require("node:path");

const schema = fs.readFileSync(path.join(__dirname, "..", "schema_mysql.sql"), "utf8");
const tables = {};
const tableBlocks = schema.match(/CREATE TABLE IF NOT EXISTS (\w+)\s*\(([\s\S]*?)\) ENGINE/g) || [];
for (const block of tableBlocks) {
    const name = block.match(/CREATE TABLE IF NOT EXISTS (\w+)/)[1];
    const cols = new Set();
    const body = block.slice(block.indexOf("(") + 1);
    for (const line of body.split("\n")) {
        const m = line.trim().match(/^`?([a-zA-Z_][a-zA-Z0-9_]*)`?\s+(CHAR|VARCHAR|TEXT|INT|SMALLINT|TINYINT|BOOLEAN|BOOL|DECIMAL|NUMERIC|DOUBLE|FLOAT|JSON|DATETIME|TIMESTAMP|DATE|TIME|BLOB|LONGBLOB)/i);
        if (m) cols.add(m[1]);
    }
    tables[name] = cols;
}

function splitTopLevel(s) {
    const parts = [];
    let depth = 0, cur = "", str = null;
    for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (str) {
            cur += c;
            if (c === str && s[i - 1] !== "\\") str = null;
        } else if (c === "'" || c === '"' || c === "`") { str = c; cur += c; }
        else if (c === "(") { depth++; cur += c; }
        else if (c === ")") { depth--; cur += c; }
        else if (c === "," && depth === 0) { parts.push(cur); cur = ""; }
        else cur += c;
    }
    if (cur.trim()) parts.push(cur);
    return parts;
}

const routesDir = path.join(__dirname, "..", "routes");
let errors = 0;
for (const file of fs.readdirSync(routesDir)) {
    if (!file.endsWith(".js")) continue;
    const src = fs.readFileSync(path.join(routesDir, file), "utf8");
    // INSERT INTO <table> (<cols>)
    for (const m of src.matchAll(/INSERT\s+(?:IGNORE\s+)?INTO\s+`?(\w+)`?\s*\(([^)]+)\)/gi)) {
        const [, table, cols] = m;
        if (!tables[table]) { console.log(`${file}: unknown table ${table}`); errors++; continue; }
        for (const col of splitTopLevel(cols)) {
            const name = col.trim().replace(/`/g, "");
            if (!tables[table].has(name)) { console.log(`${file}: INSERT ${table} unknown column '${name}'`); errors++; }
        }
    }
    // UPDATE <table> SET <assignments> WHERE (single fclose, no template holes in SET)
    for (const m of src.matchAll(/UPDATE\s+`?(\w+)`?\s+SET\s+([\s\S]*?)\s+WHERE/gi)) {
        const [, table, setClause] = m;
        if (!tables[table] || setClause.includes("${")) continue;
        for (const assign of splitTopLevel(setClause)) {
            const lhs = assign.split("=")[0].trim().replace(/^[a-zA-Z_][\w$]*\./, "").replace(/`/g, "");
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(lhs)) continue;
            if (!tables[table].has(lhs)) { console.log(`${file}: UPDATE ${table} unknown column '${lhs}'`); errors++; }
        }
    }
}
console.log(errors === 0 ? "COLUMN CHECK OK" : `${errors} PROBLEM(S) FOUND`);
process.exitCode = errors === 0 ? 0 : 1;
