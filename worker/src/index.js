import {
  consumeRateLimit,
  corsHeaders,
  isTrustedAppRequest,
  parseAllowedArticleUrl,
  rateLimitKey,
} from './security.js';

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

function decodeHTMLEntities(text) {
  if (!text) return '';
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function parseRSS(xmlString, sourceName, categoryName) {
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
    const decodedContent = decodeHTMLEntities(rawDescription);

    const imgRegex = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi;
    let imgMatch;
    const rawImages = [];
    while ((imgMatch = imgRegex.exec(decodedContent)) !== null) {
      const image = imgMatch[1];
      if (!image.startsWith('data:image') && !image.includes('blank') && !image.includes('1x1')) rawImages.push(image);
    }

    const enclosureMatch = itemContent.match(/<enclosure[^>]+url=["']([^"']+)["']/i);
    const mediaMatch = itemContent.match(/<media:content[^>]+url=["']([^"']+)["']/i);
    const mediaThumbMatch = itemContent.match(/<media:thumbnail[^>]+url=["']([^"']+)["']/i);
    const imageTagMatch = itemContent.match(/<image>\s*<url>([^<]+)<\/url>\s*<\/image>/i);

    let imageUrl = '';
    if (enclosureMatch) imageUrl = enclosureMatch[1];
    else if (mediaMatch) imageUrl = mediaMatch[1];
    else if (mediaThumbMatch) imageUrl = mediaThumbMatch[1];
    else if (imageTagMatch) imageUrl = imageTagMatch[1];

    const images = [];
    if (imageUrl && !imageUrl.startsWith('data:image') && !imageUrl.includes('1x1')) images.push(imageUrl);
    for (const image of rawImages) {
      if (!images.includes(image)) images.push(image);
    }
    if (!imageUrl && images.length > 0) imageUrl = images[0];

    const cleanText = decodedContent
      .replace(/<\/(p|div|h[1-6]|blockquote)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>?/gm, '')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    if (title && link) {
      items.push({ id: link, title, link, pubDate, description: cleanText, category: categoryName, source: sourceName, imageUrl: imageUrl || '', images });
    }
  }
  return items;
}

