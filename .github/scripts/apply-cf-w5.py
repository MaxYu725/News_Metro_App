#!/usr/bin/env python3
from pathlib import Path

root = Path('.')
index_path = root / 'worker/src/index.js'
source = index_path.read_text(encoding='utf-8')

import_marker = "} from './security.js';\n"
search_import = "import { searchArticles } from './search.js';\n"
if search_import not in source:
    if import_marker not in source:
        raise SystemExit('security import marker missing')
    source = source.replace(import_marker, import_marker + search_import, 1)

old_search = """      const offset = page * limit;
      try {
        const { results } = await env.DB
          .prepare(`SELECT * FROM articles WHERE title LIKE ? OR description LIKE ? ORDER BY pubDate DESC LIMIT ? OFFSET ?`)
          .bind(`%${query}%`, `%${query}%`, limit, offset)
          .all();
        const formattedResults = results.map(row => ({ ...row, images: row.images ? JSON.parse(row.images) : [] }));
        return jsonResponse(request, {
          success: true,
          count: formattedResults.length,
          page,
          hasMore: formattedResults.length === limit,
          timestamp: new Date().toISOString(),
          data: formattedResults,
        });
      } catch {
        return jsonResponse(request, { success: false, error: '搜尋資料庫時發生錯誤' }, 500);
      }
"""
new_search = """      try {
        const { rows, hasMore } = await searchArticles(env.DB, query, page, limit);
        const formattedResults = rows.map(row => ({ ...row, images: row.images ? JSON.parse(row.images) : [] }));
        return jsonResponse(request, {
          success: true,
          count: formattedResults.length,
          page,
          hasMore,
          timestamp: new Date().toISOString(),
          data: formattedResults,
        });
      } catch {
        return jsonResponse(request, { success: false, error: '搜尋資料庫時發生錯誤' }, 500);
      }
"""
if old_search not in source:
    raise SystemExit('legacy search block missing')
source = source.replace(old_search, new_search, 1)
index_path.write_text(source, encoding='utf-8')

(root / 'worker/src/search.js').write_text(r'''const FTS_MIN_CODEPOINTS = 3;

function codePointLength(value) {
  return Array.from(value).length;
}

export function quoteFtsPhrase(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function escapeLike(value) {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function isMissingFtsTable(error) {
  return String(error?.message || error).includes('no such table: articles_fts');
}

async function runFtsSearch(db, query, offset, fetchLimit) {
  return db
    .prepare(`SELECT a.*
      FROM articles_fts
      JOIN articles AS a ON a.rowid = articles_fts.rowid
      WHERE articles_fts MATCH ?
      ORDER BY a.pubDate DESC
      LIMIT ? OFFSET ?`)
    .bind(quoteFtsPhrase(query), fetchLimit, offset)
    .all();
}

async function runLikeFallback(db, query, offset, fetchLimit) {
  const pattern = `%${escapeLike(query)}%`;
  return db
    .prepare(`SELECT * FROM articles
      WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
      ORDER BY pubDate DESC
      LIMIT ? OFFSET ?`)
    .bind(pattern, pattern, fetchLimit, offset)
    .all();
}

export async function searchArticles(db, query, page, limit = 20) {
  const offset = page * limit;
  const fetchLimit = limit + 1;
  let result;
  let backend;

  if (codePointLength(query) >= FTS_MIN_CODEPOINTS) {
    try {
      result = await runFtsSearch(db, query, offset, fetchLimit);
      backend = 'fts5-trigram';
    } catch (error) {
      if (!isMissingFtsTable(error)) throw error;
      console.warn('search-fts-missing-fallback', { queryLength: codePointLength(query) });
      result = await runLikeFallback(db, query, offset, fetchLimit);
      backend = 'like-migration-fallback';
    }
  } else {
    result = await runLikeFallback(db, query, offset, fetchLimit);
    backend = 'like-short-query';
  }

  const results = Array.isArray(result?.results) ? result.results : [];
  return {
    rows: results.slice(0, limit),
    hasMore: results.length > limit,
    backend,
  };
}
''', encoding='utf-8')

(root / 'worker/migrations/0001_search_fts.sql').write_text(r'''-- CF-W5: indexed substring search for Traditional Chinese and mixed-language news.
-- External-content FTS avoids duplicating article payloads while triggers keep the
-- index synchronized with inserts, updates, and retention deletes.

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title,
  description,
  content='articles',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS articles_fts_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, description)
  VALUES (new.rowid, new.title, COALESCE(new.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_fts_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_fts_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.description, ''));
  INSERT INTO articles_fts(rowid, title, description)
  VALUES (new.rowid, new.title, COALESCE(new.description, ''));
END;

INSERT INTO articles_fts(articles_fts) VALUES ('rebuild');
''', encoding='utf-8')

