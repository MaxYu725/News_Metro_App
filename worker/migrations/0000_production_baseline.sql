-- CF-W1 production baseline captured from metro_news_db on 2026-08-17 UTC.
-- This migration is intentionally idempotent so it can establish Wrangler's
-- migration history on the existing production database without rebuilding data.

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  pubDate TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  imageUrl TEXT,
  images TEXT
);

CREATE INDEX IF NOT EXISTS idx_category_pubDate
  ON articles(category, pubDate DESC);

CREATE INDEX IF NOT EXISTS idx_pubDate
  ON articles(pubDate DESC);
