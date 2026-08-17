import fs from 'node:fs';
import path from 'node:path';

import {
  ARCHIVE_BACKFILL_MAX_LIMIT,
  backfillPlanItemInsertSql,
  backfillRunFinalizeSql,
  backfillRunStateInsertSql,
  sqlLiteral,
} from '../src/archive-backfill.js';
import {
  HK01_SEARCH_EARLIEST_EPOCH,
  discoverHk01SearchConfig,
  fetchHk01SearchWindow,
  hk01ArticleNumericId,
} from '../src/sources/hk01-search.js';

function parseArgs(argv) {
  const args = {};
  for (const raw of argv) {
    if (!raw.startsWith('--')) continue;
    const [key, ...parts] = raw.slice(2).split('=');
    args[key] = parts.join('=');
  }
  return args;
}

function d1Rows(file) {
  if (!file || !fs.existsSync(file)) return [];
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const chunks = Array.isArray(payload) ? payload : [payload];
  const rows = [];
  for (const chunk of chunks) {
    if (Array.isArray(chunk?.results)) rows.push(...chunk.results);
    else if (Array.isArray(chunk?.result?.results)) rows.push(...chunk.result.results);
  }
  return rows;
}

function stateFromRow(row) {
  return {
    sourceKey: 'hk01:search',
    cursor: row?.cursor == null ? '' : String(row.cursor),
    pagesFetched: Number(row?.pages_fetched || 0),
    rowsInserted: Number(row?.rows_inserted || 0),
    lastPubDate: String(row?.last_pubDate || ''),
    exhausted: Number(row?.exhausted || 0) === 1,
  };
}

function nextUtcDayEpoch(now = Date.now()) {
  return Math.floor(now / 86_400_000) * 86_400 + 86_400;
}

function updateStateAfterTake(state, take) {
  state.rowsInserted += take.length;
  if (take.length === 0) return;
  const oldest = take.map(item => item.pubDate).filter(Boolean).sort()[0] || '';
  if (!state.lastPubDate || (oldest && oldest < state.lastPubDate)) state.lastPubDate = oldest;
}

function writeStatementChunks(outDir, prefix, statements, chunkSize = 50) {
  const files = [];
  for (let i = 0; i < statements.length; i += chunkSize) {
    const file = path.join(outDir, `${prefix}-${String(i / chunkSize + 1).padStart(3, '0')}.sql`);
    fs.writeFileSync(file, `${statements.slice(i, i + chunkSize).join('\n')}\n`, 'utf8');
    files.push(file);
  }
  return files;
}

