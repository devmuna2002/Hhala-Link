# Hlala Link Admin Dashboard

The dashboard uses the PostgreSQL API, not Supabase. Start the API, then run the dashboard:

```powershell
npm start --prefix server
npm run dashboard
```

The dashboard defaults to `http://localhost:3000/api`. If the API uses another port, set the URL before starting Vite:

```powershell
$env:VITE_POSTGRES_API_URL = "http://localhost:39131/api"
npm run dashboard
```

Sign in with an existing account whose `profiles.role` is `admin`. Admin signup is intentionally disabled. To grant an account access, update its role in PostgreSQL, then sign out and sign in again so the JWT contains the new role:

```sql
UPDATE profiles
SET role = 'admin', approval_status = 'approved'
WHERE lower(email) = lower('admin@example.com')
RETURNING id, email, role;
```

## Desktop app (Hlala Link Studio)

The dashboard ships as an Electron desktop app for Windows.

Run it in development (starts against the Vite dev server on port 5174):

```powershell
cd dashboard
npm run dev          # terminal 1: web dev server
npm run desktop      # terminal 2: desktop shell
```

Build the Windows installer (writes `dashboard/release/*.exe`):

```powershell
cd dashboard
npm run desktop:build
```

Notes:

- The packaged app loads the bundled `dist/` build, so run `desktop:build` (which rebuilds `dist` first) before distributing.
- The app talks to the same API (`VITE_POSTGRES_API_URL` at build time, proxied to `https://hlala.raisdaglobal.co.zw` in dev). External links open in the system browser.
