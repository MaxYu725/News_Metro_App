import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Deterministic, finite HK01 gap repair rotation.
// Four UTC slots per day, two cycles, then automatic no-op.
export const GAP_START = '2026-08-17';
export const GAP_END = '2026-11-09';
export const FIRST_SLOT_UTC = '2026-11-10T18:00:00.000Z';
export const SLOT_MS = 6 * 60 * 60 * 1000;
export const MAX_CYCLES = 2;

function utcDay(date) {
  return Date.parse(date + 'T00:00:00.000Z');
}

export function selectGapDay(now = Date.now()) {
  const when = typeof now === 'number' ? now : new Date(now).getTime();
  if (!Number.isFinite(when)) throw Error('Invalid current timestamp');
  const slot = Math.floor((when - Date.parse(FIRST_SLOT_UTC)) / SLOT_MS);
  const totalDays = Math.round((utcDay(GAP_END) - utcDay(GAP_START)) / 86400000) + 1;
  if (slot < 0 || slot >= MAX_CYCLES * totalDays) return null;
  const day = utcDay(GAP_START) + (slot % totalDays) * 86400000;
  return new Date(day).toISOString().slice(0, 10);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(selectGapDay() || 'skip');
}
