#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."/worker

query="SELECT COUNT(*) AS total_rows, SUM(CASE WHEN category = 'video' THEN 1 ELSE 0 END) AS video_rows, COUNT(DISTINCT category) AS category_count, COUNT(DISTINCT source) AS source_count, SUM(CASE WHEN source = '香港01' THEN 1 ELSE 0 END) AS hk01_rows, SUM(CASE WHEN source = '巴士的報' THEN 1 ELSE 0 END) AS bastille_rows, SUM(CASE WHEN source = '巴士的報' AND category = 'video' THEN 1 ELSE 0 END) AS bastille_video_rows, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='articles_fts') AS fts_table_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('articles_fts_ai','articles_fts_ad','articles_fts_au')) AS fts_trigger_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='retention_state') AS retention_table_count, (SELECT COUNT(*) FROM retention_state WHERE id=1) AS retention_state_rows, (SELECT last_cleanup_size FROM retention_state WHERE id=1) AS last_cleanup_size, (SELECT last_cleanup_at FROM retention_state WHERE id=1) AS last_cleanup_at, (SELECT last_deleted_rows FROM retention_state WHERE id=1) AS last_deleted_rows, (SELECT last_mode FROM retention_state WHERE id=1) AS last_mode FROM articles"

npx wrangler d1 execute DB --remote --command "$query" --json > /tmp/metro-news-d1-audit.json

node <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/metro-news-d1-audit.json', 'utf8'));
const batch = Array.isArray(payload) ? payload : payload?.result;
const first = Array.isArray(batch) ? batch[0] : null;
const rows = first?.results || first?.result?.results || [];
const row = rows[0];
if (!row) throw new Error('D1 audit returned no result row');

const total = Number(row.total_rows || 0);
const video = Number(row.video_rows || 0);
const categories = Number(row.category_count || 0);
const sources = Number(row.source_count || 0);
const hk01Rows = Number(row.hk01_rows || 0);
const bastilleRows = Number(row.bastille_rows || 0);
const bastilleVideoRows = Number(row.bastille_video_rows || 0);
const ftsTables = Number(row.fts_table_count || 0);
const ftsTriggers = Number(row.fts_trigger_count || 0);
const retentionTables = Number(row.retention_table_count || 0);
const retentionRows = Number(row.retention_state_rows || 0);
const lastCleanupSize = Number(row.last_cleanup_size || 0);
const lastDeletedRows = Number(row.last_deleted_rows || 0);
const lastMode = row.last_mode || null;
const sizeBytes = Number(first?.meta?.size_after || 0);

if (total <= 0) throw new Error('D1 contains no articles');
if (video <= 1) throw new Error(`video category regressed to ${video} row(s)`);
if (categories < 10) throw new Error(`expected at least 10 categories, got ${categories}`);
if (sources < 2) throw new Error(`expected at least two sources after controlled sync, got ${sources}`);
if (hk01Rows <= 0) throw new Error('香港01 rows are missing');
if (bastilleRows <= 0) throw new Error('巴士的報 rows are missing after controlled sync');
if (bastilleVideoRows !== 0) throw new Error(`巴士的報 must not populate video; got ${bastilleVideoRows}`);
if (ftsTables !== 1) throw new Error(`expected articles_fts table, got ${ftsTables}`);
if (ftsTriggers !== 3) throw new Error(`expected 3 FTS maintenance triggers, got ${ftsTriggers}`);
if (retentionTables !== 1 || retentionRows !== 1) throw new Error('adaptive retention state is missing');
if (sizeBytes <= 0) throw new Error('D1 size_after is unavailable');
if (sizeBytes >= 375000000 && lastCleanupSize <= 0) throw new Error('adaptive retention has not recorded cleanup above soft limit');
const utilization = (sizeBytes / 500000000 * 100).toFixed(2);
console.log(`D1 production health: total=${total}, video=${video}, categories=${categories}, sources=${sources}, hk01=${hk01Rows}, bastille=${bastilleRows}, bastille_video=${bastilleVideoRows}, fts_table=${ftsTables}, fts_triggers=${ftsTriggers}, size_bytes=${sizeBytes}, utilization_pct=${utilization}, retention_last_size=${lastCleanupSize}, retention_last_deleted=${lastDeletedRows}, retention_last_mode=${lastMode}`);
NODE
