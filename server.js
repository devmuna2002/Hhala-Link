const http = require('http');
const fs = require('fs');
const path = require('path');

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
    '.sql': 'text/plain',
    '.env': 'text/plain',
};

const server = http.createServer((req, res) => {
    let url = req.url.split('?')[0];

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

server.listen(3000, () => {
    console.log('Server running at http://localhost:3000');
    console.log('Download page: http://localhost:3000/download.html');
});
