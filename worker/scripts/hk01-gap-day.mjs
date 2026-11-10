// Manual UTC-day HK01 repair: no multi-year cursor changes or automatic retries.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverHk01SearchConfig, fetchHk01SearchWindow, hk01ArticleNumericId } from '../src/sources/hk01-search.js';
import { sqlLiteral } from '../src/archive-backfill.js';

const SHARDS = ['DB', 'ARCHIVE_01', 'ARCHIVE_02', 'ARCHIVE_03'];
const MAX_ROWS_PER_SHARD = 2000;
const MAX_READS_PER_RUN = 20000;
const MAX_ARCHIVE_SIZE = 300_000_000;

export function dayWindow(date, today = new Date().toISOString().slice(0, 10)) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2026-08-01' || date > today) {
    throw Error('Date must be UTC YYYY-MM-DD between 2026-08-01 and today');
  }
  const start = Date.parse(date + 'T00:00:00.000Z');
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== date) throw Error('Invalid date');
  return { start: new Date(start).toISOString(), end: new Date(start + 86400000).toISOString(),
    startEpoch: start / 1000, endEpoch: start / 1000 + 86400 };
}

export function dayIdentityQuery(range) {
  return "SELECT id,link FROM articles WHERE source='香港01' AND pubDate >= "
    + sqlLiteral(range.start) + ' AND pubDate < ' + sqlLiteral(range.end)
    + ' ORDER BY pubDate DESC,id DESC LIMIT ' + (MAX_ROWS_PER_SHARD + 1);
}

export function missingArticles(articles, shards, limit) {
  if (![100, 250, 500].includes(limit)) throw Error('Limit must be 100, 250, or 500');
  const ids = new Set(), numericIds = new Set();
  for (const rows of shards) for (const row of rows) {
    if (row.id) ids.add(String(row.id));
    if (row.link) ids.add(String(row.link));
    const id = hk01ArticleNumericId(row.link || row.id);
    if (id) numericIds.add(id);
  }
  const selected = [];
  let missing = 0;
  for (const row of articles) {
    if (!row?.id || !row?.link || !row?.pubDate) continue;
    const numeric = hk01ArticleNumericId(row.link);
    if (ids.has(row.id) || ids.has(row.link) || (numeric && numericIds.has(numeric))) continue;
    ids.add(row.id);
    ids.add(row.link);
    if (numeric) numericIds.add(numeric);
    missing++;
    if (selected.length < limit) selected.push(row);
  }
  return { selected, missing };
}

export function insertArticleSql(row) {
  if (!row?.id || !row?.title || !row?.pubDate || row?.source !== '香港01') throw Error('Invalid HK01 article');
  const fields = ['id', 'title', 'link', 'pubDate', 'description', 'category', 'source', 'imageUrl'];
  return 'INSERT OR IGNORE INTO articles (' + fields.join(',') + ') VALUES ('
    + fields.map(field => sqlLiteral(row[field] ?? '')).join(',') + ');';
}

function d1Output(text, label) {
  let data;
  try { data = JSON.parse(text); } catch { throw Error(label + ': invalid D1 JSON'); }
  const chunks = Array.isArray(data) ? data : Array.isArray(data?.result) ? data.result : [data];
  const first = chunks[0]?.result || chunks[0];
  if (chunks.length !== 1 || first?.success === false || !Array.isArray(first?.results)) {
    throw Error(label + ': D1 read unsuccessful');
  }
  return { rows: first.results, meta: first.meta || {} };
}

function wrangler(args) {
  const require = createRequire(import.meta.url);
  const path = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
  try {
    return execFileSync(process.execPath, [path, ...args], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (/7500|daily row read|exceeded D1/i.test(String(error?.stderr || ''))) {
      throw Error('D1 daily row-read limit reached (7500); stop and inspect account usage');
    }
    throw Error('Wrangler failed; no automatic retry or rollback attempted');
  }
}
function read(binding, command) {
  return d1Output(wrangler(['d1', 'execute', binding, '--remote', '--json', '--command', command]), binding);
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).filter(value => value.startsWith('--') && value.includes('='))
    .map(value => [value.slice(2, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]));
  const day = dayWindow(args.date || '');
  const limit = Number(args.limit || 100);
  const mode = args.mode || 'dry-run';
  if (!['dry-run', 'run'].includes(mode) || ![100, 250, 500].includes(limit)) throw Error('Invalid mode or limit');
  if (mode === 'run' && process.env.GAP_WRITE_CONFIRM !== 'ALLOW_ARCHIVE_03_WRITE') {
    throw Error('Explicit write confirmation is required');
  }

  const config = await discoverHk01SearchConfig();
  const found = await fetchHk01SearchWindow({ startEpoch: day.startEpoch, endEpoch: day.endEpoch, config });
  const snapshots = [];
  let readRows = 0;
  for (const binding of SHARDS) {
    const result = read(binding, dayIdentityQuery(day));
    readRows += Number(result.meta.rows_read || 0);
    if (result.rows.length > MAX_ROWS_PER_SHARD || readRows > MAX_READS_PER_RUN) {
      throw Error('Safe day-snapshot scan cap exceeded; stop without writing');
    }
    console.log('Existing ' + binding + ': ' + result.rows.length + ' identities');
    snapshots.push(result.rows);
  }
  const { selected, missing } = missingArticles(found.articles, snapshots, limit);
  const report = { utcDay: args.date, mode, limit, hk01Found: found.articles.length,
    missing, selected: selected.length, remaining: Math.max(0, missing - selected.length),
    d1RowsRead: readRows, destination: 'ARCHIVE_03' };
  console.log('Gap repair plan: ' + JSON.stringify(report));
  if (mode === 'dry-run' || selected.length === 0) {
    console.log(mode === 'dry-run' ? 'DRY RUN: no D1 writes' : 'Nothing missing on this day');
    return;
  }
  const capacity = Number(read('ARCHIVE_03', 'SELECT 1 AS probe').meta.size_after || 0);
  if (!(capacity > 0 && capacity < MAX_ARCHIVE_SIZE)) throw Error('ARCHIVE_03 size guard reached');
  for (let i = 0; i < selected.length; i += 25) {
    const sql = selected.slice(i, i + 25).map(insertArticleSql).join('\n');
    wrangler(['d1', 'execute', 'ARCHIVE_03', '--remote', '--command', sql]);
    console.log('Idempotent chunk ' + (1 + Math.floor(i / 25)) + ' written');
  }
  console.log('Done. No archive cursor or original articles changed.');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error('Gap repair stopped: ' + String(error.message || error).slice(0, 280)); process.exitCode = 1; });
}
