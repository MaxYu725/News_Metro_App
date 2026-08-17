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
    if len(d1) != 1:
        fail("expected exactly one D1 binding")
    if d1[0].get("binding") != "DB":
        fail("D1 binding name is not DB")
    if d1[0].get("database_id") != binding_map["DB"].get("id"):
        fail("D1 database_id does not match recovered production binding")
    if d1[0].get("database_name") != "metro_news_db":
        fail("D1 database_name is not metro_news_db")
    if d1[0].get("migrations_dir") != "migrations":
        fail("D1 migrations_dir is not migrations")

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

    retention_sql = "DELETE FROM articles WHERE category <> 'video' AND datetime(pubDate) < datetime('now', '-30 days')"
    if retention_sql not in source:
        fail("30-day retention must exclude the low-frequency video archive")
    if "ctx.waitUntil(syncAllCategoriesAndCleanup(env));" not in source:
        fail("scheduled ingestion must clean up only after category sync completes")
    if "ctx.waitUntil(cleanUpOldArticles(env))" in source:
        fail("cleanup must not race forced sync in the background")

    print("Wrangler production resource alignment: OK")
    print("Rate limit security bindings: OK")
    print("D1 baseline schema/indexes: OK")
    print("Worker route/security contract: OK")
    print("Recovery manifest retained as historical production provenance: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
