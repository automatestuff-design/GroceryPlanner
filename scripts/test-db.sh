#!/usr/bin/env bash
# Start a throwaway Postgres with Supabase stubs + all migrations, and print its URL.
# Usage: eval "$(scripts/test-db.sh)"   # exports TEST_DATABASE_URL
set -euo pipefail
PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | tail -1)}"
DIR="${TEST_DB_DIR:-$(mktemp -d)}"; mkdir -p "$DIR"
PORT="${TEST_DB_PORT:-54329}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RUN=""; [ "$(id -u)" = "0" ] && { chown -R postgres "$DIR"; RUN="runuser -u postgres --"; }
$RUN "$PG_BIN/initdb" -D "$DIR/data" -U postgres --auth=trust >/dev/null
$RUN "$PG_BIN/pg_ctl" -D "$DIR/data" -o "-p $PORT -k $DIR -c listen_addresses=127.0.0.1" -l "$DIR/log" -w start >/dev/null
URL="postgres://postgres@127.0.0.1:$PORT/postgres"
psql -q -v ON_ERROR_STOP=1 "$URL" -f "$ROOT/supabase/test/supabase-stubs.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do psql -q -v ON_ERROR_STOP=1 "$URL" -f "$f" >/dev/null; done
echo "export TEST_DATABASE_URL=$URL TEST_DB_DIR=$DIR"
