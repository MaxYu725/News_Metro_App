#!/usr/bin/env python3
from pathlib import Path

root = Path('.')

# Worker integration: replace fixed 30-day cleanup with adaptive capacity retention.
index_path = root / 'worker/src/index.js'
source = index_path.read_text(encoding='utf-8')
import_marker = "import { searchArticles } from './search.js';\n"
retention_import = "import { enforceAdaptiveRetention } from './retention.js';\n"
if retention_import not in source:
    if import_marker not in source:
        raise SystemExit('search import marker missing')
    source = source.replace(import_marker, import_marker + retention_import, 1)

old_block = """async function cleanUpOldArticles(env) {
  try {
    await env.DB.prepare(`DELETE FROM articles WHERE category <> 'video' AND datetime(pubDate) < datetime('now', '-30 days')`).run();
  } catch {}
}

async function syncAllCategoriesAndCleanup(env) {
  await Promise.all(Object.keys(topicSources).map(cat => syncCategoryToDB(cat, env)));
  await cleanUpOldArticles(env);
}
"""
new_block = """async function syncAllCategoriesAndRetention(env) {
  await Promise.all(Object.keys(topicSources).map(cat => syncCategoryToDB(cat, env)));
  await enforceAdaptiveRetention(env.DB);
}
"""
if old_block not in source:
    raise SystemExit('fixed retention block missing')
source = source.replace(old_block, new_block, 1)
source = source.replace('ctx.waitUntil(syncAllCategoriesAndCleanup(env));', 'ctx.waitUntil(syncAllCategoriesAndRetention(env));', 1)
source = source.replace('await syncAllCategoriesAndCleanup(env);', 'await syncAllCategoriesAndRetention(env);')
source = source.replace('if (forceSync) await cleanUpOldArticles(env);', 'if (forceSync) await enforceAdaptiveRetention(env.DB);')
if "-30 days" in source or 'cleanUpOldArticles' in source:
    raise SystemExit('fixed 30-day retention survived patch')
index_path.write_text(source, encoding='utf-8')

(root / 'worker/src/retention.js').write_text(r'''export const RETENTION_POLICY = Object.freeze({
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
''', encoding='utf-8')

(root / 'worker/migrations/0002_adaptive_retention.sql').write_text(r'''-- CF-W6: retain news until D1 approaches its capacity watermark.
-- The single state row prevents repeated destructive cleanup while SQLite reuses
-- pages freed by a previous cleanup even if physical file size does not shrink.

CREATE TABLE IF NOT EXISTS retention_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_cleanup_size INTEGER NOT NULL DEFAULT 0,
  last_cleanup_at TEXT,
  last_deleted_rows INTEGER NOT NULL DEFAULT 0,
  last_mode TEXT
);

INSERT OR IGNORE INTO retention_state (id) VALUES (1);
''', encoding='utf-8')

(root / 'worker/test/retention.test.mjs').write_text(r'''import assert from 'node:assert/strict';
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
''', encoding='utf-8')

(root / '.github/scripts/validate-adaptive-retention.sh').write_text(r'''#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/worker"

state=$(mktemp -d)
trap 'rm -rf "$state"' EXIT

npx wrangler d1 migrations apply metro_news_db --local --persist-to "$state" >/tmp/cf-w6-migrations.log
grep -q '0002_adaptive_retention.sql' /tmp/cf-w6-migrations.log || {
  echo 'Adaptive retention migration was not discovered by Wrangler' >&2
  cat /tmp/cf-w6-migrations.log >&2
  exit 1
}

npx wrangler d1 execute metro_news_db --local --persist-to "$state" --json \
  --command "SELECT COUNT(*) AS table_count FROM sqlite_master WHERE type='table' AND name='retention_state'; SELECT id,last_cleanup_size,last_deleted_rows,last_mode FROM retention_state WHERE id=1" \
  >/tmp/cf-w6-retention.json

node - <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/cf-w6-retention.json', 'utf8'));
const batches = Array.isArray(payload) ? payload : payload?.result || [];
const tableCount = Number(batches[0]?.results?.[0]?.table_count || 0);
const state = batches[1]?.results?.[0];
if (tableCount !== 1) throw new Error(`expected retention_state table, got ${tableCount}`);
if (!state || Number(state.id) !== 1) throw new Error('retention_state singleton row missing');
if (Number(state.last_cleanup_size) !== 0 || Number(state.last_deleted_rows) !== 0) {
  throw new Error('retention_state defaults are not clean');
}
NODE

echo 'D1 adaptive retention migration/state: PASS'
''', encoding='utf-8')

