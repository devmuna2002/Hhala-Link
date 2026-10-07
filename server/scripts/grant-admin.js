require("dotenv").config();
const pool = require("../db");

async function grantAdmin() {
    const email = String(process.argv[2] || "").trim().toLowerCase();
    if (!email) {
        console.error("Usage: npm run admin:grant -- <existing-account-email>");
        process.exitCode = 2;
        return;
    }

    try {
        const result = await pool.query(
            `UPDATE profiles
             SET role = 'admin', approval_status = 'approved', is_approved = TRUE,
                 approved_at = COALESCE(approved_at, NOW()), updated_at = NOW()
             WHERE LOWER(email) = $1
             RETURNING id, email, role, approval_status`,
            [email]
        );
        if (!result.rows.length) {
            console.error(`No existing profile found for ${email}. Register the account first.`);
            process.exitCode = 1;
            return;
        }
        console.log(`Admin access granted to ${result.rows[0].email} (${result.rows[0].id}). Sign out and back in to refresh the token.`);
    } catch (error) {
        console.error("Could not grant admin access:", error.message);
        process.exitCode = 1;
    } finally {
        await pool.end();
    }
}

grantAdmin();