function writeBatchPlan({ outDir, batchId, requestedRows, beforeRows, articles, state }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const quotedBatch = sqlLiteral(batchId);
  fs.writeFileSync(
    path.join(outDir, 'plan-reset.sql'),
    `DELETE FROM archive_backfill_run_items WHERE batch_id=${quotedBatch};\nDELETE FROM archive_backfill_run_state WHERE batch_id=${quotedBatch};\nDELETE FROM archive_backfill_runs WHERE batch_id=${quotedBatch};\n`,
    'utf8',
  );

  const planItems = articles.map((article, index) => backfillPlanItemInsertSql(batchId, index + 1, article));
  const planItemFiles = writeStatementChunks(outDir, 'plan-items', planItems, 50);
  fs.writeFileSync(
    path.join(outDir, 'plan-state.sql'),
    `${backfillRunStateInsertSql(batchId, state)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(outDir, 'plan-finalize.sql'),
    `${backfillRunFinalizeSql({
      batchId,
      source: 'hk01',
      requestedRows,
      generatedRows: articles.length,
      beforeRows,
    })}\n`,
    'utf8',
  );
  return { planItemFiles };
}

const args = parseArgs(process.argv.slice(2));
const batchId = String(args['batch-id'] || '').trim();
const limit = Number.parseInt(args.limit || '1000', 10);
const beforeRows = Number.parseInt(args['before-rows'] || '', 10);
const existingFile = args.existing || '';
const stateFile = args.state || '';
const outDir = args['out-dir'] || '/tmp/hk01-search-backfill';
const reportFile = args.report || path.join(outDir, 'report.json');

if (!/^[A-Za-z0-9._-]{1,80}$/.test(batchId)) throw new Error('invalid batch id');
if (!Number.isInteger(limit) || limit < 1 || limit > ARCHIVE_BACKFILL_MAX_LIMIT) {
  throw new Error(`limit must be 1..${ARCHIVE_BACKFILL_MAX_LIMIT}`);
}
if (!Number.isInteger(beforeRows) || beforeRows < 0) throw new Error('invalid before row count');

const existingRows = d1Rows(existingFile).filter(row => row?.source === '香港01');
const stateRows = d1Rows(stateFile);
const state = stateFromRow(stateRows.find(row => String(row?.source_key) === 'hk01:search'));
if (state.exhausted) throw new Error('HK01 universal search history is already exhausted');

let endEpoch = Number.parseInt(state.cursor || '', 10);
if (!Number.isSafeInteger(endEpoch) || endEpoch <= HK01_SEARCH_EARLIEST_EPOCH) {
  endEpoch = state.cursor ? HK01_SEARCH_EARLIEST_EPOCH : nextUtcDayEpoch();
}
if (endEpoch <= HK01_SEARCH_EARLIEST_EPOCH) throw new Error('HK01 universal search history is exhausted');

const existingIds = new Set(existingRows.map(row => String(row?.id || '')).filter(Boolean));
const existingArticleIds = new Set(
  existingRows.map(row => hk01ArticleNumericId(row?.link || row?.id)).filter(Boolean),
);
const selected = [];
const selectedIds = new Set();
const selectedArticleIds = new Set();
const config = await discoverHk01SearchConfig();
const maxWindows = 45;
let windows = 0;
let requests = 0;

while (selected.length < limit && windows < maxWindows && !state.exhausted) {
  const startEpoch = Math.max(HK01_SEARCH_EARLIEST_EPOCH, endEpoch - 86_400);
  const result = await fetchHk01SearchWindow({ startEpoch, endEpoch, config });
  windows += 1;
  requests += result.requests;
  state.pagesFetched += result.requests;

  const candidates = result.articles.filter(article => {
    if (!article?.id || existingIds.has(article.id) || selectedIds.has(article.id)) return false;
    const numericId = hk01ArticleNumericId(article.link || article.id);
    if (numericId && (existingArticleIds.has(numericId) || selectedArticleIds.has(numericId))) return false;
    return true;
  });

  const remaining = limit - selected.length;
  const take = candidates.slice(0, remaining);
  for (const article of take) {
    selected.push(article);
    selectedIds.add(article.id);
    const numericId = hk01ArticleNumericId(article.link || article.id);
    if (numericId) selectedArticleIds.add(numericId);
  }
  updateStateAfterTake(state, take);

  // Advance only after the whole time window is consumed. When the batch fills
  // inside a day, the durable cursor intentionally stays at the same end time.
  // The next run re-queries that day and de-duplicates already materialized IDs,
  // so no mutable search-page offset is persisted.
  if (take.length === candidates.length) {
    state.cursor = String(startEpoch);
    endEpoch = startEpoch;
    if (startEpoch <= HK01_SEARCH_EARLIEST_EPOCH) state.exhausted = true;
  }

  if (selected.length >= limit) break;
  if (take.length < candidates.length) break;
}

if (selected.length !== limit) {
  throw new Error(`HK01 search planner generated ${selected.length}/${limit} rows across ${windows} windows`);
}

const plan = writeBatchPlan({
  outDir,
  batchId,
  requestedRows: limit,
  beforeRows,
  articles: selected,
  state,
});
const dates = selected.map(item => item.pubDate).filter(Boolean).sort();
const report = {
  batchId,
  source: 'hk01',
  requested: limit,
  generated: selected.length,
  beforeRows,
  existingHk01RowsObserved: existingRows.length,
  windows,
  searchRequests: requests,
  oldest: dates[0] || '',
  newest: dates.at(-1) || '',
  nextCursor: state.cursor,
  exhausted: state.exhausted,
  planChunkCount: plan.planItemFiles.length,
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report));
