const express = require("express");
const { randomUUID } = require("node:crypto");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();

router.get("/", async (req, res) => {
    try {
        const { city, vehicle_type, service_area } = req.query;
        const conditions = ["m.is_active = TRUE"];
        const params = [];
        if (city) {
            params.push(city);
            conditions.push(`LOWER(m.city) = LOWER($${params.length})`);
        }
        if (vehicle_type) {
            params.push(vehicle_type);
            conditions.push(`JSON_CONTAINS(m.vehicle_types, JSON_QUOTE($${params.length}))`);
        }
        if (service_area) {
            params.push(service_area);
            conditions.push(`JSON_CONTAINS(m.service_areas, JSON_QUOTE($${params.length}))`);
        }
        const limit = Number.parseInt(req.query.limit || "50", 10);
        if (!Number.isInteger(limit) || limit < 1) {
            return res.status(400).json({ success: false, message: "Limit must be a positive integer" });
        }
        params.push(Math.min(limit, 100));
        const result = await pool.query(
            `SELECT m.*, TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS owner_name,
                    p.avatar_url AS owner_avatar
             FROM movers m LEFT JOIN profiles p ON p.id = m.owner_id
             WHERE ${conditions.join(" AND ")}
             ORDER BY m.is_verified DESC, m.rating DESC, m.created_at DESC
             LIMIT $${params.length}`,
            params
        );
        res.json({ success: true, movers: result.rows });
    } catch (error) {
        console.error("List movers error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch movers" });
    }
});

