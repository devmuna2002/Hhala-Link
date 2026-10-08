// One-off: pull listing media out of the database / Supabase storage into
// plain files for cPanel UPLOAD_DIR, and emit the URL-rewrite SQL.
//   $env:SOURCE_DATABASE_URL="postgresql://..."  (Supabase pooler)
//   $env:MEDIA_OUT="C:\path\to\api-uploads-media"  (file tree root)
//   $env:MEDIA_SQL="C:\path\to\media-urls.sql"     (UPDATE statements)
//   node scripts/migrate-media-to-cpanel.js
// Then: upload the tree into /home/<user>/api-uploads/ (merge) and run the
// SQL in phpMyAdmin.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { Pool } = require("pg");

const API_ORIGIN = process.env.API_ORIGIN || "https://hlala.raisdaglobal.co.zw";
const outRoot = process.env.MEDIA_OUT || path.join(os.tmpdir(), "hlala-api-uploads");
const sqlOut = process.env.MEDIA_SQL || path.join(os.tmpdir(), "hlala-media-urls.sql");

function esc(value) {
    return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}
function publicUrl(bucket, objectPath) {
    return `${API_ORIGIN}/storage/v1/object/public/${bucket}/${objectPath}`;
}

async function main() {
    if (!process.env.SOURCE_DATABASE_URL) throw new Error("Set SOURCE_DATABASE_URL first.");
    const source = new Pool({
        connectionString: process.env.SOURCE_DATABASE_URL,
        ssl: { rejectUnauthorized: false }
    });
    const updates = [];
    try {
        const images = await source.query(
            "SELECT id, property_id, url, storage_path FROM property_images ORDER BY property_id, sort_order");
        for (const row of images.rows) {
            const objectPath = `${row.property_id}/${row.id}`;
            if (row.url.startsWith("data:")) {
                const match = row.url.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.*)$/s);
                if (!match) throw new Error(`Image ${row.id} is not decodable base64`);
                const ext = match[1] === "image/jpeg" ? "jpg" : match[1] === "image/png" ? "png" : "bin";
                const filePath = `${objectPath}.${ext}`;
                const dir = path.join(outRoot, "properties", String(row.property_id));
                fs.mkdirSync(dir, { recursive: true });
                fs.writeFileSync(path.join(dir, `${row.id}.${ext}`), Buffer.from(match[2], "base64"));
                updates.push(`UPDATE \`property_images\` SET \`url\` = ${esc(publicUrl("properties", filePath))}, \`storage_path\` = ${esc(filePath)} WHERE \`id\` = ${esc(row.id)};`);
                console.log(`decoded ${row.id} -> properties/${filePath}`);
            } else if (/^https?:\/\//.test(row.url)) {
                const fileName = decodeURIComponent(row.url.split("/").pop().split("?")[0]) || `${row.id}.bin`;
                const filePath = `${row.property_id}/${row.id}-${fileName}`;
                const dir = path.join(outRoot, "properties", String(row.property_id));
                fs.mkdirSync(dir, { recursive: true });
                let response;
                try {
                    response = await fetch(row.url);
                    if (!response.ok) throw new Error(`Download ${response.status}`);
                } catch (error) {
                    console.log(`SKIP ${row.id} (${error.message}); keeping existing URL`);
                    continue;
                }
                fs.writeFileSync(path.join(dir, `${row.id}-${fileName}`), Buffer.from(await response.arrayBuffer()));
                updates.push(`UPDATE \`property_images\` SET \`url\` = ${esc(publicUrl("properties", filePath))}, \`storage_path\` = ${esc(filePath)} WHERE \`id\` = ${esc(row.id)};`);
                console.log(`downloaded ${row.id} -> properties/${filePath}`);
            } else {
                console.log(`kept ${row.id} (already a path or empty)`);
            }
        }
        const avatars = await source.query(
            "SELECT id, avatar_url FROM profiles WHERE avatar_url LIKE 'http%'");
        for (const row of avatars.rows) {
            const fileName = decodeURIComponent(row.avatar_url.split("/").pop().split("?")[0]) || "avatar.jpg";
            const filePath = `${row.id}/${fileName}`;
            const dir = path.join(outRoot, "avatars", String(row.id));
            fs.mkdirSync(dir, { recursive: true });
            let response;
            try {
                response = await fetch(row.avatar_url);
                if (!response.ok) throw new Error(`Download ${response.status}`);
            } catch (error) {
                console.log(`SKIP avatar ${row.id} (${error.message}); keeping existing URL`);
                continue;
            }
            fs.writeFileSync(path.join(dir, fileName), Buffer.from(await response.arrayBuffer()));
            updates.push(`UPDATE \`profiles\` SET \`avatar_url\` = ${esc(publicUrl("avatars", filePath))} WHERE \`id\` = ${esc(row.id)};`);
            console.log(`downloaded avatar ${row.id} -> avatars/${filePath}`);
        }
    } finally {
        await source.end();
    }
    fs.writeFileSync(sqlOut, updates.join("\n") + "\n");
    console.log(`Wrote ${updates.length} UPDATEs to ${sqlOut}`);
}

if (require.main === module) {
    main().catch(error => {
        console.error("Media migration stopped:", error.message.split("\n")[0]);
        process.exitCode = 1;
    });
}

module.exports = { main };
