const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

router.get("/plans", async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT plan, price_usd, max_listings, features FROM subscription_plans ORDER BY price_usd"
        );
        res.json({ success: true, plans: result.rows });
    } catch (error) {
        console.error("List subscription plans error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch subscription plans" });
    }
});

router.get("/me", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.id, s.user_id, s.plan, s.status, s.price_usd, s.starts_at,
                    s.expires_at, s.max_listings, s.auto_renew,
                    p.features
             FROM subscriptions s
             LEFT JOIN subscription_plans p ON p.plan = s.plan
             WHERE s.user_id = $1 AND s.status = 'active'
             ORDER BY s.created_at DESC LIMIT 1`,
            [req.user.userId]
        );
        if (result.rows.length) {
            return res.json({ success: true, subscription: result.rows[0] });
        }

        const freePlan = await pool.query(
            "SELECT plan, price_usd, max_listings, features FROM subscription_plans WHERE plan = 'free'"
        );
        res.json({ success: true, subscription: { ...(freePlan.rows[0] || {}), status: "active" } });
    } catch (error) {
        console.error("Get subscription error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch subscription" });
    }
});

module.exports = router;