router.get("/bookings/me", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT b.*, m.company_name, m.phone AS mover_phone, m.owner_id,
                    TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS client_name
             FROM mover_bookings b
             JOIN movers m ON m.id = b.mover_id
             JOIN profiles p ON p.id = b.client_id
             WHERE b.client_id = $1 OR m.owner_id = $1
             ORDER BY b.created_at DESC`,
            [req.user.userId]
        );
        res.json({ success: true, bookings: result.rows });
    } catch (error) {
        console.error("List mover bookings error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch bookings" });
    }
});

router.post("/", authenticateToken, async (req, res) => {
    try {
        if (!['mover', 'admin'].includes(req.user.role)) {
            return res.status(403).json({ success: false, message: "Mover account required" });
        }
        const {
            company_name, description, city, service_areas, vehicle_types,
            base_price_usd, price_per_km, phone, whatsapp, email, website, currency
        } = req.body;
        if (!company_name || !phone) {
            return res.status(400).json({ success: false, message: "Company name and phone are required" });
        }
        if ((service_areas !== undefined && !Array.isArray(service_areas)) || (vehicle_types !== undefined && !Array.isArray(vehicle_types))) {
            return res.status(400).json({ success: false, message: "Service areas and vehicle types must be arrays" });
        }
        const id = randomUUID();
        await pool.query(
            `INSERT INTO movers (user_id, owner_id, business_name, company_name, description, city, service_area,
                service_areas, vehicle_types, price_from, base_price_usd, price_per_km, phone, whatsapp, email,
                website, currency, is_verified, is_active, id)
             VALUES ($1,$1,$2,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10,$11,$12,$13,$14,FALSE,TRUE,$15)`,
            [req.user.userId, company_name, description || null, city || "Harare",
                (service_areas || []).join(", "), JSON.stringify(service_areas || []), JSON.stringify(vehicle_types || []), base_price_usd || 0,
                price_per_km || 0, phone, whatsapp || null, email || null, website || null, currency || "USD", id]
        );
        const result = await pool.query("SELECT * FROM movers WHERE id = $1", [id]);
        res.status(201).json({ success: true, mover: result.rows[0] });
    } catch (error) {
        console.error("Create mover profile error:", error);
        res.status(500).json({ success: false, message: "Failed to create mover profile" });
    }
});

router.get("/:id/reviews", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT r.*, p.full_name AS reviewer_name, p.avatar_url AS reviewer_avatar
             FROM mover_reviews r JOIN profiles p ON p.id = r.reviewer_id
             WHERE r.mover_id = $1 ORDER BY r.created_at DESC LIMIT 100`,
            [req.params.id]
        );
        res.json({ success: true, reviews: result.rows });
    } catch (error) {
        console.error("List mover reviews error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch mover reviews" });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT m.*, TRIM(CONCAT(p.first_name, ' ', p.last_name)) AS owner_name,
                    p.avatar_url AS owner_avatar
             FROM movers m LEFT JOIN profiles p ON p.id = m.owner_id
             WHERE m.id = $1 AND m.is_active = TRUE`,
            [req.params.id]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: "Mover not found" });
        }
        res.json({ success: true, mover: result.rows[0] });
    } catch (error) {
        console.error("Get mover error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch mover" });
    }
});

router.patch("/:id", authenticateToken, async (req, res) => {
    try {
        const owner = await pool.query("SELECT owner_id FROM movers WHERE id = $1", [req.params.id]);
        if (!owner.rows.length) {
            return res.status(404).json({ success: false, message: "Mover not found" });
        }
        if (owner.rows[0].owner_id !== req.user.userId && req.user.role !== "admin") {
            return res.status(403).json({ success: false, message: "You can only update your own mover profile" });
        }
        const fields = ["company_name", "description", "city", "service_areas", "vehicle_types", "base_price_usd", "price_per_km", "phone", "whatsapp", "email", "website", "avatar_url", "logo_url"];
        const values = [];
        const assignments = [];
        for (const field of fields) {
            if (req.body[field] !== undefined) {
                values.push(["service_areas", "vehicle_types"].includes(field) && Array.isArray(req.body[field])
                    ? JSON.stringify(req.body[field])
                    : req.body[field]);
                assignments.push(`${field} = $${values.length}`);
            }
        }
        if (!assignments.length) {
            return res.status(400).json({ success: false, message: "No supported fields provided" });
        }
        assignments.push("updated_at = NOW()");
        values.push(req.params.id);
        await pool.query(
            `UPDATE movers SET ${assignments.join(", ")} WHERE id = $${values.length}`,
            values
        );
        const result = await pool.query("SELECT * FROM movers WHERE id = $1", [req.params.id]);
        res.json({ success: true, mover: result.rows[0] });
    } catch (error) {
        console.error("Update mover error:", error);
        res.status(500).json({ success: false, message: "Failed to update mover" });
    }
});

function isValidIsoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1 || month < 1 || month > 12) return false;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day >= 1 && day <= daysInMonth[month - 1];
}

router.post("/:id/bookings", authenticateToken, async (req, res) => {
    try {
        const { moving_date, pickup_address, drop_address, pickup_city, drop_city, distance_km, items_description, notes } = req.body;
        if (!pickup_address || !drop_address) {
            return res.status(400).json({ success: false, message: "Pickup and drop-off addresses are required" });
        }
        const movingDate = typeof moving_date === "string" ? moving_date.trim() : "";
        if (movingDate && !isValidIsoDate(movingDate)) {
            return res.status(400).json({ success: false, message: "Moving date must be a real date in YYYY-MM-DD format" });
        }
        let mover = await pool.query(
            "SELECT id, owner_id FROM movers WHERE (id = $1 OR owner_id = $1 OR user_id = $1) AND is_active = TRUE LIMIT 1",
            [req.params.id]
        );
        if (!mover.rows.length) {
            const profile = await pool.query(
                "SELECT id, role, full_name, phone, email, city, vehicle_details FROM profiles WHERE id = $1",
                [req.params.id]
            );
            if (!profile.rows.length || profile.rows[0].role !== "mover") {
                return res.status(404).json({ success: false, message: "Mover not found" });
            }
            const moverProfile = profile.rows[0];
            const vehicleType = moverProfile.vehicle_details?.type || "general";
            const moverId = randomUUID();
            await pool.query(
                `INSERT INTO movers (user_id, owner_id, business_name, company_name, city, service_area,
                    service_areas, vehicle_types, price_from, base_price_usd, phone, email, currency, is_verified, is_active, id)
                 VALUES ($1,$1,$2,$3,$4,$5,$6,$7,0,0,$8,$9,'USD',FALSE,TRUE,$10)`,
                [moverProfile.id, moverProfile.full_name || "Mover", moverProfile.full_name || "Mover",
                    moverProfile.city || "Harare", moverProfile.city || "Harare", JSON.stringify([vehicleType]), JSON.stringify([vehicleType]),
                    moverProfile.phone, moverProfile.email, moverId]
            );
            mover = await pool.query("SELECT id, owner_id FROM movers WHERE id = $1", [moverId]);
        }
        if (mover.rows[0].owner_id === req.user.userId) {
            return res.status(400).json({ success: false, message: "You cannot book your own moving service" });
        }
        const bookingId = randomUUID();
        await pool.query(
            `INSERT INTO mover_bookings (mover_id, customer_id, client_id, booking_date, moving_date, pickup_address,
            destination_address, drop_address, pickup_city, drop_city, distance_km, items_description, notes, id)
             VALUES ($1,$2,$2,COALESCE($3, CURRENT_DATE),$3,$4,$5,$5,$6,$7,$8,$9,$10,$11)`,
            [mover.rows[0].id, req.user.userId, movingDate || null, pickup_address, drop_address,
                pickup_city || "Harare", drop_city || "Harare", distance_km || null,
            items_description || null, notes || null, bookingId]
        );
        const result = await pool.query("SELECT * FROM mover_bookings WHERE id = $1", [bookingId]);
        if (mover.rows[0].owner_id) {
            await pool.query(
                `INSERT INTO notifications (id, user_id, type, actor_id, reference_id, title, body, message, data)
                 VALUES ($1, $2, 'mover_booking', $3, $4, 'New moving request', $5, $5, $6)`,
                [randomUUID(), mover.rows[0].owner_id, req.user.userId, result.rows[0].id, pickup_address, JSON.stringify({ booking_id: result.rows[0].id })]
            );
        }
        res.status(201).json({ success: true, booking: result.rows[0] });
    } catch (error) {
        console.error("Create mover booking error:", error);
        res.status(500).json({ success: false, message: "Failed to create booking" });
    }
});

router.patch("/bookings/:bookingId/status", authenticateToken, async (req, res) => {
    try {
        const { status, bid_amount } = req.body;
        const bookingResult = await pool.query(
            `SELECT b.*, m.owner_id FROM mover_bookings b
             JOIN movers m ON m.id = b.mover_id WHERE b.id = $1`,
            [req.params.bookingId]
        );
        if (!bookingResult.rows.length) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }
        const booking = bookingResult.rows[0];
        const isClient = booking.client_id === req.user.userId;
        const isMoverOwner = booking.owner_id === req.user.userId;
        const allowed = {
            pending: ["bidded", "confirmed", "accepted", "cancelled", "declined"],
            bidded: ["accepted", "cancelled", "declined"],
            confirmed: ["accepted", "cancelled"],
            accepted: ["in_progress", "cancelled"],
            in_progress: ["completed"]
        };
        if ((!isClient && !isMoverOwner) || !allowed[booking.status]?.includes(status)) {
            return res.status(403).json({ success: false, message: "Booking status transition is not allowed" });
        }
        if (isMoverOwner && ["accepted", "cancelled"].includes(status)) {
            return res.status(403).json({ success: false, message: "Only the client can accept or cancel a booking" });
        }
        if (isClient && !["accepted", "cancelled"].includes(status)) {
            return res.status(403).json({ success: false, message: "Only the mover can update this booking status" });
        }
        if (status === "bidded" && (!Number.isFinite(Number(bid_amount)) || Number(bid_amount) <= 0)) {
            return res.status(400).json({ success: false, message: "A positive bid amount is required" });
        }
        await pool.query(
            `UPDATE mover_bookings SET status = $1,
                bid_amount = COALESCE($2, bid_amount), price = COALESCE($2, price), updated_at = NOW()
             WHERE id = $3`,
            [status, status === "bidded" ? bid_amount : null, booking.id]
        );
        const updated = await pool.query("SELECT * FROM mover_bookings WHERE id = $1", [booking.id]);
        const recipientId = isClient ? booking.owner_id : booking.client_id;
        if (recipientId) {
            await pool.query(
                `INSERT INTO notifications (id, user_id, type, actor_id, reference_id, title, body, message, data)
                 VALUES ($1, $2, 'mover_booking_update', $3, $4, 'Moving request updated', $5, $5, $6)`,
                [randomUUID(), recipientId, req.user.userId, booking.id, `Status: ${status}`, JSON.stringify({ booking_id: booking.id, status })]
            );
        }
        res.json({ success: true, booking: updated.rows[0] });
    } catch (error) {
        console.error("Update mover booking error:", error);
        res.status(500).json({ success: false, message: "Failed to update booking" });
    }
});

router.post("/bookings/:bookingId/reviews", authenticateToken, async (req, res) => {
    try {
        const rating = Number(req.body.rating);
        if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
            return res.status(400).json({ success: false, message: "Rating must be an integer from 1 to 5" });
        }
        const booking = await pool.query(
            "SELECT id, mover_id FROM mover_bookings WHERE id = $1 AND client_id = $2 AND status = 'completed'",
            [req.params.bookingId, req.user.userId]
        );
        if (!booking.rows.length) {
            return res.status(404).json({ success: false, message: "Completed booking not found" });
        }
        const existing = await pool.query("SELECT id FROM mover_reviews WHERE booking_id = $1", [booking.rows[0].id]);
        if (existing.rows.length) {
            return res.status(409).json({ success: false, message: "This booking has already been reviewed" });
        }
        const reviewId = randomUUID();
        await pool.query(
            `INSERT INTO mover_reviews (id, mover_id, booking_id, reviewer_id, rating, comment)
             VALUES ($1,$2,$3,$4,$5,$6)`,
            [reviewId, booking.rows[0].mover_id, booking.rows[0].id, req.user.userId, rating, req.body.comment || null]
        );
        const result = await pool.query("SELECT * FROM mover_reviews WHERE id = $1", [reviewId]);
        await pool.query(
            `UPDATE movers SET
                rating = COALESCE((SELECT ROUND(AVG(rating), 1) FROM mover_reviews WHERE mover_id = $1), 0),
                total_reviews = (SELECT COUNT(*) FROM mover_reviews WHERE mover_id = $1)
             WHERE id = $1`,
            [booking.rows[0].mover_id]
        );
        res.status(201).json({ success: true, review: result.rows[0] });
    } catch (error) {
        console.error("Create mover review error:", error);
        res.status(500).json({ success: false, message: "Failed to create review" });
    }
});

module.exports = router;