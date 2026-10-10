# Self-hosted MySQL deployment

This configuration targets a Linux VPS with Docker Compose and a domain name. It runs the MySQL API in `server/`, MySQL 8, and Caddy for automatic HTTPS. Deploy the repository with its `server/` and `deploy/` folders together; Compose builds the backend from `server/`.

## Files included

- `server/server.js`, `server/db.js`, `server/routes/`, and `server/middleware/`: API application.
- `server/Dockerfile` and `server/package.json`: production image and backend dependencies.
- `server/schema_mysql.sql`: MySQL 8 schema used by the API.
- `server/scripts/migrate.js`: creates or updates the MySQL schema at startup.
- `deploy/docker-compose.yml`, `deploy/Caddyfile`, and `deploy/.env.example`: database, API, HTTPS proxy, and deployment settings.
- `deploy/scripts/backup-mysql.sh`, `restore-mysql.sh`, and `verify-mysql.sql`: MySQL backup, restore, and verification tools.

The database dump and uploaded images are data artifacts, not source files, and are intentionally not committed to the repository. Export them from the current host and transfer them securely.

## Deploy

1. Point an `A`/`AAAA` DNS record for the API domain to the VPS. Allow inbound TCP ports 80 and 443 (and optionally UDP 443) through the host firewall.
2. Copy the repository to the VPS and enter `deploy/`.
3. Create the private environment file and set strong unique values:

   ```sh
   cp .env.example .env
   openssl rand -base64 48
   ```

  Put unique generated values in `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and `JWT_SECRET`; set `API_DOMAIN` to the DNS name. Set `CORS_ORIGINS` to the exact HTTPS origins of browser clients, separated by commas. Keep `.env` off Git and out of backups shared publicly.
4. Start the services:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

5. Verify `https://<API_DOMAIN>/api/health`. The API creates its schema on startup. MySQL is only reachable by the API on the private Compose network.

## Database and frontend connection rules

- Only the API container connects to MySQL. The Compose configuration intentionally does not publish port `3306`; do not open it to the public internet or put database credentials in frontend configuration.
- Frontends use HTTPS to call the API. Expo uses `EXPO_PUBLIC_API_URL=https://<API_DOMAIN>` (origin only; the client appends `/api`). The dashboard uses `VITE_POSTGRES_API_URL=https://<API_DOMAIN>/api` (include `/api`). These are public build-time URLs, not secrets.
- Set `CORS_ORIGINS` to exact browser origins, including scheme and port where applicable, with no path or trailing slash, for example `https://www.example.com,https://admin.example.com`. Production refuses to start if this list is empty. Add local dev origins only in development configuration.
- CORS only controls which browser pages can read cross-origin responses; it is not user authentication or authorization. Keep private operations protected by the API's bearer-token checks and role checks. Never expose `JWT_SECRET`, a database URL/password, or admin tokens to a frontend.
- Native mobile clients do not send browser `Origin` headers, so CORS does not restrict them. They must still use HTTPS and authenticated API calls for private operations.
- The older web/admin clients using Supabase SDK paths (`/rest/v1/*` and Supabase Auth) are not compatible with this API just by changing their base URL. Keep them on a compatible backend or migrate their client calls to the `/api/*` contract before cutover.

Rebuild and redistribute Expo/dashboard clients after changing their build-time API URLs.

## Migrate existing PostgreSQL data

Keep the PostgreSQL source and its backups unchanged until migration is verified. The repository includes a guarded importer for the API's tables; it does not migrate Supabase auth/policies, unrelated tables, or uploaded files. Read [`../server/README.md`](../server/README.md) for the required source/target URLs and importer behavior.

Create the MySQL schema first, then run the importer from the API package in an environment that can reach both databases. The importer refuses nonempty target tables, checks source columns, preserves UUIDs, and rolls back the row copy if any batch fails. Do not cut over until per-table counts, account sign-in, listings, conversations, bookings, and images have been checked.

## Files and backups

Uploads live in the API's `uploads` directory and are persisted in the `uploads_data` volume. Stop the API and copy the source upload/storage tree into `/app/uploads` in the API container, preserving bucket and object paths. For example, from the repository root when the source files are in `server/uploads/`:

```sh
docker compose -f deploy/docker-compose.yml cp server/uploads/. api:/app/uploads/
```

If the source files are under `standalone-database/storage/`, copy that directory instead. Database rows may contain absolute URLs pointing at the old host; audit and update those URLs after copying the objects. Image copying is separate from the SQL dump and must be verified in the app.

Back up MySQL and uploads, and store the backups outside this VPS. Create a private MySQL client config file with mode `600`, then set `MYSQL_DEFAULTS_FILE` and `MYSQL_DATABASE` before running:

```sh
bash ./scripts/backup-mysql.sh ./hlala-backup.sql
```

Restore only to a dedicated target database with the explicit confirmation token required by `restore-mysql.sh`. Also back up the Docker `uploads_data` volume. Test restore procedures periodically; persistent volumes alone are not backups.

## Client compatibility

This server exposes `/api/*` plus its own `/storage/v1/*` routes. It does not implement Supabase `/rest/v1/*` or Supabase Auth. The MySQL mobile/dashboard clients use this API; older web/admin clients that still use the Supabase SDK must remain on the separate legacy-compatible service or be migrated separately.