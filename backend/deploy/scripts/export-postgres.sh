#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SOURCE_DATABASE_URL:-}" ]]; then
    echo "Set SOURCE_DATABASE_URL to the source PostgreSQL connection string." >&2
    exit 1
fi

output_file="${1:-hlala-source-$(date +%Y%m%d-%H%M%S).dump}"
if [[ -e "$output_file" ]]; then
    echo "Refusing to overwrite existing file: $output_file" >&2
    exit 1
fi

pg_dump \
    --format=custom \
    --no-owner \
    --no-acl \
    --file="$output_file" \
    "$SOURCE_DATABASE_URL"

pg_restore --list "$output_file" >/dev/null
echo "PostgreSQL backup created and checked: $output_file"