#!/usr/bin/env python3
from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if new in text:
        return text
    if old not in text:
        raise SystemExit(f"missing patch anchor: {label}")
    return text.replace(old, new, 1)


index = Path('worker/src/index.js')
text = index.read_text('utf-8')
if "from './archive-shards.js'" not in text:
    anchor = "import {\n  decodeSearchCursor,\n"
    if anchor not in text:
        raise SystemExit('missing patch anchor: index import')
    text = text.replace(anchor, "import { archiveDatabases, sourceCountsAcrossDatabases } from './archive-shards.js';\nimport {\n  decodeSearchCursor,\n", 1)
text = replace_once(
    text,
    """        const archiveDb = env.ARCHIVE_01?.withSession
          ? env.ARCHIVE_01.withSession('first-unconstrained')
          : env.DB;
        const { results } = await archiveDb.prepare(
          `SELECT source, COUNT(*) AS count FROM articles GROUP BY source`,
        ).all();
        const bySource = new Map((results || []).map(row => [String(row.source || ''), Number(row.count || 0)]));
""",
    """        const archives = archiveDatabases(env);
        const databases = archives.length > 0 ? archives : [env.DB].filter(Boolean);
        const bySource = await sourceCountsAcrossDatabases(databases);
""",
    'source stats',
)
text = replace_once(
    text,
    """        const archiveSession = env.ARCHIVE_01.withSession('first-unconstrained');
        const { rows, hasMore, nextCursor } = await searchArticlesAcrossDatabases(
          [env.DB, archiveSession],
""",
    """        const archives = archiveDatabases(env);
        const { rows, hasMore, nextCursor } = await searchArticlesAcrossDatabases(
          [env.DB, ...archives],
""",
    'archive search',
)
index.write_text(text, 'utf-8')

validator = Path('.github/scripts/validate-worker-baseline.py')
text = validator.read_text('utf-8')
anchor = '    archive_backfill = (WORKER / "src" / "archive-backfill.js").read_text("utf-8")\n'
if 'archive_shards = ' not in text:
    if anchor not in text:
        raise SystemExit('missing patch anchor: validator source')
    text = text.replace(anchor, anchor + '    archive_shards = (WORKER / "src" / "archive-shards.js").read_text("utf-8")\n', 1)
text = replace_once(
    text,
    '    if set(d1_map) != {"DB", "ARCHIVE_01"}:\n        fail(f"expected live + archive D1 bindings, got {sorted(d1_map)}")\n',
    '    if set(d1_map) != {"DB", "ARCHIVE_01", "ARCHIVE_02"}:\n        fail(f"expected live + two archive D1 bindings, got {sorted(d1_map)}")\n',
    'D1 binding set',
)
text = replace_once(
    text,
    """    archive_d1 = d1_map["ARCHIVE_01"]
    if archive_d1.get("database_id") != "a3db6dc1-599c-4ace-b12c-142e56c3734a":
        fail("archive D1 database_id mismatch")
    if archive_d1.get("database_name") != "metro_news_archive_01" or archive_d1.get("migrations_dir") != "archive-migrations":
        fail("archive D1 name/migrations_dir mismatch")
""",
    """    archive_d1 = d1_map["ARCHIVE_01"]
    if archive_d1.get("database_id") != "a3db6dc1-599c-4ace-b12c-142e56c3734a":
        fail("ARCHIVE_01 database_id mismatch")
    if archive_d1.get("database_name") != "metro_news_archive_01" or archive_d1.get("migrations_dir") != "archive-migrations":
        fail("ARCHIVE_01 name/migrations_dir mismatch")
    archive_d2 = d1_map["ARCHIVE_02"]
    if archive_d2.get("database_id") != "60ca53f2-7b2a-41cb-b933-4232b8d26d7a":
        fail("ARCHIVE_02 database_id mismatch")
    if archive_d2.get("database_name") != "metro_news_archive_02" or archive_d2.get("migrations_dir") != "archive-migrations":
        fail("ARCHIVE_02 name/migrations_dir mismatch")
""",
    'archive bindings',
)
text = replace_once(
    text,
    """    for signal in [
        "searchArticlesAcrossDatabases",
        "decodeSearchCursor",
        "scope === 'all'",
        "env.ARCHIVE_01.withSession('first-unconstrained')",
    ]:
        if signal not in source:
            fail(f"archive search integration signal missing: {signal}")
    if "ARCHIVE_01.prepare" in source or "ARCHIVE_01.batch" in source:
        fail("production Worker must not write directly to archive during NS2C2B1")
""",
    """    for signal in [
        "searchArticlesAcrossDatabases",
        "decodeSearchCursor",
        "scope === 'all'",
        "archiveDatabases(env)",
        "sourceCountsAcrossDatabases",
    ]:
        if signal not in source:
            fail(f"archive search integration signal missing: {signal}")
    for signal in ["ARCHIVE_BINDING_NAMES", "ARCHIVE_01", "ARCHIVE_02", "first-unconstrained"]:
        if signal not in archive_shards:
            fail(f"archive shard registry signal missing: {signal}")
    if any(signal in source for signal in ["ARCHIVE_01.prepare", "ARCHIVE_01.batch", "ARCHIVE_02.prepare", "ARCHIVE_02.batch"]):
        fail("production Worker must not write directly to archive shards")
""",
    'archive search validator',
)
old = """    if "ARCHIVE_01.prepare" in source or "ARCHIVE_01.batch" in source:
        fail("production Worker must remain read-only against ARCHIVE_01")
"""
new = """    if any(signal in source for signal in ["ARCHIVE_01.prepare", "ARCHIVE_01.batch", "ARCHIVE_02.prepare", "ARCHIVE_02.batch"]):
        fail("production Worker must remain read-only against archive shards")
"""
if old in text:
    text = text.replace(old, new, 1)
validator.write_text(text, 'utf-8')

Path('.deploy/worker-production.txt').write_text(
    'NS2C7 production promotion: bind metro_news_archive_02, search/count across both archive shards, and enable automatic HK01 rollover with cross-shard watchdog coverage.\n',
    'utf-8',
)
