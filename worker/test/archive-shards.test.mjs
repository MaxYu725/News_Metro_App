import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ARCHIVE_BINDING_NAMES,
  archiveDatabases,
  sourceCountsAcrossDatabases,
} from '../src/archive-shards.js';

function fakeDb(rows, { withSession = true } = {}) {
  const db = {
    prepare(sql) {
      assert.equal(sql, 'SELECT source, COUNT(*) AS count FROM articles GROUP BY source');
      return { all: async () => ({ results: rows }) };
    },
  };
  if (withSession) {
    db.withSession = mode => {
      assert.equal(mode, 'first-unconstrained');
      return db;
    };
  }
  return db;
}

test('archive registry exposes the two provisioned shards in deterministic order', () => {
  assert.deepEqual(ARCHIVE_BINDING_NAMES, ['ARCHIVE_01', 'ARCHIVE_02']);
});

test('archive registry is safe before any archive binding is available', () => {
  assert.deepEqual(archiveDatabases({}), []);
  assert.deepEqual(archiveDatabases(null), []);
});

test('archive registry ignores missing bindings and de-duplicates aliases', () => {
  const shard1 = fakeDb([]);
  const shard2 = fakeDb([]);
  const databases = archiveDatabases({
    ARCHIVE_01: shard1,
    ARCHIVE_02: shard2,
    ARCHIVE_03: shard1,
  });
  assert.deepEqual(databases, [shard1, shard2]);
});

test('source counts aggregate across every bound archive shard', async () => {
  const totals = await sourceCountsAcrossDatabases([
    fakeDb([
      { source: '香港01', count: 22541 },
      { source: '巴士的報', count: 6459 },
    ], { withSession: false }),
    fakeDb([
      { source: '香港01', count: 1000 },
    ], { withSession: false }),
  ]);

  assert.equal(totals.get('香港01'), 23541);
  assert.equal(totals.get('巴士的報'), 6459);
});
