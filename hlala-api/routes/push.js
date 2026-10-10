const express = require("express");

const configRoutes = express.Router();
const sendRoutes = express.Router();

let webPush = null;
try {
    webPush = require("web-push");
} catch (error) {
    console.error("web-push is not installed; push endpoints return 503.");
}

function vapidConfigured() {
    const { VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY } = process.env;
    if (!webPush || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY) return false;
    webPush.setVapidDetails(
        process.env.VAPID_SUBJECT || "mailto:admin@example.com",
        VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY
    );
    return true;
}

// Public VAPID key (safe to expose; the frontend needs it to subscribe).
configRoutes.get("/", (req, res) => {
    if (!process.env.VAPID_PUBLIC_KEY) {
        return res.status(503).json({ ok: false, error: "push not configured" });
    }
    res.json({ ok: true, publicKey: process.env.VAPID_PUBLIC_KEY });
});

// Fan-out limited to 10 https subscriptions per call, mirroring the legacy
// server (which required no auth). The contact form fires this without a
// session, so auth cannot be required without dropping team lead alerts.
// TODO: add rate limiting if abused.
sendRoutes.post("/", async (req, res) => {
    if (!vapidConfigured()) {
        return res.status(503).json({ ok: false, error: "push not configured" });
    }
    try {
        const msg = req.body || {};
        const subs = Array.isArray(msg.subscriptions) ? msg.subscriptions.slice(0, 10) : [];
        const title = String(msg.title || "Hlala Link").slice(0, 120);
        const body = String(msg.body || "You have a new update.").slice(0, 500);
        const link = String(msg.url || "/").slice(0, 200);
        let delivered = 0, failed = 0;
        for (const sub of subs) {
            if (!sub || typeof sub.endpoint !== "string" || !sub.endpoint.startsWith("https://") || !sub.keys) {
                failed++;
                continue;
            }
            try {
                await webPush.sendNotification(sub, JSON.stringify({ title, body, url: link }));
                delivered++;
            } catch (error) {
                failed++;
            }
        }
        res.json({ ok: true, delivered, failed });
    } catch (error) {
        console.error("Push send error:", error);
        res.status(500).json({ ok: false, error: "push failed" });
    }
});

module.exports = { configRoutes, sendRoutes };
