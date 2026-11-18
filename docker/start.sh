#!/bin/bash
set -euo pipefail
mkdir -p "$(dirname "${CRM_DATABASE_PATH:-/app/data/phigrad-crm.sqlite3}")"
if [[ -z "${LOCAL_API_TOKEN:-}" ]]; then
  echo "LOCAL_API_TOKEN must be configured before starting the service." >&2
  exit 1
fi

uvicorn app.main:app --app-dir backend --host 127.0.0.1 --port 8001 &
api_pid=$!
web_pid=""
trap 'kill "$api_pid" 2>/dev/null || true; if [[ -n "$web_pid" ]]; then kill "$web_pid" 2>/dev/null || true; fi' EXIT

api_ready=0
for attempt in {1..30}; do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    wait "$api_pid" || true
    echo "FastAPI exited before becoming ready." >&2
    exit 1
  fi
  if /opt/venv/bin/python -c 'import os, urllib.request; request = urllib.request.Request("http://127.0.0.1:8001/health", headers={"Host": "127.0.0.1:8001", "Authorization": "Bearer " + os.environ["LOCAL_API_TOKEN"]}); urllib.request.urlopen(request, timeout=2).read()' >/dev/null 2>&1; then
    api_ready=1
    break
  fi
  sleep 1
done

if [[ "$api_ready" -ne 1 ]]; then
  echo "FastAPI did not pass its database readiness check within 30 seconds." >&2
  exit 1
fi

./node_modules/.bin/next start --hostname 0.0.0.0 --port "${PORT:-3000}" &
web_pid=$!
if wait -n "$api_pid" "$web_pid"; then
  exit 1
else
  exit $?
fi