(root / 'worker/test/search.test.mjs').write_text(r'''import assert from 'node:assert/strict';
import test from 'node:test';

import { escapeLike, quoteFtsPhrase, searchArticles } from '../src/search.js';

function fakeDb(handlers) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql, params: [] };
      calls.push(call);
      return {
        bind(...params) {
          call.params = params;
          return {
            all: async () => handlers.shift()(call),
          };
        },
      };
    },
  };
}

test('FTS phrase quoting neutralizes FTS syntax characters', () => {
  assert.equal(quoteFtsPhrase('香港 "01" - test'), '"香港 ""01"" - test"');
});

test('LIKE fallback escapes wildcard characters', () => {
  assert.equal(escapeLike('100%_香港\\'), '100\\%\\_香港\\\\');
});

test('three-codepoint query uses FTS5 trigram and limit+1 pagination', async () => {
  const rows = Array.from({ length: 21 }, (_, id) => ({ id: String(id) }));
  const db = fakeDb([() => ({ results: rows })]);
  const result = await searchArticles(db, '香港01', 2, 20);
  assert.equal(result.backend, 'fts5-trigram');
  assert.equal(result.rows.length, 20);
  assert.equal(result.hasMore, true);
  assert.match(db.calls[0].sql, /articles_fts MATCH \?/);
  assert.deepEqual(db.calls[0].params, ['"香港01"', 21, 40]);
});

test('short query uses escaped LIKE fallback', async () => {
  const db = fakeDb([() => ({ results: [{ id: 'a' }] })]);
  const result = await searchArticles(db, 'AI', 0, 20);
  assert.equal(result.backend, 'like-short-query');
  assert.equal(result.hasMore, false);
  assert.match(db.calls[0].sql, /LIKE \? ESCAPE/);
  assert.deepEqual(db.calls[0].params, ['%AI%', '%AI%', 21, 0]);
});

test('missing FTS table falls back during migration window only', async () => {
  const db = fakeDb([
    () => { throw new Error('D1_ERROR: no such table: articles_fts'); },
    () => ({ results: [{ id: 'fallback' }] }),
  ]);
  const result = await searchArticles(db, '香港新聞', 0, 20);
  assert.equal(result.backend, 'like-migration-fallback');
  assert.equal(result.rows[0].id, 'fallback');
  assert.equal(db.calls.length, 2);
});

test('unrelated FTS errors fail closed instead of triggering a table scan', async () => {
  const db = fakeDb([() => { throw new Error('D1_ERROR: database overloaded'); }]);
  await assert.rejects(() => searchArticles(db, '香港新聞', 0, 20), /database overloaded/);
  assert.equal(db.calls.length, 1);
});
''', encoding='utf-8')

(root / '.github/scripts/validate-search-fts.sh').write_text(r'''#!/usr/bin/env bash
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
''', encoding='utf-8')

validator_path = root / '.github/scripts/validate-worker-baseline.py'
validator = validator_path.read_text(encoding='utf-8')
validator = validator.replace(
    '    security = (WORKER / "src" / "security.js").read_text("utf-8")\n',
    '    security = (WORKER / "src" / "security.js").read_text("utf-8")\n    search = (WORKER / "src" / "search.js").read_text("utf-8")\n', 1)
marker = '    retention_sql = "DELETE FROM articles WHERE category <> \'video\' AND datetime(pubDate) < datetime(\'now\', \'-30 days\')"\n'
if marker not in validator:
    raise SystemExit('retention validator marker missing')
fts_checks = '''    # CF-W5: indexed substring search must remain on D1 FTS5 trigram.\n    fts_migration = (WORKER / "migrations" / "0001_search_fts.sql").read_text("utf-8")\n    for signal in [\n        "USING fts5",\n        "tokenize='trigram'",\n        "content='articles'",\n        "articles_fts_ai",\n        "articles_fts_ad",\n        "articles_fts_au",\n        "VALUES ('rebuild')",\n    ]:\n        if signal not in fts_migration:\n            fail(f"FTS migration signal missing: {signal}")\n    if "searchArticles" not in source or "articles_fts MATCH ?" not in search:\n        fail("Worker search route is not using the FTS search owner")\n    if "SELECT * FROM articles WHERE title LIKE ? OR description LIKE ?" in source:\n        fail("legacy unindexed search scan must not be reintroduced")\n\n'''
validator = validator.replace(marker, fts_checks + marker, 1)
validator = validator.replace('    print("D1 baseline schema/indexes: OK")\n', '    print("D1 baseline schema/indexes: OK")\n    print("D1 FTS5 trigram search contract: OK")\n', 1)
validator_path.write_text(validator, encoding='utf-8')

