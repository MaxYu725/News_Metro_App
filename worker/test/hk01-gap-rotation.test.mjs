import assert from 'node:assert/strict';
import test from 'node:test';
import {
  GAP_START, GAP_END, FIRST_SLOT_UTC, SLOT_MS, MAX_CYCLES, selectGapDay,
} from '../scripts/hk01-gap-rotation.mjs';

const slot = index => Date.parse(FIRST_SLOT_UTC) + index * SLOT_MS + 37 * 60 * 1000;
const days = (Date.parse(GAP_END + 'T00:00:00Z') - Date.parse(GAP_START + 'T00:00:00Z')) / 86400000 + 1;

test('finite rotation covers every calendar day without local timezone drift', () => {
  assert.equal(days, 85);
  assert.equal(selectGapDay(slot(0)), '2026-08-17');
  assert.equal(selectGapDay(slot(1)), '2026-08-18');
  assert.equal(selectGapDay(slot(84)), '2026-11-09');
  assert.equal(selectGapDay(slot(85)), '2026-08-17');
  assert.equal(selectGapDay(slot(169)), '2026-11-09');
  assert.equal(MAX_CYCLES, 2);
});
test('no-op outside finite recovery window', () => {
  assert.equal(selectGapDay(Date.parse(FIRST_SLOT_UTC) - 1000), null);
  assert.equal(selectGapDay(slot(170)), null);
  assert.equal(selectGapDay('2027-01-01T00:00:00Z'), null);
  assert.throws(() => selectGapDay('invalid'), /Invalid current timestamp/);
});
