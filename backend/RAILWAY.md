# Deploy the MySQL API on Railway

The current API requires MySQL. The existing Railway PostgreSQL service is only a source for the one-time data migration; do not set it as `MYSQL_URL`.

## Create the services

1. Add a MySQL 8.0.13+ service to the Railway project, or use another reachable MySQL server.
2. Add a service from the private GitHub repository `devmuna2002/hlala-link-backend`, using the `main` branch. Authorize Railway's GitHub app to access the private repository if prompted.
3. In the API service's build settings, leave the Root Directory at the repository root. Set the Dockerfile path to `server/Dockerfile` if Railway does not detect it automatically. The Dockerfile expects the repository root as its build context.
4. In the API service's deploy settings, set the health check path to `/api/health`.

## Set API variables

In the API service's **Variables** tab, add:

| Variable | Value |
| --- | --- |
| `MYSQL_URL` | Reference the MySQL service's connection URL using Railway's variable picker. |
| `JWT_SECRET` | A unique random secret of at least 32 bytes. |
| `CORS_ORIGINS` | Comma-separated frontend origins, including scheme and host only, for example `https://example.com,https://admin.example.com`. |

Generate a secret locally with PowerShell:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

Paste the generated value directly into Railway's variable editor. Do not commit it or place it in frontend variables. Railway injects `PORT`; the API listens on it automatically. The container sets `NODE_ENV=production`.

The API creates the MySQL schema during startup. The repository's existing PostgreSQL service is not a valid database target for this API. Once the deployment is healthy, generate a Railway public domain and test `https://<domain>/api/health`.

## Persist uploads

Railway's container filesystem is ephemeral. If the API accepts uploads, add a Railway Volume to the API service mounted at `/app/uploads` and set `UPLOAD_DIR=/app/uploads`. Without a volume, uploaded files can be lost when Railway replaces the container.

For a self-hosted Docker Compose deployment instead, see [`deploy/DEPLOYMENT.md`](deploy/DEPLOYMENT.md).