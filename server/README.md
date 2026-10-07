# PostgreSQL API Server

This Express service connects to PostgreSQL through `DATABASE_URL` or `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD`. `JWT_SECRET` must contain at least 32 bytes. `UPLOAD_DIR` optionally selects persistent file storage, and `CORS_ORIGINS` accepts a comma-separated list of browser origins.

## Self-hosted deployment

The provider-neutral Docker/VPS configuration is in [`../deploy`](../deploy/DEPLOYMENT.md). It runs PostgreSQL, this API, and Caddy for HTTPS. The database is not published on a public port; PostgreSQL and uploaded files use persistent Docker volumes.

For local development, set the environment values in `server/.env`, then run:

```powershell
npm start --prefix server
```

The API applies the base schema if `public.profiles` is absent, then applies the additive compatibility migration on startup. Back up the database before upgrading. To run the compatibility migration manually from the repository root:

```powershell
npm run migrate --prefix server
```

The health endpoint is `/api/health`. The API includes auth, profiles/follows, properties/applications, conversations/messages, movers/bookings/reviews, notifications, and subscription plan/read endpoints. Payment activation is not implemented; subscription changes must be connected to a verified payment flow before being exposed.

This API is not a Supabase replacement endpoint: it serves `/api/*` and storage routes, not Supabase Auth or PostgREST `/rest/v1/*`. Legacy clients using the Supabase SDK need a compatible gateway or a separate client migration.