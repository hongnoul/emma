#!/usr/bin/env bash
# Publish pipeline: rebuild generation locally (with judge), then ship.
# Prereqs: fly CLI authed; vercel CLI authed (or connect the repo in the UI).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "== 1/3 rebuild bulk generation (judged) =="
(cd backend && .venv/bin/python -m pipeline.bulk_run)

echo "== 2/3 deploy API to Fly =="
fly deploy

echo "== 3/3 frontend =="
echo "Vercel: set NEXT_PUBLIC_API_BASE=https://rare-disease-atlas-api.fly.dev"
echo "then: cd frontend && vercel --prod   (or push to the connected repo)"
