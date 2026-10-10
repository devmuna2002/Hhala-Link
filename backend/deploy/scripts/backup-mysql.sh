#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${MYSQL_DEFAULTS_FILE:-}" || ! -f "$MYSQL_DEFAULTS_FILE" ]]; then
    echo "Set MYSQL_DEFAULTS_FILE to a private MySQL client config file." >&2
    exit 1
fi
if [[ -z "${MYSQL_DATABASE:-}" ]]; then
    echo "Set MYSQL_DATABASE to the database name." >&2
    exit 1
fi

output_file="${1:-hlala-mysql-$(date +%Y%m%d-%H%M%S).sql}"
if [[ -e "$output_file" ]]; then
    echo "Refusing to overwrite existing file: $output_file" >&2
    exit 1
fi

mysqldump \
    --defaults-extra-file="$MYSQL_DEFAULTS_FILE" \
    --single-transaction \
    --routines \
    --triggers \
    --hex-blob \
    "$MYSQL_DATABASE" > "$output_file"

test -s "$output_file"
echo "MySQL backup created: $output_file"