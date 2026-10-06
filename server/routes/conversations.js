const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.*,
                    json_build_object('id', participant_a.id, 'first_name', participant_a.first_name,
                        'last_name', participant_a.last_name, 'avatar_url', participant_a.avatar_url,
                        'role', participant_a.role, 'business_name', participant_a.business_name,
                        'last_seen', participant_a.last_seen) AS participant_a_profile,
                    json_build_object('id', participant_b.id, 'first_name', participant_b.first_name,
                        'last_name', participant_b.last_name, 'avatar_url', participant_b.avatar_url,
                        'role', participant_b.role, 'business_name', participant_b.business_name,
                        'last_seen', participant_b.last_seen) AS participant_b_profile,
                    json_build_object('id', other.id, 'first_name', other.first_name,
                        'last_name', other.last_name, 'avatar_url', other.avatar_url) AS other_user,
                    COALESCE((SELECT json_agg(preview ORDER BY preview.created_at ASC) FROM (
                        SELECT body, message, sender_id, status, is_read, created_at FROM messages
                        WHERE conversation_id = c.id ORDER BY created_at DESC LIMIT 20
                    ) preview), '[]'::json) AS messages,
                    (SELECT row_to_json(m) FROM (
                        SELECT id, sender_id, body, message, status, is_read, created_at
                        FROM messages WHERE conversation_id = c.id
                        ORDER BY created_at DESC LIMIT 1
                    ) m) AS last_message,
                    (SELECT COUNT(*) FROM messages
                     WHERE conversation_id = c.id AND sender_id <> $1 AND is_read = FALSE) AS unread_count
             FROM conversations c
             JOIN profiles participant_a ON participant_a.id = c.participant_one
             JOIN profiles participant_b ON participant_b.id = c.participant_two
             JOIN profiles other ON other.id = CASE
                 WHEN c.participant_one = $1 THEN c.participant_two ELSE c.participant_one END
             WHERE c.participant_one = $1 OR c.participant_two = $1
             ORDER BY c.last_message_at DESC`,
            [req.user.userId]
        );

        res.json({ success: true, conversations: result.rows });
    } catch (error) {
        console.error("List conversations error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch conversations" });
    }
});

router.post("/", async (req, res) => {
    try {
        const { participant_id, property_id } = req.body;
        if (!participant_id || participant_id === req.user.userId) {
            return res.status(400).json({ success: false, message: "A different participant is required" });
        }

        if (property_id) {
            const property = await pool.query("SELECT owner_id FROM properties WHERE id = $1", [property_id]);
            if (!property.rows.length) {
                return res.status(404).json({ success: false, message: "Property not found" });
            }
            if (property.rows[0].owner_id !== participant_id) {
                return res.status(400).json({ success: false, message: "Participant must own the selected property" });
            }
        }

        const participantExists = await pool.query("SELECT id FROM profiles WHERE id = $1", [participant_id]);
        if (!participantExists.rows.length) {
            return res.status(404).json({ success: false, message: "Participant not found" });
        }

        await pool.query(
            `INSERT INTO conversations (participant_one, participant_two, participant_a, participant_b, property_id)
             VALUES ($1, $2, $1, $2, $3) ON CONFLICT DO NOTHING`,
            [req.user.userId, participant_id, property_id || null]
        );
        const result = await pool.query(
            `SELECT * FROM conversations
                         WHERE LEAST(participant_one, participant_two) = LEAST($1::uuid, $2::uuid)
                             AND GREATEST(participant_one, participant_two) = GREATEST($1::uuid, $2::uuid)
                         ORDER BY created_at LIMIT 1`,
            [req.user.userId, participant_id]
        );

        res.status(201).json({ success: true, conversation: result.rows[0] });
    } catch (error) {
        console.error("Create conversation error:", error);
        res.status(500).json({ success: false, message: "Failed to create conversation" });
    }
});

router.get("/:id/messages", async (req, res) => {
    try {
        const limit = Number.parseInt(req.query.limit || "50", 10);
        const before = req.query.before;
        if (!Number.isInteger(limit) || limit < 1 || (before && Number.isNaN(Date.parse(before)))) {
            return res.status(400).json({ success: false, message: "Invalid message pagination" });
        }

        const member = await pool.query(
            "SELECT id FROM conversations WHERE id = $1 AND (participant_one = $2 OR participant_two = $2)",
            [req.params.id, req.user.userId]
        );
        if (!member.rows.length) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        const result = await pool.query(
            `SELECT *, message AS body FROM messages WHERE conversation_id = $1
             AND ($2::timestamptz IS NULL OR created_at < $2)
             ORDER BY created_at DESC LIMIT $3`,
            [req.params.id, before || null, Math.min(limit, 100)]
        );
        res.json({ success: true, messages: result.rows.reverse() });
    } catch (error) {
        console.error("Get messages error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch messages" });
    }
});

router.post("/:id/messages", async (req, res) => {
    try {
        const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
        if (!body || body.length > 4000) {
            return res.status(400).json({ success: false, message: "Message must be between 1 and 4000 characters" });
        }

        const conversation = await pool.query(
            `SELECT id, CASE WHEN participant_one = $2 THEN participant_two ELSE participant_one END AS recipient_id
             FROM conversations WHERE id = $1 AND (participant_one = $2 OR participant_two = $2)`,
            [req.params.id, req.user.userId]
        );
        if (!conversation.rows.length) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            const message = await client.query(
                `INSERT INTO messages (conversation_id, sender_id, body, message, status, is_read)
                 VALUES ($1, $2, $3, $3, 'sent', FALSE) RETURNING *`,
                [req.params.id, req.user.userId, body]
            );
            await client.query(
                "UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1",
                [req.params.id]
            );
            await client.query(
                `INSERT INTO notifications (user_id, type, actor_id, reference_id, title, body, message, data)
                 VALUES ($1, 'message', $2, $3, 'New message', $4, $4, $5::jsonb)`,
                [conversation.rows[0].recipient_id, req.user.userId, req.params.id, body.slice(0, 180), JSON.stringify({ conversation_id: req.params.id })]
            );
            await client.query("COMMIT");
            res.status(201).json({ success: true, message: message.rows[0] });
        } catch (error) {
            await client.query("ROLLBACK");
            throw error;
        } finally {
            client.release();
        }
    } catch (error) {
        console.error("Send message error:", error);
        res.status(500).json({ success: false, message: "Failed to send message" });
    }
});

router.patch("/:id/read", async (req, res) => {
    try {
        const result = await pool.query(
                        `UPDATE messages SET status = 'read', is_read = TRUE
                         WHERE conversation_id = $1 AND sender_id <> $2 AND is_read = FALSE
                             AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = $1
                                     AND (c.participant_one = $2 OR c.participant_two = $2))
             RETURNING id`,
            [req.params.id, req.user.userId]
        );
        res.json({ success: true, updated: result.rowCount });
    } catch (error) {
        console.error("Mark messages read error:", error);
        res.status(500).json({ success: false, message: "Failed to update messages" });
    }
});

router.patch("/:id/messages/:messageId", async (req, res) => {
    try {
        const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
        if (!body || body.length > 4000) {
            return res.status(400).json({ success: false, message: "Message must be between 1 and 4000 characters" });
        }
        const result = await pool.query(
                 `UPDATE messages m SET body = $1, message = $1, is_edited = TRUE
             WHERE m.id = $2 AND m.conversation_id = $3 AND m.sender_id = $4
               AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = m.conversation_id
                     AND (c.participant_one = $4 OR c.participant_two = $4))
             RETURNING m.*`,
            [body, req.params.messageId, req.params.id, req.user.userId]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: "Message not found or not editable" });
        }
        res.json({ success: true, message: result.rows[0] });
    } catch (error) {
        console.error("Edit message error:", error);
        res.status(500).json({ success: false, message: "Failed to edit message" });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM conversations WHERE id = $1
             AND (participant_one = $2 OR participant_two = $2) RETURNING id`,
            [req.params.id, req.user.userId]
        );
        if (!result.rows.length) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }
        res.json({ success: true });
    } catch (error) {
        console.error("Delete conversation error:", error);
        res.status(500).json({ success: false, message: "Failed to delete conversation" });
    }
});

module.exports = router;