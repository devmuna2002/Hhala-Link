const express = require("express");
const { randomUUID } = require("node:crypto");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

// Compatibility dispatcher for Supabase-style rpc() calls from the web and
// mobile shims. Each function maps onto existing backend behavior.
const handlers = {
    // Returns the caller's conversations enriched for chat lists:
    // [{ id, partner_id, partner_name, last_message_content,
    //    last_message_at, unread_count }]
    async get_user_conversations(req) {
        const { uid } = req.body || {};
        if (!uid || uid !== req.user.userId) {
            const error = new Error("You can only load your own conversations");
            error.status = 403;
            throw error;
        }
        const result = await pool.query(
            `SELECT c.id, c.last_message_at,
                    CASE WHEN c.participant_one = $1 THEN c.participant_two ELSE c.participant_one END AS partner_id,
                    TRIM(CONCAT(other.first_name, ' ', other.last_name)) AS partner_name
             FROM conversations c
             JOIN profiles other ON other.id = CASE
                 WHEN c.participant_one = $1 THEN c.participant_two ELSE c.participant_one END
             WHERE c.participant_one = $1 OR c.participant_two = $1
             ORDER BY c.last_message_at DESC`,
            [req.user.userId]
        );
        if (!result.rows.length) return [];
        const ids = result.rows.map(row => row.id);
        const placeholders = ids.map((_, index) => `$${index + 1}`).join(", ");
        const lastMessages = await pool.query(
            `SELECT m.conversation_id, m.body, m.created_at FROM messages m
             WHERE m.conversation_id IN (${placeholders})
             ORDER BY m.created_at DESC`,
            ids
        );
        const lastByConversation = new Map();
        for (const message of lastMessages.rows) {
            if (!lastByConversation.has(message.conversation_id)) {
                lastByConversation.set(message.conversation_id, message);
            }
        }
        const unread = await pool.query(
            `SELECT conversation_id, COUNT(*) AS unread_count FROM messages
             WHERE conversation_id IN (${placeholders}) AND sender_id <> $${ids.length + 1} AND is_read = FALSE
             GROUP BY conversation_id`,
            [...ids, req.user.userId]
        );
        const unreadByConversation = new Map(
            unread.rows.map(row => [row.conversation_id, Number(row.unread_count)])
        );
        return result.rows.map(row => {
            const last = lastByConversation.get(row.id);
            return {
                id: row.id,
                partner_id: row.partner_id,
                partner_name: (row.partner_name || "").trim() || "User",
                last_message_content: last ? last.body : null,
                last_message_at: row.last_message_at,
                unread_count: unreadByConversation.get(row.id) || 0
            };
        });
    },

    // Fire-and-forget view counter used by listing modals.
    async increment_property_views(req) {
        const { prop_id } = req.body || {};
        if (!prop_id) {
            const error = new Error("prop_id is required");
            error.status = 400;
            throw error;
        }
        await pool.query("UPDATE properties SET views = views + 1 WHERE id = $1", [prop_id]);
        const result = await pool.query("SELECT views FROM properties WHERE id = $1", [prop_id]);
        return { ok: true, views: result.rows[0] ? result.rows[0].views : 0 };
    },

    // Booking creation used by the mover booking form. The caller resolves a
    // real movers.id first; the mover must exist and not belong to the caller.
    async create_mover_booking(req) {
        const { requester_id, mover_id, job_details } = req.body || {};
        if (!requester_id || requester_id !== req.user.userId) {
            const error = new Error("requester_id must be your own user id");
            error.status = 403;
            throw error;
        }
        const job = job_details && typeof job_details === "object" ? job_details : {};
        if (!mover_id) {
            const error = new Error("mover_id is required");
            error.status = 400;
            throw error;
        }
        const mover = await pool.query(
            "SELECT id, owner_id FROM movers WHERE id = $1 AND is_active = TRUE LIMIT 1",
            [mover_id]
        );
        if (!mover.rows.length) {
            const error = new Error("Mover not found");
            error.status = 404;
            throw error;
        }
        if (mover.rows[0].owner_id === req.user.userId) {
            const error = new Error("You cannot book your own moving service");
            error.status = 400;
            throw error;
        }
        const movingDate = typeof job.moving_date === "string" ? job.moving_date.trim() : "";
        const bookingId = randomUUID();
        await pool.query(
            `INSERT INTO mover_bookings (mover_id, customer_id, client_id, booking_date, moving_date,
                pickup_address, destination_address, drop_address, items_description, notes, id)
             VALUES ($1, $2, $2, CURRENT_DATE, $3, $4, $5, $5, $6, $7, $8)`,
            [
                mover.rows[0].id,
                req.user.userId,
                movingDate || null,
                job.pickup_address || null,
                job.drop_address || null,
                job.items_description || null,
                job.notes || null,
                bookingId
            ]
        );
        const result = await pool.query("SELECT * FROM mover_bookings WHERE id = $1", [bookingId]);
        if (mover.rows[0].owner_id) {
            await pool.query(
                `INSERT INTO notifications (id, user_id, type, actor_id, reference_id, title, body, message, data)
                 VALUES ($1, $2, 'mover_booking', $3, $4, 'New moving request', $5, $5, $6)`,
                [randomUUID(), mover.rows[0].owner_id, req.user.userId, bookingId,
                    job.pickup_address || "New booking", JSON.stringify({ booking_id: bookingId })]
            );
        }
        return result.rows[0];
    }
};

router.post("/:fn", async (req, res) => {
    try {
        const handler = handlers[req.params.fn];
        if (!handler) {
            return res.status(404).json({ success: false, message: `RPC "${req.params.fn}" is not implemented` });
        }
        const data = await handler(req);
        res.json(data === undefined ? null : data);
    } catch (error) {
        console.error(`RPC ${req.params.fn} error:`, error.message);
        res.status(error.status || 500).json({ success: false, message: error.message || "RPC failed" });
    }
});

module.exports = router;
