#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/worker"

state=$(mktemp -d)
trap 'rm -rf "$state"' EXIT

npx wrangler d1 migrations apply metro_news_db --local --persist-to "$state" >/tmp/cf-w6-migrations.log
grep -q '0002_adaptive_retention.sql' /tmp/cf-w6-migrations.log || {
  echo 'Adaptive retention migration was not discovered by Wrangler' >&2
  cat /tmp/cf-w6-migrations.log >&2
  exit 1
}

npx wrangler d1 execute metro_news_db --local --persist-to "$state" --json \
  --command "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table' AND name='retention_state'; SELECT id,last_cleanup_size,last_deleted_rows,last_mode FROM retention_state WHERE id=1" \
  >/tmp/cf-w6-retention.json

node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/cf-w6-retention.json', 'utf8'));
const batches = Array.isArray(payload) ? payload : payload?.result || [];
const tableCount = Number(batches[0]?.results?.[0]?.table_count || 0);
const state = batches[1]?.results?.[0];
if (tableCount !== 1) throw new Error(`expected retention_state table, got ${tableCount}`);
if (!state || Number(state.id) !== 1) throw new Error('retention_state singleton row missing');
if (Number(state.last_cleanup_size) !== 0 || Number(state.last_deleted_rows) !== 0) {
  throw new Error('retention_state defaults are not clean');
}
NODE

echo 'D1 adaptive retention migration/state: PASS'
