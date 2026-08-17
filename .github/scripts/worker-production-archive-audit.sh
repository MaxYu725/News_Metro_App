#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/worker"

ARCHIVE_ID="a3db6dc1-599c-4ace-b12c-142e56c3734a"

query="SELECT COUNT(*) AS total_rows, SUM(CASE WHEN source='香港01' THEN 1 ELSE 0 END) AS hk01_rows, SUM(CASE WHEN source='巴士的報' THEN 1 ELSE 0 END) AS bastille_rows, MIN(pubDate) AS oldest, MAX(pubDate) AS newest, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='articles_fts') AS fts_table_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('articles_fts_ai','articles_fts_ad','articles_fts_au')) AS fts_trigger_count, (SELECT COUNT(*) FROM pragma_table_info('articles') WHERE name='images') AS images_column_count FROM articles"

npx wrangler d1 execute ARCHIVE_01 --remote --command "$query" --json > /tmp/metro-news-archive-audit.json

node <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/metro-news-archive-audit.json', 'utf8'));
const first = Array.isArray(payload) ? payload[0] : payload?.result?.[0];
const row = first?.results?.[0] || first?.result?.results?.[0];
if (!row) throw new Error('archive D1 audit returned no result row');
const total = Number(row.total_rows || 0);
const hk01 = Number(row.hk01_rows || 0);
const bastille = Number(row.bastille_rows || 0);
const fts = Number(row.fts_table_count || 0);
const triggers = Number(row.fts_trigger_count || 0);
const imagesColumn = Number(row.images_column_count || 0);
const size = Number(first?.meta?.size_after || 0);
if (total < 1000) throw new Error(`archive prototype regressed to ${total} rows`);
if (hk01 < 500) throw new Error(`archive HK01 sample regressed to ${hk01}`);
if (bastille < 500) throw new Error(`archive Bastille sample regressed to ${bastille}`);
if (fts !== 1 || triggers !== 3) throw new Error(`archive FTS contract invalid: table=${fts}, triggers=${triggers}`);
if (imagesColumn !== 0) throw new Error('archive unexpectedly stores full images JSON');
if (size <= 0 || size >= 400000000) throw new Error(`archive size outside prototype guardrail: ${size}`);
console.log(`Archive D1 health: total=${total}, hk01=${hk01}, bastille=${bastille}, oldest=${row.oldest}, newest=${row.newest}, fts_table=${fts}, fts_triggers=${triggers}, size_bytes=${size}`);
NODE

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" || -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo 'Cloudflare credentials unavailable; cannot verify archive read replication' >&2
  exit 1
fi

api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${ARCHIVE_ID}"
curl -sS --retry 2 --retry-delay 1 \
  -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
  "$api" > /tmp/metro-news-archive-resource.json
jq -e '.success == true and .result.read_replication.mode == "auto"' /tmp/metro-news-archive-resource.json >/dev/null
jq -r '"Archive read replication: mode=\(.result.read_replication.mode), primary=\(.result.primary_location_hint // "unknown")"' /tmp/metro-news-archive-resource.json
