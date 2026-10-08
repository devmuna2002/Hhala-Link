# MySQL API Server

This Express service connects to MySQL 8.0+ or MariaDB 10.6+ through `MYSQL_URL` or `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD`. `JWT_SECRET` must contain at least 32 bytes. `UPLOAD_DIR` optionally selects persistent file storage, and `CORS_ORIGINS` accepts a comma-separated list of browser origins.

## Self-hosted deployment

The provider-neutral Docker/VPS configuration is in [`../deploy`](../deploy/DEPLOYMENT.md). It runs MySQL, this API, and Caddy for HTTPS. The database is not published on a public port; MySQL and uploaded files use persistent Docker volumes.

For local development, copy `.env.example` to `.env`, set the MySQL and JWT values, then run:

```powershell
npm start --prefix server
```

The API creates or updates the MySQL tables on startup. To initialize them manually:

```powershell
npm run migrate
```

## Move existing PostgreSQL data

The PostgreSQL database is not modified by the application or importer. Before switching clients, back up the Railway database and uploaded files. Create a new, empty MySQL 8.0+ or MariaDB 10.6+ database, then configure `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, and `MYSQL_PASSWORD` for it.

The importer copies the API tables in foreign-key order and refuses to start if target tables already contain data or expected source tables/columns are missing. First create the MySQL schema with `npm run migrate`, then set these variables in a private local environment file:

```text
SOURCE_DATABASE_URL=<Railway PostgreSQL public connection URL>
MYSQL_URL=<cPanel MySQL connection URL>
```

Use Railway's public TCP proxy URL for `SOURCE_DATABASE_URL`; its private `.railway.internal` hostname is reachable only from Railway services. Keep both URLs private. From `server/`, run:

```sh
npm run migrate:postgres-to-mysql
```

Review the per-table migrated row counts and verify user sign-in, listings, conversations, bookings, and reviews before changing the production API connection. Move uploaded media separately; database rows alone do not transfer files.

The health endpoint is `/api/health`. The API includes auth, profiles/follows, properties/applications, conversations/messages, movers/bookings/reviews, notifications, and subscription plan/read endpoints. Payment activation is not implemented; subscription changes must be connected to a verified payment flow before being exposed.

This API is not a Supabase replacement endpoint: it serves `/api/*` and storage routes, not Supabase Auth or PostgREST `/rest/v1/*`. Legacy clients using the Supabase SDK need a compatible gateway or a separate client migration.