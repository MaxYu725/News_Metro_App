import { parseBastilleRss } from './sources/bastille.js';

export const ARCHIVE_BACKFILL_MAX_LIMIT = 1000;
export const ARCHIVE_SHARD_STOP_BYTES = 300_000_000;
export const ARCHIVE_SHARD_POST_WRITE_MAX_BYTES = 325_000_000;

export const HK01_HISTORICAL_ZONES = [
  { zoneId: 1, category: 'local' },
  { zoneId: 2, category: 'ent' },
  { zoneId: 3, category: 'sports' },
  { zoneId: 4, category: 'global' },
  { zoneId: 5, category: 'china' },
  { zoneId: 7, category: 'hot' },
  { zoneId: 8, category: 'life' },
  { zoneId: 10, category: 'community' },
  { zoneId: 11, category: 'tech' },
];

const HK01_API_ORIGIN = 'https://web-data.api.hk01.com';
const BASTILLE_ORIGIN = 'https://www.bastillepost.com';
const HK01_ARTICLE_HOSTS = new Set(['hk01.com', 'www.hk01.com']);
const BASTILLE_HOSTS = new Set(['bastillepost.com', 'www.bastillepost.com']);
const HK01_IMAGE_HOSTS = new Set(['cdn.hk01.com']);

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

function safeIsoFromEpochSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function safeHttpsUrl(value, allowedHosts) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || !allowedHosts.has(url.hostname)) return '';
    return url.href;
  } catch {
    return '';
  }
}

function integerLiteral(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error('invalid non-negative integer literal');
  return String(number);
}

export function hk01HistoricalPageUrl(zoneId, cursor = '') {
  const zone = Number(zoneId);
  if (!Number.isInteger(zone) || zone < 1) throw new Error('invalid HK01 zone');
  const url = new URL(`/v2/feed/zone/${zone}`, HK01_API_ORIGIN);
  if (cursor !== '' && cursor != null) url.searchParams.set('offset', String(cursor));
  return url.href;
}

export function parseHk01HistoricalPage(payload, category) {
  const articles = [];
  const items = Array.isArray(payload?.items) ? payload.items : [];

  for (const item of items) {
    const data = item?.data;
    if (!data || typeof data !== 'object') continue;
    if (data.type && data.type !== 'article') continue;

    const link = safeHttpsUrl(data.canonicalUrl || data.publishUrl, HK01_ARTICLE_HOSTS);
    const title = String(data.title || '').trim();
    const pubDate = safeIsoFromEpochSeconds(data.publishTime);
    if (!link || !title || !pubDate) continue;

    const imageUrl = safeHttpsUrl(
      data.mainImage?.cdnUrl || data.originalImage?.cdnUrl || '',
      HK01_IMAGE_HOSTS,
    );

    articles.push({
      id: link,
      title,
      link,
      pubDate,
      description: String(data.description || '').trim(),
      category,
      source: '香港01',
      imageUrl,
    });
  }

  const next = payload?.nextOffset;
  return {
    articles,
    nextCursor: next == null ? '' : String(next),
  };
}

export async function fetchHk01HistoricalPage(zone, cursor = '', fetchImpl = fetch) {
  const { signal, clear } = timeoutSignal(15_000);
  try {
    const response = await fetchImpl(hk01HistoricalPageUrl(zone.zoneId, cursor), {
      signal,
      redirect: 'error',
      headers: {
        'User-Agent': 'MetroNewsArchive/1.0',
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'zh-HK,zh-TW;q=0.9,en;q=0.6',
      },
    });
    if (!response.ok) throw new Error(`HK01 historical HTTP ${response.status}`);
    return parseHk01HistoricalPage(await response.json(), zone.category);
  } finally {
    clear();
  }
}

export function bastilleHistoricalPageUrl(page) {
  const value = Number(page);
  if (!Number.isInteger(value) || value < 1) throw new Error('invalid Bastille page');
  const url = new URL('/hongkong/feed', BASTILLE_ORIGIN);
  url.searchParams.set('paged', String(value));
  return url.href;
}

export async function fetchBastilleHistoricalPage(page, fetchImpl = fetch) {
  const { signal, clear } = timeoutSignal(20_000);
  try {
    const response = await fetchImpl(bastilleHistoricalPageUrl(page), {
      signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'MetroNewsArchive/1.0',
        Accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
        'Accept-Language': 'zh-HK,zh-TW;q=0.9,en;q=0.6',
      },
    });
    if (!response.ok) throw new Error(`Bastille historical HTTP ${response.status}`);

    const finalUrl = new URL(response.url || bastilleHistoricalPageUrl(page));
    if (finalUrl.protocol !== 'https:' || !BASTILLE_HOSTS.has(finalUrl.hostname)) {
      throw new Error('Bastille historical redirect escaped publisher host');
    }

    const articles = parseBastilleRss(await response.text()).map(item => ({
      id: item.link,
      title: item.title,
      link: item.link,
      pubDate: item.pubDate,
      description: item.description || '',
      category: item.category,
      source: item.source,
      imageUrl: item.imageUrl || '',
    }));

    return {
      articles,
      nextCursor: String(Number(page) + 1),
    };
  } finally {
    clear();
  }
}

