const express = require("express");
const { randomUUID } = require("node:crypto");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");
const { pushToUser } = require("../utils/expoPush");

const router = express.Router();


// =====================================================
// PUSH HELPERS (best-effort, never fail the request)
// =====================================================

// Writes the in-app Activity row AND attempts the Expo system push.
// Never throws — a failed push must never fail the request that triggered it.
async function notifyUserBestEffort({ userId, actorId, referenceId, type, title, body, data }) {
    if (!userId) return;
    try {
        await pool.query(
            `INSERT INTO notifications (id, user_id, type, actor_id, reference_id, title, body, message, data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $7, $8)`,
            [
                randomUUID(),
                userId,
                String(type || "general").slice(0, 64),
                actorId || null,
                referenceId ? String(referenceId).slice(0, 255) : null,
                String(title || "").slice(0, 255),
                String(body || "").slice(0, 2000),
                JSON.stringify(data || {})
            ]
        );
    } catch (error) {
        console.error("Notification row insert failed:", error?.message || error);
    }
    try {
        await pushToUser(pool, userId, { title, body, data });
    } catch (error) {
        console.error("Expo push failed:", error?.message || error);
    }
}


// =====================================================
// CREATE APPLICATION
// =====================================================

router.post("/", authenticateToken, async (req, res) => {
    try {
        const {
            property_id,
            message,
            move_in_date
        } = req.body;


        // Required field
        if (!property_id) {
            return res.status(400).json({
                success: false,
                message: "Property ID is required"
            });
        }


        // Check property exists
        const propertyCheck = await pool.query(
            `
            SELECT id, owner_id, title, status
            FROM properties
            WHERE id = $1
            `,
            [property_id]
        );


        if (propertyCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Property not found"
            });
        }


        const property = propertyCheck.rows[0];

        if (property.status !== "available") {
            return res.status(409).json({ success: false, message: "This property is not accepting applications" });
        }


        // Prevent owner from applying to own property
        if (property.owner_id === req.user.userId) {
            return res.status(400).json({
                success: false,
                message: "You cannot apply for your own property"
            });
        }


        // Check if user already applied
        const existingApplication = await pool.query(
            `
            SELECT id
            FROM applications
            WHERE property_id = $1
            AND applicant_id = $2
            `,
            [property_id, req.user.userId]
        );


        if (existingApplication.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "You have already applied for this property"
            });
        }


        // Create application
        const applicationId = randomUUID();
        await pool.query(
            `
            INSERT INTO applications (
                id,
                property_id,
                applicant_id,
                status,
                message,
                move_in_date
            )
            VALUES ($1, $2, $3, $4, $5, $6)
            `,
            [
                applicationId,
                property_id,
                req.user.userId,
                "pending",
                message || null,
                move_in_date || null
            ]
        );

        const result = await pool.query(
            "SELECT * FROM applications WHERE property_id = $1 AND applicant_id = $2",
            [property_id, req.user.userId]
        );

        const created = result.rows[0];

        // Owner gets an inbox row + system push even if the client-side
        // notifyUser call never fires (app closed, offline, token missing).
        notifyUserBestEffort({
            userId: property.owner_id,
            actorId: req.user.userId,
            referenceId: created?.id || applicationId,
            type: "application_received",
            title: "New application received",
            body: `${property.title || "Your listing"} — you have a new application.`,
            data: { type: "application_received", applicationId: created?.id || applicationId, propertyId: property_id }
        }).catch(() => {});

        res.status(201).json({
            success: true,
            message: "Application submitted successfully",
            application: result.rows[0]
        });

    } catch (error) {
        console.error("Create application error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to submit application"
        });
    }
});


// =====================================================
// GET MY APPLICATIONS
// =====================================================

router.get("/my", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `
            SELECT
                a.*,
                p.title AS property_title,
                p.price,
                p.currency,
                p.address,
                p.city,
                p.country
            FROM applications a
            JOIN properties p
                ON p.id = a.property_id
            WHERE a.applicant_id = $1
            ORDER BY a.created_at DESC
            `,
            [req.user.userId]
        );


        res.json({
            success: true,
            applications: result.rows
        });

    } catch (error) {
        console.error("Get my applications error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch applications"
        });
    }
});


// =====================================================
// GET APPLICATIONS FOR MY PROPERTIES
// =====================================================

