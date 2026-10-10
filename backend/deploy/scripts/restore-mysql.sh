#!/usr/bin/env bash
set -euo pipefail

if [[ "${RESTORE_CONFIRM:-}" != "restore-to-dedicated-database" ]]; then
    echo "Set RESTORE_CONFIRM=restore-to-dedicated-database to confirm the restore." >&2
    exit 1
fi
if [[ -z "${MYSQL_DEFAULTS_FILE:-}" || ! -f "$MYSQL_DEFAULTS_FILE" ]]; then
    echo "Set MYSQL_DEFAULTS_FILE to a private MySQL client config file." >&2
    exit 1
fi
if [[ -z "${MYSQL_DATABASE:-}" ]]; then
    echo "Set MYSQL_DATABASE to the dedicated target database." >&2
    exit 1
fi

input_file="${1:-}"
if [[ -z "$input_file" || ! -s "$input_file" ]]; then
    echo "Usage: RESTORE_CONFIRM=restore-to-dedicated-database MYSQL_DEFAULTS_FILE=... MYSQL_DATABASE=... $0 dump.sql" >&2
    exit 1
fi

mysql --defaults-extra-file="$MYSQL_DEFAULTS_FILE" "$MYSQL_DATABASE" < "$input_file"
echo "MySQL restore completed into database: $MYSQL_DATABASE"