smoke_path = root / '.github/scripts/worker-production-smoke.sh'
smoke = smoke_path.read_text(encoding='utf-8')
old_latest = '''echo 'Smoke: latest news remains readable'\nrequest 200 -H "Origin: ${APP_ORIGIN}" "${WORKER_ORIGIN}/api/news/latest?page=0"\njq -e '.success == true and (.data | type == "array")' "$tmp_body" >/dev/null\ngrep -Fqi "access-control-allow-origin: ${APP_ORIGIN}" "$tmp_headers"\n\necho 'Smoke: search remains readable'\nrequest 200 -G \\\n  -H "Origin: ${APP_ORIGIN}" \\\n  --data-urlencode 'q=香港' \\\n  --data-urlencode 'page=0' \\\n  "${WORKER_ORIGIN}/api/search"\njq -e '.success == true and (.data | type == "array")' "$tmp_body" >/dev/null\n'''
new_latest = '''echo 'Smoke: latest news remains readable'\nrequest 200 -H "Origin: ${APP_ORIGIN}" "${WORKER_ORIGIN}/api/news/latest?page=0"\njq -e '.success == true and (.data | type == "array") and (.data | length > 0)' "$tmp_body" >/dev/null\ngrep -Fqi "access-control-allow-origin: ${APP_ORIGIN}" "$tmp_headers"\nlatest_id=$(jq -r '.data[0].id // .data[0].link // empty' "$tmp_body")\nlatest_title=$(jq -r '.data[0].title // empty' "$tmp_body")\nsearch_probe=$(printf '%s' "$latest_title" | python3 -c 'import sys; print("".join(list(sys.stdin.read())[:6]))')\nif [[ -z "$latest_id" || ${#search_probe} -lt 3 ]]; then\n  echo 'Unable to derive FTS smoke probe from latest article' >&2\n  exit 1\nfi\n\necho 'Smoke: FTS5 trigram search finds a live article'\nrequest 200 -G \\\n  -H "Origin: ${APP_ORIGIN}" \\\n  --data-urlencode "q=${search_probe}" \\\n  --data-urlencode 'page=0' \\\n  "${WORKER_ORIGIN}/api/search"\njq --arg id "$latest_id" -e '.success == true and (.data | type == "array") and any(.data[]; (.id == $id) or (.link == $id))' "$tmp_body" >/dev/null\n'''
if old_latest not in smoke:
    raise SystemExit('production search smoke marker missing')
smoke_path.write_text(smoke.replace(old_latest, new_latest, 1), encoding='utf-8')

audit_path = root / '.github/scripts/worker-production-d1-audit.sh'
audit = audit_path.read_text(encoding='utf-8')
audit = audit.replace(
    "query=\"SELECT COUNT(*) AS total_rows, SUM(CASE WHEN category = 'video' THEN 1 ELSE 0 END) AS video_rows, SUM(CASE WHEN category <> 'video' AND datetime(pubDate) < datetime('now', '-30 days') THEN 1 ELSE 0 END) AS stale_non_video_rows, COUNT(DISTINCT category) AS category_count, COUNT(DISTINCT source) AS source_count FROM articles\"",
    "query=\"SELECT COUNT(*) AS total_rows, SUM(CASE WHEN category = 'video' THEN 1 ELSE 0 END) AS video_rows, SUM(CASE WHEN category <> 'video' AND datetime(pubDate) < datetime('now', '-30 days') THEN 1 ELSE 0 END) AS stale_non_video_rows, COUNT(DISTINCT category) AS category_count, COUNT(DISTINCT source) AS source_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='articles_fts') AS fts_table_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('articles_fts_ai','articles_fts_ad','articles_fts_au')) AS fts_trigger_count FROM articles\"", 1)
audit = audit.replace("const sources = Number(row.source_count || 0);\n", "const sources = Number(row.source_count || 0);\nconst ftsTables = Number(row.fts_table_count || 0);\nconst ftsTriggers = Number(row.fts_trigger_count || 0);\n", 1)
audit = audit.replace(
    "if (sources < 1) throw new Error('expected at least one source');\n\nconsole.log(`D1 production health: total=${total}, video=${video}, stale_non_video=${stale}, categories=${categories}, sources=${sources}`);",
    "if (sources < 1) throw new Error('expected at least one source');\nif (ftsTables !== 1) throw new Error(`expected articles_fts table, got ${ftsTables}`);\nif (ftsTriggers !== 3) throw new Error(`expected 3 FTS maintenance triggers, got ${ftsTriggers}`);\n\nconsole.log(`D1 production health: total=${total}, video=${video}, stale_non_video=${stale}, categories=${categories}, sources=${sources}, fts_table=${ftsTables}, fts_triggers=${ftsTriggers}`);", 1)
audit_path.write_text(audit, encoding='utf-8')

(root / '.deploy/worker-production.txt').write_text('CF-W5 production promotion: apply D1 FTS5 trigram migration before deploying indexed search.\n', encoding='utf-8')