# Validator contract.
validator_path = root / '.github/scripts/validate-worker-baseline.py'
validator = validator_path.read_text(encoding='utf-8')
validator = validator.replace(
    '    search = (WORKER / "src" / "search.js").read_text("utf-8")\n',
    '    search = (WORKER / "src" / "search.js").read_text("utf-8")\n    retention = (WORKER / "src" / "retention.js").read_text("utf-8")\n',
    1,
)
old_retention = '''    retention_sql = "DELETE FROM articles WHERE category <> 'video' AND datetime(pubDate) < datetime('now', '-30 days')"\n    if retention_sql not in source:\n        fail("30-day retention must exclude the low-frequency video archive")\n    if "ctx.waitUntil(syncAllCategoriesAndCleanup(env));" not in source:\n        fail("scheduled ingestion must clean up only after category sync completes")\n    if "ctx.waitUntil(cleanUpOldArticles(env))" in source:\n        fail("cleanup must not race forced sync in the background")\n'''
new_retention = '''    # CF-W6: retention is capacity-driven, not age-driven.\n    retention_migration = (WORKER / "migrations" / "0002_adaptive_retention.sql").read_text("utf-8")\n    for signal in [\n        "retention_state",\n        "last_cleanup_size",\n        "last_cleanup_at",\n        "last_deleted_rows",\n        "last_mode",\n    ]:\n        if signal not in retention_migration:\n            fail(f"adaptive retention migration signal missing: {signal}")\n    for signal in [\n        "softLimitBytes: 375_000_000",\n        "emergencyLimitBytes: 450_000_000",\n        "databaseLimitBytes: 500_000_000",\n        "hardReserveBytes: 10_000_000",\n        "softRearmBytes: 25_000_000",\n        "emergencyRearmBytes: 10_000_000",\n        "category <> 'video'",\n        "ORDER BY pubDate ASC",\n        "UPDATE retention_state",\n        "size_after",\n    ]:\n        if signal not in retention:\n            fail(f"adaptive retention contract signal missing: {signal}")\n    if "-30 days" in source or "cleanUpOldArticles" in source:\n        fail("fixed 30-day retention must not be reintroduced")\n    if "ctx.waitUntil(syncAllCategoriesAndRetention(env));" not in source:\n        fail("scheduled ingestion must run adaptive retention after category sync")\n    if "enforceAdaptiveRetention(env.DB)" not in source:\n        fail("forced sync must use adaptive retention")\n'''
if old_retention not in validator:
    raise SystemExit('old retention validator block missing')
validator = validator.replace(old_retention, new_retention, 1)
validator = validator.replace(
    '    print("D1 FTS5 trigram search contract: OK")\n',
    '    print("D1 FTS5 trigram search contract: OK")\n    print("D1 adaptive capacity retention contract: OK")\n',
    1,
)
validator_path.write_text(validator, encoding='utf-8')

# Production smoke: no age-based assertion; a full sync should remain healthy under adaptive policy.
smoke_path = root / '.github/scripts/worker-production-smoke.sh'
smoke = smoke_path.read_text(encoding='utf-8')
smoke = smoke.replace("# Rebuild archive rows under the new retention policy before asserting archive depth.\n# The previous production version could legitimately leave only the newest video row\n# after its concurrent sync/cleanup race, so checking video first creates a false failure.\necho 'Smoke: controlled full sync applies retention policy'",
                      "# Force one full sync so production exercises the adaptive retention size probe.\necho 'Smoke: controlled full sync preserves adaptive retention health'", 1)
smoke_path.write_text(smoke, encoding='utf-8')

# Production D1 audit: old rows are now expected; verify adaptive state and report physical size.
audit_path = root / '.github/scripts/worker-production-d1-audit.sh'
audit = audit_path.read_text(encoding='utf-8')
old_query = "query=\"SELECT COUNT(*) AS total_rows, SUM(CASE WHEN category = 'video' THEN 1 ELSE 0 END) AS video_rows, SUM(CASE WHEN category <> 'video' AND datetime(pubDate) < datetime('now', '-30 days') THEN 1 ELSE 0 END) AS stale_non_video_rows, COUNT(DISTINCT category) AS category_count, COUNT(DISTINCT source) AS source_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='articles_fts') AS fts_table_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('articles_fts_ai','articles_fts_ad','articles_fts_au')) AS fts_trigger_count FROM articles\""
new_query = "query=\"SELECT COUNT(*) AS total_rows, SUM(CASE WHEN category = 'video' THEN 1 ELSE 0 END) AS video_rows, COUNT(DISTINCT category) AS category_count, COUNT(DISTINCT source) AS source_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='articles_fts') AS fts_table_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('articles_fts_ai','articles_fts_ad','articles_fts_au')) AS fts_trigger_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='retention_state') AS retention_table_count, (SELECT COUNT(*) FROM retention_state WHERE id=1) AS retention_state_rows, (SELECT last_cleanup_size FROM retention_state WHERE id=1) AS last_cleanup_size, (SELECT last_cleanup_at FROM retention_state WHERE id=1) AS last_cleanup_at, (SELECT last_deleted_rows FROM retention_state WHERE id=1) AS last_deleted_rows, (SELECT last_mode FROM retention_state WHERE id=1) AS last_mode FROM articles\""
if old_query not in audit:
    raise SystemExit('old production D1 audit query missing')
