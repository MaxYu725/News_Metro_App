#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/worker"

state_all=$(mktemp -d)
state_rebuild=$(mktemp -d)
trap 'rm -rf "$state_all" "$state_rebuild"' EXIT

npx wrangler d1 migrations apply metro_news_db --local --persist-to "$state_all" >/tmp/cf-w5-migrations.log
grep -q '0001_search_fts.sql' /tmp/cf-w5-migrations.log || {
  echo 'FTS migration was not discovered by Wrangler' >&2
  cat /tmp/cf-w5-migrations.log >&2
  exit 1
}

npx wrangler d1 execute metro_news_db --local --persist-to "$state_rebuild" --file migrations/0000_production_baseline.sql >/dev/null
npx wrangler d1 execute metro_news_db --local --persist-to "$state_rebuild" --command "INSERT INTO articles (id,title,link,pubDate,description,category,source,imageUrl,images) VALUES ('pre','香港天文台暴雨測試','https://example.test/pre','2026-08-17T00:00:00.000Z','九龍新界廣泛大雨','local','test','','[]')" >/dev/null
npx wrangler d1 execute metro_news_db --local --persist-to "$state_rebuild" --file migrations/0001_search_fts.sql >/dev/null

npx wrangler d1 execute metro_news_db --local --persist-to "$state_rebuild" --json --command "SELECT a.id FROM articles_fts JOIN articles a ON a.rowid=articles_fts.rowid WHERE articles_fts MATCH '\"香港天文台\"'" >/tmp/cf-w5-pre.json
node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/cf-w5-pre.json', 'utf8'));
const rows = (Array.isArray(payload) ? payload[0] : payload)?.results || [];
if (!rows.some(row => row.id === 'pre')) throw new Error('FTS rebuild did not index pre-existing Chinese row');
NODE

npx wrangler d1 execute metro_news_db --local --persist-to "$state_rebuild" --command "INSERT INTO articles (id,title,link,pubDate,description,category,source,imageUrl,images) VALUES ('post','啟德體育園測試新聞','https://example.test/post','2026-08-17T00:01:00.000Z','大型活動交通安排','sports','test','','[]')" >/dev/null
npx wrangler d1 execute metro_news_db --local --persist-to "$state_rebuild" --json --command "SELECT a.id FROM articles_fts JOIN articles a ON a.rowid=articles_fts.rowid WHERE articles_fts MATCH '\"啟德體育園\"'" >/tmp/cf-w5-post.json
node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/cf-w5-post.json', 'utf8'));
const rows = (Array.isArray(payload) ? payload[0] : payload)?.results || [];
if (!rows.some(row => row.id === 'post')) throw new Error('FTS insert trigger did not index new row');
NODE

npx wrangler d1 execute metro_news_db --local --persist-to "$state_rebuild" --command "DELETE FROM articles WHERE id='post'" >/dev/null
npx wrangler d1 execute metro_news_db --local --persist-to "$state_rebuild" --json --command "SELECT count(*) AS total FROM articles_fts WHERE articles_fts MATCH '\"啟德體育園\"'" >/tmp/cf-w5-delete.json
node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/cf-w5-delete.json', 'utf8'));
const rows = (Array.isArray(payload) ? payload[0] : payload)?.results || [];
if (Number(rows[0]?.total ?? -1) !== 0) throw new Error('FTS delete trigger left stale index entry');
NODE

echo 'D1 FTS5 trigram migration/rebuild/triggers: PASS'
