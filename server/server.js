const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

if (!process.env.JWT_SECRET || Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET must be set to a secret of at least 32 bytes");
}

const pool = require("./db");
const migrate = require("./scripts/migrate");
const authenticateToken = require("./middleware/auth");
const STORAGE_DIR = path.join(__dirname, "uploads");
fs.mkdirSync(STORAGE_DIR, { recursive: true });

const authRoutes = require("./routes/auth");
const profileRoutes = require("./routes/profile");
const propertyRoutes = require("./routes/properties");
const applicationRoutes = require("./routes/applications");
const conversationRoutes = require("./routes/conversations");
const moverRoutes = require("./routes/movers");
const notificationRoutes = require("./routes/notifications");
const subscriptionRoutes = require("./routes/subscriptions");
const messageRoutes = require("./routes/messages");
const reviewRoutes = require("./routes/reviews");
const savedSearchRoutes = require("./routes/saved-searches");
const adminRoutes = require("./routes/admin");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));


// ===============================
// API ROUTES
// ===============================

app.use("/api/auth", authRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/properties", propertyRoutes);
app.use("/api/applications", applicationRoutes);
app.use("/api/conversations", conversationRoutes);
app.use("/api/movers", moverRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/subscriptions", subscriptionRoutes);
app.use("/api/messages", messageRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/saved-searches", savedSearchRoutes);
app.use("/api/admin", adminRoutes);

function storagePath(bucket, objectPath) {
    if (!/^[a-zA-Z0-9_-]+$/.test(bucket)) return null;
    const root = path.resolve(STORAGE_DIR);
    const target = path.resolve(root, bucket, ...objectPath.split("/"));
    return target.startsWith(root + path.sep) ? target : null;
}

function ownsStoragePath(req, objectPath) {
    return req.user.role === "admin" || objectPath.split("/")[0] === req.user.userId;
}

app.post(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/, authenticateToken, express.raw({ type: "*/*", limit: "50mb" }), (req, res) => {
    const bucket = req.params[0];
    const objectPath = req.params[1];
    const target = storagePath(bucket, objectPath);
    if (!target) return res.status(400).json({ message: "Invalid storage path" });
    if (!ownsStoragePath(req, objectPath)) return res.status(403).json({ message: "You can only upload to your own storage path" });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) return res.status(400).json({ message: "File body is empty" });
    try {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, req.body);
        res.status(201).json({ Key: `${bucket}/${objectPath}`, path: objectPath });
    } catch (error) {
        console.error("Storage upload error:", error);
        res.status(500).json({ message: "File upload failed" });
    }
});

app.get(/^\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/, (req, res) => {
    const target = storagePath(req.params[0], req.params[1]);
    if (!target) return res.status(400).json({ message: "Invalid storage path" });
    if (!fs.existsSync(target)) return res.status(404).json({ message: "File not found" });
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.sendFile(target);
});

app.delete(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/, authenticateToken, (req, res) => {
    const objectPath = req.params[1];
    const target = storagePath(req.params[0], objectPath);
    if (!target) return res.status(400).json({ message: "Invalid storage path" });
    if (!ownsStoragePath(req, objectPath)) return res.status(403).json({ message: "You can only delete your own storage path" });
    if (!fs.existsSync(target)) return res.status(404).json({ message: "File not found" });
    fs.unlinkSync(target);
    res.status(204).end();
});

// ===============================
// HEALTH CHECK
// ===============================

app.get("/api/health", async (req, res) => {
    try {
        const result = await pool.query("SELECT NOW()");

        res.json({
            success: true,
            message: "Hlala Link backend is running",
            databaseTime: result.rows[0].now
        });

    } catch (error) {
        console.error(error);

        res.status(500).json({
            success: false,
            message: "Database connection failed"
        });
    }
});


// ===============================
// START SERVER
// ===============================

app.use((req, res) => {
    res.status(404).json({ success: false, message: "API route not found" });
});

app.use((error, req, res, next) => {
    if (error instanceof SyntaxError && error.status === 400 && "body" in error) {
        return res.status(400).json({ success: false, message: "Invalid JSON body" });
    }
    console.error("Unhandled API error:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
});

const PORT = process.env.PORT || 3000;

async function startServer() {
    try {
        await migrate();
        app.listen(PORT, "0.0.0.0", () => {
            console.log(`Hlala Link API running on 0.0.0.0:${PORT}`);
        });
    } catch (error) {
        console.error("API startup failed:", error.message);
        await pool.end();
        process.exitCode = 1;
    }
}

startServer();