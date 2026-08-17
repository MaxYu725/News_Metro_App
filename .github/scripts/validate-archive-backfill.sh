#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/worker"

state=$(mktemp -d)
work=$(mktemp -d)
trap 'rm -rf "$state" "$work"' EXIT

npx wrangler d1 migrations apply metro_news_archive_01 --local --persist-to "$state" >/dev/null

WORK_DIR="$work" node --input-type=module <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
import {
  backfillApplyArticlesSql,
  backfillApplyStateAndMarkWrittenSql,
  backfillMarkCompletedSql,
  backfillPlanItemInsertSql,
  backfillRunFinalizeSql,
  backfillRunStateInsertSql,
} from './src/archive-backfill.js';

const dir = process.env.WORK_DIR;
const batch = 'local-lifecycle';
const articles = [
  {
    id: 'https://example.test/archive-1',
    title: '香港歷史批次測試一',
    link: 'https://example.test/archive-1',
    pubDate: '2026-06-01T00:00:00.000Z',
    description: '歷史內容一',
    category: 'local',
    source: 'test',
    imageUrl: '',
  },
  {
    id: 'https://example.test/archive-2',
    title: '香港歷史批次測試二',
    link: 'https://example.test/archive-2',
    pubDate: '2026-05-31T00:00:00.000Z',
    description: '歷史內容二',
    category: 'local',
    source: 'test',
    imageUrl: '',
  },
];
const state = {
  sourceKey: 'test:source',
  cursor: '52',
  pagesFetched: 5,
  rowsInserted: 2,
  lastPubDate: '2026-05-31T00:00:00.000Z',
  exhausted: false,
};
fs.writeFileSync(path.join(dir, 'plan-items.sql'), articles.map((a, i) => backfillPlanItemInsertSql(batch, i + 1, a)).join('\n') + '\n');
fs.writeFileSync(path.join(dir, 'plan-state.sql'), backfillRunStateInsertSql(batch, state) + '\n');
fs.writeFileSync(path.join(dir, 'plan-finalize.sql'), backfillRunFinalizeSql({
  batchId: batch,
  source: 'all',
  requestedRows: 2,
  generatedRows: 2,
  beforeRows: 0,
  now: '2026-08-17T00:00:00.000Z',
}) + '\n');
fs.writeFileSync(path.join(dir, 'apply-articles.sql'), backfillApplyArticlesSql(batch, 1, 50) + '\n');
fs.writeFileSync(path.join(dir, 'apply-state.sql'), backfillApplyStateAndMarkWrittenSql(batch, '2026-08-17T00:01:00.000Z') + '\n');
fs.writeFileSync(path.join(dir, 'complete.sql'), backfillMarkCompletedSql(batch, '2026-08-17T00:02:00.000Z') + '\n');
NODE

for file in plan-items.sql plan-state.sql plan-finalize.sql apply-articles.sql apply-state.sql; do
  npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --file "$work/$file" >/dev/null
done

npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --json \
  --command "SELECT r.status,r.generated_rows,(SELECT COUNT(*) FROM articles) AS total,(SELECT COUNT(*) FROM archive_backfill_run_items WHERE batch_id=r.batch_id) AS plan_rows,(SELECT cursor FROM archive_backfill_state WHERE source_key='test:source') AS cursor,(SELECT COUNT(*) FROM articles_fts WHERE articles_fts MATCH '\"香港歷史批次\"') AS fts_hits FROM archive_backfill_runs r WHERE batch_id='local-lifecycle'" \
  > /tmp/ns2c3-local-lifecycle.json

node <<'NODE'
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('/tmp/ns2c3-local-lifecycle.json','utf8'));
const first = Array.isArray(p) ? p[0] : p;
const row = first?.results?.[0];
if (!row) throw new Error('local archive lifecycle returned no row');
if (row.status !== 'written') throw new Error(`expected written, got ${row.status}`);
if (Number(row.generated_rows) !== 2 || Number(row.total) !== 2 || Number(row.plan_rows) !== 2) throw new Error('local archive materialization counts mismatch');
if (String(row.cursor) !== '52') throw new Error(`resume cursor did not advance: ${row.cursor}`);
if (Number(row.fts_hits) !== 2) throw new Error(`FTS triggers did not index planned rows: ${row.fts_hits}`);
NODE

npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --file "$work/complete.sql" >/dev/null
npx wrangler d1 execute metro_news_archive_01 --local --persist-to "$state" --json \
  --command "SELECT status,completed_at FROM archive_backfill_runs WHERE batch_id='local-lifecycle'" \
  > /tmp/ns2c3-local-completed.json
node <<'NODE'
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('/tmp/ns2c3-local-completed.json','utf8'));
const first = Array.isArray(p) ? p[0] : p;
const row = first?.results?.[0];
if (row?.status !== 'completed' || !row?.completed_at) throw new Error('local archive batch completion failed');
NODE

echo 'Archive replayable batch lifecycle + FTS: PASS'
