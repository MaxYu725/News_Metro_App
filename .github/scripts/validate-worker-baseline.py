#!/usr/bin/env python3
"""Validate Worker config, security contract, and D1 baseline."""

from __future__ import annotations

import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "worker"


def fail(message: str) -> None:
    raise SystemExit(f"worker baseline validation failed: {message}")


def main() -> int:
    source = (WORKER / "src" / "index.js").read_text("utf-8")
    security = (WORKER / "src" / "security.js").read_text("utf-8")
    search = (WORKER / "src" / "search.js").read_text("utf-8")
    retention = (WORKER / "src" / "retention.js").read_text("utf-8")
    bastille = (WORKER / "src" / "sources" / "bastille.js").read_text("utf-8")
    archive_backfill = (WORKER / "src" / "archive-backfill.js").read_text("utf-8")
    archive_backfill_script = (WORKER / "scripts" / "archive-backfill.mjs").read_text("utf-8")
    archive_backfill_migration = (WORKER / "archive-migrations" / "0001_backfill_state.sql").read_text("utf-8")
    manifest = json.loads((WORKER / "recovery-manifest.json").read_text("utf-8"))
    config = json.loads((WORKER / "wrangler.jsonc").read_text("utf-8"))

    settings = manifest["settings"]
    if config.get("name") != "news-proxy":
        fail("Wrangler Worker name is not news-proxy")
    if config.get("compatibility_date") != settings.get("compatibility_date"):
        fail("compatibility_date does not match recovered production settings")
    if config.get("compatibility_flags", []) != settings.get("compatibility_flags", []):
        fail("compatibility_flags do not match recovered production settings")
    if config.get("preview_urls") is not False:
        fail("preview_urls must be explicitly disabled")

    binding_map = {item["name"]: item for item in settings.get("bindings", [])}
    if set(binding_map) != {"AI", "API_KEY", "DB"}:
        fail(f"unexpected recovered binding set: {sorted(binding_map)}")

    if config.get("ai", {}).get("binding") != "AI":
        fail("AI binding is not reproduced in wrangler.jsonc")

    d1 = config.get("d1_databases", [])
    d1_map = {item.get("binding"): item for item in d1}
    if set(d1_map) != {"DB", "ARCHIVE_01"}:
        fail(f"expected live + archive D1 bindings, got {sorted(d1_map)}")
    live_d1 = d1_map["DB"]
    if live_d1.get("database_id") != binding_map["DB"].get("id"):
        fail("live D1 database_id does not match recovered production binding")
    if live_d1.get("database_name") != "metro_news_db" or live_d1.get("migrations_dir") != "migrations":
        fail("live D1 name/migrations_dir mismatch")
    archive_d1 = d1_map["ARCHIVE_01"]
    if archive_d1.get("database_id") != "a3db6dc1-599c-4ace-b12c-142e56c3734a":
        fail("archive D1 database_id mismatch")
    if archive_d1.get("database_name") != "metro_news_archive_01" or archive_d1.get("migrations_dir") != "archive-migrations":
        fail("archive D1 name/migrations_dir mismatch")

    if config.get("secrets", {}).get("required") != ["API_KEY"]:
        fail("API_KEY must be declared as the only required secret")

    if config.get("triggers", {}).get("crons") != ["*/15 * * * *"]:
        fail("cron trigger does not match production")

    ratelimits = {item.get("name"): item for item in config.get("ratelimits", [])}
    expected_rate_limits = {
        "AI_RATE_LIMITER": (12, 60),
        "FETCH_RATE_LIMITER": (60, 60),
        "SYNC_RATE_LIMITER": (4, 60),
    }
    if set(ratelimits) != set(expected_rate_limits):
        fail(f"unexpected rate limit bindings: {sorted(ratelimits)}")
    for name, (limit, period) in expected_rate_limits.items():
        simple = ratelimits[name].get("simple", {})
        if simple.get("limit") != limit or simple.get("period") != period:
            fail(f"{name} rate limit does not match security contract")

    migration = (WORKER / "migrations" / "0000_production_baseline.sql").read_text("utf-8")
    db = sqlite3.connect(":memory:")
    db.executescript(migration)

    columns = db.execute("PRAGMA table_info(articles)").fetchall()
    actual_columns = [(row[1], row[2], row[3], row[5]) for row in columns]
    expected_columns = [
        ("id", "TEXT", 0, 1),
        ("title", "TEXT", 1, 0),
        ("link", "TEXT", 1, 0),
        ("pubDate", "TEXT", 1, 0),
        ("description", "TEXT", 0, 0),
        ("category", "TEXT", 1, 0),
        ("source", "TEXT", 1, 0),
        ("imageUrl", "TEXT", 0, 0),
        ("images", "TEXT", 0, 0),
    ]
    if actual_columns != expected_columns:
        fail(f"baseline articles schema mismatch: {actual_columns}")

    indexes = {
        row[1]
        for row in db.execute("PRAGMA index_list(articles)").fetchall()
        if row[1] and not row[1].startswith("sqlite_autoindex")
    }
    if indexes != {"idx_category_pubDate", "idx_pubDate"}:
        fail(f"baseline index set mismatch: {sorted(indexes)}")

    for route in [
        "/api/article-full",
        "/api/summarize",
        "/api/images",
        "/api/search",
        "/api/news/",
    ]:
        if route not in source:
            fail(f"Worker route missing: {route}")

    security_signals = [
        "https://maxyu725.github.io",
        "parseAllowedArticleUrl",
        "AI_RATE_LIMITER",
        "FETCH_RATE_LIMITER",
        "SYNC_RATE_LIMITER",
    ]
    combined = source + "\n" + security
    for signal in security_signals:
        if signal not in combined:
            fail(f"security contract signal missing: {signal}")

    if "Access-Control-Allow-Origin': '*'" in combined or '"Access-Control-Allow-Origin": "*"' in combined:
        fail("wildcard CORS must not be reintroduced")
    if "targetUrl.includes('hk01.com')" in combined:
        fail("unsafe HK01 substring allowlist must not be reintroduced")

    # NS2B: second source must stay source-specific and use the existing schema.
    for signal in [
        "BASTILLE_SOURCE_NAME = '巴士的報'",
        "https://www.bastillepost.com/hongkong/feed",
        "parseBastilleRss",
        "resolveBastilleCategory",
        "content:encoded",
    ]:
        if signal not in bastille:
            fail(f"Bastille provider signal missing: {signal}")
    for signal in [
        "fetchBastilleArticles",
        "syncBastilleToDB",
        "isFullContentLoaded: isBastilleSource(row.source)",
    ]:
        if signal not in source:
            fail(f"Bastille integration signal missing: {signal}")
    if "bastillepost.com" not in security:
        fail("Bastille article hostname allowlist is missing")

    # CF-W4R2: image archive uses only the two live, verified RSSHub channels.
    if '/hk01/zone/13' in source:
        fail('stale HK01 image aggregate feed must not be reintroduced')
    if '[259, 256]' not in source or '/hk01/channel/${channelId}' not in source:
        fail('verified HK01 image channel mapping is missing')
    if '[259, 256, 260, 348]' in source or 'channel/260' in source or 'channel/348' in source:
        fail('dead HK01 image channels must not be reintroduced')
    if 'https://rsshub.rssforever.com/hk01/channel/${channelId}' not in source:
        fail('image archive must use the verified rssforever endpoint')
    if 'timeoutMs: 20000' not in source or 'sourceConfig.timeoutMs || 8000' not in source:
        fail('image archive timeout policy is missing')

    # NS2C2B1: archive search is read-only, cursor-based, and replica-aware.
    archive_migration = (WORKER / "archive-migrations" / "0000_archive_baseline.sql").read_text("utf-8")
    for signal in [
        "CREATE TABLE IF NOT EXISTS articles",
        "USING fts5",
        "tokenize='trigram'",
        "idx_archive_pubDate",
        "idx_archive_source_pubDate",
        "articles_fts_ai",
        "articles_fts_ad",
        "articles_fts_au",
    ]:
        if signal not in archive_migration:
            fail(f"archive migration signal missing: {signal}")
    if "images TEXT" in archive_migration:
        fail("archive schema must remain lean and omit full images JSON")
    for signal in [
        "searchArticlesAcrossDatabases",
        "decodeSearchCursor",
        "scope === 'all'",
        "env.ARCHIVE_01.withSession('first-unconstrained')",
    ]:
        if signal not in source:
            fail(f"archive search integration signal missing: {signal}")
    if "ARCHIVE_01.prepare" in source or "ARCHIVE_01.batch" in source:
        fail("production Worker must not write directly to archive during NS2C2B1")

    # NS2C3A: historical backfill is bounded, backward-only, replayable, and external to the Worker runtime.
    for signal in [
        "ARCHIVE_BACKFILL_MAX_LIMIT = 1000",
        "ARCHIVE_SHARD_STOP_BYTES = 300_000_000",
        "ARCHIVE_SHARD_POST_WRITE_MAX_BYTES = 325_000_000",
        "https://web-data.api.hk01.com",
        "nextOffset",
        "https://www.bastillepost.com",
        "paged",
        "backfillPlanItemInsertSql",
        "backfillApplyArticlesSql",
        "backfillApplyStateAndMarkWrittenSql",
        "backfillMarkCompletedSql",
    ]:
        if signal not in archive_backfill:
            fail(f"archive backfill contract signal missing: {signal}")
    for zone_signal in [
        "{ zoneId: 1, category: 'local' }",
        "{ zoneId: 2, category: 'ent' }",
        "{ zoneId: 3, category: 'sports' }",
        "{ zoneId: 4, category: 'global' }",
        "{ zoneId: 5, category: 'china' }",
        "{ zoneId: 7, category: 'hot' }",
        "{ zoneId: 8, category: 'life' }",
        "{ zoneId: 10, category: 'community' }",
        "{ zoneId: 11, category: 'tech' }",
    ]:
        if zone_signal not in archive_backfill:
            fail(f"archive historical zone mapping missing: {zone_signal}")
    if "category: 'video'" in archive_backfill:
        fail("video/image archive must not be historical-backfill owned")
    for signal in [
        "archive_backfill_state",
        "archive_backfill_runs",
        "archive_backfill_run_items",
        "archive_backfill_run_state",
        "'planned', 'written', 'completed'",
    ]:
        if signal not in archive_backfill_migration:
            fail(f"archive backfill migration signal missing: {signal}")
    for signal in [
        "sourceFloor(existingRows",
        "writeBatchPlan",
        "plan-reset.sql",
        "existing snapshot incomplete",
        "args['batch-id']",
    ]:
        if signal not in archive_backfill_script:
            fail(f"archive backfill generator signal missing: {signal}")
    if "ARCHIVE_01.prepare" in source or "ARCHIVE_01.batch" in source:
        fail("production Worker must remain read-only against ARCHIVE_01")

    # CF-W5: indexed substring search must remain on D1 FTS5 trigram.
    fts_migration = (WORKER / "migrations" / "0001_search_fts.sql").read_text("utf-8")
    for signal in [
        "USING fts5",
        "tokenize='trigram'",
        "content='articles'",
        "articles_fts_ai",
        "articles_fts_ad",
        "articles_fts_au",
        "VALUES ('rebuild')",
    ]:
        if signal not in fts_migration:
            fail(f"FTS migration signal missing: {signal}")
    if "searchArticles" not in source or "articles_fts MATCH ?" not in search:
        fail("Worker search route is not using the FTS search owner")
    if "SELECT * FROM articles WHERE title LIKE ? OR description LIKE ?" in source:
        fail("legacy unindexed search scan must not be reintroduced")

    # CF-W6: retention is capacity-driven, not age-driven.
    retention_migration = (WORKER / "migrations" / "0002_adaptive_retention.sql").read_text("utf-8")
    for signal in [
        "retention_state",
        "last_cleanup_size",
        "last_cleanup_at",
        "last_deleted_rows",
        "last_mode",
    ]:
        if signal not in retention_migration:
            fail(f"adaptive retention migration signal missing: {signal}")
    for signal in [
        "softLimitBytes: 375_000_000",
        "emergencyLimitBytes: 450_000_000",
        "databaseLimitBytes: 500_000_000",
        "hardReserveBytes: 10_000_000",
        "softRearmBytes: 25_000_000",
        "emergencyRearmBytes: 10_000_000",
        "category <> 'video'",
        "ORDER BY pubDate ASC",
        "UPDATE retention_state",
        "size_after",
    ]:
        if signal not in retention:
            fail(f"adaptive retention contract signal missing: {signal}")
    if "-30 days" in source or "cleanUpOldArticles" in source:
        fail("fixed 30-day retention must not be reintroduced")
    if "ctx.waitUntil(syncAllCategoriesAndRetention(env));" not in source:
        fail("scheduled ingestion must run adaptive retention after category sync")
    if "enforceAdaptiveRetention(env.DB)" not in source:
        fail("forced sync must use adaptive retention")

    print("Wrangler production resource alignment: OK")
    print("Rate limit security bindings: OK")
    print("D1 baseline schema/indexes: OK")
    print("D1 FTS5 trigram search contract: OK")
    print("D1 controlled historical archive backfill contract: OK")
    print("D1 adaptive capacity retention contract: OK")
    print("Worker route/security contract: OK")
    print("Recovery manifest retained as historical production provenance: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
