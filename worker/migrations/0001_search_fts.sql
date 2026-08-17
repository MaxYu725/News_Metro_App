-- CF-W5: indexed substring search for Traditional Chinese and mixed-language news.
-- External-content FTS avoids duplicating article payloads while triggers keep the
-- index synchronized with inserts, updates, and retention deletes.

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

INSERT INTO articles_fts(articles_fts) VALUES ('rebuild');
