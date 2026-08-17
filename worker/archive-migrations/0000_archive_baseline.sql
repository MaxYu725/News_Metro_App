CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  link TEXT NOT NULL,
  pubDate TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  imageUrl TEXT
);

CREATE INDEX IF NOT EXISTS idx_archive_pubDate ON articles(pubDate DESC);
CREATE INDEX IF NOT EXISTS idx_archive_source_pubDate ON articles(source, pubDate DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(
  title,
  description,
  content='articles',
  content_rowid='rowid',
  tokenize='trigram'
);

CREATE TRIGGER IF NOT EXISTS articles_fts_ai AFTER INSERT ON articles BEGIN
  INSERT INTO articles_fts(rowid, title, description)
  VALUES (new.rowid, new.title, COALESCE(new.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_fts_ad AFTER DELETE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS articles_fts_au AFTER UPDATE ON articles BEGIN
  INSERT INTO articles_fts(articles_fts, rowid, title, description)
  VALUES ('delete', old.rowid, old.title, COALESCE(old.description, ''));
  INSERT INTO articles_fts(rowid, title, description)
  VALUES (new.rowid, new.title, COALESCE(new.description, ''));
END;
