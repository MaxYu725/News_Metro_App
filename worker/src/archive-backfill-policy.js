export function hk01ContinuationFloor(persistedStateRow, bootstrapFloor = '') {
  const cursor = persistedStateRow?.cursor == null ? '' : String(persistedStateRow.cursor).trim();
  return cursor ? '' : String(bootstrapFloor || '');
}

export function allSourceHk01Target(limit) {
  const value = Number(limit);
  if (!Number.isInteger(value) || value < 1) throw new Error('invalid all-source limit');
  return Math.ceil(value / 2);
}

export function allSourceBastilleTarget(limit, hk01Generated) {
  const total = Number(limit);
  const hk = Number(hk01Generated);
  if (!Number.isInteger(total) || total < 1) throw new Error('invalid all-source limit');
  if (!Number.isInteger(hk) || hk < 0 || hk > total) throw new Error('invalid HK01 generated count');
  return total - hk;
}
