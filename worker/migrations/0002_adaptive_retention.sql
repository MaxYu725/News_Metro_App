-- CF-W6: retain news until D1 approaches its capacity watermark.
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
