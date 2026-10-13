// Shared Expo push fan-out: every Activity-screen notification row should
// also arrive as a system push. Best-effort everywhere — these helpers
// never throw and must never fail the request that triggered them.
function extractExpoToken(stored) {
    if (!stored) return null;
    if (typeof stored === "string") {
        const trimmed = stored.trim();
        if (trimmed.startsWith("ExponentPushToken")) return trimmed;
        try {
            return extractExpoToken(JSON.parse(trimmed));
        } catch {
            return null;
        }
    }
    if (typeof stored === "object") {
        if (typeof stored.expo === "string" && stored.expo.startsWith("ExponentPushToken")) return stored.expo;
        if (typeof stored.token === "string" && stored.token.startsWith("ExponentPushToken")) return stored.token;
    }
    return null;
}

async function sendExpoPush({ token, title, body, data }) {
    if (!token) return null;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
        const response = await fetch("https://exp.host/--/api/v2/push/send", {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            body: JSON.stringify({
                to: token,
                sound: "default",
                title: String(title || "Hlala Link").slice(0, 100),
                body: String(body || "You have a new update.").slice(0, 500),
                data: data && typeof data === "object" && !Array.isArray(data) ? data : {},
                channelId: "default",
                priority: "high",
                ttl: 60
            }),
            signal: controller.signal
        });
        const result = await response.json().catch(() => null);
        const ticket = Array.isArray(result?.data) ? result.data[0] : result?.data;
        return ticket?.status === "ok" ? ticket : null;
    } catch {
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

// Resolve the recipient's stored token and push. Resolves the ticket on
// success, null when there is no token or delivery fails. Never throws.
async function pushToUser(pool, userId, { title, body, data }) {
    if (!pool || !userId) return null;
    try {
        const profile = await pool.query("SELECT push_token FROM profiles WHERE id = $1", [userId]);
        const token = extractExpoToken(profile.rows[0]?.push_token);
        if (!token) return null;
        return await sendExpoPush({ token, title, body, data });
    } catch (error) {
        console.error("Expo push failed:", error?.message || error);
        return null;
    }
}

// Bulk Expo fan-out for admin notification rows. Resolves
// { attempted, accepted }. Never throws — push failures must never roll
// back the inbox rows.
async function fanOutAdminPush(pool, rows) {
    const targets = (rows || []).filter((r) => r && r.user_id && String(r.message || r.body || r.title || "").trim());
    if (!targets.length) return { attempted: 0, accepted: 0 };
    const ids = [...new Set(targets.map((r) => String(r.user_id)))];
    let tokenByUser = new Map();
    try {
        const placeholders = ids.map((_, i) => `$${i + 1}`).join(", ");
        const tok = await pool.query("SELECT id, push_token FROM profiles WHERE id IN (" + placeholders + ")", ids);
        tokenByUser = new Map((tok.rows || []).map((r) => [String(r.id), r.push_token]));
    } catch (tokenError) {
        console.error("Admin push token lookup failed:", tokenError?.message || tokenError);
        return { attempted: 0, accepted: 0 };
    }
    const messages = [];
    for (const row of targets) {
        const token = extractExpoToken(tokenByUser.get(String(row.user_id)));
        if (!token) continue;
        const bodyText = String(row.message || row.body || "").trim() || String(row.title || "").trim();
        if (!bodyText) continue;
        let pushData = { type: row.type || "admin_broadcast", notificationId: row.id };
        try {
            const parsed = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) pushData = Object.assign({}, parsed, { notificationId: row.id });
        } catch (_) {}
        messages.push({
            to: token,
            sound: "default",
            title: String(row.title || "Hlala Link").slice(0, 120),
            body: bodyText.slice(0, 500),
            channelId: "default",
            priority: "high",
            ttl: 60,
            data: pushData,
        });
    }
    const attempted = messages.length;
    let accepted = 0;
    for (let i = 0; i < messages.length; i += 100) {
        const chunk = messages.slice(i, i + 100);
        try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 15000);
            let response;
            try {
                response = await fetch("https://exp.host/--/api/v2/push/send", {
                    method: "POST",
                    headers: { Accept: "application/json", "Content-Type": "application/json" },
                    body: JSON.stringify(chunk),
                    signal: controller.signal,
                });
            } finally {
                clearTimeout(timeout);
            }
            const payload = await response.json().catch(() => null);
            const tickets = Array.isArray(payload) ? payload : payload ? payload.data : null;
            const list = Array.isArray(tickets) ? tickets : tickets ? [tickets] : [];
            for (const ticket of list) {
                if (ticket && ticket.status === "ok") accepted += 1;
            }
        } catch (chunkError) {
            console.error("Admin push chunk failed:", chunkError?.message || chunkError);
        }
    }
    return { attempted, accepted };
}

module.exports = { extractExpoToken, sendExpoPush, pushToUser, fanOutAdminPush };
