import fs from 'node:fs';
import path from 'node:path';

import {
  ARCHIVE_BACKFILL_MAX_LIMIT,
  HK01_HISTORICAL_ZONES,
  backfillApplyArticlesSql,
  backfillApplyStateAndMarkWrittenSql,
  backfillMarkCompletedSql,
  backfillPlanItemInsertSql,
  backfillRunFinalizeSql,
  backfillRunStateInsertSql,
  fetchBastilleHistoricalPage,
  fetchHk01HistoricalPage,
  seekBastillePageBeforeFloor,
  sqlLiteral,
} from '../src/archive-backfill.js';
import { hk01ContinuationFloor } from '../src/archive-backfill-policy.js';

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

function sourceFloor(rows, source, category = null) {
  const dates = rows
    .filter(row => row?.source === source && (!category || row?.category === category))
    .map(row => String(row?.pubDate || ''))
    .filter(Boolean)
    .sort();
  return dates[0] || '';
}

function stateFromRow(row, sourceKey, defaultCursor = '') {
  return {
    sourceKey,
    cursor: row?.cursor == null ? defaultCursor : String(row.cursor),
    pagesFetched: Number(row?.pages_fetched || 0),
    rowsInserted: Number(row?.rows_inserted || 0),
    lastPubDate: String(row?.last_pubDate || ''),
    exhausted: Number(row?.exhausted || 0) === 1,
  };
}

function eligibleNewArticles(articles, existingIds, selectedIds, floor = '') {
  return articles.filter(article => {
    if (!article?.id || existingIds.has(article.id) || selectedIds.has(article.id)) return false;
    if (floor && String(article.pubDate || '') >= floor) return false;
    return true;
  });
}

