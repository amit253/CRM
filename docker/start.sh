#!/bin/bash
set -euo pipefail
mkdir -p "$(dirname "${CRM_DATABASE_PATH:-/app/data/phigrad-crm.sqlite3}")"
uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001 &
api_pid=$!
./node_modules/.bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}" &
web_pid=$!
trap 'kill "$api_pid" "$web_pid" 2>/dev/null || true' EXIT
wait -n "$api_pid" "$web_pid"
exit 1
