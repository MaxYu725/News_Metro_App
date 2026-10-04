-- Additive: AI state stays in live DB; archives remain lean.
CREATE TABLE IF NOT EXISTS topic_ai_cache (
  cache_key TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  preference TEXT NOT NULL,
  source_filter TEXT NOT NULL,
  analysis_json TEXT,
  output_json TEXT,
  sources_json TEXT NOT NULL DEFAULT '[]',
  members_json TEXT NOT NULL DEFAULT '[]',
  checked_at INTEGER NOT NULL DEFAULT 0,
  generated_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topic_ai_updated ON topic_ai_cache(updated_at);
CREATE TABLE IF NOT EXISTS topic_ai_budget (
  bucket TEXT PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0 CHECK(calls >= 0),
  hours_json TEXT NOT NULL DEFAULT '{}'
);
