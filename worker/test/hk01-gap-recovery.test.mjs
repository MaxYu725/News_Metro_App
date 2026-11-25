import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GAP_START,GAP_END,DAY_COUNT,MAX_CYCLES,FIRST_SLOT_UTC,
  advanceRecoveryState,validateRecoveryState,progressTableSql,
  progressInitialSql,progressAdvanceSql,shouldAttemptRecovery,verifiedDayResult,
  recoverConsecutiveDays, MAX_DAYS_PER_RUN, MAX_ARTICLES_PER_DAY,
} from '../scripts/hk01-gap-recovery.mjs';

test('delayed or dropped cron invocations do not skip a UTC day', () => {
  let state = { cycle: 1, next_date: GAP_START, completed_days: 0 };
  const seen = [];
  for (let n = 0; n < MAX_CYCLES * DAY_COUNT; n++) {
    const before = validateRecoveryState(state);
    seen.push(before.nextDate);
    const next = advanceRecoveryState(before);
    assert.equal(next.completedDays, n + 1);
    // Real clock time is intentionally absent from progression.
    state = { cycle: next.cycle, next_date: next.nextDate, completed_days: next.completedDays };
  }
  assert.equal(DAY_COUNT, 85);
  assert.equal(seen.length, 170);
  assert.equal(seen[0], '2026-08-17');
  assert.equal(seen[84], GAP_END);
  assert.equal(seen[85], GAP_START);
  assert.equal(seen[169], GAP_END);
  assert.deepEqual(validateRecoveryState(state), {
    cycle: 3, nextDate: '2026-11-10', completedDays: 170, done: true,
  });
  assert.equal(advanceRecoveryState(state), null);
});

test('state mismatch and improper movement fail closed', () => {
  for (const invalid of [
    null,
    { cycle: 1, next_date: '2026-08-18', completed_days: 0 },
    { cycle: 2, next_date: GAP_START, completed_days: 0 },
    { cycle: 1, next_date: '2026-09-99', completed_days: 44 },
    { cycle: 2, next_date: GAP_END, completed_days: 168 },
    { cycle: 3, next_date: GAP_END, completed_days: 170 },
    { cycle: 5, next_date: GAP_START, completed_days: 170 },
  ]) {
    assert.throws(() => validateRecoveryState(invalid));
  }
});

test('progress is stored in archive03 state table and advanced with CAS', () => {
  assert.match(progressTableSql(), /^CREATE TABLE IF NOT EXISTS hk01_gap_recovery_state/);
  assert.match(progressInitialSql('2026-11-11T00:00:00.000Z'), /^INSERT OR IGNORE INTO hk01_gap_recovery_state/);
  const state = { cycle: 1, next_date: GAP_START, completed_days: 0 };
  const next = advanceRecoveryState(state);
  const sql = progressAdvanceSql(state, next, '2026-11-11T00:00:00.000Z');
  assert.match(sql, /WHERE id='hk01-2026-aug-nov-v1'/);
  assert.match(sql, /AND cycle=1/);
  assert.match(sql, /AND next_date='2026-08-17'/);
  assert.match(sql, /AND completed_days=0/);
  assert.match(sql, /RETURNING cycle,next_date,completed_days$/);
  assert.doesNotMatch(sql, /archive_backfill_state|DELETE FROM|UPDATE articles/);
  assert.throws(() => progressAdvanceSql(state, { ...next, nextDate: GAP_END }));
});

test('day report must be post-write verified, for the requested date', () => {
  const sample = { utcDay: GAP_START,mode: 'run',verified: true,
    hk01Found: 550,archive03Identities: 500,remainingAfterWrite: 50,complete: false };
  assert.deepEqual(verifiedDayResult(sample,GAP_START), { complete: false, remaining: 50 });
  assert.deepEqual(verifiedDayResult({ ...sample,remainingAfterWrite: 0,complete: true },GAP_START),
    { complete: true, remaining: 0 });
  for (const invalid of [
    { ...sample, complete: true },
    { ...sample, verified: false },
    { ...sample, utcDay: '2026-08-18' },
    { ...sample, remainingAfterWrite: -1 },
    { ...sample, remainingAfterWrite: undefined },
  ]) assert.throws(() => verifiedDayResult(invalid,GAP_START));
});

