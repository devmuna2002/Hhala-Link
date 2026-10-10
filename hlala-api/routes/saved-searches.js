const express = require("express");
const { randomUUID } = require("node:crypto");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT * FROM saved_searches WHERE user_id = $1 ORDER BY created_at DESC",
            [req.user.userId]
        );
        res.json({ success: true, saved_searches: result.rows });
    } catch (error) {
        console.error("List saved searches error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch saved searches" });
    }
});

router.post("/", async (req, res) => {
    try {
        const { city, suburb, property_type, max_price } = req.body;
        if (!city || !String(city).trim()) {
            return res.status(400).json({ success: false, message: "City is required" });
        }
        const id = randomUUID();
        await pool.query(
            `INSERT INTO saved_searches (id, user_id, city, suburb, property_type, max_price)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [id, req.user.userId, String(city).trim(), suburb || null, property_type || null, max_price ?? null]
        );
        const result = await pool.query("SELECT * FROM saved_searches WHERE id = $1", [id]);
        res.status(201).json({ success: true, saved_search: result.rows[0] });
    } catch (error) {
        console.error("Create saved search error:", error);
        res.status(500).json({ success: false, message: "Failed to save search" });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const existing = await pool.query(
            "SELECT id FROM saved_searches WHERE id = $1 AND user_id = $2",
            [req.params.id, req.user.userId]
        );
        if (!existing.rows.length) return res.status(404).json({ success: false, message: "Saved search not found" });
        await pool.query("DELETE FROM saved_searches WHERE id = $1 AND user_id = $2", [req.params.id, req.user.userId]);
        res.json({ success: true });
    } catch (error) {
        console.error("Delete saved search error:", error);
        res.status(500).json({ success: false, message: "Failed to delete saved search" });
    }
});

module.exports = router;