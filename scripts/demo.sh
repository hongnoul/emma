#!/usr/bin/env bash
# Demo stack: frontend (:3000) + backend (:8001) serving the BULK generation
# (data/graph.bulk.json, ~18k nodes — same generation as the checked-in UMAP
# hero artifact). The frontend reaches it same-origin via the EMMA_API_PROXY
# rewrite in frontend/next.config.ts, so no CORS changes are needed.
#
# This is the prod-scale physician showcase: /physician hero -> triage.
# For the small demo dataset use scripts/dev.sh instead (:8000).
#
# Env written to frontend/.env.local by hand (gitignored):
#   NEXT_PUBLIC_API_BASE=            (empty -> relative URLs)
#   EMMA_API_PROXY=http://localhost:8001
# This script passes them as process env instead, so .env.local is optional.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -f data/graph.bulk.json ]; then
  echo "data/graph.bulk.json missing — run the bulk pipeline first" >&2
  exit 1
fi
if [ ! -d backend/.venv ]; then
  python3 -m venv backend/.venv
  backend/.venv/bin/pip install -r backend/requirements.txt
fi
[ -d frontend/node_modules ] || (cd frontend && npm install)

trap 'kill 0' EXIT
(cd backend && EMMATICS_GRAPH_PATH=data/graph.bulk.json \
  .venv/bin/uvicorn app.main:app --port 8001) &
(cd frontend && NEXT_PUBLIC_API_BASE= EMMA_API_PROXY=http://localhost:8001 \
  npm run dev) &
wait
