CREATE TABLE IF NOT EXISTS archive_backfill_state (
  source_key TEXT PRIMARY KEY,
  cursor TEXT NOT NULL DEFAULT '',
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  last_pubDate TEXT NOT NULL DEFAULT '',
  exhausted INTEGER NOT NULL DEFAULT 0 CHECK (exhausted IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS archive_backfill_runs (
  batch_id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  requested_rows INTEGER NOT NULL,
  generated_rows INTEGER NOT NULL,
  before_rows INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('planned', 'written', 'completed')),
  created_at TEXT NOT NULL,
  written_at TEXT,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS archive_backfill_run_items (
  batch_id TEXT NOT NULL,
  ordinal INTEGER NOT NULL,
  id TEXT NOT NULL,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  pubDate TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  imageUrl TEXT,
  PRIMARY KEY (batch_id, ordinal),
  UNIQUE (batch_id, id)
);

CREATE INDEX IF NOT EXISTS idx_archive_backfill_run_items_batch
ON archive_backfill_run_items(batch_id, ordinal);

CREATE TABLE IF NOT EXISTS archive_backfill_run_state (
  batch_id TEXT NOT NULL,
  source_key TEXT NOT NULL,
  cursor TEXT NOT NULL DEFAULT '',
  pages_fetched INTEGER NOT NULL DEFAULT 0,
  rows_inserted INTEGER NOT NULL DEFAULT 0,
  last_pubDate TEXT NOT NULL DEFAULT '',
  exhausted INTEGER NOT NULL DEFAULT 0 CHECK (exhausted IN (0, 1)),
  PRIMARY KEY (batch_id, source_key)
);
