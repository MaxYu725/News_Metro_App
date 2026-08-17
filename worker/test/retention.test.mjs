import assert from 'node:assert/strict';
import test from 'node:test';

import { enforceAdaptiveRetention, RETENTION_POLICY } from '../src/retention.js';

function createDb({ sizeBytes, state = {}, totalRows = 20_000, eligibleRows = 19_960, batchError = null }) {
  const calls = [];
  let stateRead = false;
  let countRead = false;
  let batchCalls = 0;

  const db = {
    calls,
    prepare(sql) {
      const statement = {
        sql,
        params: [],
        bind(...params) {
          this.params = params;
          return this;
        },
        async all() {
          calls.push({ type: 'all', sql, params: this.params });
          if (sql.includes('retention_probe')) return { results: [{ retention_probe: 1 }], meta: { size_after: sizeBytes } };
          if (sql.includes('FROM retention_state')) {
            stateRead = true;
            return { results: [{ last_cleanup_size: 0, ...state }] };
          }
          if (sql.includes('eligible_rows')) {
            countRead = true;
            return { results: [{ total_rows: totalRows, eligible_rows: eligibleRows }] };
          }
          throw new Error(`unexpected all SQL: ${sql}`);
        },
      };
      calls.push({ type: 'prepare', sql, statement });
      return statement;
    },
    async batch(statements) {
      batchCalls += 1;
      calls.push({ type: 'batch', statements });
      if (batchError) throw batchError;
      return statements.map((statement, index) => ({
        success: true,
        meta: { changes: index === statements.length - 1 ? 1 : Number(statement.params[0] || 0) },
      }));
    },
    stats() {
      return { stateRead, countRead, batchCalls };
    },
  };
  return db;
}

test('healthy database uses only cheap size probe and keeps all news', async () => {
  const db = createDb({ sizeBytes: 45_846_528 });
  const result = await enforceAdaptiveRetention(db);
  assert.equal(result.action, 'healthy');
  assert.equal(db.stats().stateRead, false);
  assert.equal(db.stats().countRead, false);
  assert.equal(db.stats().batchCalls, 0);
});

test('missing size_after fails safe without deleting', async () => {
  const db = createDb({ sizeBytes: undefined });
  const result = await enforceAdaptiveRetention(db);
  assert.equal(result.action, 'size-unavailable');
  assert.equal(db.stats().batchCalls, 0);
});

test('first soft crossing deletes oldest non-video rows and stores watermark atomically', async () => {
  const db = createDb({ sizeBytes: RETENTION_POLICY.softLimitBytes });
  const result = await enforceAdaptiveRetention(db, { now: '2026-08-17T03:30:00.000Z' });
  assert.equal(result.action, 'cleaned');
  assert.equal(result.mode, 'soft');
  assert.ok(result.targetRows >= RETENTION_POLICY.softDeleteFloorRows);
  assert.ok(result.targetRows <= RETENTION_POLICY.softDeleteCapRows);
  const batch = db.calls.find(call => call.type === 'batch');
  assert.ok(batch);
  const deleteStatements = batch.statements.slice(0, -1);
  assert.ok(deleteStatements.every(statement => statement.sql.includes("category <> 'video'")));
  assert.ok(deleteStatements.every(statement => statement.sql.includes('ORDER BY pubDate ASC')));
  const stateStatement = batch.statements.at(-1);
  assert.match(stateStatement.sql, /UPDATE retention_state/);
  assert.deepEqual(stateStatement.params.slice(0, 2), [RETENTION_POLICY.softLimitBytes, '2026-08-17T03:30:00.000Z']);
});

test('same physical size after cleanup is held instead of repeatedly deleting', async () => {
  const size = 400_000_000;
  const db = createDb({ sizeBytes: size, state: { last_cleanup_size: size } });
  const result = await enforceAdaptiveRetention(db);
  assert.equal(result.action, 'watermark-hold');
  assert.equal(db.stats().countRead, false);
  assert.equal(db.stats().batchCalls, 0);
});

test('soft cleanup rearms only after sufficient physical growth', async () => {
  const last = 380_000_000;
  const held = createDb({ sizeBytes: last + RETENTION_POLICY.softRearmBytes - 1, state: { last_cleanup_size: last } });
  assert.equal((await enforceAdaptiveRetention(held)).action, 'watermark-hold');

  const rearmed = createDb({ sizeBytes: last + RETENTION_POLICY.softRearmBytes, state: { last_cleanup_size: last } });
  assert.equal((await enforceAdaptiveRetention(rearmed)).action, 'cleaned');
});

test('emergency mode uses larger cleanup cap and tighter rearm', async () => {
  const size = RETENTION_POLICY.emergencyLimitBytes;
  const db = createDb({ sizeBytes: size, state: { last_cleanup_size: 430_000_000 } });
  const result = await enforceAdaptiveRetention(db, { totalRows: 20_000 });
  assert.equal(result.action, 'cleaned');
  assert.equal(result.mode, 'emergency');
  assert.ok(result.targetRows >= RETENTION_POLICY.emergencyDeleteFloorRows);
  assert.ok(result.targetRows <= RETENTION_POLICY.emergencyDeleteCapRows);
});

test('near hard limit any actual growth beyond cleanup watermark can rearm', async () => {
  const last = 490_000_000;
  const same = createDb({ sizeBytes: last, state: { last_cleanup_size: last } });
  assert.equal((await enforceAdaptiveRetention(same)).action, 'watermark-hold');

  const grown = createDb({ sizeBytes: last + 1_000_000, state: { last_cleanup_size: last } });
  assert.equal((await enforceAdaptiveRetention(grown)).action, 'cleaned');
});

test('protected recent reserve prevents deleting the final non-video archive', async () => {
  const db = createDb({
    sizeBytes: RETENTION_POLICY.softLimitBytes,
    totalRows: 5_040,
    eligibleRows: RETENTION_POLICY.softProtectedRows,
  });
  const result = await enforceAdaptiveRetention(db);
  assert.equal(result.action, 'protected-minimum');
  assert.equal(db.stats().batchCalls, 0);
});

test('transactional batch failure does not report a successful cleanup watermark', async () => {
  const db = createDb({ sizeBytes: RETENTION_POLICY.softLimitBytes, batchError: new Error('D1 batch failed') });
  await assert.rejects(() => enforceAdaptiveRetention(db), /D1 batch failed/);
  assert.equal(db.stats().batchCalls, 1);
});
