// Durable finite HK01 gap cursor: never derive dates from delayed GitHub cron timestamps.
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { readFileSync, unlinkSync, existsSync, appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { sqlLiteral } from '../src/archive-backfill.js';

export const GAP_START = '2026-08-17';
export const GAP_END = '2026-11-09';
export const MAX_CYCLES = 2;
export const STATE_KEY = 'hk01-2026-aug-nov-v1';
export const FIRST_SLOT_UTC = '2026-11-10T18:00:00.000Z';
export const DAY_COUNT = Math.round((Date.parse(GAP_END) - Date.parse(GAP_START)) / 86400000) + 1;
const database = 'ARCHIVE_03';
const scriptDir = dirname(fileURLToPath(import.meta.url));

function plusDays(day, increment) {
  return new Date(Date.parse(day + 'T00:00:00.000Z') + increment * 86400000)
    .toISOString().slice(0, 10);
}

export function validateRecoveryState(state) {
  const cycle = Number(state?.cycle);
  const completedDays = Number(state?.completed_days);
  const nextDate = String(state?.next_date || '');
  if (!Number.isInteger(cycle) || cycle < 1 || cycle > MAX_CYCLES + 1
      || !Number.isInteger(completedDays) || completedDays < 0 || completedDays > MAX_CYCLES * DAY_COUNT) {
    throw Error('Invalid durable HK01 recovery state');
  }
  const expectedDays = cycle > MAX_CYCLES ? MAX_CYCLES * DAY_COUNT
    : (cycle - 1) * DAY_COUNT + Math.round((Date.parse(nextDate) - Date.parse(GAP_START)) / 86400000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nextDate)
      || (cycle > MAX_CYCLES && nextDate !== plusDays(GAP_END, 1))
      || (cycle <= MAX_CYCLES && (nextDate < GAP_START || nextDate > GAP_END))
      || completedDays !== expectedDays) {
    throw Error('Durable HK01 cursor disagrees with the completed-day count');
  }
  return { cycle, nextDate, completedDays, done: cycle > MAX_CYCLES };
}

export function advanceRecoveryState(state) {
  const current = validateRecoveryState(state);
  if (current.done) return null;
  const atEnd = current.nextDate === GAP_END;
  const cycle = atEnd ? current.cycle + 1 : current.cycle;
  const nextDate = atEnd
    ? cycle > MAX_CYCLES ? plusDays(GAP_END, 1) : GAP_START
    : plusDays(current.nextDate, 1);
  return {
    cycle, nextDate, completedDays: current.completedDays + 1,
    lastCompletedDate: current.nextDate,
  };
}

export function progressTableSql() {
  return 'CREATE TABLE IF NOT EXISTS hk01_gap_recovery_state ('
    + 'id TEXT PRIMARY KEY,'
    + 'cycle INTEGER NOT NULL CHECK(cycle >= 1 AND cycle <= 3),'
    + 'next_date TEXT NOT NULL,'
    + 'completed_days INTEGER NOT NULL,'
    + 'last_completed_date TEXT,'
    + 'updated_at TEXT NOT NULL)';
}
export function progressInitialSql(now = new Date().toISOString()) {
  return 'INSERT OR IGNORE INTO hk01_gap_recovery_state '
    + '(id,cycle,next_date,completed_days,last_completed_date,updated_at) VALUES ('
    + [sqlLiteral(STATE_KEY), '1', sqlLiteral(GAP_START), '0', 'NULL', sqlLiteral(now)].join(',') + ')';
}
export function progressAdvanceSql(before, after, now = new Date().toISOString()) {
  const state = validateRecoveryState(before);
  const expected = advanceRecoveryState(state);
  if (!expected || !after
      || after.cycle !== expected.cycle || after.nextDate !== expected.nextDate
      || after.completedDays !== expected.completedDays || after.lastCompletedDate !== expected.lastCompletedDate) {
    throw Error('Cannot advance an incomplete or invalid HK01 recovery cursor');
  }
  return 'UPDATE hk01_gap_recovery_state SET '
    + 'cycle=' + after.cycle + ',next_date=' + sqlLiteral(after.nextDate)
    + ',completed_days=' + after.completedDays
    + ',last_completed_date=' + sqlLiteral(after.lastCompletedDate)
    + ',updated_at=' + sqlLiteral(now)
    + ' WHERE id=' + sqlLiteral(STATE_KEY)
    + ' AND cycle=' + state.cycle
    + ' AND next_date=' + sqlLiteral(state.nextDate)
    + ' AND completed_days=' + state.completedDays
    + ' RETURNING cycle,next_date,completed_days';
}