async function fetchFromSource(sourceConfig, categoryName) {
  for (const sourceUrl of sourceConfig.urls) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(sourceUrl, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
      clearTimeout(timeoutId);
      if (response.ok) {
        const xmlData = await response.text();
        const parsed = parseRSS(xmlData, sourceConfig.name, categoryName);
        if (parsed.length > 0) return parsed;
      }
    } catch {}
  }

  console.warn('rss-source-empty', { category: categoryName, source: sourceConfig.name });
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
  video: [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/13`) }],
};

async function syncCategoryToDB(category, env) {
  const targetSources = topicSources[category];
  if (!targetSources) return;

  const resultsArray = await Promise.all(targetSources.map(sourceConfig => fetchFromSource(sourceConfig, category)));
  const combinedNews = resultsArray.flat();
  if (combinedNews.length === 0) return;

  const statements = combinedNews.map(item =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO articles (id, title, link, pubDate, description, category, source, imageUrl, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      item.id,
      item.title,
      item.link,
      item.pubDate,
      item.description,
      item.category,
      item.source,
      item.imageUrl || '',
      JSON.stringify(item.images || []),
    ),
  );

  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    await env.DB.batch(statements.slice(i, i + chunkSize));
  }
}

async function cleanUpOldArticles(env) {
  try {
    await env.DB.prepare(`DELETE FROM articles WHERE datetime(pubDate) < datetime('now', '-30 days')`).run();
  } catch {}
}

export default {
  async scheduled(event, env, ctx) {
    const catKeys = Object.keys(topicSources);
    ctx.waitUntil(Promise.all([
      ...catKeys.map(cat => syncCategoryToDB(cat, env)),
      cleanUpOldArticles(env),
    ]));
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
        return jsonResponse(request, { success: false, error: '只允許 HTTPS 香港01文章 URL' }, 400);
      }

      try {
        let fullText = '';
        const hk01Match = targetUrl.pathname.match(/(?:^|\/)(\d+)(?:\/|$)/);

        if (hk01Match) {
          const articleId = hk01Match[1];
          try {
            const apiRes = await fetch(`https://web-data.api.hk01.com/v2/page/article/${articleId}`, {
              headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
              redirect: 'error',
            });
            if (apiRes.ok) {
              const apiData = await apiRes.json();
              const blocks = apiData?.data?.blocks || apiData?.data?.articleData?.blocks || [];
              if (blocks.length > 0) {
                const textList = [];
                for (const block of blocks) {
                  if (['html', 'p', 'text', 'paragraph', 'heading'].includes(block.type)) {
                    const htmlContent = block.html || block.content || block.text || '';
                    const clean = decodeHTMLEntities(htmlContent)
                      .replace(/<\/(p|div|h[1-6]|blockquote)>/gi, '\n\n')
                      .replace(/<br\s*\/?>/gi, '\n')
                      .replace(/<[^>]*>?/gm, '')
                      .trim();
                    if (clean) textList.push(clean);
                  }
                }
                fullText = textList.join('\n\n');
              }
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
              const html = await pageRes.text();
              const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
              let pMatch;
              const pList = [];
              while ((pMatch = pRegex.exec(html)) !== null) {
                const text = decodeHTMLEntities(pMatch[1]).replace(/<[^>]*>?/gm, '').trim();
                if (text.length > 10 && !text.includes('版權所有') && !text.includes('hk01.com')) {
                  pList.push(text);
                }
              }
              fullText = pList.join('\n\n');
            }
          }
        }

        return jsonResponse(request, { success: true, content: fullText || '' });
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

    if (url.pathname === '/api/search') {
      if (request.method !== 'GET') return methodNotAllowed(request, ['GET']);

      const query = (url.searchParams.get('q') || '').trim();
      const page = Number.parseInt(url.searchParams.get('page') || '0', 10);
      const limit = 20;

      if (query.length > 100 || !Number.isInteger(page) || page < 0 || page > 500) {
        return jsonResponse(request, { success: false, error: '搜尋參數無效' }, 400);
      }

      if (!query) {
        return jsonResponse(request, { success: true, count: 0, page, hasMore: false, data: [] });
      }

      const offset = page * limit;
      try {
        const { results } = await env.DB
          .prepare(`SELECT * FROM articles WHERE title LIKE ? OR description LIKE ? ORDER BY pubDate DESC LIMIT ? OFFSET ?`)
          .bind(`%${query}%`, `%${query}%`, limit, offset)
          .all();
        const formattedResults = results.map(row => ({ ...row, images: row.images ? JSON.parse(row.images) : [] }));
        return jsonResponse(request, {
          success: true,
          count: formattedResults.length,
          page,
          hasMore: formattedResults.length === limit,
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
            const { results: checkDB } = await env.DB.prepare(`SELECT count(*) as count FROM articles`).all();
            if (forceSync || checkDB[0].count === 0) {
              if (forceSync) ctx.waitUntil(cleanUpOldArticles(env));
              await Promise.all(Object.keys(topicSources).map(cat => syncCategoryToDB(cat, env)));
            }
          }
          query = `SELECT * FROM articles ORDER BY pubDate DESC LIMIT ? OFFSET ?`;
          params = [limit, offset];
        } else {
          if (forceSync || page === 0) {
            const { results: checkDB } = await env.DB.prepare(`SELECT count(*) as count FROM articles WHERE category = ?`).bind(category).all();
            if (forceSync || checkDB[0].count === 0) {
              if (forceSync) ctx.waitUntil(cleanUpOldArticles(env));
              await syncCategoryToDB(category, env);
            }
          }
          query = `SELECT * FROM articles WHERE category = ? ORDER BY pubDate DESC LIMIT ? OFFSET ?`;
          params = [category, limit, offset];
        }

        const { results } = await env.DB.prepare(query).bind(...params).all();
        const formattedResults = results.map(row => ({ ...row, images: row.images ? JSON.parse(row.images) : [] }));

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
