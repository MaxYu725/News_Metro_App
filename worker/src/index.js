import {
  consumeRateLimit,
  corsHeaders,
  isTrustedAppRequest,
  parseAllowedArticleUrl,
  rateLimitKey,
} from './security.js';
import { archiveDatabases, sourceCountsAcrossDatabases } from './archive-shards.js';
import {
  decodeSearchCursor,
  isArchiveEligibleQuery,
  searchArticles,
  searchArticlesAcrossDatabases,
} from './search.js';
import { enforceAdaptiveRetention } from './retention.js';
import {
  articleTextFromHtml,
  decodeArticleHtmlEntities,
  extractArticleMedia,
  prependArticleMedia,
  stripArticleMediaHtml,
} from './article-content.js';
import { fetchBastilleArticles, isBastilleSource } from './sources/bastille.js';
import { parseHk01ArticlePayload } from './sources/hk01-article.js';
import { NEWS_SOURCES, parseSourceFilter, sourceNamesForIds, sourceFilterSql } from './source-filter.js';

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

function textResponse(request, body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      ...corsHeaders(request),
      ...extraHeaders,
    },
  });
}

function methodNotAllowed(request, methods) {
  return jsonResponse(
    request,
    { success: false, error: '不支援的請求方法' },
    405,
    { Allow: methods.join(', ') },
  );
}

async function guardTrustedCostRequest(request, limiter, scope) {
  if (!isTrustedAppRequest(request)) {
    return jsonResponse(request, { success: false, error: '禁止的請求來源' }, 403);
  }

  const allowed = await consumeRateLimit(limiter, rateLimitKey(request, scope));
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

export function parseRSS(xmlString, sourceName, categoryName) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemRegex.exec(xmlString)) !== null) {
    const itemContent = match[1];
    const titleMatch = itemContent.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || itemContent.match(/<title>([\s\S]*?)<\/title>/);
    const title = titleMatch ? titleMatch[1].trim() : '';
    const linkMatch = itemContent.match(/<link>([\s\S]*?)<\/link>/);
    const link = linkMatch ? linkMatch[1].trim() : '';
    const pubDateMatch = itemContent.match(/<pubDate>([\s\S]*?)<\/pubDate>/);
    const pubDate = pubDateMatch ? new Date(pubDateMatch[1].trim()).toISOString() : new Date().toISOString();
    const descMatch = itemContent.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i) || itemContent.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i) || itemContent.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i) || itemContent.match(/<description>([\s\S]*?)<\/description>/i);

    const rawDescription = descMatch ? descMatch[1].trim() : '';
    const decodedContent = decodeArticleHtmlEntities(rawDescription);

    const enclosureMatch = itemContent.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
    const mediaMatch = itemContent.match(/<media:content[^>]+url=["']([^"']+)["']/i);
    const mediaThumbMatch = itemContent.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    const imageTagMatch = itemContent.match(/<image>\s*<url>([^<]+)<\/url>\s*<\/image>/i);

    let imageUrl = '';
    if (enclosureMatch) imageUrl = enclosureMatch[1];
    else if (mediaMatch) imageUrl = mediaMatch[1];
    else if (mediaThumbMatch) imageUrl = mediaThumbMatch[1];
    else if (imageTagMatch) imageUrl = imageTagMatch[1];

    const media = prependArticleMedia(extractArticleMedia(decodedContent), imageUrl);
    const images = media.map(item => item.url);
    if (!imageUrl && images.length > 0) imageUrl = images[0];
    const cleanText = articleTextFromHtml(decodedContent);

    if (title && link) {
      items.push({ id: link, title, link, pubDate, description: cleanText, category: categoryName, source: sourceName, imageUrl: imageUrl || '', images, media });
    }
  }
  return items;
}

async function fetchFromSource(sourceConfig, categoryName) {
  for (const sourceUrl of sourceConfig.urls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), sourceConfig.timeoutMs || 8000);
      const response = await fetch(sourceUrl, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(timeoutId);
      if (response.ok) {
        const xmlData = await response.text();
        const parsed = parseRSS(xmlData, sourceConfig.name, categoryName);
        if (parsed.length > 0) return parsed;
      }
    } catch {}
  }

  console.warn('rss-source-empty', { category: categoryName, source: sourceConfig.name, timeoutMs: sourceConfig.timeoutMs || 8000, urlCount: sourceConfig.urls.length });
  return [];
}

