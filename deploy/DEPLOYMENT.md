# Self-hosted deployment and migration

This configuration targets a Linux VPS with Docker Compose and a domain name. It runs the existing PostgreSQL API in `server/`, PostgreSQL 15, and Caddy for automatic HTTPS. It does not require Railway or Supabase. Deploy the repository with its `server/` and `deploy/` folders together; Compose builds the backend from `server/`.

## Files included

- `server/server.js`, `server/db.js`, `server/routes/`, and `server/middleware/`: API application.
- `server/Dockerfile` and `server/package.json`: production image and backend dependencies.
- `server/schema_postgres.sql`: base standalone PostgreSQL schema.
- `server/migrations/001_api_compatibility.sql`: additive compatibility migration for the API.
- `server/scripts/migrate.js`: applies the base schema when needed, then the compatibility migration at API startup.
- `deploy/docker-compose.yml`, `deploy/Caddyfile`, and `deploy/.env.example`: database, API, HTTPS proxy, and deployment settings.
- `deploy/scripts/export-postgres.sh`, `restore-postgres.sh`, and `verify-postgres.sql`: PostgreSQL data transfer and verification tools.

The database dump and uploaded images are data artifacts, not source files, and are intentionally not committed to the repository. Export them from the current host and transfer them securely.

## Deploy

1. Point an `A`/`AAAA` DNS record for the API domain to the VPS. Allow inbound TCP ports 80 and 443 (and optionally UDP 443) through the host firewall.
2. Copy the repository to the VPS and enter `deploy/`.
3. Create the private environment file and set strong unique values:

   ```sh
   cp .env.example .env
   openssl rand -base64 48
   ```

   Put one generated value in `POSTGRES_PASSWORD` and another in `JWT_SECRET`; set `API_DOMAIN` to the DNS name. Set `CORS_ORIGINS` to the exact HTTPS origins of browser clients, separated by commas. Keep `.env` off Git and out of backups shared publicly.
4. Start the services:

   ```sh
   docker compose up -d --build
   docker compose ps
   ```

5. Verify `https://<API_DOMAIN>/api/health`. The API creates or upgrades its schema on startup. PostgreSQL is only reachable by the API on the private Compose network.

## Database and frontend connection rules

- Only the API container connects to PostgreSQL. The Compose configuration intentionally does not publish port `5432`; do not open it to the public internet or put database credentials in frontend configuration.
- Frontends use HTTPS to call the API. Expo uses `EXPO_PUBLIC_API_URL=https://<API_DOMAIN>` (origin only; the client appends `/api`). The dashboard uses `VITE_POSTGRES_API_URL=https://<API_DOMAIN>/api` (include `/api`). These are public build-time URLs, not secrets.
- Set `CORS_ORIGINS` to exact browser origins, including scheme and port where applicable, with no path or trailing slash, for example `https://www.example.com,https://admin.example.com`. Production refuses to start if this list is empty. Add local dev origins only in development configuration.
- CORS only controls which browser pages can read cross-origin responses; it is not user authentication or authorization. Keep private operations protected by the API's bearer-token checks and role checks. Never expose `JWT_SECRET`, a database URL/password, or admin tokens to a frontend.
- Native mobile clients do not send browser `Origin` headers, so CORS does not restrict them. They must still use HTTPS and authenticated API calls for private operations.
- The older web/admin clients using Supabase SDK paths (`/rest/v1/*` and Supabase Auth) are not compatible with this API just by changing their base URL. Keep them on a compatible backend or migrate their client calls to the `/api/*` contract before cutover.

Rebuild and redistribute Expo/dashboard clients after changing their build-time API URLs.

## Move PostgreSQL data

First identify the source engine and schema. The repository contains both a PostgreSQL API and older Supabase-compatible/SQLite code; these are different backends and their database files are not interchangeable. The scripts below support a PostgreSQL source whose schema is compatible with the API. They are not a Supabase-to-API transformation or a SQLite converter.

For a compatible PostgreSQL source, install PostgreSQL client tools on the export machine and set `SOURCE_DATABASE_URL` in its environment. Keep the connection string private. From the repository root, create and validate the dump:

```sh
bash ./deploy/scripts/export-postgres.sh ./hlala-before-move.dump
```

Before cutover, put the source into maintenance/read-only mode and create a final dump. Copy the dump securely to the VPS. Do not overwrite the first backup; retain both until cutover is verified.

On the VPS, create `deploy/.env` from `.env.example`, confirm it points to a new dedicated destination database, then restore from the `deploy/` directory:

```sh
RESTORE_CONFIRM=restore-to-dedicated-database \
  bash ./scripts/restore-postgres.sh /path/to/hlala-before-move.dump
```

The restore script starts only PostgreSQL, requires the explicit confirmation value, and uses `pg_restore --clean`. Never use it against a live or valuable database. Then start the API and proxy; startup applies the included schema migration:

```sh
docker compose up -d --build api proxy
docker compose logs --tail=100 api
docker compose exec -T db sh -c \
  'psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -f -' \
  < ./scripts/verify-postgres.sql
```

Review row counts and confirm the expected accounts can sign in before switching client URLs. The included check reports profiles without a password hash; resolve those accounts explicitly before cutover.

This procedure is not a safe direct import for Supabase: its `auth.users`, policies, triggers, and profile foreign keys differ from this API schema. The destination API expects account hashes in `profiles.password_hash`; Supabase account/password migration must be explicitly mapped and tested. The existing SQLite CSV importer targets SQLite, not this PostgreSQL API. Do not delete or overwrite the source until the imported data and sign-in flow have been verified.

## Files and backups

Uploads live in the API's `uploads` directory and are persisted in the `uploads_data` volume. Stop the API and copy the source upload/storage tree into `/app/uploads` in the API container, preserving bucket and object paths. For example, from the repository root when the source files are in `server/uploads/`:

```sh
docker compose -f deploy/docker-compose.yml cp server/uploads/. api:/app/uploads/
```

If the source files are under `standalone-database/storage/`, copy that directory instead. Database rows may contain absolute URLs pointing at the old host; audit and update those URLs after copying the objects. Image copying is separate from the SQL dump and must be verified in the app.

Back up both PostgreSQL and uploads, and store the backups outside this VPS. A database backup can be made with:

```sh
docker compose exec -T db sh -c 'pg_dump --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --format=custom' > hlala-backup.dump
```

Also back up the Docker `uploads_data` volume. Test restore procedures periodically; persistent volumes alone are not backups.

## Client compatibility

This server exposes `/api/*` plus its own `/storage/v1/*` routes. It does not implement Supabase `/rest/v1/*` or Supabase Auth. The Expo PostgreSQL client and dashboard PostgreSQL client use this API; the older web/admin clients that still use the Supabase SDK must remain on a compatible service or be migrated separately.