function wranglerPath() {
  const require = createRequire(import.meta.url);
  return join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');
}
function wrangler(args) {
  try {
    return execFileSync(process.execPath, [wranglerPath(), ...args], {
      cwd: resolve(scriptDir, '..'), encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const message = String(error?.stderr || error?.message || '');
    if (/7500|daily row read|exceeded D1/i.test(message)) {
      throw Error('D1 daily quota exceeded; durable HK01 cursor unchanged');
    }
    throw Error('Durable HK01 cursor D1 operation failed; cursor unchanged');
  }
}
function d1(sql) {
  const raw = wrangler(['d1', 'execute', database, '--remote', '--json', '--command', sql]);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw Error('D1 cursor query returned invalid JSON'); }
  const chunks = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.result) ? parsed.result : [parsed];
  if (chunks.length !== 1) throw Error('D1 cursor query returned unexpected chunks');
  const data = chunks[0]?.result || chunks[0];
  if (data?.success === false || !Array.isArray(data?.results)) throw Error('D1 cursor query did not succeed');
  return data.results;
}
function jobSummary(lines) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join('\n') + '\n', 'utf8');
  }
}
export function shouldAttemptRecovery(now = Date.now()) {
  const time = typeof now === 'number' ? now : new Date(now).getTime();
  if (!Number.isFinite(time)) throw Error('Invalid current time');
  return time >= Date.parse(FIRST_SLOT_UTC);
}

async function main() {
  if (!shouldAttemptRecovery()) {
    console.log('Recovery start boundary not reached; no D1 operations');
    return;
  }
  if (process.env.GAP_WRITE_CONFIRM !== 'ALLOW_ARCHIVE_03_WRITE') {
    throw Error('Explicit production D1 write confirmation is required');
  }
  // Only ARCHIVE_03 contains this operational cursor; existing archive states untouched.
  d1(progressTableSql());
  d1(progressInitialSql());
  const records = d1('SELECT cycle,next_date,completed_days FROM hk01_gap_recovery_state WHERE id='
    + sqlLiteral(STATE_KEY) + ' LIMIT 1');
  if (records.length !== 1) throw Error('Durable HK01 progress row missing');
  const state = validateRecoveryState(records[0]);
  if (state.done) {
    console.log('HK01 gap recovery finished: ' + state.completedDays + ' day-passes; no article writes');
    jobSummary(['## HK01 gap recovery', '- Finished: ' + state.completedDays + ' day-passes']);
    return;
  }
  console.log('Durable gap cursor: cycle=' + state.cycle + '/' + MAX_CYCLES
    + ', UTC day=' + state.nextDate + ', completed=' + state.completedDays
    + '/' + (MAX_CYCLES * DAY_COUNT));
  const reportFile = '/tmp/hk01-gap-recovery-' + process.pid + '.json';
  if (existsSync(reportFile)) unlinkSync(reportFile);
  try {
    execFileSync(process.execPath, [
      join(scriptDir, 'hk01-gap-day.mjs'), '--date=' + state.nextDate,
      '--mode=run', '--limit=500', '--report-file=' + reportFile,
    ], { cwd: resolve(scriptDir, '..'), stdio: 'inherit' });
    if (!existsSync(reportFile)) throw Error('Verified day report missing; cursor unchanged');
    const report = JSON.parse(readFileSync(reportFile, 'utf8'));
    if (report.utcDay !== state.nextDate || report.mode !== 'run' || report.verified !== true
        || !Number.isInteger(report.remainingAfterWrite) || report.remainingAfterWrite < 0) {
      throw Error('Invalid day verification report; cursor unchanged');
    }
    if (!report.complete || report.remainingAfterWrite !== 0) {
      console.log('UTC ' + state.nextDate + ' still has ' + report.remainingAfterWrite
        + ' missing articles; next run retries SAME day');
      jobSummary(['## HK01 gap recovery', '- Pending: ' + state.nextDate + ' (cycle ' + state.cycle + ')',
        '- Remaining: ' + report.remainingAfterWrite, '- Cursor not advanced']);
      return;
    }
    const next = advanceRecoveryState(state);
    const rows = d1(progressAdvanceSql(state, next));
    if (rows.length !== 1 || Number(rows[0].completed_days) !== next.completedDays
        || Number(rows[0].cycle) !== next.cycle || rows[0].next_date !== next.nextDate) {
      throw Error('D1 cursor compare-and-swap failed; retry current day');
    }
    console.log('Durable cursor advanced: ' + state.nextDate + ' completed, next='
      + next.nextDate + ', cycle=' + next.cycle + ', completed=' + next.completedDays);
    jobSummary(['## HK01 gap recovery', '- Completed UTC day: ' + state.nextDate,
      '- Cycle: ' + state.cycle + '/' + MAX_CYCLES,
      '- Next day: ' + next.nextDate,
      '- Completed: ' + next.completedDays + '/' + (MAX_CYCLES * DAY_COUNT)]);
  } finally {
    if (existsSync(reportFile)) unlinkSync(reportFile);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error('Durable HK01 recovery stopped: ' + String(error?.message || error).slice(0, 400));
    process.exitCode = 1;
  });
}
