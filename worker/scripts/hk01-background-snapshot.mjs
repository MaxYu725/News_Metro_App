import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHARDS = ['ARCHIVE_01', 'ARCHIVE_02'];
const PAGE_SIZE = 5000;
const quote = value => `'${String(value).replaceAll("'", "''")}'`;
const bounded = (value, limit = 300) => String(value ?? '').slice(0, limit);

export function snapshotLowerBound(state) {
  const cursor = Number.parseInt(state?.[0]?.results?.[0]?.cursor || '', 10);
  const epoch = 1451606400;
  return Number.isSafeInteger(cursor) && cursor > epoch
    ? new Date(Math.max(epoch, cursor - 46 * 86400) * 1000).toISOString() : null;
}

export function buildSnapshotQuery({ lowerBound = null, after = null, pageSize = PAGE_SIZE } = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > PAGE_SIZE) {
    throw new Error('Snapshot page size must be between 1 and 5000');
  }
  const conditions = ["source='香港01'"];
  if (lowerBound) conditions.push(`pubDate >= ${quote(lowerBound)}`);
  if (after) {
    conditions.push(`(pubDate < ${quote(after.pubDate)} OR (pubDate = ${quote(after.pubDate)} AND id < ${quote(after.id)}))`);
  }
  return `SELECT id,link,source,pubDate FROM articles WHERE ${conditions.join(' AND ')} ORDER BY pubDate DESC,id DESC LIMIT ${pageSize}`;
}

function failure(context, code, message, notes = []) {
  return Object.assign(new Error(bounded(message)), {
    shard: context.binding, page: context.page,
    code: typeof code === 'number' ? code : bounded(code, 80),
    notes: (Array.isArray(notes) ? notes : []).slice(0, 3).map(note => bounded(note?.text ?? note?.message ?? note, 200)),
  });
}

function apiFailure(payload, context) {
  if (Array.isArray(payload)) {
    for (const chunk of payload) {
      const error = apiFailure(chunk, context);
      if (error) return error;
    }
  } else if (payload && typeof payload === 'object') {
    const detail = payload.error || payload.errors?.[0];
    if (detail || payload.success === false) {
      const message = String(typeof detail === 'string' ? detail : detail?.message || detail?.text || 'D1 query failed');
      const code = detail?.code ?? (Number(message.match(/\[code:\s*(\d+)\]/)?.[1]) || 'D1_ERROR');
      return failure(context, code, message, detail?.notes);
    }
    if (payload.result) return apiFailure(payload.result, context);
  }
  return null;
}

function parsePage(raw, context) {
  let payload;
  try { payload = JSON.parse(raw); }
  catch { throw failure(context, 'INVALID_JSON', 'Wrangler returned invalid JSON'); }
  const error = apiFailure(payload, context);
  if (error) throw error;
  const chunks = Array.isArray(payload) ? payload : Array.isArray(payload?.result) ? payload.result : [payload];
  const chunk = chunks[0]?.result ?? chunks[0];
  if (chunks.length !== 1 || !Array.isArray(chunk?.results)) {
    throw failure(context, 'INVALID_RESPONSE', 'Expected exactly one D1 query result');
  }
  return chunk.results;
}

function executeD1({ binding, query }) {
  const require = createRequire(import.meta.url);
  const wrangler = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
  return execFileSync(process.execPath, [wrangler, 'd1', 'execute', binding, '--remote', '--json', '--command', query], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// SQLite's default BINARY text ordering compares UTF-8 bytes, including astral characters.
const compare = (a, b) => Buffer.compare(Buffer.from(a.pubDate), Buffer.from(b.pubDate))
  || Buffer.compare(Buffer.from(a.id), Buffer.from(b.id));

export async function collectSnapshot({ binding, lowerBound = null, pageSize = PAGE_SIZE, execute = executeD1 }) {
  if (!SHARDS.includes(binding)) throw new Error('Unknown archive shard');
  const rows = [];
  let after = null;
  for (let page = 1; ; page++) {
    const context = { binding, page };
    const query = buildSnapshotQuery({ lowerBound, after, pageSize });
    let raw;
    try { raw = await execute({ binding, query, page }); }
    catch (error) {
      for (const output of [error.stdout, error.stderr]) {
        let payload;
        try { payload = JSON.parse(output); } catch { continue; }
        const detail = apiFailure(payload, context);
        if (detail) throw detail;
      }
      throw failure(context, error.code || 'COMMAND_FAILED', 'Wrangler query command failed');
    }
    const batch = parsePage(raw, context);
    if (batch.length > pageSize) throw failure(context, 'INVALID_RESPONSE', 'D1 page exceeded requested limit');
    let previous = after;
    for (const row of batch) {
      if (!row || ['id', 'link', 'source', 'pubDate'].some(key => typeof row[key] !== 'string')
        || !row.id || !row.pubDate || row.source !== '香港01' || (lowerBound && row.pubDate < lowerBound)) {
        throw failure(context, 'INVALID_RESPONSE', 'D1 returned an invalid identity row');
      }
      if (previous && compare(row, previous) >= 0) {
        throw failure(context, 'NON_ADVANCING_PAGE', 'D1 keyset page did not advance in descending order');
      }
      previous = row;
      rows.push(row);
    }
    if (batch.length < pageSize) return [{ results: rows }];
    after = batch.at(-1);
  }
}

export async function runSnapshot({ stateFile, outDir = tmpdir(), execute = executeD1, log = console.log }) {
  const lowerBound = snapshotLowerBound(JSON.parse(readFileSync(stateFile, 'utf8')));
  const snapshots = [];
  for (const binding of SHARDS) {
    snapshots.push(await collectSnapshot({ binding, lowerBound, execute }));
  }
  for (let i = 0; i < SHARDS.length; i++) {
    writeFileSync(join(outDir, `${SHARDS[i].toLowerCase()}-existing.json`), JSON.stringify(snapshots[i]));
    log(`Background dedupe shard: ${SHARDS[i]} rows=${snapshots[i][0].results.length} page_size=${PAGE_SIZE}`);
  }
  log(lowerBound
    ? `Background dedupe snapshot: bounded_46d from=${lowerBound} across ARCHIVE_01+ARCHIVE_02`
    : 'Background dedupe snapshot: full bootstrap scan across ARCHIVE_01+ARCHIVE_02');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (const arg of process.argv.slice(2)) {
      if (arg.startsWith('--state=')) options.stateFile = arg.slice('--state='.length);
      else if (arg.startsWith('--out-dir=')) options.outDir = arg.slice('--out-dir='.length);
      else throw new Error('Unknown snapshot argument');
    }
    if (!options.stateFile) throw new Error('Missing snapshot state file');
    await runSnapshot(options);
  } catch (error) {
    console.error(JSON.stringify({
      shard: error.shard ?? null, page: error.page ?? null, code: error.code || 'SNAPSHOT_FAILED',
      message: error.shard ? error.message : 'Unable to build HK01 dedupe snapshot', notes: error.notes || [],
    }));
    process.exitCode = 1;
  }
}
