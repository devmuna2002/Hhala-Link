# PostgreSQL API Server

This Express service uses the PostgreSQL database configured by `DATABASE_URL` or the `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, and `DB_PASSWORD` values in `server/.env`. `JWT_SECRET` must contain at least 32 bytes.

The current database has the earlier Hlala Link schema. Back up the database, then apply the additive compatibility migration once before starting the API. From the repository root:

```powershell
npm run migrate --prefix server
```

The migration runner loads `server/.env` and uses the same PostgreSQL connection settings as the API.

Then start the PostgreSQL API:

```powershell
npm start --prefix server
```

The health endpoint is `/api/health`. The API includes auth, profiles/follows, properties/applications, conversations/messages, movers/bookings/reviews, notifications, and subscription plan/read endpoints. Payment activation is not implemented; subscription changes must be connected to a verified payment flow before being exposed.