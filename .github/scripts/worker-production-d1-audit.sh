#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../.."/worker

query="SELECT COUNT(*) AS total_rows, SUM(CASE WHEN category = 'video' THEN 1 ELSE 0 END) AS video_rows, SUM(CASE WHEN category <> 'video' AND datetime(pubDate) < datetime('now', '-30 days') THEN 1 ELSE 0 END) AS stale_non_video_rows, COUNT(DISTINCT category) AS category_count, COUNT(DISTINCT source) AS source_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='articles_fts') AS fts_table_count, (SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('articles_fts_ai','articles_fts_ad','articles_fts_au')) AS fts_trigger_count FROM articles"

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
const stale = Number(row.stale_non_video_rows || 0);
const categories = Number(row.category_count || 0);
const sources = Number(row.source_count || 0);
const ftsTables = Number(row.fts_table_count || 0);
const ftsTriggers = Number(row.fts_trigger_count || 0);

if (total <= 0) throw new Error('D1 contains no articles');
if (video <= 1) throw new Error(`video category regressed to ${video} row(s)`);
if (stale !== 0) throw new Error(`${stale} non-video row(s) are older than 30 days`);
if (categories < 10) throw new Error(`expected at least 10 categories, got ${categories}`);
if (sources < 1) throw new Error('expected at least one source');
if (ftsTables !== 1) throw new Error(`expected articles_fts table, got ${ftsTables}`);
if (ftsTriggers !== 3) throw new Error(`expected 3 FTS maintenance triggers, got ${ftsTriggers}`);

console.log(`D1 production health: total=${total}, video=${video}, stale_non_video=${stale}, categories=${categories}, sources=${sources}, fts_table=${ftsTables}, fts_triggers=${ftsTriggers}`);
NODE
