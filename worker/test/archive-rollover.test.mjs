import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const workflow = name => readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
function control(shards) {
  const text = workflow('hk01-background-backfill');
  const start = text.indexOf('          const shards =');
  const end = text.indexOf('          const statePayload =', start);
  const script = text.slice(start, end).replace(/const shards = .*?;/, '');
  return vm.runInNewContext(`${script}; ({active, sourceState, halted, haltReason})`, { shards });
}
const shard = (binding, size, statePresent = false, cursor = '', status = '') => ({binding, size, statePresent, state:{cursor, exhausted:0}, status});
test('new batches select newest writable shard and inherit latest existing cursor', () => {
  const old = shard('ARCHIVE_01', 299000000, true, 'old');
  const previous = shard('ARCHIVE_02', 299990000, true, 'preserved');
  const newest = shard('ARCHIVE_03', 40960);
  const result = control([old, previous, newest]);
  assert.equal(result.active.binding, 'ARCHIVE_03');
  assert.equal(result.sourceState.state.cursor, 'preserved');
});
test('replays stay on original shard including third shard and all full halts', () => {
  for (let i=0;i<3;i++) {
    const shards = [1,2,3].map(n => shard(`ARCHIVE_0${n}`, 300000000));
    shards[i].status = 'written';
    assert.equal(control(shards).active.binding, shards[i].binding);
  }
  assert.equal(control([1,2,3].map(n => shard(`ARCHIVE_0${n}`,300000000))).haltReason, 'all-shards-at-capacity');
});
test('watchdog uses newest writable shard and newest state owner', () => {
  const text = workflow('archive-watchdog');
  const state = text.match(/          const stateOwner = (.*);/)[1];
  const active = text.match(/          const active = ([\s\S]*?);/)[1];
  const shards = [shard('ARCHIVE_01', 299000000,true), shard('ARCHIVE_02',299990000,true), shard('ARCHIVE_03',40960)];
  assert.equal(vm.runInNewContext(state, {shards}).binding, 'ARCHIVE_02');
  assert.equal(vm.runInNewContext(active, {shards}), 'ARCHIVE_03');
});

test('fallback to older writable shard keeps newest shard cursor', () => {
  const result = control([shard('ARCHIVE_01',300000000,true,'old'), shard('ARCHIVE_02',299990000,true,'older'), shard('ARCHIVE_03',300000000,true,'newest')]);
  assert.equal(result.active.binding,'ARCHIVE_02');
  assert.equal(result.sourceState.state.cursor,'newest');
});

test('successive fallback writes resume newest timestamp rather than highest binding', () => {
  const shards = [shard('ARCHIVE_01',300000000,true,'old'), shard('ARCHIVE_02',299990000,true,'advanced'), shard('ARCHIVE_03',300000000,true,'previous')];
  shards[1].stateUpdatedAt = '2026-11-10T00:00:00.000Z';
  shards[2].stateUpdatedAt = '2026-11-09T00:00:00.000Z';
  const result = control(shards);
  assert.equal(result.active.binding,'ARCHIVE_02');
  assert.equal(result.sourceState.state.cursor,'advanced');
  const text = workflow('archive-watchdog');
  const state = text.match(/          const stateOwner = (.*);/)[1];
  assert.equal(vm.runInNewContext(state, {shards}).binding, 'ARCHIVE_02');
});
