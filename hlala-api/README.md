# hlala-api — cPanel ready backend (MySQL only)

Clean copy of what runs on cPanel right now. Upload this folder's contents
into the cPanel **Setup Node.js App** application root (`hlala-api/`),
NOT inside `public_html`.

## What's inside

- `server.js` — Express API, startup file
- `db.js`, `mysql-query.js` — MySQL pool
- `routes/` — all `/api/*` + `/storage/*` routes
- `middleware/auth.js` — JWT auth
- `scripts/migrate.js` — auto-creates schema on boot
- `migrations/` + `schema_mysql.sql` — MySQL 8 / MariaDB 10.6 schema
- `uploads/.gitkeep` — placeholder. Real files live in `UPLOAD_DIR`
  (`/home/<user>/api-uploads`), outside the app folder.
- `.env.example` — copy values into Setup Node.js App > Environment Variables.
  Never upload a real `.env`.

Excluded on purpose (saves quota, avoids mixing backends):
`node_modules/`, `.env`, logs, `uploads/*` content, Postgres files,
one-off migration scripts, tests, Dockerfile.

## Deploy (matches backend/CPANEL.md)

1. Setup Node.js App > Application root `hlala-api`, startup file `server.js`,
   Node 20+, Production. Application URL `https://hlala.raisdaglobal.co.zw`.
2. Delete ALL old files in `hlala-api/` first if replacing a Postgres backend.
3. Upload `hlala-api-cpanel.zip` into `hlala-api/` > Extract > delete zip.
4. Run NPM Install from the app panel.
5. Set env vars: `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`,
   `MYSQL_PASSWORD`, `JWT_SECRET` (32+ bytes), `CORS_ORIGINS`,
   `UPLOAD_DIR=/home/<user>/api-uploads`, `DB_POOL_MAX=5`.
   Leave `PORT` unset (Passenger assigns it).
6. Start app. Test `https://hlala.raisdaglobal.co.zw/api/health` ->
   `{"success":true,...}`. On failure read `stderr.log` in app root.
