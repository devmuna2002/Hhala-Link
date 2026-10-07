const http = require('http');
const fs = require('fs');
const path = require('path');

let webPush = null;
try { webPush = require('web-push'); } catch (e) { /* optional: push endpoints return 503 */ }

let pushConfig = null;
try {
    pushConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'push-config.json'), 'utf8'));
    if (webPush && pushConfig?.publicKey && pushConfig?.privateKey) {
        webPush.setVapidDetails(pushConfig.subject || 'mailto:munasheantonio1@gmail.com', pushConfig.publicKey, pushConfig.privateKey);
    }
} catch (e) { pushConfig = null; }

const MIME = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'text/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
    '.sql': 'text/plain',
    '.env': 'text/plain',
};

function readJsonBody(req, limit = 20000) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > limit) req.destroy(); });
        req.on('end', () => {
            try { resolve(JSON.parse(body || '{}')); }
            catch (e) { reject(e); }
        });
        req.on('error', reject);
    });
}

function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
    let url = req.url.split('?')[0];

    // ── Web Push public key (public by design) ──
    if (req.method === 'GET' && url === '/api/push-config') {
        if (!pushConfig?.publicKey) return sendJson(res, 503, { ok: false, error: 'push not configured' });
        return sendJson(res, 200, { ok: true, publicKey: pushConfig.publicKey });
    }

    // ── Web Push fan-out. Body: { subscriptions: [{endpoint,keys}], title, body, url } ──
    if (req.method === 'POST' && url === '/api/push-send') {
        if (!webPush || !pushConfig?.publicKey) return sendJson(res, 503, { ok: false, error: 'push not configured' });
        readJsonBody(req).then(async (msg) => {
            try {
                const subs = Array.isArray(msg.subscriptions) ? msg.subscriptions.slice(0, 10) : [];
                const title = String(msg.title || 'Hlala Link').slice(0, 120);
                const body  = String(msg.body || 'You have a new update.').slice(0, 500);
                const link  = String(msg.url || '/').slice(0, 200);
                let delivered = 0, failed = 0;
                for (const s of subs) {
                    if (!s || typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://') || !s.keys) { failed++; continue; }
                    try {
                        await webPush.sendNotification(s, JSON.stringify({ title, body, url: link }));
                        delivered++;
                    } catch (e) { failed++; }
                }
                console.log(`[push-send] delivered=${delivered} failed=${failed}`);
                sendJson(res, 200, { ok: true, delivered, failed });
            } catch (e) {
                sendJson(res, 400, { ok: false });
            }
        }).catch(() => sendJson(res, 400, { ok: false }));
        return;
    }

    // ── Background contact alert (WhatsApp). Called fire-and-forget by
    // the website contact form — never redirects the visitor.
    // Real delivery needs WhatsApp Cloud API credentials:
    //   set WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID env vars.
    // Without them, alerts are appended to contact-alerts-queue.jsonl.
    // Only the two shuffled support lines are accepted as recipients.
    if (req.method === 'POST' && url === '/api/contact-alert') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 20000) req.destroy(); });
        req.on('end', async () => {
            try {
                const msg  = JSON.parse(body || '{}');
                const to   = String(msg.to || '').replace(/\D/g, '');
                const text = String(msg.text || '').slice(0, 1000);
                const ALLOWED = ['263788118836', '263771179613'];
                if (!ALLOWED.includes(to) || !text) {
                    res.writeHead(400, { 'Content-Type': 'application/json' });
                    return res.end(JSON.stringify({ ok: false }));
                }
                const record = {
                    at: new Date().toISOString(),
                    to, text,
                    submissionId: msg.submissionId || null,
                    team: Array.isArray(msg.team) ? msg.team : [],
                };
                let sent = false;
                const token   = process.env.WHATSAPP_TOKEN;
                const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;
                if (token && phoneId) {
                    try {
                        const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
                            method: 'POST',
                            headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
                        });
                        sent = r.ok;
                        record.providerStatus = r.status;
                    } catch (e) { record.providerError = String(e.message || e); }
                }
                if (!sent) {
                    fs.appendFile('contact-alerts-queue.jsonl', JSON.stringify(record) + '\n', () => {});
                }
                console.log(`[contact-alert] to=${to} sent=${sent} queued=${!sent}`);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, sent, queued: !sent }));
            } catch (e) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: false }));
            }
        });
        return;
    }

    if (url === '/') url = '/index.html';
    const filePath = path.join(__dirname, url);
    const ext = path.extname(filePath).toLowerCase();

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/html' });
            res.end('<h1>404 Not Found</h1>');
            return;
        }
        res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
        res.end(data);
    });
});

// ── Auto-start Standalone Database Server (Port 8000) ───────────
try {
    require('./standalone-database/standalone-server.js');
} catch (e) {
    console.log('[Standalone DB] Note:', e.message);
}

server.listen(3000, () => {
    console.log('Frontend server running at http://localhost:3000');
    console.log('Standalone Database API at http://localhost:8000');
    console.log('Download page: http://localhost:3000/download.html');
});
