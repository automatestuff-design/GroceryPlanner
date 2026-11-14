#!/usr/bin/env bash
# Run every test, including the Postgres/RLS integration tests, against a throwaway database.
set -euo pipefail
cd "$(dirname "$0")/.."
eval "$(scripts/test-db.sh)"
trap 'scripts/stop-test-db.sh' EXIT
npm test
