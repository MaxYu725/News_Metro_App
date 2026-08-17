#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/worker"

state=$(mktemp -d)
trap 'rm -rf "$state"' EXIT

npx wrangler d1 migrations apply metro_news_archive_01 --local --persist-to "$state" >/tmp/ns2c2-archive-migrations.log
grep -q '0000_archive_baseline.sql' /tmp/ns2c2-archive-migrations.log || {
  echo 'Archive baseline migration was not discovered by Wrangler' >&2
  cat /tmp/ns2c2-archive-migrations.log >&2
  exit 1
}
grep -q '0001_backfill_state.sql' /tmp/ns2c2-archive-migrations.log || {
  echo 'Archive backfill state migration was not discovered by Wrangler' >&2
  cat /tmp/ns2c2-archive-migrations.log >&2
  exit 1
}

npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --command "INSERT INTO articles (id,title,link,pubDate,description,category,source,imageUrl) VALUES ('archive-test','香港歷史新聞搜尋測試','https://example.test/archive','2026-07-01T00:00:00.000Z','測試舊新聞全文搜尋','local','test','')" >/dev/null

npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --json --command "SELECT a.id FROM articles_fts JOIN articles a ON a.rowid=articles_fts.rowid WHERE articles_fts MATCH '\"香港歷史新聞\"'" >/tmp/ns2c2-archive-fts.json
node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/ns2c2-archive-fts.json', 'utf8'));
const first = Array.isArray(payload) ? payload[0] : payload;
const rows = first?.results || [];
if (!rows.some(row => row.id === 'archive-test')) throw new Error('archive FTS insert trigger/search failed');
NODE

npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --json --command "PRAGMA table_info(articles)" >/tmp/ns2c2-archive-columns.json
node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/ns2c2-archive-columns.json', 'utf8'));
const first = Array.isArray(payload) ? payload[0] : payload;
const names = (first?.results || []).map(row => row.name);
const expected = ['id','title','link','pubDate','description','category','source','imageUrl'];
if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`archive columns mismatch: ${names.join(',')}`);
if (names.includes('images')) throw new Error('archive must not store full images JSON');
NODE

npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --json --command "PRAGMA table_info(archive_backfill_state)" >/tmp/ns2c3-state-columns.json
node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/ns2c3-state-columns.json', 'utf8'));
const first = Array.isArray(payload) ? payload[0] : payload;
const names = (first?.results || []).map(row => row.name);
const expected = ['source_key','cursor','pages_fetched','rows_inserted','last_pubDate','exhausted','updated_at'];
if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error(`archive backfill state columns mismatch: ${names.join(',')}`);
NODE

npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --command "INSERT INTO archive_backfill_state (source_key,cursor,pages_fetched,rows_inserted,last_pubDate,exhausted,updated_at) VALUES ('test','123',1,10,'2026-07-01T00:00:00.000Z',0,'2026-08-17T00:00:00.000Z') ON CONFLICT(source_key) DO UPDATE SET cursor='124',pages_fetched=2" >/dev/null
npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --json --command "SELECT cursor,pages_fetched FROM archive_backfill_state WHERE source_key='test'" >/tmp/ns2c3-state-upsert.json
node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/ns2c3-state-upsert.json', 'utf8'));
const first = Array.isArray(payload) ? payload[0] : payload;
const row = first?.results?.[0];
if (String(row?.cursor) !== '124' || Number(row?.pages_fetched) !== 2) throw new Error('archive backfill state upsert failed');
NODE

echo 'Archive D1 lean schema + FTS5 trigram + resume state: PASS'
