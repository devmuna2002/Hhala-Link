require("dotenv").config();

const mysql = require("mysql2/promise");
const { bindNumberedParameters, parseJsonColumn } = require("./mysql-query");

const mysqlUrl = process.env.MYSQL_URL;
if (!mysqlUrl && (!process.env.MYSQL_DATABASE || !process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD)) {
    throw new Error("Set MYSQL_URL or MYSQL_DATABASE, MYSQL_USER, and MYSQL_PASSWORD before starting the API");
}

const poolOptions = {
    host: process.env.MYSQL_HOST || "localhost",
    port: Number(process.env.MYSQL_PORT || 3306),
    database: process.env.MYSQL_DATABASE,
    user: process.env.MYSQL_USER,
    password: process.env.MYSQL_PASSWORD,
    ...(process.env.MYSQL_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_POOL_MAX || 10),
    queueLimit: 0,
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    typeCast(field, next) {
        if (field.type === "JSON" || ["vehicle_details", "vehicle_photos", "features", "images", "amenities", "service_areas", "vehicle_types", "data", "owner"].includes(field.name)) {
            return parseJsonColumn(field.name, field.string());
        }
        if (field.type === "TINY" && field.length === 1) {
            return field.string() === "1";
        }
        return next();
    },
    connectTimeout: Number(process.env.DB_CONNECT_TIMEOUT_MS || 10000)
};

if (mysqlUrl) {
    const parsedUrl = new URL(mysqlUrl);
    poolOptions.host = parsedUrl.hostname;
    poolOptions.port = Number(parsedUrl.port || 3306);
    poolOptions.database = decodeURIComponent(parsedUrl.pathname.replace(/^\//, ""));
    poolOptions.user = decodeURIComponent(parsedUrl.username);
    poolOptions.password = decodeURIComponent(parsedUrl.password);
}

const mysqlPool = mysql.createPool(poolOptions);

async function runQuery(connection, sql, parameters = []) {
    const bound = bindNumberedParameters(sql, parameters);
    const [result] = await connection.query(bound.sql, bound.values);
    if (Array.isArray(result)) {
        return { rows: result, rowCount: result.length };
    }
    return {
        rows: [],
        rowCount: result.affectedRows || 0,
        insertId: result.insertId
    };
}

function createClient(connection, releaseConnection) {
    return {
        async query(sql, parameters = []) {
            const command = String(sql).trim().replace(/;$/, "").toUpperCase();
            if (command === "BEGIN" || command === "BEGIN TRANSACTION") {
                await connection.beginTransaction();
                return { rows: [], rowCount: 0 };
            }
            if (command === "COMMIT") {
                await connection.commit();
                return { rows: [], rowCount: 0 };
            }
            if (command === "ROLLBACK") {
                await connection.rollback();
                return { rows: [], rowCount: 0 };
            }
            return runQuery(connection, sql, parameters);
        },
        release: releaseConnection
    };
}

mysqlPool.on("error", (error) => {
    console.error("Unexpected MySQL pool error:", error);
});

const pool = {
    query(sql, parameters = []) {
        return runQuery(mysqlPool, sql, parameters);
    },
    async connect() {
        const connection = await mysqlPool.getConnection();
        return createClient(connection, () => connection.release());
    },
    end() {
        return mysqlPool.end();
    }
};

module.exports = pool;