audit = audit.replace(old_query, new_query, 1)
audit = audit.replace("const stale = Number(row.stale_non_video_rows || 0);\n", "", 1)
audit = audit.replace("const ftsTriggers = Number(row.fts_trigger_count || 0);\n", "const ftsTriggers = Number(row.fts_trigger_count || 0);\nconst retentionTables = Number(row.retention_table_count || 0);\nconst retentionRows = Number(row.retention_state_rows || 0);\nconst lastCleanupSize = Number(row.last_cleanup_size || 0);\nconst lastDeletedRows = Number(row.last_deleted_rows || 0);\nconst lastMode = row.last_mode || null;\nconst sizeBytes = Number(first?.meta?.size_after || 0);\n", 1)
audit = audit.replace("if (stale !== 0) throw new Error(`${stale} non-video row(s) are older than 30 days`);\n", "", 1)
audit = audit.replace("if (ftsTriggers !== 3) throw new Error(`expected 3 FTS maintenance triggers, got ${ftsTriggers}`);\n\nconsole.log(`D1 production health: total=${total}, video=${video}, stale_non_video=${stale}, categories=${categories}, sources=${sources}, fts_table=${ftsTables}, fts_triggers=${ftsTriggers}`);",
                      "if (ftsTriggers !== 3) throw new Error(`expected 3 FTS maintenance triggers, got ${ftsTriggers}`);\nif (retentionTables !== 1 || retentionRows !== 1) throw new Error('adaptive retention state is missing');\nif (sizeBytes <= 0) throw new Error('D1 size_after is unavailable');\nif (sizeBytes >= 375000000 && lastCleanupSize <= 0) throw new Error('adaptive retention has not recorded cleanup above soft limit');\nconst utilization = (sizeBytes / 500000000 * 100).toFixed(2);\nconsole.log(`D1 production health: total=${total}, video=${video}, categories=${categories}, sources=${sources}, fts_table=${ftsTables}, fts_triggers=${ftsTriggers}, size_bytes=${sizeBytes}, utilization_pct=${utilization}, retention_last_size=${lastCleanupSize}, retention_last_deleted=${lastDeletedRows}, retention_last_mode=${lastMode}`);", 1)
audit_path.write_text(audit, encoding='utf-8')

# CI workflows.
workflow_path = root / '.github/workflows/worker-baseline.yml'
workflow = workflow_path.read_text(encoding='utf-8')
workflow = workflow.replace('      - .github/scripts/validate-search-fts.sh\n', '      - .github/scripts/validate-search-fts.sh\n      - .github/scripts/validate-adaptive-retention.sh\n')
workflow = workflow.replace('          node --check worker/src/search.js\n          bash -n .github/scripts/validate-search-fts.sh\n', '          node --check worker/src/search.js\n          node --check worker/src/retention.js\n          bash -n .github/scripts/validate-search-fts.sh\n          bash -n .github/scripts/validate-adaptive-retention.sh\n', 1)
workflow = workflow.replace('      - name: Run Worker tests\n', '      - name: Validate adaptive retention migration locally\n        run: bash .github/scripts/validate-adaptive-retention.sh\n\n      - name: Run Worker tests\n', 1)
workflow_path.write_text(workflow, encoding='utf-8')

deploy_path = root / '.github/workflows/deploy-worker-production.yml'
deploy = deploy_path.read_text(encoding='utf-8')
deploy = deploy.replace('      - .github/scripts/validate-search-fts.sh\n', '      - .github/scripts/validate-search-fts.sh\n      - .github/scripts/validate-adaptive-retention.sh\n', 1)
deploy = deploy.replace('          node --check worker/src/search.js\n          bash -n .github/scripts/validate-search-fts.sh\n', '          node --check worker/src/search.js\n          node --check worker/src/retention.js\n          bash -n .github/scripts/validate-search-fts.sh\n          bash -n .github/scripts/validate-adaptive-retention.sh\n', 1)
deploy = deploy.replace('      - name: Run Worker regressions\n', '      - name: Validate adaptive retention migration locally\n        run: bash .github/scripts/validate-adaptive-retention.sh\n\n      - name: Run Worker regressions\n', 1)
deploy_path.write_text(deploy, encoding='utf-8')

(root / '.deploy/worker-production.txt').write_text(
    'CF-W6 production promotion: replace fixed 30-day deletion with 375MB/450MB adaptive retention watermarks.\n',
    encoding='utf-8',
)
