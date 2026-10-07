const jwt = require("jsonwebtoken");

function authenticateToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader) {
            return res.status(401).json({
                success: false,
                message: "Authentication required"
            });
        }

        const parts = authHeader.split(" ");

        if (parts.length !== 2 || parts[0] !== "Bearer") {
            return res.status(401).json({
                success: false,
                message: "Invalid authorization format"
            });
        }

        const token = parts[1];

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        req.user = decoded;

        next();

    } catch (error) {
        console.error("Authentication error:", error);

        return res.status(401).json({
            success: false,
            message: "Invalid or expired token"
        });
    }
}

function optionalAuthenticateToken(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if (authHeader) {
            const [scheme, token, ...extra] = authHeader.split(" ");
            if (scheme === "Bearer" && token && extra.length === 0) {
                req.user = jwt.verify(token, process.env.JWT_SECRET);
            }
        }
    } catch (_) {
        req.user = null;
    }

    next();
}

module.exports = authenticateToken;
module.exports.optional = optionalAuthenticateToken;