#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )/.." >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "================================================================"
echo " Starting Hlala Link Standalone Database Stack..."
echo "================================================================"

if ! command -v docker >/dev/null 2>&1; then
    echo "[ERROR] Docker is not installed. Please install Docker and docker compose."
    exit 1
fi

docker compose up -d

echo ""
echo "[SUCCESS] Standalone Database Stack is running!"
echo "- Gateway / API:  http://localhost:8000"
echo "- Health check:   http://localhost:8000/health"
echo "- PostgreSQL:     localhost:5432 (User: postgres, DB: hlala_link)"
echo ""
