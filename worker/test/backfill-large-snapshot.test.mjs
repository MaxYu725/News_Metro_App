import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';

// Exceed both the production snapshot (125,739) and Node's argument limit.
const rows = Array.from({ length: 180_000 }, (_, i) => ({ id: String(i) }));
for (const script of ['hk01-search-backfill.mjs', 'archive-backfill.mjs']) {
  test(`${script} reads large D1 chunks without losing row order`, () => {
    const source = fs.readFileSync(new URL(`../scripts/${script}`, import.meta.url), 'utf8');
    const reader = source.slice(source.indexOf('function d1Rows('), source.indexOf('\nfunction ', source.indexOf('function d1Rows(') + 1));
    for (const payload of [[{ results: rows }, { result: { results: [{ id: 'last' }] } }], { result: { results: rows } }]) {
      const context = { fs: { existsSync: () => true, readFileSync: () => JSON.stringify(payload) } };
      const actual = vm.runInNewContext(`${reader}\nd1Rows('snapshot.json')`, context);
      assert.equal(actual.length, Array.isArray(payload) ? rows.length + 1 : rows.length);
      assert.equal(actual[0].id, '0');
      assert.equal(actual[179_999].id, '179999');
      if (Array.isArray(payload)) assert.equal(actual.at(-1).id, 'last');
    }
  });
}
test('background workflow combines large shard snapshots and removes duplicate identities', () => {
  const workflow = fs.readFileSync(new URL('../../.github/workflows/hk01-background-backfill.yml', import.meta.url), 'utf8');
  const step = workflow.split('      - name: Build cross-shard dedupe snapshot')[1].split('      - name: Generate HK01 universal-search plan')[0];
  const code = step.split("node <<'NODE'\n")[1].split('\n          NODE')[0];
  let saved;
  const fakeFs = {
    readFileSync: file => JSON.stringify(file.includes('archive_01') ? [{ results: rows }] : [{ result: { results: [rows[0], { id: 'last' }] } }]),
    writeFileSync: (_, content) => { saved = JSON.parse(content); },
  };
  vm.runInNewContext(code, { require: () => fakeFs, console: { log() {} } });
  assert.equal(saved[0].results.length, rows.length + 1);
  assert.equal(saved[0].results.at(-1).id, 'last');
});