test('only the start boundary uses wall clock time', () => {
  assert.equal(shouldAttemptRecovery(Date.parse(FIRST_SLOT_UTC) - 1),false);
  assert.equal(shouldAttemptRecovery(Date.parse(FIRST_SLOT_UTC)),true);
  assert.equal(shouldAttemptRecovery('2027-02-01T00:00:00Z'),true);
  assert.throws(() => shouldAttemptRecovery('bad'));
});

const reportFor = (state, remaining = 0) => ({
  utcDay: state.nextDate, mode: 'run', verified: true,
  hk01Found: 550, archive03Identities: 550 - remaining,
  remainingAfterWrite: remaining, complete: remaining === 0,
});

test('three-day acceleration commits every day separately and caps article selection', async () => {
  const seen = [], committed = [];
  const result = await recoverConsecutiveDays({cycle:1,next_date:GAP_START,completed_days:0},
    state => { seen.push(state.nextDate); return reportFor(state); },
    (state,next) => committed.push(next.lastCompletedDate));
  assert.deepEqual(seen, ['2026-08-17','2026-08-18','2026-08-19']);
  assert.deepEqual(committed, seen);
  assert.equal(result.state.nextDate,'2026-08-20');
  assert.equal(result.advanced,3);
  assert.equal(MAX_DAYS_PER_RUN * MAX_ARTICLES_PER_DAY,1500);
});

test('partial day stops batch without skipping or undoing earlier completed days', async () => {
  const seen = [], committed = [];
  const result = await recoverConsecutiveDays({cycle:1,next_date:GAP_START,completed_days:0},
    state => { seen.push(state.nextDate); return reportFor(state, seen.length === 2 ? 50 : 0); },
    (state,next) => committed.push(next.lastCompletedDate));
  assert.deepEqual(seen, ['2026-08-17','2026-08-18']);
  assert.deepEqual(committed, ['2026-08-17']);
  assert.equal(result.state.nextDate,'2026-08-18');
  assert.equal(result.remaining,50);
});

test('failed child or CAS never processes a later date', async () => {
  const seen = [];
  await assert.rejects(recoverConsecutiveDays({cycle:1,next_date:GAP_START,completed_days:0},
    state => { seen.push(state.nextDate); return reportFor(state); },
    () => { throw Error('CAS failed'); }), /CAS failed/);
  assert.deepEqual(seen, [GAP_START]);
  const completed = [];
  await assert.rejects(recoverConsecutiveDays({cycle:1,next_date:GAP_START,completed_days:0},
    state => { if (state.nextDate !== GAP_START) throw Error('D1 quota'); return reportFor(state); },
    (state,next) => completed.push(next.lastCompletedDate)), /D1 quota/);
  assert.deepEqual(completed,[GAP_START]);
});

test('a batch stops at pass boundaries and after final completion', async () => {
  const seen = [];
  const result = await recoverConsecutiveDays({cycle:1,next_date:GAP_END,completed_days:84},
    state => { seen.push(state.nextDate); return reportFor(state); }, () => {});
  assert.deepEqual(seen,[GAP_END]);
  assert.equal(result.state.cycle,2);
  const final = await recoverConsecutiveDays({cycle:2,next_date:GAP_END,completed_days:169},
    reportFor, () => {});
  assert.equal(final.state.done,true);
  const done = await recoverConsecutiveDays(final.state, () => { throw Error('must not run'); }, () => {});
  assert.equal(done.advanced,0);
  await assert.rejects(recoverConsecutiveDays(final.state, reportFor, () => {}, 4), /Invalid day batch limit/);
});
