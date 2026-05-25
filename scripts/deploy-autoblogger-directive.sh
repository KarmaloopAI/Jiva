#!/usr/bin/env bash
# Uploads the autoblogger directive to GCS so the Jiva Cloud Run instance
# picks it up on the next session — no image rebuild required.
#
# Directive filename: f53b52ad6d21cceb.md
#   = SHA-256 of the workspace path (/app) truncated to 16 chars.
#   Jiva uses this hash to namespace directives per-workspace in GCS.
#
# Tenants updated:
#   dev-tenant    — used by Cloud Scheduler (no x-tenant-id header → default)
#   auto-blogger  — used by manual test sessions
#
# Usage:
#   ./scripts/deploy-autoblogger-directive.sh [BUCKET]
#
# Default BUCKET = jiva-state-gritsa-technologies

set -euo pipefail

BUCKET="${1:-jiva-state-gritsa-technologies}"
DIRECTIVE_HASH="f53b52ad6d21cceb"
DIRECTIVE="$(cd "$(dirname "$0")/.." && pwd)/docs/autoblogger/directive.md"

if [[ ! -f "$DIRECTIVE" ]]; then
  echo "ERROR: directive not found at $DIRECTIVE" >&2
  exit 1
fi

for TENANT in dev-tenant auto-blogger; do
  TARGET="gs://${BUCKET}/${TENANT}/directives/${DIRECTIVE_HASH}.md"
  echo "Uploading → ${TARGET}"
  gsutil cp "$DIRECTIVE" "$TARGET"
done

echo ""
echo "Done. Directive will be loaded on the next session for both tenants."
echo "Trigger a test run with:"
echo "  gcloud scheduler jobs run gritsa-auto-blogger --location=us-central1 --project=gritsa-technologies"
