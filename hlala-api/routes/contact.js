const express = require("express");
const { randomUUID } = require("node:crypto");

const pool = require("../db");

const submissionRoutes = express.Router();
const alertRoutes = express.Router();

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Public contact-form storage. The web app also fires /api/contact-alert
// separately for the WhatsApp fan-out.
submissionRoutes.post("/", async (req, res) => {
    try {
        const { name, email, subject, message } = req.body || {};
        if (!name || !String(name).trim()) {
            return res.status(400).json({ success: false, message: "Name is required" });
        }
        if (!email || !EMAIL_PATTERN.test(String(email).trim())) {
            return res.status(400).json({ success: false, message: "A valid email is required" });
        }
        if (!message || !String(message).trim()) {
            return res.status(400).json({ success: false, message: "Message is required" });
        }
        const id = randomUUID();
        await pool.query(
            `INSERT INTO contact_submissions (id, name, email, subject, message, ip_address)
             VALUES ($1, $2, $3, $4, $5, $6)`,
            [
                id,
                String(name).trim().slice(0, 255),
                String(email).trim().slice(0, 320),
                subject ? String(subject).trim().slice(0, 255) : null,
                String(message).trim().slice(0, 5000),
                (req.ip || "").slice(0, 64) || null
            ]
        );
        const result = await pool.query("SELECT * FROM contact_submissions WHERE id = $1", [id]);
        res.status(201).json({ success: true, submission: result.rows[0] });
    } catch (error) {
        console.error("Contact submission error:", error);
        res.status(500).json({ success: false, message: "Could not save your message" });
    }
});

// WhatsApp team fan-out. Only the two shuffled support lines are accepted,
// mirroring the legacy static server. Needs WHATSAPP_TOKEN +
// WHATSAPP_PHONE_NUMBER_ID; without them the alert is logged as queued.
const ALLOWED_SUPPORT_LINES = ["263788118836", "263771179613"];

alertRoutes.post("/", async (req, res) => {
    try {
        const msg = req.body || {};
        const to = String(msg.to || "").replace(/\D/g, "");
        const text = String(msg.text || "").slice(0, 1000);
        if (!ALLOWED_SUPPORT_LINES.includes(to) || !text) {
            return res.status(400).json({ ok: false });
        }
        const record = {
            at: new Date().toISOString(),
            to,
            text,
            submissionId: msg.submissionId || null,
            team: Array.isArray(msg.team) ? msg.team : []
        };
        let sent = false;
        const token = process.env.WHATSAPP_TOKEN;
        const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
        if (token && phoneId) {
            try {
                const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text } })
                });
                sent = response.ok;
            } catch (error) {
                console.error("WhatsApp alert error:", error.message);
            }
        }
        if (!sent) {
            console.log(`[contact-alert] queued to=${to} submission=${record.submissionId}`);
        }
        res.json({ ok: true, sent, queued: !sent });
    } catch (error) {
        console.error("Contact alert error:", error);
        res.status(400).json({ ok: false });
    }
});

module.exports = { submissionRoutes, alertRoutes };
