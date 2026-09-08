import worker from './index.js';
import {
  consumeRateLimit,
  corsHeaders,
  isTrustedAppRequest,
  rateLimitKey,
} from './security.js';
import { decodeSearchCursor, encodeSearchCursor } from './search.js';
import { isBastilleSource } from './sources/bastille.js';
import { parseSourceFilter, sourceNamesForIds, sourceFilterSql } from './source-filter.js';

const PIXABAY_API_URL = 'https://pixabay.com/api/';
const PIXABAY_HOSTNAMES = new Set(['pixabay.com', 'www.pixabay.com']);
const PIXABAY_TIMEOUT_MS = 10_000;
const FEED_LIMIT = 20;
const FEED_CATEGORIES = new Set([
  'latest',
  'local',
  'global',
  'ent',
  'sports',
  'china',
  'hot',
  'life',
  'community',
  'tech',
  'video',
]);

function jsonResponse(request, payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

async function guardImageRequest(request, env) {
  if (!isTrustedAppRequest(request)) {
    return jsonResponse(request, { success: false, error: '禁止的請求來源' }, 403);
  }

  const allowed = await consumeRateLimit(
    env.FETCH_RATE_LIMITER,
    rateLimitKey(request, 'images'),
  );
  if (!allowed) {
    return jsonResponse(
      request,
      { success: false, error: '請求過於頻密，請稍後再試' },
      429,
      { 'Retry-After': '60' },
    );
  }

  return null;
}

function safePixabayFinalUrl(response, fallbackUrl) {
  try {
    const finalUrl = new URL(response.url || fallbackUrl);
    return finalUrl.protocol === 'https:' && PIXABAY_HOSTNAMES.has(finalUrl.hostname)
      ? finalUrl
      : null;
  } catch {
    return null;
  }
}

async function fetchPixabayImages(request, env, url) {
  if (request.method !== 'GET') {
    return jsonResponse(request, { success: false, error: '不支援的請求方法' }, 405, { Allow: 'GET' });
  }

  const guard = await guardImageRequest(request, env);
  if (guard) return guard;

  const query = (url.searchParams.get('q') || 'cyberpunk').trim();
  const page = Number.parseInt(url.searchParams.get('page') || '1', 10);
  if (!query || query.length > 100 || !Number.isInteger(page) || page < 1 || page > 50) {
    return jsonResponse(request, { success: false, error: '圖庫搜尋參數無效' }, 400);
  }

  const pixabayKey = env.API_KEY;
  if (!pixabayKey) {
    return jsonResponse(request, { success: false, error: '圖庫服務尚未設定' }, 503);
  }

  const pxUrl = `${PIXABAY_API_URL}?key=${encodeURIComponent(pixabayKey)}&q=${encodeURIComponent(query)}&image_type=photo&orientation=all&page=${page}&per_page=20&safesearch=true`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PIXABAY_TIMEOUT_MS);

  try {
    // This is a fixed trusted upstream. Cloudflare Worker subrequests can throw
    // on otherwise valid redirects when redirect:'error' is used (the same
    // runtime behaviour already affected the Bastille provider). Follow the
    // redirect, then verify the final host before trusting the payload.
    const pxRes = await fetch(pxUrl, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'MetroNews/1.0',
        'Accept': 'application/json',
        'Accept-Language': 'zh-HK,zh-TW;q=0.9,en;q=0.6',
      },
    });

    if (!safePixabayFinalUrl(pxRes, pxUrl)) {
      console.warn('pixabay-final-host-rejected', { status: pxRes.status });
      return jsonResponse(request, { success: false, error: '圖庫 API 暫時無法回應' }, 502);
    }

    if (!pxRes.ok) {
      console.warn('pixabay-upstream-error', {
        status: pxRes.status,
        contentType: pxRes.headers.get('Content-Type') || '',
      });
      return jsonResponse(request, { success: false, error: '圖庫 API 暫時無法回應' }, 502);
    }

    const contentType = (pxRes.headers.get('Content-Type') || '').toLowerCase();
    if (contentType && !contentType.includes('json')) {
      console.warn('pixabay-non-json-success', { status: pxRes.status, contentType });
      return jsonResponse(request, { success: false, error: '圖庫 API 暫時無法回應' }, 502);
    }

    let pxData;
    try {
      pxData = await pxRes.json();
    } catch (error) {
      console.warn('pixabay-json-parse-failed', { message: String(error?.message || error) });
      return jsonResponse(request, { success: false, error: '圖庫 API 暫時無法回應' }, 502);
    }

    const hits = Array.isArray(pxData?.hits) ? pxData.hits : [];
    const formatted = hits
      .filter(hit => hit && hit.id != null && (hit.largeImageURL || hit.webformatURL))
      .map(hit => ({
        id: String(hit.id),
        imageUrl: hit.largeImageURL || hit.webformatURL,
        thumbUrl: hit.webformatURL || hit.largeImageURL,
        tags: String(hit.tags || ''),
        source: 'Pixabay',
      }));

    return jsonResponse(request, {
      success: true,
      data: formatted,
      hasMore: Number(pxData?.totalHits || 0) > page * 20,
    });
  } catch (error) {
    console.warn('pixabay-fetch-failed', {
      name: String(error?.name || ''),
      message: String(error?.message || error),
    });
    return jsonResponse(request, { success: false, error: '圖庫 API 發生錯誤' }, 500);
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseStoredArticleMedia(rawValue) {
  let images = [];
  let media = [];
  try {
    const stored = rawValue ? JSON.parse(rawValue) : [];
    const entries = Array.isArray(stored) ? stored : (Array.isArray(stored?.items) ? stored.items : []);
    for (const entry of entries) {
      const mediaUrl = typeof entry === 'string' ? entry : (entry?.url || entry?.src || '');
      if (!mediaUrl || images.includes(mediaUrl)) continue;
      images.push(mediaUrl);
      media.push({
        url: mediaUrl,
        caption: typeof entry === 'string' ? '' : String(entry?.caption || entry?.alt || '').trim(),
      });
    }
  } catch {
    images = [];
    media = [];
  }
  return { images, media };
}

function formatFeedRow(row) {
  const { images, media } = parseStoredArticleMedia(row.images);
  return {
    ...row,
    images,
    media,
    isFullContentLoaded: isBastilleSource(row.source),
  };
}

async function fetchCursorFeed(request, env, ctx, url) {
  if (request.method !== 'GET') return worker.fetch(request, env, ctx);

  const category = url.pathname.split('/').pop();
  if (!FEED_CATEGORIES.has(category)) return worker.fetch(request, env, ctx);

  const page = Number.parseInt(url.searchParams.get('page') || '0', 10);
  if (!Number.isInteger(page) || page < 0 || page > 500) {
    return jsonResponse(request, { success: false, error: '新聞頁碼無效' }, 400);
  }

  const rawCursor = url.searchParams.get('cursor') || '';

  // Keep backward compatibility for an older cached frontend that requests
  // page > 0 without a cursor. v72 clients always use cursor/keyset paging.
  if (page > 0 && !rawCursor) {
    return worker.fetch(request, env, ctx);
  }

  let cursor;
  try {
    cursor = decodeSearchCursor(rawCursor);
  } catch {
    return jsonResponse(request, { success: false, error: '新聞游標無效' }, 400);
  }

  const sourceIds = parseSourceFilter(url.searchParams.get('sources'));
  if (!sourceIds) return jsonResponse(request, { success: false, error: '新聞來源參數無效' }, 400);
  const sourceNames = sourceNamesForIds(sourceIds);
  const sourceFilter = sourceFilterSql('source', sourceNames);

  // Preserve the legacy sync/empty-database behaviour before taking the first
  // deterministic keyset snapshot. The legacy response itself is discarded.
  if (page === 0 && !cursor) {
    const legacyResponse = await worker.fetch(request, env, ctx);
    if (!legacyResponse.ok) return legacyResponse;
  }

  const fetchLimit = FEED_LIMIT + 1;
  const cursorDate = cursor?.pubDate || null;
  const cursorId = cursor?.id || null;
  let query;
  let params;

  if (category === 'latest') {
    query = `SELECT * FROM articles
      WHERE 1 = 1${sourceFilter.sql}
        AND (? IS NULL OR pubDate < ? OR (pubDate = ? AND id < ?))
      ORDER BY pubDate DESC, id DESC
      LIMIT ?`;
    params = [
      ...sourceFilter.params,
      cursorDate,
      cursorDate,
      cursorDate,
      cursorId,
      fetchLimit,
    ];
  } else {
    query = `SELECT * FROM articles
      WHERE category = ?${sourceFilter.sql}
        AND (? IS NULL OR pubDate < ? OR (pubDate = ? AND id < ?))
      ORDER BY pubDate DESC, id DESC
      LIMIT ?`;
    params = [
      category,
      ...sourceFilter.params,
      cursorDate,
      cursorDate,
      cursorDate,
      cursorId,
      fetchLimit,
    ];
  }

  try {
    const { results } = await env.DB.prepare(query).bind(...params).all();
    const rows = (Array.isArray(results) ? results : []).slice(0, FEED_LIMIT);
    const hasMore = Array.isArray(results) && results.length > FEED_LIMIT;
    const nextCursor = hasMore && rows.length > 0 ? encodeSearchCursor(rows.at(-1)) : '';

    return jsonResponse(request, {
      success: true,
      count: rows.length,
      page,
      hasMore,
      nextCursor,
      pagination: 'cursor',
      timestamp: new Date().toISOString(),
      data: rows.map(formatFeedRow),
    });
  } catch (error) {
    console.warn('feed-cursor-query-failed', { category, message: String(error?.message || error) });
    return jsonResponse(request, { success: false, error: '存取資料庫時發生錯誤' }, 500);
  }
}

export default {
  async scheduled(event, env, ctx) {
    return worker.scheduled(event, env, ctx);
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/images') {
      if (request.method === 'OPTIONS') {
        if (!isTrustedAppRequest(request)) {
          return new Response('Forbidden', { status: 403, headers: corsHeaders(request) });
        }
        return new Response(null, { status: 204, headers: corsHeaders(request) });
      }
      return fetchPixabayImages(request, env, url);
    }

    if (url.pathname.startsWith('/api/news/')) {
      return fetchCursorFeed(request, env, ctx, url);
    }

    return worker.fetch(request, env, ctx);
  },
};
