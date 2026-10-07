const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");
const optionalAuthenticateToken = authenticateToken.optional;

const router = express.Router();


// ============================================================
// GET ALL PROFILES (admin / search use)
// ============================================================

router.get("/", optionalAuthenticateToken, async (req, res) => {
    try {
        const limit = Number.parseInt(req.query.limit || "500", 10);
        if (!Number.isInteger(limit) || limit < 1) {
            return res.status(400).json({ success: false, message: "Limit must be a positive integer" });
        }

        const columns = req.user?.role === "admin"
            ? `id, email, full_name, phone, first_name, last_name, phone_number, role,
               avatar_url, bio, city, id_verified, is_active, followers_count,
                    average_rating, review_count, last_seen, business_name, vehicle_details,
                    vehicle_photos, approval_status, created_at, updated_at`
            : `id, COALESCE(NULLIF(full_name, ''), TRIM(first_name || ' ' || last_name)) AS full_name,
               first_name, last_name, role, avatar_url, bio, city, id_verified,
                    followers_count, average_rating, review_count, business_name,
                    vehicle_details, vehicle_photos, approval_status, created_at`;
        const result = await pool.query(
            `SELECT ${columns} FROM profiles ORDER BY created_at DESC LIMIT $1`,
            [Math.min(limit, req.user?.role === "admin" ? 1000 : 500)]
        );

        res.json({ success: true, profiles: result.rows });

    } catch (error) {
        console.error("Get profiles error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch profiles" });
    }
});


// ============================================================
// GET CURRENT USER PROFILE
// ============================================================

router.get("/me", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT
                id, email, phone, first_name, last_name, phone_number, role,
                avatar_url, bio, city, push_token, id_verified, is_active,
                business_name, vehicle_details, vehicle_photos, approval_status,
                followers_count, average_rating, review_count, last_seen,
                created_at, updated_at,
                TRIM(first_name || ' ' || last_name) AS full_name
            FROM profiles
            WHERE id = $1`,
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "User profile not found" });
        }

        const profile = result.rows[0];
        const subscription = await pool.query(
            `SELECT plan, status, expires_at, max_listings FROM subscriptions
             WHERE user_id = $1 AND status = 'active'
             ORDER BY created_at DESC LIMIT 1`,
            [req.user.userId]
        );
        profile.subscription = subscription.rows[0] || { plan: "free", max_listings: 1 };
        res.json({ success: true, user: profile, profile });

    } catch (error) {
        console.error("Profile error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


// ============================================================
// GET PROFILE BY ID
// ============================================================

router.get("/:id", optionalAuthenticateToken, async (req, res) => {
    try {
        const { id } = req.params;

        const result = await pool.query(
            `SELECT
                id, full_name, first_name, last_name, role, business_name, vehicle_details,
                avatar_url, bio, city, id_verified, is_active,
                followers_count, average_rating, review_count, created_at,
                ${req.user ? "email, phone, phone_number," : ""}
                TRIM(first_name || ' ' || last_name) AS full_name
            FROM profiles
            WHERE id = $1`,
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "Profile not found" });
        }

        // Fetch their active listings count
        const listingCount = await pool.query(
            "SELECT COUNT(*) FROM properties WHERE owner_id = $1 AND status != 'inactive'",
            [id]
        );

        const profile = result.rows[0];
        profile.listing_count = parseInt(listingCount.rows[0].count);

        res.json({ success: true, profile });

    } catch (error) {
        console.error("Get profile error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch profile" });
    }
});


// ============================================================
// UPDATE CURRENT USER PROFILE
// ============================================================

router.put("/me", authenticateToken, async (req, res) => {
    try {
        const {
            first_name,
            last_name,
            phone_number,
            bio,
            city,
            avatar_url,
            push_token,
            business_name,
            vehicle_details,
            vehicle_photos
        } = req.body;
        const hasPushToken = Object.prototype.hasOwnProperty.call(req.body, "push_token");

        const result = await pool.query(
            `UPDATE profiles
            SET
                first_name   = COALESCE($1, first_name),
                last_name    = COALESCE($2, last_name),
                phone_number = COALESCE($3, phone_number),
                full_name    = COALESCE(NULLIF(BTRIM(CONCAT_WS(' ', COALESCE($1, first_name), COALESCE($2, last_name))), ''), full_name),
                phone        = COALESCE($3, phone),
                bio          = COALESCE($4, bio),
                city         = COALESCE($5, city),
                avatar_url   = COALESCE($6, avatar_url),
                push_token   = CASE WHEN $12 THEN $7 ELSE push_token END,
                business_name = COALESCE($9, business_name),
                vehicle_details = COALESCE($10::jsonb, vehicle_details),
                vehicle_photos = COALESCE($11::jsonb, vehicle_photos),
                updated_at   = NOW()
            WHERE id = $8
            RETURNING
                id, email, full_name, phone, first_name, last_name, phone_number, role,
                avatar_url, bio, city, push_token, id_verified, is_active,
                business_name, vehicle_details, vehicle_photos, approval_status,
                followers_count, average_rating, review_count, created_at, updated_at,
                TRIM(first_name || ' ' || last_name) AS full_name`,
            [first_name, last_name, phone_number, bio, city, avatar_url, push_token, req.user.userId,
                business_name, vehicle_details == null ? null : JSON.stringify(vehicle_details),
                vehicle_photos == null ? null : JSON.stringify(vehicle_photos), hasPushToken]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "User profile not found" });
        }

        res.json({
            success: true,
            message: "Profile updated successfully",
            profile: result.rows[0]
        });

    } catch (error) {
        console.error("Update profile error:", error);
        res.status(500).json({ success: false, message: "Failed to update profile" });
    }
});


// ============================================================
// DELETE CURRENT USER PROFILE
// ============================================================

router.delete("/me", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            "DELETE FROM profiles WHERE id = $1 RETURNING id",
            [req.user.userId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "User profile not found" });
        }

        res.json({ success: true, message: "Profile deleted successfully" });

    } catch (error) {
        console.error("Delete profile error:", error);
        res.status(500).json({ success: false, message: "Failed to delete profile" });
    }
});


// ============================================================
// FOLLOW / UNFOLLOW A USER
// ============================================================

router.post("/:id/follow", authenticateToken, async (req, res) => {
    try {
        const { id: targetId } = req.params;

        if (targetId === req.user.userId) {
            return res.status(400).json({ success: false, message: "You cannot follow yourself" });
        }

        await pool.query(
            "INSERT INTO user_follows (follower_id, following_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
            [req.user.userId, targetId]
        );

        res.json({ success: true, message: "Followed successfully" });

    } catch (error) {
        console.error("Follow error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.delete("/:id/follow", authenticateToken, async (req, res) => {
    try {
        const { id: targetId } = req.params;

        await pool.query(
            "DELETE FROM user_follows WHERE follower_id = $1 AND following_id = $2",
            [req.user.userId, targetId]
        );

        res.json({ success: true, message: "Unfollowed successfully" });

    } catch (error) {
        console.error("Unfollow error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


module.exports = router;