#!/usr/bin/env bash
# Updates an EXISTING staging environment without touching its data or credentials:
#   build + embed the web app, deploy the Worker, apply only pending D1 migrations (additive),
#   and run the create-only real-repertoire import. It does not re-run the demo seed, rotate
#   passwords, end sessions or delete anything. Never uses --env production.
# Needs Cloudflare credentials and apps/api/.staging/credentials.txt (for the import login).
set -euo pipefail
cd "$(dirname "$0")/.."

STAGING_URL="${STAGING_URL:-https://bandsync-staging.gabriel-gavinelli.workers.dev}"

echo "==> Pending migrations on bandsync-staging"
npx wrangler d1 migrations list bandsync-staging --remote --env staging

echo "==> Building and embedding the web app"
pnpm --filter @bandsync/web build
node scripts/embed-web.mjs

echo "==> Applying pending migrations (additive) before the new code goes live"
npx wrangler d1 migrations apply bandsync-staging --remote --env staging

echo "==> Deploying Worker bandsync-staging"
npx wrangler deploy --env staging

echo "==> Importing the real repertoire (create-only, idempotent)"
BANDSYNC_URL="$STAGING_URL" BANDSYNC_CREDENTIALS=.staging/credentials.txt \
  NODE_USE_ENV_PROXY=1 node scripts/import-real-repertoire.mjs "$@"
