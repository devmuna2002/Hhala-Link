# Hlala Link Backend

This repository contains the Hlala Link MySQL API, MySQL self-hosted deployment files, and a separate legacy Supabase-compatible stack.

## Components

- `server/`: Express API, MySQL schema, and the guarded PostgreSQL data importer.
- `deploy/`: MySQL Docker Compose, Caddy HTTPS proxy, and MySQL backup/restore scripts.
- `standalone-database/`: legacy PostgreSQL, GoTrue, PostgREST, and storage services; these are not used by the MySQL API.

## MySQL API deployment

For cPanel, follow [`CPANEL.md`](CPANEL.md). For a Linux VPS using Docker Compose and Caddy, see [`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md). Both use `server/` as the API and create the MySQL schema at startup.

For local API development, copy `server/.env.example` to `server/.env`, set the MySQL credentials and a JWT secret of at least 32 bytes, then start the API with:

```sh
npm start --prefix server
```

The API health endpoint is `/api/health`. Database migration commands and API routes are documented in [`server/README.md`](server/README.md).

## Standalone compatibility stack

The separate `standalone-database/` Compose stack still uses PostgreSQL for its legacy Supabase-compatible services. It is independent from the MySQL API and must not be used as the API's `MYSQL_URL`.

Do not commit `.env` files, database dumps, uploaded media, or migration exports.