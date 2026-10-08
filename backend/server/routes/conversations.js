const express = require("express");
const { randomUUID } = require("node:crypto");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

router.get("/", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT c.*,
                    participant_a.id AS participant_a_profile_id,
                    participant_a.first_name AS participant_a_first_name,
                    participant_a.last_name AS participant_a_last_name,
                    participant_a.avatar_url AS participant_a_avatar_url,
                    participant_a.role AS participant_a_role,
                    participant_a.business_name AS participant_a_business_name,
                    participant_a.last_seen AS participant_a_last_seen,
                    participant_b.id AS participant_b_profile_id,
                    participant_b.first_name AS participant_b_first_name,
                    participant_b.last_name AS participant_b_last_name,
                    participant_b.avatar_url AS participant_b_avatar_url,
                    participant_b.role AS participant_b_role,
                    participant_b.business_name AS participant_b_business_name,
                    participant_b.last_seen AS participant_b_last_seen,
                    other.id AS other_user_id,
                    other.first_name AS other_user_first_name,
                    other.last_name AS other_user_last_name,
                    other.avatar_url AS other_user_avatar_url
             FROM conversations c
             JOIN profiles participant_a ON participant_a.id = c.participant_one
             JOIN profiles participant_b ON participant_b.id = c.participant_two
             JOIN profiles other ON other.id = CASE
                 WHEN c.participant_one = $1 THEN c.participant_two ELSE c.participant_one END
             WHERE c.participant_one = $1 OR c.participant_two = $1
             ORDER BY c.last_message_at DESC`,
            [req.user.userId]
        );

        if (!result.rows.length) {
            return res.json({ success: true, conversations: [] });
        }

        const conversationIds = result.rows.map(row => row.id);
        const placeholders = conversationIds.map((_, index) => `$${index + 1}`).join(", ");
        const recentMessages = await pool.query(
            `SELECT id, conversation_id, body, message, sender_id, status, is_read, is_edited, created_at
             FROM (
                 SELECT m.*, ROW_NUMBER() OVER (PARTITION BY m.conversation_id ORDER BY m.created_at DESC) AS message_rank
                 FROM messages m WHERE m.conversation_id IN (${placeholders})
             ) ranked
             WHERE message_rank <= 20
             ORDER BY conversation_id, created_at ASC`,
            conversationIds
        );
        const unreadCounts = await pool.query(
            `SELECT conversation_id, COUNT(*) AS unread_count FROM messages
             WHERE conversation_id IN (${placeholders}) AND sender_id <> $${conversationIds.length + 1} AND is_read = FALSE
             GROUP BY conversation_id`,
            [...conversationIds, req.user.userId]
        );
        const messagesByConversation = new Map();
        for (const message of recentMessages.rows) {
            const messages = messagesByConversation.get(message.conversation_id) || [];
            messages.push(message);
            messagesByConversation.set(message.conversation_id, messages);
        }
        const unreadByConversation = new Map(unreadCounts.rows.map(row => [row.conversation_id, Number(row.unread_count)]));
        const conversations = result.rows.map(row => {
            const messages = messagesByConversation.get(row.id) || [];
            const conversation = { ...row };
            conversation.participant_a_profile = {
                id: row.participant_a_profile_id,
                first_name: row.participant_a_first_name,
                last_name: row.participant_a_last_name,
                avatar_url: row.participant_a_avatar_url,
                role: row.participant_a_role,
                business_name: row.participant_a_business_name,
                last_seen: row.participant_a_last_seen
            };
            conversation.participant_b_profile = {
                id: row.participant_b_profile_id,
                first_name: row.participant_b_first_name,
                last_name: row.participant_b_last_name,
                avatar_url: row.participant_b_avatar_url,
                role: row.participant_b_role,
                business_name: row.participant_b_business_name,
                last_seen: row.participant_b_last_seen
            };
            conversation.other_user = {
                id: row.other_user_id,
                first_name: row.other_user_first_name,
                last_name: row.other_user_last_name,
                avatar_url: row.other_user_avatar_url
            };
            conversation.messages = messages;
            conversation.last_message = messages.length ? messages[messages.length - 1] : null;
            conversation.unread_count = unreadByConversation.get(row.id) || 0;
            for (const key of Object.keys(row)) {
                if (key.includes("_profile_") || key.startsWith("other_user_")) delete conversation[key];
            }
            return conversation;
        });

        res.json({ success: true, conversations });
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

        const conversationId = randomUUID();
        await pool.query(
            `INSERT INTO conversations (id, participant_one, participant_two, participant_a, participant_b, property_id)
             VALUES ($1, $2, $3, $2, $3, $4) ON DUPLICATE KEY UPDATE id = id`,
            [conversationId, req.user.userId, participant_id, property_id || null]
        );
        const result = await pool.query(
            `SELECT * FROM conversations
                         WHERE LEAST(participant_one, participant_two) = LEAST($1, $2)
                             AND GREATEST(participant_one, participant_two) = GREATEST($1, $2)
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
             AND ($2 IS NULL OR created_at < $2)
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
            const messageId = randomUUID();
            await client.query(
                `INSERT INTO messages (id, conversation_id, sender_id, body, message, status, is_read)
                 VALUES ($1, $2, $3, $4, $4, 'sent', FALSE)`,
                [messageId, req.params.id, req.user.userId, body]
            );
            const message = await client.query("SELECT * FROM messages WHERE id = $1", [messageId]);
            await client.query(
                "UPDATE conversations SET last_message_at = NOW() WHERE id = $1",
                [req.params.id]
            );
            await client.query(
                `INSERT INTO notifications (id, user_id, type, actor_id, reference_id, title, body, message, data)
                 VALUES ($1, $2, 'message', $3, $4, 'New message', $5, $5, $6)`,
                [randomUUID(), conversation.rows[0].recipient_id, req.user.userId, req.params.id, body.slice(0, 180), JSON.stringify({ conversation_id: req.params.id })]
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
                                     AND (c.participant_one = $2 OR c.participant_two = $2))`,
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
        await pool.query(
                 `UPDATE messages m SET body = $1, message = $1, is_edited = TRUE
             WHERE m.id = $2 AND m.conversation_id = $3 AND m.sender_id = $4
               AND EXISTS (SELECT 1 FROM conversations c WHERE c.id = m.conversation_id
                     AND (c.participant_one = $4 OR c.participant_two = $4))`,
            [body, req.params.messageId, req.params.id, req.user.userId]
        );
        const result = await pool.query(
            `SELECT m.* FROM messages m JOIN conversations c ON c.id = m.conversation_id
             WHERE m.id = $1 AND m.conversation_id = $2 AND m.sender_id = $3
               AND (c.participant_one = $3 OR c.participant_two = $3)`,
            [req.params.messageId, req.params.id, req.user.userId]
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
        const existing = await pool.query(
            `SELECT id FROM conversations WHERE id = $1
             AND (participant_one = $2 OR participant_two = $2)`,
            [req.params.id, req.user.userId]
        );
        if (!existing.rows.length) {
            return res.status(404).json({ success: false, message: "Conversation not found" });
        }
        await pool.query(
            `DELETE FROM conversations WHERE id = $1
             AND (participant_one = $2 OR participant_two = $2)`,
            [req.params.id, req.user.userId]
        );
        res.json({ success: true });
    } catch (error) {
        console.error("Delete conversation error:", error);
        res.status(500).json({ success: false, message: "Failed to delete conversation" });
    }
});

module.exports = router;