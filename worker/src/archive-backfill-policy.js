export function hk01ContinuationFloor(persistedStateRow, bootstrapFloor = '') {
  const cursor = persistedStateRow?.cursor == null ? '' : String(persistedStateRow.cursor).trim();
  return cursor ? '' : String(bootstrapFloor || '');
}
