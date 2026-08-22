#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
cd "$ROOT/worker"

batch_id=${1:-}
archive_binding=${2:-ARCHIVE_01}
if [[ ! "$batch_id" =~ ^[A-Za-z0-9._-]{1,80}$ ]]; then
  echo 'invalid archive batch id' >&2
  exit 1
fi
if [[ "$archive_binding" != 'ARCHIVE_01' && "$archive_binding" != 'ARCHIVE_02' ]]; then
  echo 'invalid archive binding' >&2
  exit 1
fi

query="SELECT r.batch_id,r.source,r.requested_rows,r.generated_rows,r.before_rows,r.status,(SELECT COUNT(*) FROM archive_backfill_run_items i WHERE i.batch_id=r.batch_id) AS plan_rows,(SELECT COUNT(*) FROM archive_backfill_run_state s WHERE s.batch_id=r.batch_id) AS plan_states,(SELECT COUNT(*) FROM archive_backfill_run_items i JOIN articles a ON a.id=i.id WHERE i.batch_id=r.batch_id) AS materialized_rows,(SELECT COUNT(*) FROM articles) AS total_rows,(SELECT COUNT(*) FROM articles WHERE source='香港01') AS hk01_rows,(SELECT COUNT(*) FROM articles WHERE source='巴士的報') AS bastille_rows,(SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='articles_fts') AS fts_table_count,(SELECT COUNT(*) FROM sqlite_master WHERE type='trigger' AND name IN ('articles_fts_ai','articles_fts_ad','articles_fts_au')) AS fts_trigger_count,(SELECT COUNT(*) FROM pragma_table_info('articles') WHERE name='images') AS images_column_count FROM archive_backfill_runs r WHERE r.batch_id='${batch_id}'"

npx wrangler d1 execute "$archive_binding" --remote --command "$query" --json > /tmp/metro-news-archive-backfill-audit.json

ARCHIVE_BINDING="$archive_binding" node <<'NODE'
const fs = require('fs');
const payload = JSON.parse(fs.readFileSync('/tmp/metro-news-archive-backfill-audit.json', 'utf8'));
const first = Array.isArray(payload) ? payload[0] : payload?.result?.[0];
const row = first?.results?.[0] || first?.result?.results?.[0];
if (!row) throw new Error('archive backfill audit returned no run row');

const requested = Number(row.requested_rows || 0);
const generated = Number(row.generated_rows || 0);
const before = Number(row.before_rows || 0);
const total = Number(row.total_rows || 0);
const planRows = Number(row.plan_rows || 0);
const planStates = Number(row.plan_states || 0);
const materialized = Number(row.materialized_rows || 0);
const fts = Number(row.fts_table_count || 0);
const triggers = Number(row.fts_trigger_count || 0);
const imagesColumn = Number(row.images_column_count || 0);
const size = Number(first?.meta?.size_after || first?.result?.meta?.size_after || 0);

if (row.status !== 'written') throw new Error(`batch is not written: ${row.status}`);
if (![500, 1000].includes(requested)) throw new Error(`production batch size outside controlled contract: ${requested}`);
if (generated !== requested) throw new Error(`generated/requested mismatch: ${generated}/${requested}`);
if (planRows !== generated) throw new Error(`plan row mismatch: ${planRows}/${generated}`);
if (planStates < 1) throw new Error('batch has no persisted resume-state plan');
if (materialized !== generated) throw new Error(`planned articles not fully materialized: ${materialized}/${generated}`);
if (total !== before + generated) throw new Error(`archive row delta mismatch: before=${before}, generated=${generated}, total=${total}`);
if (fts !== 1 || triggers !== 3) throw new Error(`archive FTS contract invalid: table=${fts}, triggers=${triggers}`);
if (imagesColumn !== 0) throw new Error('archive unexpectedly stores full images JSON');
if (size <= 0 || size >= 325000000) throw new Error(`archive exceeded post-write shard guard: ${size}`);

console.log(`Archive backfill audit: shard=${process.env.ARCHIVE_BINDING}, batch=${row.batch_id}, source=${row.source}, requested=${requested}, before=${before}, after=${total}, hk01=${row.hk01_rows}, bastille=${row.bastille_rows}, plan_states=${planStates}, size_bytes=${size}`);
NODE
