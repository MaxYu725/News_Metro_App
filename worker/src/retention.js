export const RETENTION_POLICY = Object.freeze({
  databaseLimitBytes: 500_000_000,
  softLimitBytes: 375_000_000,
  emergencyLimitBytes: 450_000_000,
  hardReserveBytes: 10_000_000,
  softRearmBytes: 25_000_000,
  emergencyRearmBytes: 10_000_000,
  softReclaimBytes: 50_000_000,
  emergencyReclaimBytes: 100_000_000,
  deleteBatchRows: 500,
  softDeleteFloorRows: 500,
  emergencyDeleteFloorRows: 1_000,
  softDeleteCapRows: 4_000,
  emergencyDeleteCapRows: 8_000,
  softProtectedRows: 5_000,
  emergencyProtectedRows: 1_000,
});

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function retentionMode(sizeBytes, policy) {
  if (sizeBytes >= policy.emergencyLimitBytes) return 'emergency';
  if (sizeBytes >= policy.softLimitBytes) return 'soft';
  return null;
}

function rearmThreshold(lastCleanupSize, mode, policy) {
  const delta = mode === 'emergency' ? policy.emergencyRearmBytes : policy.softRearmBytes;
  const hardCeiling = policy.databaseLimitBytes - policy.hardReserveBytes;
  return Math.min(lastCleanupSize + delta, hardCeiling);
}

function cleanupShape(mode, policy) {
  if (mode === 'emergency') {
    return {
      reclaimBytes: policy.emergencyReclaimBytes,
      floorRows: policy.emergencyDeleteFloorRows,
      capRows: policy.emergencyDeleteCapRows,
      protectedRows: policy.emergencyProtectedRows,
    };
  }
  return {
    reclaimBytes: policy.softReclaimBytes,
    floorRows: policy.softDeleteFloorRows,
    capRows: policy.softDeleteCapRows,
    protectedRows: policy.softProtectedRows,
  };
}

export async function enforceAdaptiveRetention(db, options = {}) {
  const policy = options.policy || RETENTION_POLICY;
  const now = options.now || new Date().toISOString();

  let probe;
  try {
    probe = await db.prepare('SELECT 1 AS retention_probe').all();
  } catch (error) {
    console.warn('retention-size-probe-failed', { error: String(error?.message || error) });
    return { action: 'probe-error', sizeBytes: null, deletedRows: 0 };
  }

  const sizeBytes = numeric(probe?.meta?.size_after, -1);
  if (sizeBytes <= 0) {
    console.warn('retention-size-unavailable');
    return { action: 'size-unavailable', sizeBytes: null, deletedRows: 0 };
  }

  const mode = retentionMode(sizeBytes, policy);
  if (!mode) {
    return { action: 'healthy', mode: null, sizeBytes, deletedRows: 0 };
  }

  const { results: stateRows } = await db
    .prepare(`SELECT last_cleanup_size, last_cleanup_at, last_deleted_rows, last_mode
      FROM retention_state WHERE id = 1 LIMIT 1`)
    .all();
  const state = stateRows?.[0] || {};
  const lastCleanupSize = Math.max(0, numeric(state.last_cleanup_size));

  if (lastCleanupSize > 0) {
    const threshold = rearmThreshold(lastCleanupSize, mode, policy);
    if (sizeBytes <= lastCleanupSize || sizeBytes < threshold) {
      return {
        action: 'watermark-hold',
        mode,
        sizeBytes,
        deletedRows: 0,
        lastCleanupSize,
        rearmAtBytes: threshold,
      };
    }
  }

  const { results: countRows } = await db
    .prepare(`SELECT COUNT(*) AS total_rows,
      SUM(CASE WHEN category <> 'video' THEN 1 ELSE 0 END) AS eligible_rows
      FROM articles`)
    .all();
  const counts = countRows?.[0] || {};
  const totalRows = Math.max(0, numeric(counts.total_rows));
  const eligibleRows = Math.max(0, numeric(counts.eligible_rows));
  const shape = cleanupShape(mode, policy);
  const maxDeletable = Math.max(0, eligibleRows - shape.protectedRows);

  if (totalRows <= 0 || maxDeletable <= 0) {
    return { action: 'protected-minimum', mode, sizeBytes, deletedRows: 0 };
  }

  const averageBytesPerRow = Math.max(1, sizeBytes / totalRows);
  const estimatedRows = Math.ceil(shape.reclaimBytes / averageBytesPerRow);
  const lowerBound = Math.min(shape.floorRows, maxDeletable);
  const upperBound = Math.min(shape.capRows, maxDeletable);
  const targetRows = Math.min(upperBound, Math.max(lowerBound, estimatedRows));

  if (targetRows <= 0) {
    return { action: 'protected-minimum', mode, sizeBytes, deletedRows: 0 };
  }

  const statements = [];
  let remaining = targetRows;
  while (remaining > 0) {
    const batchRows = Math.min(policy.deleteBatchRows, remaining);
    statements.push(
      db.prepare(`DELETE FROM articles WHERE rowid IN (
        SELECT rowid FROM articles
        WHERE category <> 'video'
        ORDER BY pubDate ASC
        LIMIT ?
      )`).bind(batchRows),
    );
    remaining -= batchRows;
  }

  statements.push(
    db.prepare(`UPDATE retention_state
      SET last_cleanup_size = ?, last_cleanup_at = ?, last_deleted_rows = ?, last_mode = ?
      WHERE id = 1`).bind(sizeBytes, now, targetRows, mode),
  );

  const batchResults = await db.batch(statements);
  const deleteResults = Array.isArray(batchResults) ? batchResults.slice(0, -1) : [];
  const deletedRows = deleteResults.reduce((sum, result) => sum + Math.max(0, numeric(result?.meta?.changes)), 0);

  console.log('adaptive-retention-cleanup', {
    mode,
    sizeBytes,
    targetRows,
    deletedRows,
    averageBytesPerRow: Math.round(averageBytesPerRow),
  });

  return {
    action: 'cleaned',
    mode,
    sizeBytes,
    targetRows,
    deletedRows,
    lastCleanupSize: sizeBytes,
  };
}
