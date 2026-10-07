# Hlala Link API — cPanel deployment (Node.js app + Supabase Postgres)

This backend is **PostgreSQL-only** (190+ parameterized queries, `RETURNING`,
`jsonb`, pg enums). cPanel's MySQL/phpMyAdmin **cannot** run it, so the
database stays on Supabase Postgres and cPanel hosts only the Node.js API.
That is a standard, supported setup.

## 0. What you need

- cPanel with **Setup Node.js App** (CloudLinux) and Node **20+**
- A domain with SSL, e.g. `api.yourdomain.com` (subdomain recommended)
- Your Supabase project (free tier is fine)

## 1. Supabase — get the connection string

1. Supabase Dashboard > your project > **Project Settings > Database**.
2. Under **Connection string**, choose **Transaction pooler (port 6543)**,
   copy the URI. It looks like:
   `postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?sslmode=require`
3. Supabase accepts connections from any IP by default — nothing to allowlist.
4. Schema is already managed by the app: on startup it applies
   `schema_postgres.sql` (first boot) plus `migrations/001_api_compatibility.sql`.

## 2. cPanel — create the Node.js app

1. **Subdomains** > create `api` (document root is irrelevant for a Node app,
   e.g. `public_html/api` — the app runs separately).
2. **Setup Node.js App** > **Create Application**:
   - Node.js version: **20** (or higher)
   - Application mode: **production**
   - Application root: e.g. `hlala-api` (a folder in your home dir, NOT inside
     `public_html`)
   - Application URL: `https://api.yourdomain.com`
   - Application startup file: `server.js`
3. Upload `hlala-link-api-cpanel.zip` (see §4) into the application root and
   **Extract** it there, so `server.js` sits at the root of `hlala-api/`.
4. In the app panel, **Run NPM Install** (installs `express`, `pg`,
   `bcryptjs`, `jsonwebtoken`, `cors`, `dotenv` — all pure JS, no compiler
   needed).
5. **Environment Variables** (do NOT upload your local `.env`):
   - `DATABASE_URL` = the pooler URI from step 1
   - `JWT_SECRET` = a fresh random string, min 32 bytes. PowerShell:
     `[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Max 256 }))`
   - `CORS_ORIGINS` = `https://yourdomain.com` (your frontend origin)
   - `NODE_ENV` = `production`
   - `DB_POOL_MAX` = `5` (shared hosting: keep the pool small)
   - `UPLOAD_DIR` = `/home/<your-cpanel-user>/api-uploads` (outside
     `public_html` so uploads aren't directly web-accessible)
   - Leave `PORT` unset — Passenger assigns it.
6. **Start** (or Restart) the app.

## 3. Verify

- `GET https://api.yourdomain.com/api/health` should return
  `{"success":true,"message":"Hlala Link backend is running",...}`.
- First boot runs the schema + compatibility migration automatically; check
  the app's **stderr.log** if health reports a DB failure.
- Point your frontend at `https://api.yourdomain.com` and make sure that exact
  origin is in `CORS_ORIGINS`.

## 4. The upload package

`hlala-link-api-cpanel.zip` (next to this file) contains `server/` ready to
extract as the application root:

- `server.js`, `routes/`, `middleware/`, `scripts/`, `db.js`
- `schema_postgres.sql`, `migrations/`
- `package.json` + `package-lock.json`

Excluded on purpose: `node_modules/` (reinstalled on the server),
`uploads/` (recreated at runtime under `UPLOAD_DIR`), and `.env`
(secrets must be entered in cPanel, never shipped in a zip).

## 5. Notes / gotchas

- Auth uses `bcryptjs` (pure JS), chosen deliberately: native `bcrypt` needs a
  C++ build toolchain that shared cPanel hosts don't have.
- `db.js` enables TLS automatically whenever `DATABASE_URL` is set, which is
  what Supabase requires.
- Passenger may take 30–60s to boot the app on first request — that is normal.
- Never expose `JWT_SECRET` or `DATABASE_URL` in git, screenshots, or support
  tickets.