router.get("/received", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `
            SELECT
                a.*,
                p.title AS property_title,
                p.price,
                p.currency,
                p.address,
                p.city,
                p.country,
                applicant.full_name AS applicant_name,
                applicant.email AS applicant_email,
                applicant.phone AS applicant_phone
            FROM applications a
            JOIN properties p
                ON p.id = a.property_id
            JOIN profiles applicant
                ON applicant.id = a.applicant_id
            WHERE p.owner_id = $1
            ORDER BY a.created_at DESC
            `,
            [req.user.userId]
        );


        res.json({
            success: true,
            applications: result.rows
        });

    } catch (error) {
        console.error("Get received applications error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch received applications"
        });
    }
});


// =====================================================
// GET ONE APPLICATION
// =====================================================

router.get("/:id", authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;


        const result = await pool.query(
            `
            SELECT
                a.*,
                p.title AS property_title,
                p.price,
                p.currency,
                p.address,
                p.city,
                p.country,
                p.owner_id,
                applicant.full_name AS applicant_name,
                applicant.email AS applicant_email,
                applicant.phone AS applicant_phone
            FROM applications a
            JOIN properties p
                ON p.id = a.property_id
            JOIN profiles applicant
                ON applicant.id = a.applicant_id
            WHERE a.id = $1
            AND (
                a.applicant_id = $2
                OR p.owner_id = $2
            )
            `,
            [id, req.user.userId]
        );


        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Application not found or you do not have permission to view it"
            });
        }


        res.json({
            success: true,
            application: result.rows[0]
        });

    } catch (error) {
        console.error("Get application error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to fetch application"
        });
    }
});


// =====================================================
// UPDATE APPLICATION STATUS
// =====================================================

router.put("/:id/status", authenticateToken, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;


        const allowedStatuses = [
            "pending",
            "reviewed",
            "approved",
            "rejected",
            "withdrawn"
        ];


        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid status. Use pending, reviewed, approved, rejected or withdrawn"
            });
        }


        // Check that current user owns the property
        const applicationCheck = await pool.query(
            `
            SELECT
                a.id,
                a.property_id,
                a.applicant_id,
                p.owner_id
            FROM applications a
            JOIN properties p
                ON p.id = a.property_id
            WHERE a.id = $1
            `,
            [id]
        );


        if (applicationCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Application not found"
            });
        }


        const application = applicationCheck.rows[0];


        // Only property owner can approve/reject
        if (
            application.owner_id !== req.user.userId &&
            status !== "withdrawn"
        ) {
            return res.status(403).json({
                success: false,
                message: "Only the property owner can update this application"
            });
        }


        // Applicant can only withdraw
        if (
            status === "withdrawn" &&
            application.applicant_id !== req.user.userId
        ) {
            return res.status(403).json({
                success: false,
                message: "Only the applicant can withdraw this application"
            });
        }


        await pool.query(
            `
            UPDATE applications
            SET
                status = $1,
                updated_at = NOW()
            WHERE id = $2
            `,
            [status, id]
        );

        const result = await pool.query("SELECT * FROM applications WHERE id = $1", [id]);

        const updated = result.rows[0];

        // Applicant gets an inbox row + system push straight from the server,
        // so the decision lands even when the owner's client-side push fails.
        if (updated && ["approved", "rejected", "reviewed"].includes(status)) {
            const notifType =
                status === "approved" ? "application_approved" :
                status === "rejected" ? "application_rejected" : "application_received";
            notifyUserBestEffort({
                userId: application.applicant_id,
                actorId: req.user.userId,
                referenceId: id,
                type: notifType,
                title: status === "approved" ? "Application approved"
                    : status === "rejected" ? "Application update" : "Application reviewed",
                body: status === "approved"
                    ? "Good news! Your application was approved. The agent will be in touch shortly."
                    : status === "rejected"
                        ? "Your application was not successful this time. Keep exploring other listings."
                        : "The agent reviewed your application.",
                data: { type: "application_decision", applicationId: id }
            }).catch(() => {});
        }

        res.json({
            success: true,
            message: "Application status updated successfully",
            application: result.rows[0]
        });

    } catch (error) {
        console.error("Update application status error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to update application status"
        });
    }
});


module.exports = router;