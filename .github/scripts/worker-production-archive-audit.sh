#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/worker"

query="SELECT COUNT(*) AS total_rows, SUM(CASE WHEN source='香港01' THEN 1 ELSE 0 END) AS hk01_rows, SUM(CASE WHEN source='巴士的報' THEN 1 ELSE 0 END) AS bastille_rows, SUM(CASE WHEN source NOT IN ('香港01','巴士的報') THEN 1 ELSE 0 END) AS invalid_source_rows, MIN(pubDate) AS oldest, MAX(pubDate) AS newest, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='articles_fts') AS fts_table_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('articles_fts_ai','articles_fts_ad','articles_fts_au')) AS fts_trigger_count, (SELECT COUNT(*) FROM pragma_table_info('articles') WHERE name='images') AS images_column_count FROM articles"

for binding in ARCHIVE_01 ARCHIVE_02; do
  lower=$(echo "$binding" | tr '[:upper:]' '[:lower:]')
  npx wrangler d1 execute "$binding" --remote --command "$query" --json > "/tmp/metro-news-${lower}-audit.json"
done

node <<'NODE'
const fs = require('fs');
function read(binding) {
  const payload = JSON.parse(fs.readFileSync(`/tmp/metro-news-${binding.toLowerCase()}-audit.json`, 'utf8'));
  const first = Array.isArray(payload) ? payload[0] : payload?.result?.[0];
  const row = first?.results?.[0] || first?.result?.results?.[0];
  if (!row) throw new Error(`${binding} audit returned no result row`);
  const result = {
    binding,
    total: Number(row.total_rows || 0),
    hk01: Number(row.hk01_rows || 0),
    bastille: Number(row.bastille_rows || 0),
    invalid: Number(row.invalid_source_rows || 0),
    fts: Number(row.fts_table_count || 0),
    triggers: Number(row.fts_trigger_count || 0),
    imagesColumn: Number(row.images_column_count || 0),
    size: Number(first?.meta?.size_after || first?.result?.meta?.size_after || 0),
    oldest: row.oldest || '',
    newest: row.newest || '',
  };
  if (result.fts !== 1 || result.triggers !== 3) throw new Error(`${binding} FTS contract invalid: table=${result.fts}, triggers=${result.triggers}`);
  if (result.imagesColumn !== 0) throw new Error(`${binding} unexpectedly stores full images JSON`);
  if (result.invalid !== 0) throw new Error(`${binding} contains ${result.invalid} unsupported source rows`);
  if (result.size <= 0 || result.size >= 400000000) throw new Error(`${binding} size outside guardrail: ${result.size}`);
  return result;
}
const a = read('ARCHIVE_01');
const b = read('ARCHIVE_02');
if (a.total < 1000) throw new Error(`ARCHIVE_01 regressed to ${a.total} rows`);
if (a.hk01 < 500) throw new Error(`ARCHIVE_01 HK01 sample regressed to ${a.hk01}`);
if (a.bastille < 500) throw new Error(`ARCHIVE_01 Bastille sample regressed to ${a.bastille}`);
console.log(`Archive D1 health: ARCHIVE_01 total=${a.total}, hk01=${a.hk01}, bastille=${a.bastille}, size=${a.size}; ARCHIVE_02 total=${b.total}, hk01=${b.hk01}, bastille=${b.bastille}, size=${b.size}`);
NODE

if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" || -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo 'Cloudflare credentials unavailable; cannot verify archive read replication' >&2
  exit 1
fi

for spec in \
  "ARCHIVE_01:a3db6dc1-599c-4ace-b12c-142e56c3734a" \
  "ARCHIVE_02:60ca53f2-7b2a-41cb-b933-4232b8d26d7a"; do
  binding=${spec%%:*}
  archive_id=${spec#*:}
  api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/d1/database/${archive_id}"
  outfile="/tmp/metro-news-${binding,,}-resource.json"
  curl -sS --retry 2 --retry-delay 1 \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
    "$api" > "$outfile"
  jq -e '.success == true and .result.read_replication.mode == "auto"' "$outfile" >/dev/null
  jq -r '"'"$binding"' read replication: mode=\(.result.read_replication.mode), primary=\(.result.primary_location_hint // "unknown")"' "$outfile"
done