const rssHubs = [
  'https://rsshub.rssforever.com',
  'https://rsshub.liubing.me',
  'https://rsshub.pseudoyu.com',
  'https://rsshub.mxd.me',
  'https://rss.shab.fun',
  'https://rsshub.app',
];

const topicSources = {
  local: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/1`) }],
  ent: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/2`) }],
  sports: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/3`) }],
  global: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/4`) }],
  china: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/5`) }],
  hot: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/7`) }],
  life: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/8`) }],
  community: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/10`) }],
  tech: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/11`) }],
  video: [259, 256].map(channelId => ({
    name: '香港01',
    urls: [`https://rsshub.rssforever.com/hk01/channel/${channelId}`],
    timeoutMs: 20000,
  })),
};

async function insertArticles(items, env) {
  if (!Array.isArray(items) || items.length === 0) return;

  const statements = items.map(item =>
    env.DB.prepare(
      `INSERT INTO articles (id, title, link, pubDate, description, category, source, imageUrl, images)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          title = excluded.title,
          description = excluded.description,
          imageUrl = excluded.imageUrl,
          images = excluded.images
        WHERE articles.title IS NOT excluded.title
          OR articles.description IS NOT excluded.description
          OR articles.imageUrl IS NOT excluded.imageUrl
          OR articles.images IS NOT excluded.images`,
    ).bind(
      item.id,
      item.title,
      item.link,
      item.pubDate,
      item.description,
      item.category,
      item.source,
      item.imageUrl || '',
      JSON.stringify(
        Array.isArray(item.media) && item.media.some(media => media?.caption)
          ? { version: 2, items: item.media }
          : (item.images || []),
      ),
    ),
  );

  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    await env.DB.batch(statements.slice(i, i + chunkSize));
  }
}

async function syncCategoryToDB(category, env) {
  const targetSources = topicSources[category];
  if (!targetSources) return;

  const resultsArray = await Promise.all(targetSources.map(sourceConfig => fetchFromSource(sourceConfig, category)));
  await insertArticles(resultsArray.flat(), env);
}

async function syncBastilleToDB(env, requestedCategory = null) {
  if (requestedCategory === 'video') return;

  const articles = await fetchBastilleArticles();
  const eligible = requestedCategory
    ? articles.filter(item => item.category === requestedCategory)
    : articles;

  if (eligible.length === 0) {
    console.warn('rss-source-empty', {
      category: requestedCategory || 'mixed',
      source: '巴士的報',
      timeoutMs: 15000,
      urlCount: 1,
    });
    return;
  }

  await insertArticles(eligible, env);
}

async function syncAllCategoriesAndRetention(env) {
  await Promise.all([
    Promise.all(Object.keys(topicSources).map(cat => syncCategoryToDB(cat, env))),
    syncBastilleToDB(env),
  ]);
  await enforceAdaptiveRetention(env.DB);
}

function parseStoredArticleMedia(rawValue) {
  let images = [];
  let media = [];
  try {
    const stored = rawValue ? JSON.parse(rawValue) : [];
    const entries = Array.isArray(stored) ? stored : (Array.isArray(stored?.items) ? stored.items : []);
    for (const entry of entries) {
      const url = typeof entry === 'string' ? entry : (entry?.url || entry?.src || '');
      if (!url || images.includes(url)) continue;
      images.push(url);
      media.push({
        url,
        caption: typeof entry === 'string' ? '' : String(entry?.caption || entry?.alt || '').trim(),
      });
    }
  } catch {
    images = [];
    media = [];
  }
  return { images, media };
}

