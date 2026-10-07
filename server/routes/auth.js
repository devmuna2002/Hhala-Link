const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const pool = require("../db");
const authenticateToken = require("../middleware/auth");

const router = express.Router();


// ===============================
// REGISTER
// ===============================

router.post("/register", async (req, res) => {
    try {
        const {
            email,
            password,
            first_name,
            last_name,
            phone_number,
            role,
            city,
            vehicle_details
        } = req.body;

        if (!email || !password || !first_name) {
            return res.status(400).json({
                success: false,
                message: "Email, password and first name are required"
            });
        }

        const normalizedEmail = String(email).trim().toLowerCase();
        const normalizedRole = role || "tenant";
        if (typeof password !== "string" || password.length < 8) {
            return res.status(400).json({ success: false, message: "Password must be at least 8 characters" });
        }
        if (!["tenant", "landlord", "agent", "mover"].includes(normalizedRole)) {
            return res.status(400).json({ success: false, message: "Invalid account role" });
        }

        // Check if email already exists
        const existingUser = await pool.query(
            "SELECT id FROM profiles WHERE email = $1",
            [normalizedEmail]
        );

        if (existingUser.rows.length > 0) {
            return res.status(409).json({
                success: false,
                message: "An account with this email already exists"
            });
        }

        // Hash password
        const passwordHash = await bcrypt.hash(password, 12);

        // Create user
        const result = await pool.query(
            `
            INSERT INTO profiles
            (email, password_hash, full_name, phone, first_name, last_name, phone_number, role, city, vehicle_details, approval_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
            RETURNING id, email, full_name, phone, first_name, last_name, phone_number, role, city, vehicle_details, approval_status, created_at
            `,
            [
                normalizedEmail,
                passwordHash,
                `${first_name} ${last_name || ""}`.trim(),
                phone_number || null,
                first_name,
                last_name || "",
                phone_number || null,
                normalizedRole,
                city || "Harare",
                JSON.stringify(vehicle_details || null),
                ["agent", "mover"].includes(normalizedRole) ? "pending" : "approved"
            ]
        );

        const user = result.rows[0];
        await pool.query(
            `INSERT INTO subscriptions (user_id, plan, status, price_usd, max_listings)
             VALUES ($1, 'free', 'active', 0, 1)
             ON CONFLICT DO NOTHING`,
            [user.id]
        );

        // Create JWT token
        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        res.status(201).json({
            success: true,
            message: "Account created successfully",
            user,
            token
        });

    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


// ===============================
// LOGIN
// ===============================

router.post("/login", async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                success: false,
                message: "Email and password are required"
            });
        }

        const result = await pool.query(
            `SELECT * FROM profiles WHERE email = $1`,
            [String(email).trim().toLowerCase()]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const user = result.rows[0];

        if (!user.password_hash) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        const passwordMatch = await bcrypt.compare(password, user.password_hash);

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "Invalid email or password"
            });
        }

        // Update last_seen
        await pool.query("UPDATE profiles SET last_seen = NOW() WHERE id = $1", [user.id]);

        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );

        delete user.password_hash;

        res.json({
            success: true,
            message: "Login successful",
            user,
            token
        });

    } catch (error) {
        console.error("Login error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});

router.get("/session", authenticateToken, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, email, full_name, first_name, last_name, phone, phone_number,
                    role, city, avatar_url, business_name, approval_status, is_active
             FROM profiles WHERE id = $1`,
            [req.user.userId]
        );
        if (!result.rows.length) {
            return res.status(401).json({ success: false, message: "Session profile no longer exists" });
        }
        const user = result.rows[0];
        const token = jwt.sign(
            { userId: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "7d" }
        );
        res.json({ success: true, user, token });
    } catch (error) {
        console.error("Session refresh error:", error);
        res.status(500).json({ success: false, message: "Could not refresh session" });
    }
});


// ===============================
// CHANGE PASSWORD
// ===============================

router.post("/change-password", authenticateToken, async (req, res) => {
    try {
        const { current_password, new_password } = req.body;
        if (!current_password || !new_password) {
            return res.status(400).json({ success: false, message: "Both current and new password are required" });
        }
        if (typeof new_password !== "string" || new_password.length < 8) {
            return res.status(400).json({ success: false, message: "New password must be at least 8 characters" });
        }

        const result = await pool.query("SELECT password_hash FROM profiles WHERE id = $1", [req.user.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        const match = await bcrypt.compare(current_password, result.rows[0].password_hash);
        if (!match) {
            return res.status(401).json({ success: false, message: "Current password is incorrect" });
        }

        const newHash = await bcrypt.hash(new_password, 12);
        await pool.query("UPDATE profiles SET password_hash = $1 WHERE id = $2", [newHash, req.user.userId]);

        res.json({ success: true, message: "Password changed successfully" });

    } catch (error) {
        console.error("Change password error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});


module.exports = router;