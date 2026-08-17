const FTS_MIN_CODEPOINTS = 3;

function codePointLength(value) {
  return Array.from(value).length;
}

export function quoteFtsPhrase(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function escapeLike(value) {
  return value.replace(/[\\%_]/g, match => `\\${match}`);
}

function isMissingFtsTable(error) {
  return String(error?.message || error).includes('no such table: articles_fts');
}

async function runFtsSearch(db, query, offset, fetchLimit) {
  return db
    .prepare(`SELECT a.*
      FROM articles_fts
      JOIN articles AS a ON a.rowid = articles_fts.rowid
      WHERE articles_fts MATCH ?
      ORDER BY a.pubDate DESC
      LIMIT ? OFFSET ?`)
    .bind(quoteFtsPhrase(query), fetchLimit, offset)
    .all();
}

async function runLikeFallback(db, query, offset, fetchLimit) {
  const pattern = `%${escapeLike(query)}%`;
  return db
    .prepare(`SELECT * FROM articles
      WHERE title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
      ORDER BY pubDate DESC
      LIMIT ? OFFSET ?`)
    .bind(pattern, pattern, fetchLimit, offset)
    .all();
}

export async function searchArticles(db, query, page, limit = 20) {
  const offset = page * limit;
  const fetchLimit = limit + 1;
  let result;
  let backend;

  if (codePointLength(query) >= FTS_MIN_CODEPOINTS) {
    try {
      result = await runFtsSearch(db, query, offset, fetchLimit);
      backend = 'fts5-trigram';
    } catch (error) {
      if (!isMissingFtsTable(error)) throw error;
      console.warn('search-fts-missing-fallback', { queryLength: codePointLength(query) });
      result = await runLikeFallback(db, query, offset, fetchLimit);
      backend = 'like-migration-fallback';
    }
  } else {
    result = await runLikeFallback(db, query, offset, fetchLimit);
    backend = 'like-short-query';
  }

  const results = Array.isArray(result?.results) ? result.results : [];
  return {
    rows: results.slice(0, limit),
    hasMore: results.length > limit,
    backend,
  };
}