function formatArticleRow(row) {
  const { images, media } = parseStoredArticleMedia(row.images);
  return {
    ...row,
    images,
    media,
    isFullContentLoaded: isBastilleSource(row.source),
  };
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(syncAllCategoriesAndRetention(env));
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      if (!isTrustedAppRequest(request)) {
        return textResponse(request, 'Forbidden', 403);
      }
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    if (url.pathname === '/') {
      if (request.method !== 'GET') return methodNotAllowed(request, ['GET']);
      return textResponse(request, 'Metro News D1 Database API is running!');
    }

    if (url.pathname === '/api/article-full') {
      if (request.method !== 'GET') return methodNotAllowed(request, ['GET']);

      const guard = await guardTrustedCostRequest(request, env.FETCH_RATE_LIMITER, 'article-full');
      if (guard) return guard;

      const targetUrl = parseAllowedArticleUrl(url.searchParams.get('url'));
      if (!targetUrl) {
        return jsonResponse(request, { success: false, error: '只允許已支援新聞來源的 HTTPS 文章 URL' }, 400);
      }

      try {
        let fullText = '';
        let fullMedia = [];
        const isHk01Article = targetUrl.hostname === 'hk01.com' || targetUrl.hostname === 'www.hk01.com';
        const hk01Match = isHk01Article ? targetUrl.pathname.match(/(?:^|\/)(\d+)(?:\/|$)/) : null;

        if (hk01Match) {
          const articleId = hk01Match[1];
          try {
            const apiRes = await fetch(`https://web-data.api.hk01.com/v2/page/article/${articleId}`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
                'Accept': 'application/json',
                'Accept-Language': 'zh-HK,zh-TW;q=0.9,en;q=0.6',
              },
              redirect: 'follow',
            });
            if (apiRes.ok) {
              const finalUrl = new URL(apiRes.url || `https://web-data.api.hk01.com/v2/page/article/${articleId}`);
              if (finalUrl.protocol === 'https:' && finalUrl.hostname === 'web-data.api.hk01.com') {
                const apiData = await apiRes.json();
                const parsed = parseHk01ArticlePayload(apiData);
                fullText = parsed.content;
                fullMedia = parsed.media;
              }
            }
          } catch {}
        }

        if (!fullText && env.DB) {
          try {
            const exactUrl = targetUrl.toString();
            const canonicalUrl = hk01Match ? `https://hk01.com/sns/article/${hk01Match[1]}` : exactUrl;
            const { results } = await env.DB.prepare(
              `SELECT description, images FROM articles
                WHERE id IN (?, ?) OR link IN (?, ?)
                LIMIT 1`,
            ).bind(exactUrl, canonicalUrl, exactUrl, canonicalUrl).all();
            const storedArticle = results?.[0];
            if (storedArticle?.description) {
              fullText = String(storedArticle.description).trim();
              fullMedia = parseStoredArticleMedia(storedArticle.images).media;
            }
          } catch {}
        }

        if (!fullText) {
          const pageRes = await fetch(targetUrl.toString(), {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
            redirect: 'manual',
          });

          if (pageRes.ok) {
            const contentType = pageRes.headers.get('Content-Type') || '';
            if (contentType.toLowerCase().includes('text/html')) {
              const html = stripArticleMediaHtml(await pageRes.text());
              const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
              let pMatch;
              const pList = [];
              while ((pMatch = pRegex.exec(html)) !== null) {
                const text = articleTextFromHtml(pMatch[1]);
                if (text.length > 10 && !text.includes('版權所有') && !text.includes('hk01.com')) {
                  if (pList.at(-1) !== text) pList.push(text);
                }
              }
              fullText = pList.join('\n\n');
            }
          }
        }

        return jsonResponse(request, { success: true, content: fullText || '', media: fullMedia });
      } catch {
        return jsonResponse(request, { success: false, error: '擷取全文失敗' }, 500);
      }
    }

    if (url.pathname === '/api/summarize') {
      if (request.method !== 'POST') return methodNotAllowed(request, ['POST']);

      const guard = await guardTrustedCostRequest(request, env.AI_RATE_LIMITER, 'summarize');
      if (guard) return guard;

      const contentType = request.headers.get('Content-Type') || '';
      if (!contentType.toLowerCase().startsWith('application/json')) {
        return jsonResponse(request, { success: false, error: '只接受 JSON 請求' }, 415);
      }

      const contentLength = Number(request.headers.get('Content-Length') || 0);
      if (Number.isFinite(contentLength) && contentLength > 20000) {
        return jsonResponse(request, { success: false, error: '新聞內文過長' }, 413);
      }

      try {
        const body = await request.json();
        const text = typeof body?.text === 'string' ? body.text.trim() : '';
        if (!text) {
          return jsonResponse(request, { success: false, error: '缺少新聞內文' }, 400);
        }

        const truncatedText = text.substring(0, 1500);
        const aiResponse = await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
          messages: [
            { role: 'system', content: '你是一個專業的新聞編輯。請將提供的新聞內文，用香港繁體中文總結核心摘要，直接輸出摘要內容，禁止包含任何導言（如「以下是摘要：」）、結尾或無關的客套話，因應內文長短輸出適當文字數量，必要時可以列點。' },
            { role: 'user', content: truncatedText },
          ],
        });

        return jsonResponse(request, { success: true, summary: aiResponse.response });
      } catch {
        return jsonResponse(request, { success: false, error: 'AI 摘要服務暫時無法回應' }, 500);
      }
    }

    if (url.pathname === '/api/images') {
      if (request.method !== 'GET') return methodNotAllowed(request, ['GET']);

      const guard = await guardTrustedCostRequest(request, env.FETCH_RATE_LIMITER, 'images');
      if (guard) return guard;

      const query = (url.searchParams.get('q') || 'cyberpunk').trim();
      const page = Number.parseInt(url.searchParams.get('page') || '1', 10);
      if (!query || query.length > 100 || !Number.isInteger(page) || page < 1 || page > 50) {
        return jsonResponse(request, { success: false, error: '圖庫搜尋參數無效' }, 400);
      }

      try {
        const pixabayKey = env.API_KEY;
        if (!pixabayKey) {
          return jsonResponse(request, { success: false, error: '圖庫服務尚未設定' }, 503);
        }

        const pxUrl = `https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(query)}&image_type=photo&orientation=all&page=${page}&per_page=20&safesearch=true`;
        const pxRes = await fetch(pxUrl, { redirect: 'error' });
        if (!pxRes.ok) {
          return jsonResponse(request, { success: false, error: '圖庫 API 暫時無法回應' }, 502);
        }

        const pxData = await pxRes.json();
        const formatted = (pxData.hits || []).map(hit => ({
          id: hit.id.toString(),
          imageUrl: hit.largeImageURL,
          thumbUrl: hit.webformatURL,
          tags: hit.tags,
          source: 'Pixabay',
        }));

        return jsonResponse(request, {
          success: true,
          data: formatted,
          hasMore: (pxData.totalHits || 0) > page * 20,
        });
      } catch {
        return jsonResponse(request, { success: false, error: '圖庫 API 發生錯誤' }, 500);
      }
    }

    if (url.pathname === '/api/source-stats') {
      if (request.method !== 'GET') return methodNotAllowed(request, ['GET']);
      try {
        const archives = archiveDatabases(env);
        const databases = archives.length > 0 ? archives : [env.DB].filter(Boolean);
        const bySource = await sourceCountsAcrossDatabases(databases);
        return jsonResponse(request, {
          success: true,
          data: NEWS_SOURCES.map(source => ({
            id: source.id,
            name: source.name,
            count: bySource.get(source.name) || 0,
          })),
        });
      } catch {
        return jsonResponse(request, { success: false, error: '讀取新聞來源統計失敗' }, 500);
      }
    }

    if (url.pathname === '/api/search') {
    if (request.method !== 'GET') return methodNotAllowed(request, ['GET']);

    const query = (url.searchParams.get('q') || '').trim();
    const scope = (url.searchParams.get('scope') || 'live').trim();
    const sourceIds = parseSourceFilter(url.searchParams.get('sources'));
    if (!sourceIds) return jsonResponse(request, { success: false, error: '新聞來源參數無效' }, 400);
    const sourceNames = sourceNamesForIds(sourceIds);
    const limit = 20;

    if (query.length > 100 || !['live', 'all'].includes(scope)) {
      return jsonResponse(request, { success: false, error: '搜尋參數無效' }, 400);
    }

    if (scope === 'all') {
      if (!query) {
        return jsonResponse(request, { success: true, count: 0, scope, hasMore: false, nextCursor: '', data: [] });
      }
      if (!isArchiveEligibleQuery(query)) {
        return jsonResponse(request, { success: false, error: '歷史搜尋至少需要 3 個字元' }, 400);
      }

      let cursor;
      try {
        cursor = decodeSearchCursor(url.searchParams.get('cursor') || '');
      } catch {
        return jsonResponse(request, { success: false, error: '搜尋游標無效' }, 400);
      }

      try {
        const archives = archiveDatabases(env);
        const { rows, hasMore, nextCursor } = await searchArticlesAcrossDatabases(
          [env.DB, ...archives],
          query,
          cursor,
          limit,
          sourceNames,
        );
        const formattedResults = rows.map(formatArticleRow);
        return jsonResponse(request, {
          success: true,
          count: formattedResults.length,
          scope,
          hasMore,
          nextCursor,
          timestamp: new Date().toISOString(),
          data: formattedResults,
        });
      } catch {
        return jsonResponse(request, { success: false, error: '搜尋歷史資料時發生錯誤' }, 500);
      }
    }

    const page = Number.parseInt(url.searchParams.get('page') || '0', 10);
    if (!Number.isInteger(page) || page < 0 || page > 500) {
      return jsonResponse(request, { success: false, error: '搜尋參數無效' }, 400);
    }

    if (!query) {
      return jsonResponse(request, { success: true, count: 0, page, hasMore: false, data: [] });
    }

    try {
      const { rows, hasMore } = await searchArticles(env.DB, query, page, limit, sourceNames);
      const formattedResults = rows.map(formatArticleRow);
      return jsonResponse(request, {
        success: true,
        count: formattedResults.length,
        page,
        hasMore,
        timestamp: new Date().toISOString(),
        data: formattedResults,
      });
    } catch {
      return jsonResponse(request, { success: false, error: '搜尋資料庫時發生錯誤' }, 500);
    }
  }

    if (url.pathname.startsWith('/api/news/')) {
      if (request.method !== 'GET') return methodNotAllowed(request, ['GET']);

      const category = url.pathname.split('/').pop();
      const page = Number.parseInt(url.searchParams.get('page') || '0', 10);
      const forceSync = url.searchParams.get('sync') === '1';
      const sourceIds = parseSourceFilter(url.searchParams.get('sources'));
      if (!sourceIds) return jsonResponse(request, { success: false, error: '新聞來源參數無效' }, 400);
      const sourceNames = sourceNamesForIds(sourceIds);
      const sourceFilter = sourceFilterSql('source', sourceNames);
      const limit = 20;

      if (!Number.isInteger(page) || page < 0 || page > 500) {
        return jsonResponse(request, { success: false, error: '新聞頁碼無效' }, 400);
      }

      if (category !== 'latest' && !topicSources[category]) {
        return jsonResponse(request, { error: '不支援的新聞分類' }, 400);
      }

      if (forceSync) {
        const guard = await guardTrustedCostRequest(request, env.SYNC_RATE_LIMITER, 'sync');
        if (guard) return guard;
      }

      const offset = page * limit;

      try {
        let query;
        let params;

        if (category === 'latest') {
          if (forceSync || page === 0) {
            const { results: checkDB } = await env.DB.prepare(`SELECT count(*) as count FROM articles WHERE 1 = 1${sourceFilter.sql}`).bind(...sourceFilter.params).all();
            if (forceSync || checkDB[0].count === 0) {
              await syncAllCategoriesAndRetention(env);
            }
          }
          query = `SELECT * FROM articles WHERE 1 = 1${sourceFilter.sql} ORDER BY pubDate DESC LIMIT ? OFFSET ?`;
          params = [...sourceFilter.params, limit, offset];
        } else {
          if (forceSync || page === 0) {
            const { results: checkDB } = await env.DB.prepare(`SELECT count(*) as count FROM articles WHERE category = ?${sourceFilter.sql}`).bind(category, ...sourceFilter.params).all();
            if (forceSync || checkDB[0].count === 0) {
              await Promise.all([
                syncCategoryToDB(category, env),
                syncBastilleToDB(env, category),
              ]);
              if (forceSync) await enforceAdaptiveRetention(env.DB);
            }
          }
          query = `SELECT * FROM articles WHERE category = ?${sourceFilter.sql} ORDER BY pubDate DESC LIMIT ? OFFSET ?`;
          params = [category, ...sourceFilter.params, limit, offset];
        }

        const { results } = await env.DB.prepare(query).bind(...params).all();
        const formattedResults = results.map(formatArticleRow);

        return jsonResponse(request, {
          success: true,
          count: formattedResults.length,
          page,
          hasMore: formattedResults.length === limit,
          timestamp: new Date().toISOString(),
          data: formattedResults,
        });
      } catch {
        return jsonResponse(request, { success: false, error: '存取資料庫時發生錯誤' }, 500);
      }
    }

    return textResponse(request, 'Not Found', 404);
  },
};
