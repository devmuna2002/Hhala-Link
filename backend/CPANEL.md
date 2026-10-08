# Deploy the MySQL API on cPanel

This API is **MySQL-only**. Do not point it at PostgreSQL/Supabase at runtime;
Supabase is only the one-off *source* for the data import below.

## Requirements

- cPanel **Setup Node.js App** with Node.js **20+** (tested on 20.20.2).
- MySQL 8.0+ or MariaDB 10.6+ (the schema uses JSON columns and generated
  columns). Check the version on phpMyAdmin's home page under "Server version".
- The Node app must be able to reach MySQL on `localhost:3306` (standard when
  app and DB live on the same cPanel account).

## 1. Create the database

1. cPanel **Manage My Databases**: create a database and a database user.
2. Add the user to the database with ALL PRIVILEGES.
3. Note the full prefixed names (cPanel prefixes them, e.g.
   `hlala_hlala_link`). Use the complete values everywhere below.

## 2. Create the Node.js app

1. **Setup Node.js App** > Create Application, mode **Production**, Node 20+.
2. **Application root**: e.g. `hlala-api` (a folder in your home directory, NOT
   inside `public_html`). **Startup file**: `server.js`.
3. **Application URL**: your API subdomain with SSL, e.g.
   `https://hlala.raisdaglobal.co.zw` (path box empty).
4. Upload `hlala-link-api-mysql-cpanel.zip` into the application root and
   **Extract** it so `server.js` sits directly inside `hlala-api/`. Delete the
   zip afterwards. If an older (PostgreSQL) backend is already there, delete
   ALL of its files first — do not mix the two.
5. **Run NPM Install** from the app panel.

## 3. Set environment variables

Add each in the app's Environment Variables section:

| Variable | Value |
| --- | --- |
| `MYSQL_HOST` | `localhost` (same account) |
| `MYSQL_PORT` | `3306` |
| `MYSQL_DATABASE` | Full prefixed DB name |
| `MYSQL_USER` | Full prefixed DB username |
| `MYSQL_PASSWORD` | The MySQL user's password |
| `JWT_SECRET` | Fresh random secret, min 32 bytes (generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`) |
| `CORS_ORIGINS` | Exact frontend origin(s), comma-separated, e.g. `https://raisdaglobal.co.zw,https://www.raisdaglobal.co.zw` |
| `UPLOAD_DIR` | `/home/<user>/api-uploads` (outside `public_html`) |
| `DB_POOL_MAX` | `5` |

Leave `PORT` unset (Passenger assigns it). **Start** the app. First boot creates
the schema automatically. Test `https://<api-domain>/api/health` — expect
`{"success":true,...}`. If it fails, read `stderr.log` in the app root; boot
lines start with `[db]` / `[boot]`.

## 4. Import live data from Supabase (one-off, from your own computer)

The importer refuses non-empty targets and rolls back on failure. Nothing in
Supabase is modified.

1. cPanel **Remote MySQL**: add your computer's public IP so the importer can
   reach cPanel MySQL from home. (Find your IP via any "what is my ip" site.)
2. In `backend/server/`, set (PowerShell `$env:` or a local `.env` — never
   commit these):
   - `SOURCE_DATABASE_URL` = Supabase pooler URI
     (`postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres`,
     percent-encode special chars in the password).
   - `MYSQL_URL` = `mysql://[cpanel-user]:[password]@[server-host-or-ip]:3306/[database]`.
     Use the cPanel server's hostname/IP, not `localhost`.
3. Run `npm run migrate:postgres-to-mysql` from `backend/server/`.
4. Verify counts, then remove your IP from Remote MySQL again.
5. Sign-in test with a real account, then switch frontend API URLs to the new
   backend. Uploaded files live outside the database — copy them into
   `UPLOAD_DIR` separately.

Do not switch frontends to the new API or delete anything until users,
listings, messages, bookings, reviews, and media are verified against MySQL.
