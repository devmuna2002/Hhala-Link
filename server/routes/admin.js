const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

const tableQueries = {
    profiles: `SELECT id, email, full_name, first_name, last_name, phone, phone_number, role,
        city, business_name, vehicle_details, vehicle_photos, approval_status, is_approved,
        approved_at, avatar_url, bio, push_token, id_verified, is_active, followers_count,
        average_rating, review_count, last_seen, created_at, updated_at
        FROM profiles ORDER BY created_at DESC LIMIT 1000`,
    properties: `SELECT p.*,
        json_build_object('id', pr.id, 'first_name', pr.first_name, 'last_name', pr.last_name,
            'full_name', pr.full_name, 'business_name', pr.business_name, 'email', pr.email,
            'phone_number', pr.phone_number, 'avatar_url', pr.avatar_url, 'role', pr.role) AS owner,
        (SELECT json_agg(pi ORDER BY pi.sort_order) FROM property_images pi WHERE pi.property_id = p.id) AS property_images
        FROM properties p LEFT JOIN profiles pr ON pr.id = p.owner_id
        ORDER BY p.created_at DESC LIMIT 1000`,
    conversations: "SELECT * FROM conversations ORDER BY created_at DESC LIMIT 1000",
    messages: "SELECT *, message AS body FROM messages ORDER BY created_at DESC LIMIT 1000",
    applications: `SELECT a.*, p.title AS property_title, p.price, p.currency, p.address, p.city,
        applicant.full_name AS applicant_name, applicant.email AS applicant_email, applicant.phone AS applicant_phone
        FROM applications a JOIN properties p ON p.id = a.property_id
        JOIN profiles applicant ON applicant.id = a.applicant_id
        ORDER BY a.created_at DESC LIMIT 1000`,
    movers: "SELECT * FROM movers ORDER BY created_at DESC LIMIT 1000",
    mover_bookings: "SELECT * FROM mover_bookings ORDER BY created_at DESC LIMIT 1000",
    mover_reviews: "SELECT * FROM mover_reviews ORDER BY created_at DESC LIMIT 1000",
    reviews: "SELECT * FROM reviews ORDER BY created_at DESC LIMIT 1000",
    notifications: "SELECT *, message AS body FROM notifications ORDER BY created_at DESC LIMIT 1000",
    subscriptions: "SELECT * FROM subscriptions ORDER BY created_at DESC LIMIT 1000",
    subscription_plans: "SELECT * FROM subscription_plans ORDER BY price_usd LIMIT 1000",
    saved_properties: "SELECT * FROM saved_properties LIMIT 1000",
    saved_searches: "SELECT * FROM saved_searches ORDER BY created_at DESC LIMIT 1000",
    property_images: "SELECT * FROM property_images ORDER BY uploaded_at DESC LIMIT 1000",
    contact_submissions: "SELECT * FROM contact_submissions ORDER BY created_at DESC LIMIT 1000"
};

const editableColumns = {
    profiles: ["role", "approval_status", "is_approved", "approved_at", "first_name", "last_name", "business_name", "city", "is_active", "id_verified"],
    properties: ["status", "featured", "reviewed_at", "reviewed_by", "listing_purpose"],
    notifications: ["is_read"],
};

function requireAdmin(req, res, next) {
    if (req.user?.role !== "admin") {
        return res.status(403).json({ success: false, message: "Admin access required" });
    }
    next();
}

router.use(authenticateToken, requireAdmin);

router.get("/data/:table", async (req, res) => {
    try {
        const query = tableQueries[req.params.table];
        if (!query) return res.status(404).json({ success: false, message: "Admin table is not available" });
        const result = await pool.query(query);
        res.json({ success: true, rows: result.rows, count: result.rowCount });
    } catch (error) {
        console.error("Admin table read error:", error);
        res.status(500).json({ success: false, message: "Failed to read admin data" });
    }
});

router.patch("/data/:table/:id", async (req, res) => {
    try {
        const allowed = editableColumns[req.params.table];
        if (!allowed) return res.status(404).json({ success: false, message: "Admin updates are not available for this table" });
        const fields = Object.keys(req.body || {}).filter(field => allowed.includes(field));
        if (!fields.length) return res.status(400).json({ success: false, message: "No supported fields provided" });
        if (fields.includes("role") && !["tenant", "landlord", "agent", "mover", "admin"].includes(req.body.role)) {
            return res.status(400).json({ success: false, message: "Invalid user role" });
        }
        const values = fields.map(field => req.body[field]);
        const assignments = fields.map((field, index) => `"${field}" = $${index + 1}`);
        values.push(req.params.id);
        const updatedAt = ["profiles", "properties"].includes(req.params.table) ? ", updated_at = NOW()" : "";
        const result = await pool.query(
            `UPDATE "${req.params.table}" SET ${assignments.join(", ")}${updatedAt}
             WHERE id = $${values.length} RETURNING *`,
            values
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Record not found" });
        res.json({ success: true, row: result.rows[0] });
    } catch (error) {
        console.error("Admin table update error:", error);
        res.status(500).json({ success: false, message: "Failed to update admin data" });
    }
});

router.post("/data/notifications", async (req, res) => {
    try {
        const notifications = Array.isArray(req.body) ? req.body : [req.body];
        if (!notifications.length || notifications.length > 500) {
            return res.status(400).json({ success: false, message: "Provide between 1 and 500 notifications" });
        }
        const inserted = [];
        for (const item of notifications) {
            if (!item.user_id || !item.title) continue;
            const message = item.message || item.body || "";
            const result = await pool.query(
                `INSERT INTO notifications (user_id, actor_id, type, title, message, body, is_read, data)
                 VALUES ($1,$2,$3,$4,$5,$5,$6,$7::jsonb) RETURNING *`,
                [item.user_id, item.actor_id || req.user.userId, item.type || "admin_broadcast",
                    item.title, message, Boolean(item.is_read), JSON.stringify(item.data || {})]
            );
            inserted.push(result.rows[0]);
        }
        res.status(201).json({ success: true, rows: inserted, count: inserted.length });
    } catch (error) {
        console.error("Admin notification insert error:", error);
        res.status(500).json({ success: false, message: "Failed to send notifications" });
    }
});

router.delete("/data/:table/:id", async (req, res) => {
    try {
        if (!tableQueries[req.params.table]) return res.status(404).json({ success: false, message: "Admin table is not available" });
        const result = await pool.query(`DELETE FROM "${req.params.table}" WHERE id = $1 RETURNING id`, [req.params.id]);
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Record not found" });
        res.json({ success: true });
    } catch (error) {
        console.error("Admin table delete error:", error);
        res.status(500).json({ success: false, message: "Failed to delete record" });
    }
});

router.post("/profiles/:id/approval", async (req, res) => {
    try {
        const { approved, role } = req.body;
        const nextRole = role === "admin" && approved ? "admin" : undefined;
        const result = await pool.query(
            `UPDATE profiles SET approval_status = $1, is_approved = $2,
                approved_at = CASE WHEN $2 THEN NOW() ELSE approved_at END,
                role = COALESCE($3, role), updated_at = NOW()
             WHERE id = $4 RETURNING *`,
            [approved ? "approved" : "rejected", Boolean(approved), nextRole || null, req.params.id]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Profile not found" });
        res.json({ success: true, profile: result.rows[0] });
    } catch (error) {
        console.error("Admin profile approval error:", error);
        res.status(500).json({ success: false, message: "Failed to update profile approval" });
    }
});

module.exports = router;