export function sqlLiteral(value) {
  if (value == null) return 'NULL';
  const text = String(value).replace(/\u0000/g, '').replace(/'/g, "''");
  return `'${text}'`;
}

export function articleInsertSql(article) {
  return `INSERT OR IGNORE INTO articles (id,title,link,pubDate,description,category,source,imageUrl) VALUES (${[
    article.id,
    article.title,
    article.link,
    article.pubDate,
    article.description || '',
    article.category,
    article.source,
    article.imageUrl || '',
  ].map(sqlLiteral).join(',')});`;
}

export function backfillStateUpsertSql(state, now = new Date().toISOString()) {
  return `INSERT INTO archive_backfill_state (source_key,cursor,pages_fetched,rows_inserted,last_pubDate,exhausted,updated_at) VALUES (${[
    sqlLiteral(state.sourceKey),
    sqlLiteral(state.cursor || ''),
    integerLiteral(Number(state.pagesFetched || 0)),
    integerLiteral(Number(state.rowsInserted || 0)),
    sqlLiteral(state.lastPubDate || ''),
    integerLiteral(Number(state.exhausted ? 1 : 0)),
    sqlLiteral(now),
  ].join(',')}) ON CONFLICT(source_key) DO UPDATE SET cursor=excluded.cursor,pages_fetched=excluded.pages_fetched,rows_inserted=excluded.rows_inserted,last_pubDate=excluded.last_pubDate,exhausted=excluded.exhausted,updated_at=excluded.updated_at;`;
}

export function backfillPlanItemInsertSql(batchId, ordinal, article) {
  return `INSERT INTO archive_backfill_run_items (batch_id,ordinal,id,title,link,pubDate,description,category,source,imageUrl) VALUES (${[
    sqlLiteral(batchId),
    integerLiteral(ordinal),
    sqlLiteral(article.id),
    sqlLiteral(article.title),
    sqlLiteral(article.link),
    sqlLiteral(article.pubDate),
    sqlLiteral(article.description || ''),
    sqlLiteral(article.category),
    sqlLiteral(article.source),
    sqlLiteral(article.imageUrl || ''),
  ].join(',')});`;
}

export function backfillRunStateInsertSql(batchId, state) {
  return `INSERT INTO archive_backfill_run_state (batch_id,source_key,cursor,pages_fetched,rows_inserted,last_pubDate,exhausted) VALUES (${[
    sqlLiteral(batchId),
    sqlLiteral(state.sourceKey),
    sqlLiteral(state.cursor || ''),
    integerLiteral(Number(state.pagesFetched || 0)),
    integerLiteral(Number(state.rowsInserted || 0)),
    sqlLiteral(state.lastPubDate || ''),
    integerLiteral(Number(state.exhausted ? 1 : 0)),
  ].join(',')});`;
}

export function backfillRunFinalizeSql({ batchId, source, requestedRows, generatedRows, beforeRows, now = new Date().toISOString() }) {
  return `INSERT INTO archive_backfill_runs (batch_id,source,requested_rows,generated_rows,before_rows,status,created_at) VALUES (${[
    sqlLiteral(batchId),
    sqlLiteral(source),
    integerLiteral(requestedRows),
    integerLiteral(generatedRows),
    integerLiteral(beforeRows),
    sqlLiteral('planned'),
    sqlLiteral(now),
  ].join(',')});`;
}

export function backfillApplyArticlesSql(batchId, ordinalStart, ordinalEnd) {
  const start = integerLiteral(ordinalStart);
  const end = integerLiteral(ordinalEnd);
  return `INSERT OR IGNORE INTO articles (id,title,link,pubDate,description,category,source,imageUrl) SELECT id,title,link,pubDate,description,category,source,imageUrl FROM archive_backfill_run_items WHERE batch_id=${sqlLiteral(batchId)} AND ordinal BETWEEN ${start} AND ${end} ORDER BY ordinal;`;
}

export function backfillApplyStateAndMarkWrittenSql(batchId, now = new Date().toISOString()) {
  const id = sqlLiteral(batchId);
  return `INSERT INTO archive_backfill_state (source_key,cursor,pages_fetched,rows_inserted,last_pubDate,exhausted,updated_at) SELECT source_key,cursor,pages_fetched,rows_inserted,last_pubDate,exhausted,${sqlLiteral(now)} FROM archive_backfill_run_state WHERE batch_id=${id} ON CONFLICT(source_key) DO UPDATE SET cursor=excluded.cursor,pages_fetched=excluded.pages_fetched,rows_inserted=excluded.rows_inserted,last_pubDate=excluded.last_pubDate,exhausted=excluded.exhausted,updated_at=excluded.updated_at;\nUPDATE archive_backfill_runs SET status='written',written_at=${sqlLiteral(now)} WHERE batch_id=${id} AND status='planned';`;
}

export function backfillMarkCompletedSql(batchId, now = new Date().toISOString()) {
  return `UPDATE archive_backfill_runs SET status='completed',completed_at=${sqlLiteral(now)} WHERE batch_id=${sqlLiteral(batchId)} AND status='written';`;
}
