#!/usr/bin/env bash
# Stop and delete the database started by test-db.sh.
set -euo pipefail
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
RUN=""; [ "$(id -u)" = "0" ] && RUN="runuser -u postgres --"
$RUN "$PG_BIN/pg_ctl" -D "$TEST_DB_DIR/data" -m fast stop >/dev/null 2>&1 || true
rm -rf "$TEST_DB_DIR"
