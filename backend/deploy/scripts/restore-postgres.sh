#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 || ! -f "$1" ]]; then
    echo "Usage: $0 path/to/source.dump" >&2
    exit 1
fi

if [[ "${RESTORE_CONFIRM:-}" != "restore-to-dedicated-database" ]]; then
    echo "Set RESTORE_CONFIRM=restore-to-dedicated-database after verifying this is a new destination database." >&2
    exit 1
fi

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
deploy_dir="$(cd "$script_dir/.." && pwd)"
dump_file="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"

cd "$deploy_dir"
docker compose up -d db
docker compose exec -T db sh -c \
    'pg_restore --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" --no-owner --no-acl --clean --if-exists --exit-on-error' \
    < "$dump_file"

echo "Restore complete. Start the API to apply its compatibility migration."