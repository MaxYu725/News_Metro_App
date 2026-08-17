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

function compareRowsDesc(a, b) {
  const byDate = String(b?.pubDate || '').localeCompare(String(a?.pubDate || ''));
  if (byDate !== 0) return byDate;
  return String(b?.id || b?.link || '').localeCompare(String(a?.id || a?.link || ''));
}

function utf8ToBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToUtf8(value) {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function encodeSearchCursor(row) {
  if (!row?.pubDate) return '';
  const id = String(row.id || row.link || '');
  if (!id) return '';
  const json = JSON.stringify({ pubDate: String(row.pubDate), id });
  return utf8ToBase64(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeSearchCursor(value) {
  if (!value) return null;
  if (typeof value !== 'string' || value.length > 4096) throw new Error('invalid search cursor');
  try {
    const base64 = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
    const parsed = JSON.parse(base64ToUtf8(base64));
    if (!parsed || typeof parsed.pubDate !== 'string' || typeof parsed.id !== 'string') throw new Error('shape');
    if (!parsed.pubDate || !parsed.id || parsed.pubDate.length > 64 || parsed.id.length > 2048) throw new Error('bounds');
    return { pubDate: parsed.pubDate, id: parsed.id };
  } catch {
    throw new Error('invalid search cursor');
  }
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

async function runFtsCursorSearch(db, query, cursor, fetchLimit) {
  const pubDate = cursor?.pubDate || null;
  const id = cursor?.id || null;
  return db
    .prepare(`SELECT a.*
      FROM articles_fts
      JOIN articles AS a ON a.rowid = articles_fts.rowid
      WHERE articles_fts MATCH ?
        AND (? IS NULL OR a.pubDate < ? OR (a.pubDate = ? AND a.id < ?))
      ORDER BY a.pubDate DESC, a.id DESC
      LIMIT ?`)
    .bind(quoteFtsPhrase(query), pubDate, pubDate, pubDate, id, fetchLimit)
    .all();
}

async function runLikeCursorSearch(db, query, cursor, fetchLimit) {
  const pattern = `%${escapeLike(query)}%`;
  const pubDate = cursor?.pubDate || null;
  const id = cursor?.id || null;
  return db
    .prepare(`SELECT * FROM articles
      WHERE (title LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
        AND (? IS NULL OR pubDate < ? OR (pubDate = ? AND id < ?))
      ORDER BY pubDate DESC, id DESC
      LIMIT ?`)
    .bind(pattern, pattern, pubDate, pubDate, pubDate, id, fetchLimit)
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

export async function searchArticlesAfterCursor(db, query, cursor, limit = 20) {
  const fetchLimit = limit + 1;
  let result;
  let backend;

  if (codePointLength(query) >= FTS_MIN_CODEPOINTS) {
    try {
      result = await runFtsCursorSearch(db, query, cursor, fetchLimit);
      backend = 'fts5-trigram';
    } catch (error) {
      if (!isMissingFtsTable(error)) throw error;
      console.warn('search-fts-missing-fallback', { queryLength: codePointLength(query) });
      result = await runLikeCursorSearch(db, query, cursor, fetchLimit);
      backend = 'like-migration-fallback';
    }
  } else {
    result = await runLikeCursorSearch(db, query, cursor, fetchLimit);
    backend = 'like-short-query';
  }

  const results = Array.isArray(result?.results) ? result.results : [];
  return {
    rows: results.slice(0, limit),
    hasMore: results.length > limit,
    backend,
  };
}

export async function searchArticlesAcrossDatabases(databases, query, cursor, limit = 20) {
  const eligible = (databases || []).filter(Boolean);
  if (eligible.length === 0) return { rows: [], hasMore: false, nextCursor: '', backends: [] };

  const perDbLimit = limit * 2 + 1;
  const batches = await Promise.all(
    eligible.map(db => searchArticlesAfterCursor(db, query, cursor, perDbLimit)),
  );

  const unique = new Map();
  for (const batch of batches) {
    for (const row of batch.rows) {
      const key = String(row?.id || row?.link || '');
      if (!key) continue;
      const previous = unique.get(key);
      if (!previous || compareRowsDesc(row, previous) < 0) unique.set(key, row);
    }
  }

  const merged = [...unique.values()].sort(compareRowsDesc);
  const rows = merged.slice(0, limit);
  const hasMore = merged.length > limit || batches.some(batch => batch.hasMore);
  return {
    rows,
    hasMore,
    nextCursor: hasMore && rows.length > 0 ? encodeSearchCursor(rows.at(-1)) : '',
    backends: batches.map(batch => batch.backend),
  };
}

export function isArchiveEligibleQuery(query) {
  return codePointLength(query) >= FTS_MIN_CODEPOINTS;
}
