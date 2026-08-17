#!/usr/bin/env python3
"""Validate the recovered Worker, Wrangler config, and D1 baseline stay aligned."""

from __future__ import annotations

import hashlib
import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "worker"


def fail(message: str) -> None:
    raise SystemExit(f"worker baseline validation failed: {message}")


def main() -> int:
    source = (WORKER / "src" / "index.js").read_bytes()
    manifest = json.loads((WORKER / "recovery-manifest.json").read_text("utf-8"))
    config = json.loads((WORKER / "wrangler.jsonc").read_text("utf-8"))

    expected_hash = manifest["recovered_source"]["sha256"]
    actual_hash = hashlib.sha256(source).hexdigest()
    if actual_hash != expected_hash:
        fail(f"source hash drifted: expected {expected_hash}, got {actual_hash}")

    settings = manifest["settings"]
    if config.get("name") != "news-proxy":
        fail("Wrangler Worker name is not news-proxy")
    if config.get("compatibility_date") != settings.get("compatibility_date"):
        fail("compatibility_date does not match recovered production settings")
    if config.get("compatibility_flags", []) != settings.get("compatibility_flags", []):
        fail("compatibility_flags do not match recovered production settings")

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

    text = source.decode("utf-8")
    for route in [
        "/api/article-full",
        "/api/summarize",
        "/api/images",
        "/api/search",
        "/api/news/",
    ]:
        if route not in text:
            fail(f"recovered production route missing: {route}")

    print("Worker recovery hash: OK")
    print("Wrangler production alignment: OK")
    print("D1 baseline schema/indexes: OK")
    print("Recovered route inventory: OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
