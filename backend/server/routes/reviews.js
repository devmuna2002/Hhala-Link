const express = require("express");
const { randomUUID } = require("node:crypto");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const { property_id, mover_id } = req.query;
        if (!property_id && !mover_id) {
            return res.status(400).json({ success: false, message: "property_id or mover_id is required" });
        }
        if (property_id && mover_id) {
            return res.status(400).json({ success: false, message: "Provide property_id or mover_id, not both" });
        }
        const field = property_id ? "property_id" : "mover_id";
        const rawIds = property_id || mover_id;
        const ids = (Array.isArray(rawIds) ? rawIds : String(rawIds).split(","))
            .flatMap(value => String(value).split(","))
            .map(value => value.trim())
            .filter(Boolean);
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (!ids.length || ids.length > 100 || ids.some(id => !uuidPattern.test(id))) {
            return res.status(400).json({ success: false, message: "Review IDs must be valid UUIDs (up to 100 per request)" });
        }
        const idPlaceholders = ids.map((id, index) => `$${index + 1}`).join(", ");
        const result = await pool.query(
            `SELECT r.*, p.full_name AS reviewer_name, p.avatar_url AS reviewer_avatar
             FROM reviews r JOIN profiles p ON p.id = r.reviewer_id
             WHERE r.${field} IN (${idPlaceholders}) ORDER BY r.created_at DESC LIMIT 500`,
            ids
        );
        res.json({ success: true, reviews: result.rows });
    } catch (error) {
        console.error("List reviews error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch reviews" });
    }
});

router.post("/", authenticateToken, async (req, res) => {
    try {
        const { property_id, mover_id, rating, comment } = req.body;
        if ((!property_id && !mover_id) || (property_id && mover_id)) {
            return res.status(400).json({ success: false, message: "Provide either property_id or mover_id" });
        }
        if (!Number.isInteger(Number(rating)) || Number(rating) < 1 || Number(rating) > 5) {
            return res.status(400).json({ success: false, message: "Rating must be an integer from 1 to 5" });
        }
        const id = randomUUID();
        await pool.query(
            `INSERT INTO reviews (id, reviewer_id, property_id, mover_id, rating, comment)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [id, req.user.userId, property_id || null, mover_id || null, Number(rating), comment || null]
        );
        const result = await pool.query("SELECT * FROM reviews WHERE id = $1", [id]);
        res.status(201).json({ success: true, review: result.rows[0] });
    } catch (error) {
        console.error("Create review error:", error);
        res.status(500).json({ success: false, message: "Failed to create review" });
    }
});

module.exports = router;