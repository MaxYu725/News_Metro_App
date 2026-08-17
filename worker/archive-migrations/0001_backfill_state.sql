CREATE TABLE IF NOT EXISTS archive_backfill_state (
  source_key TEXT PRIMARY KEY,
  cursor TEXT NOT NULL DEFAULT '',
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  last_pubDate TEXT NOT NULL DEFAULT '',
  exhausted INTEGER NOT NULL DEFAULT 0 CHECK (exhausted IN (0, 1)),
  updated_at TEXT NOT NULL
);
