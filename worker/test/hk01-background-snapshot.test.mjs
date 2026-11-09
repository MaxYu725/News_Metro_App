import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectSnapshot, runSnapshot, snapshotLowerBound } from '../scripts/hk01-background-snapshot.mjs';
import { sqliteD1 } from './helpers/sqlite-d1.mjs';

const date = '2026-10-01T00:00:00.000Z';
const article = (id, pubDate = date, source = '香港01') => ({
  id, link: `https://example.test/${id}`, source, pubDate,
});

async function sqliteExecutor(t, rows, wrapped = false) {
  const db = sqliteD1();
  t.after(() => db.close());
  await db.batch(rows.map(row => db.prepare(
    'INSERT INTO articles(id,title,link,pubDate,category,source) VALUES(?,?,?,?,?,?)',
  ).bind(row.id, 'title', row.link, row.pubDate, 'local', row.source)));
  const queries = [];
  return {
    queries,
    execute: async ({ query }) => {
      queries.push(query);
      const result = await db.prepare(query).all();
      return JSON.stringify(wrapped ? { success: true, result: [{ result }] } : [result]);
    },
  };
}

test('keyset pages preserve every identity across equal timestamps and SQL quotes', async t => {
  const executor = await sqliteExecutor(t, [
    article('a'), article("a'quoted"), article('0'), article('中文'), article('𠀀'),
    article('newer', '2026-11-10T00:00:00.000Z'),
    article('old', '2026-09-23T23:59:59.999Z'),
    article('other-source', date, 'other'),
  ]);
  const snapshot = await collectSnapshot({
    binding: 'ARCHIVE_01', lowerBound: '2026-09-24T00:00:00.000Z', pageSize: 2,
    execute: executor.execute,
  });
  assert.deepEqual(snapshot[0].results.map(row => row.id), ['newer', '𠀀', '中文', "a'quoted", 'a', '0']);
  assert.deepEqual(snapshot[0].results.at(-3), article("a'quoted"));
  assert.equal(executor.queries.length, 4, 'exact-size last page must be followed by an empty page');
  assert.ok(executor.queries.every(query => /LIMIT 2\s*;?$/.test(query)));
});

test('bootstrap scans all dates and accepts wrapped Wrangler results', async t => {
  const executor = await sqliteExecutor(t, [
    article('old', '2016-01-01T00:00:00.000Z'), article('new', '2026-11-10T00:00:00.000Z'),
  ], true);
  const snapshot = await collectSnapshot({ binding: 'ARCHIVE_02', execute: executor.execute, pageSize: 1 });
  assert.deepEqual(snapshot[0].results.map(row => row.id), ['new', 'old']);
  assert.equal(executor.queries.length, 3);
});

test('empty shard yields an empty compatible D1 snapshot', async () => {
  assert.deepEqual(await collectSnapshot({
    binding: 'ARCHIVE_01', execute: async () => '[{"results":[],"success":true}]',
  }), [{ results: [] }]);
});

test('cursor overlap retains the original 46-day lower bound and bootstrap behavior', () => {
  assert.equal(snapshotLowerBound([{ results: [{ cursor: String(Date.parse('2026-11-09T00:00:00.000Z') / 1000) }] }]), '2026-09-24T00:00:00.000Z');
  assert.equal(snapshotLowerBound([{ results: [{ cursor: '1451692800' }] }]), '2016-01-01T00:00:00.000Z');
  assert.equal(snapshotLowerBound([{ results: [] }]), null);
  assert.equal(snapshotLowerBound([{ results: [{ cursor: '' }] }]), null);
});

for (const [label, response, code] of [
  ['D1 7500', JSON.stringify({ success: false, errors: [{ code: 7500, message: 'response > 50MB', notes: [{ text: 'page failed' }] }] }), 7500],
  ['nested API failure', JSON.stringify([{ result: { success: false, results: [], errors: [{ code: 7500, message: 'too large' }] } }]), 7500],
  ['malformed JSON', '<html>raw article payload</html>', 'INVALID_JSON'],
  ['missing results', '[{"success":true}]', 'INVALID_RESPONSE'],
  ['malformed row', '[{"results":[{"id":"only-id"}]}]', 'INVALID_RESPONSE'],
]) {
  test(`${label} aborts rather than producing a successful snapshot`, async () => {
    await assert.rejects(collectSnapshot({
      binding: 'ARCHIVE_02', execute: async () => response,
    }), error => {
      assert.equal(error.code, code);
      assert.equal(error.shard, 'ARCHIVE_02');
      assert.equal(error.page, 1);
      assert.ok(!error.message.includes('raw article payload'));
      return true;
    });
  });
}

test('a repeated or out-of-order page aborts without looping or dropping identities', async () => {
  let calls = 0;
  await assert.rejects(collectSnapshot({
    binding: 'ARCHIVE_01', pageSize: 1,
    execute: async () => { calls++; return JSON.stringify([{ results: [article('same')] }]); },
  }), error => error.code === 'NON_ADVANCING_PAGE' && error.page === 2);
  assert.equal(calls, 2);
});

test('failed commands preserve bounded API diagnostics without exposing command output', async () => {
  await assert.rejects(collectSnapshot({
    binding: 'ARCHIVE_01', execute: async () => {
      throw Object.assign(new Error('raw article payload'.repeat(1000)), {
        stdout: JSON.stringify({ error: { code: 7500, text: 'response > 50MB', notes: [{ text: 'n'.repeat(5000) }] } }),
        stderr: 'raw article payload'.repeat(1000),
      });
    },
  }), error => {
    assert.equal(error.code, 7500);
    assert.equal(error.message, 'response > 50MB');
    assert.ok(JSON.stringify(error).length < 1500);
    assert.ok(!JSON.stringify(error).includes('raw article payload'));
    return true;
  });
});

test('a later shard failure leaves no successful snapshot files', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hk01-snapshot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'state.json');
  writeFileSync(stateFile, '[{"results":[]}]');
  await assert.rejects(runSnapshot({
    stateFile, outDir: dir, log() {},
    execute: async ({ binding }) => binding === 'ARCHIVE_01'
      ? JSON.stringify([{ results: [article('first')] }]) : '{"error":{"code":7500,"message":"failed"}}',
  }));
  assert.deepEqual(readdirSync(dir), ['state.json']);
});

test('both shard snapshots retain the existing D1 results shape and summary', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'hk01-snapshot-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const stateFile = join(dir, 'state.json');
  const logs = [];
  writeFileSync(stateFile, '[{"results":[]}]');
  await runSnapshot({
    stateFile, outDir: dir, log: line => logs.push(line),
    execute: async ({ binding, query }) => {
      assert.match(query, /LIMIT 5000\s*;?$/);
      return JSON.stringify([{ results: [article(binding)] }]);
    },
  });
  for (const binding of ['ARCHIVE_01', 'ARCHIVE_02']) {
    assert.deepEqual(JSON.parse(readFileSync(join(dir, `${binding.toLowerCase()}-existing.json`), 'utf8')), [{ results: [article(binding)] }]);
  }
  assert.ok(logs.some(line => line.includes('full bootstrap scan across ARCHIVE_01+ARCHIVE_02')));
});
