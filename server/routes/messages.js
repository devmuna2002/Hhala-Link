const express = require("express");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();
router.use(authenticateToken);

router.get("/", async (req, res) => {
    try {
        const rawIds = req.query.conversation_ids;
        const conversationIds = rawIds
            ? (Array.isArray(rawIds) ? rawIds : String(rawIds).split(","))
                .flatMap(value => String(value).split(","))
                .map(value => value.trim())
                .filter(Boolean)
            : null;
        const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
        if (conversationIds && (!conversationIds.length || conversationIds.length > 100 || conversationIds.some(id => !uuidPattern.test(id)))) {
            return res.status(400).json({ success: false, message: "Conversation IDs must be valid UUIDs (up to 100)" });
        }
        const limit = Number.parseInt(req.query.limit || "500", 10);
        if (!Number.isInteger(limit) || limit < 1) {
            return res.status(400).json({ success: false, message: "Limit must be a positive integer" });
        }
        const result = await pool.query(
            `SELECT m.*, m.message AS body FROM messages m
             WHERE ($1::uuid[] IS NULL OR m.conversation_id = ANY($1::uuid[]))
               AND EXISTS (
                   SELECT 1 FROM conversations c WHERE c.id = m.conversation_id
                     AND (c.participant_one = $2 OR c.participant_two = $2)
               )
             ORDER BY m.created_at DESC LIMIT $3`,
            [conversationIds, req.user.userId, Math.min(limit, 1000)]
        );
        res.json({ success: true, messages: result.rows });
    } catch (error) {
        console.error("List messages error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch messages" });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT m.*, m.message AS body
             FROM messages m JOIN conversations c ON c.id = m.conversation_id
             WHERE m.id = $1 AND (c.participant_one = $2 OR c.participant_two = $2)`,
            [req.params.id, req.user.userId]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Message not found" });
        res.json({ success: true, message: result.rows[0] });
    } catch (error) {
        console.error("Get message error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch message" });
    }
});

router.patch("/:id", async (req, res) => {
    try {
        if (req.body.status === "read") {
            const result = await pool.query(
                `UPDATE messages m SET is_read = TRUE, status = 'read'
                 FROM conversations c
                 WHERE m.id = $1 AND m.conversation_id = c.id AND m.sender_id <> $2
                   AND (c.participant_one = $2 OR c.participant_two = $2)
                 RETURNING m.*`,
                [req.params.id, req.user.userId]
            );
            if (!result.rows.length) return res.status(404).json({ success: false, message: "Message not found" });
            return res.json({ success: true, message: result.rows[0] });
        }

        const body = typeof req.body.body === "string" ? req.body.body.trim() : "";
        if (!body || body.length > 4000) {
            return res.status(400).json({ success: false, message: "Message must be between 1 and 4000 characters" });
        }
        const result = await pool.query(
            `UPDATE messages SET body = $1, message = $1, is_edited = TRUE
             WHERE id = $2 AND sender_id = $3 RETURNING *`,
            [body, req.params.id, req.user.userId]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Message not found or not editable" });
        res.json({ success: true, message: { ...result.rows[0], body: result.rows[0].message } });
    } catch (error) {
        console.error("Update message error:", error);
        res.status(500).json({ success: false, message: "Failed to update message" });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const result = await pool.query(
            `DELETE FROM messages m USING conversations c
             WHERE m.id = $1 AND m.sender_id = $2 AND m.conversation_id = c.id
               AND (c.participant_one = $2 OR c.participant_two = $2)
             RETURNING m.id`,
            [req.params.id, req.user.userId]
        );
        if (!result.rows.length) return res.status(404).json({ success: false, message: "Message not found or not removable" });
        res.json({ success: true });
    } catch (error) {
        console.error("Delete message error:", error);
        res.status(500).json({ success: false, message: "Failed to delete message" });
    }
});

module.exports = router;