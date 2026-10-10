#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"

mkdir -p backups
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
OUTFILE="backups/hlala_link_backup_${TIMESTAMP}.sql"

echo "Backing up Hlala Link database to ${OUTFILE}..."
docker compose exec -T db pg_dump -U postgres hlala_link > "${OUTFILE}"
echo "[SUCCESS] Backup created at ${OUTFILE}"
