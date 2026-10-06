const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

router.post('/push', async (req, res) => {
    try {
        const { recipientId, title, body, data = {} } = req.body || {};
        const notificationData = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
        let recipient;

        if (notificationData.type === 'message' && notificationData.conversationId) {
            const conversation = await pool.query(
                `SELECT CASE WHEN participant_one = $2 THEN participant_two ELSE participant_one END AS recipient_id
                 FROM conversations
                 WHERE id = $1 AND (participant_one = $2 OR participant_two = $2)
                   AND EXISTS (SELECT 1 FROM messages m WHERE m.conversation_id = conversations.id AND m.sender_id = $2)`,
                [notificationData.conversationId, req.user.userId]
            );
            recipient = conversation.rows[0]?.recipient_id;
        } else if (notificationData.propertyId) {
            const property = await pool.query(
                `SELECT p.owner_id AS recipient_id
                 FROM properties p
                 JOIN saved_properties sp ON sp.property_id = p.id AND sp.user_id = $2
                 WHERE p.id = $1 AND p.owner_id <> $2`,
                [notificationData.propertyId, req.user.userId]
            );
            recipient = property.rows[0]?.recipient_id;
        } else if (notificationData.type === 'mover_booking' && notificationData.bookingId) {
            const booking = await pool.query(
                `SELECT m.owner_id AS recipient_id
                 FROM mover_bookings b JOIN movers m ON m.id = b.mover_id
                 WHERE b.id = $1 AND b.client_id = $2`,
                [notificationData.bookingId, req.user.userId]
            );
            recipient = booking.rows[0]?.recipient_id;
        } else if (notificationData.type === 'mover_booking_update' && notificationData.bookingId) {
            const booking = await pool.query(
                `SELECT b.client_id AS recipient_id
                 FROM mover_bookings b JOIN movers m ON m.id = b.mover_id
                 WHERE b.id = $1 AND m.owner_id = $2 AND b.client_id = $3`,
                [notificationData.bookingId, req.user.userId, recipientId]
            );
            recipient = booking.rows[0]?.recipient_id;
        } else if (notificationData.type === 'application_decision' && notificationData.applicationId) {
            const application = await pool.query(
                `SELECT a.applicant_id AS recipient_id
                 FROM applications a JOIN properties p ON p.id = a.property_id
                 WHERE a.id = $1 AND p.owner_id = $2 AND a.applicant_id = $3
                   AND a.status IN ('approved', 'rejected')`,
                [notificationData.applicationId, req.user.userId, recipientId]
            );
            recipient = application.rows[0]?.recipient_id;
        }

        if (!recipient || recipient !== recipientId) {
            return res.status(403).json({ success: false, message: 'Push recipient is not authorized' });
        }
        if (typeof title !== 'string' || typeof body !== 'string' || !title.trim() || !body.trim()) {
            return res.status(400).json({ success: false, message: 'A title and body are required' });
        }

        const profile = await pool.query('SELECT push_token FROM profiles WHERE id = $1', [recipient]);
        const token = profile.rows[0]?.push_token;
        if (!token) return res.status(404).json({ success: false, message: 'Recipient has no push token' });

        const pushResponse = await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify({
                to: token,
                sound: 'default',
                title: title.trim().slice(0, 100),
                body: body.trim().slice(0, 500),
                data: notificationData,
                channelId: 'default',
                priority: 'high',
                ttl: 60,
            }),
        });
        const result = await pushResponse.json().catch(() => null);
        const ticket = Array.isArray(result?.data) ? result.data[0] : result?.data;
        if (!pushResponse.ok || ticket?.status !== 'ok') {
            return res.status(502).json({ success: false, message: ticket?.message || 'Push provider did not accept the notification' });
        }
        res.json({ success: true, ticket });
    } catch (error) {
        console.error('Push notification error:', error);
        res.status(502).json({ success: false, message: 'Could not send push notification' });
    }
});

router.get("/me", async (req, res) => {
    try {
        const limit = Number.parseInt(req.query.limit || "50", 10);
        if (!Number.isInteger(limit) || limit < 1) {
            return res.status(400).json({ success: false, message: "Limit must be a positive integer" });
        }
        const unreadOnly = req.query.unread === "true";
        const result = await pool.query(
            `SELECT n.*, n.message AS body,
                    CASE WHEN actor.id IS NULL THEN NULL ELSE json_build_object(
                        'id', actor.id, 'first_name', actor.first_name, 'last_name', actor.last_name,
                        'avatar_url', actor.avatar_url, 'role', actor.role, 'business_name', actor.business_name
                    ) END AS actor
             FROM notifications n
             LEFT JOIN profiles actor ON actor.id = n.actor_id
             WHERE n.user_id = $1
             AND ($2::boolean = FALSE OR is_read = FALSE)
             ORDER BY n.created_at DESC LIMIT $3`,
            [req.user.userId, unreadOnly, Math.min(limit, 100)]
        );
        const unread = await pool.query(
            "SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = FALSE",
            [req.user.userId]
        );
        res.json({ success: true, notifications: result.rows, unread_count: Number(unread.rows[0].count) });
    } catch (error) {
        console.error("List notifications error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch notifications" });
    }
});

router.patch("/read-all", async (req, res) => {
    try {
        const result = await pool.query(
            "UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND is_read = FALSE",
            [req.user.userId]
        );
        res.json({ success: true, updated: result.rowCount });
    } catch (error) {
        console.error("Mark notifications read error:", error);
        res.status(500).json({ success: false, message: "Failed to update notifications" });
    }
});

router.patch("/:id/read", async (req, res) => {
    try {
        const result = await pool.query(
            "UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2 RETURNING id",
            [req.params.id, req.user.userId]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }
        res.json({ success: true });
    } catch (error) {
        console.error("Mark notification read error:", error);
        res.status(500).json({ success: false, message: "Failed to update notification" });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const result = await pool.query(
            "DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id",
            [req.params.id, req.user.userId]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: "Notification not found" });
        }
        res.json({ success: true });
    } catch (error) {
        console.error("Delete notification error:", error);
        res.status(500).json({ success: false, message: "Failed to delete notification" });
    }
});

module.exports = router;