function takePageCandidates({ candidates, remaining, selected, selectedIds, state, nextCursor }) {
  const take = candidates.slice(0, remaining);
  for (const article of take) {
    selected.push(article);
    selectedIds.add(article.id);
  }

  state.rowsInserted += take.length;
  if (take.length > 0) {
    const oldest = take.map(item => item.pubDate).filter(Boolean).sort()[0] || '';
    if (!state.lastPubDate || (oldest && oldest < state.lastPubDate)) state.lastPubDate = oldest;
  }

  const consumedWholePage = take.length === candidates.length;
  if (consumedWholePage) {
    if (!nextCursor || nextCursor === state.cursor) state.exhausted = true;
    else state.cursor = nextCursor;
  }

  return { taken: take.length, consumedWholePage };
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function collectHk01({ target, existingRows, existingIds, stateRows, selected, selectedIds }) {
  if (target <= 0) return { pages: 0, target: 0, generated: 0, states: [] };

  const stateMap = new Map(stateRows.map(row => [String(row.source_key), row]));
  const globalFloor = sourceFloor(existingRows, '香港01');
  const states = new Map();
  const touched = new Set();
  for (const zone of HK01_HISTORICAL_ZONES) {
    const key = `hk01:zone:${zone.zoneId}`;
    states.set(key, stateFromRow(stateMap.get(key), key, ''));
  }

  const startCount = selected.length;
  const maxPages = Math.min(360, Math.max(90, Math.ceil(target / 10) * 4 + 60));
  let pages = 0;

  while (selected.length - startCount < target && pages < maxPages) {
    let roundAdvanced = false;

    for (const zone of HK01_HISTORICAL_ZONES) {
      if (selected.length - startCount >= target || pages >= maxPages) break;
      const key = `hk01:zone:${zone.zoneId}`;
      const state = states.get(key);
      if (state.exhausted) continue;

      touched.add(key);
      const oldCursor = state.cursor;
      const page = await fetchHk01HistoricalPage(zone, state.cursor);
      state.pagesFetched += 1;
      pages += 1;

      // Publication dates are not a reliable resume boundary because HK01 can
      // resurface old articles in a much newer feed page. Once a nextOffset has
      // been persisted, that cursor is the chronological owner. The pubDate
      // floor is only used for the initial bootstrap before a cursor exists.
      const bootstrapFloor = sourceFloor(existingRows, '香港01', zone.category) || globalFloor;
      const floor = hk01ContinuationFloor(stateMap.get(key), bootstrapFloor);
      const candidates = eligibleNewArticles(page.articles, existingIds, selectedIds, floor);
      const remaining = target - (selected.length - startCount);
      const { taken, consumedWholePage } = takePageCandidates({
        candidates,
        remaining,
        selected,
        selectedIds,
        state,
        nextCursor: page.nextCursor,
      });

      if (consumedWholePage && page.nextCursor && page.nextCursor !== oldCursor) roundAdvanced = true;
      if (taken > 0) roundAdvanced = true;
      if (selected.length - startCount >= target) break;
      await sleep(120);
    }

    if (!roundAdvanced) break;
  }

  const generated = selected.length - startCount;
  if (generated < target) {
    throw new Error(`HK01 backfill only produced ${generated}/${target} new rows within ${pages} pages`);
  }

  return {
    pages,
    target,
    generated,
    states: [...touched].map(key => states.get(key)),
  };
}

async function collectBastille({ target, existingRows, existingIds, stateRows, selected, selectedIds }) {
  if (target <= 0) return { pages: 0, target: 0, generated: 0, states: [] };

  const key = 'bastille:rss';
  const row = stateRows.find(item => String(item.source_key) === key);
  const state = stateFromRow(row, key, '1');
  const floor = sourceFloor(existingRows, '巴士的報');
  const startCount = selected.length;
  const maxPages = Math.min(180, Math.max(80, Math.ceil(target / 10) + 80));
  let pages = 0;


    if (!row && floor) {
      const seek = await seekBastillePageBeforeFloor(floor);
      state.cursor = String(seek.page);
      state.pagesFetched += seek.probes;
      pages += seek.probes;
    }
    
  while (selected.length - startCount < target && pages < maxPages && !state.exhausted) {
    const pageNumber = Number.parseInt(state.cursor || '1', 10);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) throw new Error('invalid Bastille resume cursor');

    const page = await fetchBastilleHistoricalPage(pageNumber);
    state.pagesFetched += 1;
    pages += 1;

    const candidates = eligibleNewArticles(page.articles, existingIds, selectedIds, floor);
    const remaining = target - (selected.length - startCount);
    const { consumedWholePage } = takePageCandidates({
      candidates,
      remaining,
      selected,
      selectedIds,
      state,
      nextCursor: page.nextCursor,
    });

    if (page.articles.length === 0) state.exhausted = true;
    if (!consumedWholePage) break;
    if (selected.length - startCount >= target) break;
    await sleep(180);
  }

  const generated = selected.length - startCount;
  if (generated < target) {
    throw new Error(`Bastille backfill only produced ${generated}/${target} new rows within ${pages} pages`);
  }

  return { pages, target, generated, states: [state] };
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

function writeBatchPlan({ outDir, batchId, source, requestedRows, beforeRows, articles, states }) {
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });

  const quotedBatch = sqlLiteral(batchId);
  fs.writeFileSync(
    path.join(outDir, 'plan-reset.sql'),
    `DELETE FROM archive_backfill_run_items WHERE batch_id=${quotedBatch};\nDELETE FROM archive_backfill_run_state WHERE batch_id=${quotedBatch};\nDELETE FROM archive_backfill_runs WHERE batch_id=${quotedBatch};\n`,
    'utf8',
  );

  const planItemStatements = articles.map((article, index) =>
    backfillPlanItemInsertSql(batchId, index + 1, article));
  const planItemFiles = writeStatementChunks(outDir, 'plan-items', planItemStatements, 50);

  fs.writeFileSync(
    path.join(outDir, 'plan-state.sql'),
    `${states.map(state => backfillRunStateInsertSql(batchId, state)).join('\n')}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(outDir, 'plan-finalize.sql'),
    `${backfillRunFinalizeSql({
      batchId,
      source,
      requestedRows,
      generatedRows: articles.length,
      beforeRows,
    })}\n`,
    'utf8',
  );

  const applyFiles = [];
  for (let start = 1; start <= articles.length; start += 50) {
    const end = Math.min(start + 49, articles.length);
    const file = path.join(outDir, `apply-articles-${String(applyFiles.length + 1).padStart(3, '0')}.sql`);
    fs.writeFileSync(file, `${backfillApplyArticlesSql(batchId, start, end)}\n`, 'utf8');
    applyFiles.push(file);
  }

  fs.writeFileSync(
    path.join(outDir, 'apply-state.sql'),
    `${backfillApplyStateAndMarkWrittenSql(batchId)}\n`,
    'utf8',
  );
  fs.writeFileSync(
    path.join(outDir, 'complete.sql'),
    `${backfillMarkCompletedSql(batchId)}\n`,
    'utf8',
  );

  return { planItemFiles, applyFiles };
}

const args = parseArgs(process.argv.slice(2));
const source = args.source || 'all';
const limit = Number.parseInt(args.limit || '500', 10);
const batchId = String(args['batch-id'] || '').trim();
const existingFile = args.existing || '';
const stateFile = args.state || '';
const outDir = args['out-dir'] || '/tmp/metro-news-archive-backfill';
const reportFile = args.report || path.join(outDir, 'report.json');

if (!['all', 'hk01', 'bastille'].includes(source)) throw new Error(`unsupported source: ${source}`);
if (!Number.isInteger(limit) || limit < 1 || limit > ARCHIVE_BACKFILL_MAX_LIMIT) {
  throw new Error(`limit must be 1..${ARCHIVE_BACKFILL_MAX_LIMIT}`);
}
if (!/^[A-Za-z0-9._-]{1,80}$/.test(batchId)) throw new Error('invalid batch id');

const existingRows = d1Rows(existingFile);
const stateRows = d1Rows(stateFile);
const beforeRows = Number.parseInt(args['before-rows'] || String(existingRows.length), 10);
if (!Number.isInteger(beforeRows) || beforeRows < 0) throw new Error('invalid before row count');
if (beforeRows !== existingRows.length) {
  throw new Error(`existing snapshot incomplete: before_rows=${beforeRows}, snapshot=${existingRows.length}`);
}

const existingIds = new Set(existingRows.map(row => String(row?.id || '')).filter(Boolean));
const selected = [];
const selectedIds = new Set();

const hkTarget = source === 'hk01' ? limit : source === 'all' ? Math.ceil(limit / 2) : 0;
const bastilleTarget = source === 'bastille' ? limit : source === 'all' ? limit - hkTarget : 0;

const hk = await collectHk01({
  target: hkTarget,
  existingRows,
  existingIds,
  stateRows,
  selected,
  selectedIds,
});
const bastille = await collectBastille({
  target: bastilleTarget,
  existingRows,
  existingIds,
  stateRows,
  selected,
  selectedIds,
});

if (selected.length !== limit) throw new Error(`generated ${selected.length}, expected exactly ${limit}`);

const touchedStates = [...(hk.states || []), ...(bastille.states || [])];
const planFiles = writeBatchPlan({
  outDir,
  batchId,
  source,
  requestedRows: limit,
  beforeRows,
  articles: selected,
  states: touchedStates,
});

const dates = selected.map(item => item.pubDate).filter(Boolean).sort();
const report = {
  batchId,
  source,
  requested: limit,
  generated: selected.length,
  beforeRows,
  hk01: { generated: hk.generated || 0, pages: hk.pages || 0 },
  bastille: { generated: bastille.generated || 0, pages: bastille.pages || 0 },
  oldest: dates[0] || '',
  newest: dates.at(-1) || '',
  planChunkCount: planFiles.planItemFiles.length,
  applyChunkCount: planFiles.applyFiles.length,
  existingRowsObserved: existingRows.length,
  stateRowsObserved: stateRows.length,
  touchedStateCount: touchedStates.length,
};
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report));
