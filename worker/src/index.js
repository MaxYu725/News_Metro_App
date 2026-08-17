const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Custom-Header, Upgrade-Insecure-Requests',
};

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
    
    let rawDescription = descMatch ? descMatch[1].trim() : '';
    let decodedContent = decodeHTMLEntities(rawDescription);

    const imgRegex = /<img[^>]+(?:data-src|src)=["']([^"']+)["']/gi;
    let imgMatch;
    const rawImages = [];
    while ((imgMatch = imgRegex.exec(decodedContent)) !== null) {
        const url = imgMatch[1];
        if (!url.startsWith('data:image') && !url.includes('blank') && !url.includes('1x1')) rawImages.push(url);
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
    for (const img of rawImages) { if (!images.includes(img)) images.push(img); }
    if (!imageUrl && images.length > 0) imageUrl = images[0];

    let cleanText = decodedContent
      .replace(/<\/(p|div|h[1-6]|blockquote)>/gi, '\n\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]*>?/gm, '')
      .replace(/\n\s*\n/g, '\n\n')
      .trim();

    if (title && link) {
      items.push({ id: link, title, link, pubDate, description: cleanText, category: categoryName, source: sourceName, imageUrl: imageUrl || '', images: images });
    }
  }
  return items;
}

async function fetchFromSource(sourceConfig, categoryName) {
    for (const url of sourceConfig.urls) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000);
            const response = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
            clearTimeout(timeoutId);
            if (response.ok) {
                const xmlData = await response.text();
                const parsed = parseRSS(xmlData, sourceConfig.name, categoryName);
                if (parsed.length > 0) return parsed;
            }
        } catch (e) {}
    }
    return [];
}

const rssHubs = [
    'https://rsshub.rssforever.com',
    'https://rsshub.liubing.me',
    'https://rsshub.pseudoyu.com',
    'https://rsshub.mxd.me',
    'https://rss.shab.fun',
    'https://rsshub.app'
];

const topicSources = {
  'local': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/1`) }],
  'ent': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/2`) }],
  'sports': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/3`) }],
  'global': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/4`) }],
  'china': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/5`) }],
  'hot': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/7`) }],
  'life': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/8`) }],
  'community': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/10`) }],
  'tech': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/11`) }],
  'video': [{ name: '香港01', urls: rssHubs.map(base => `${base}/hk01/zone/13`) }]
};

async function syncCategoryToDB(category, env) {
    const targetSources = topicSources[category];
    if (!targetSources) return;
    const fetchPromises = targetSources.map(sourceConfig => fetchFromSource(sourceConfig, category));
    const resultsArray = await Promise.all(fetchPromises);
    const combinedNews = resultsArray.flat();
    if (combinedNews.length === 0) return;

    const statements = [];
    for (const item of combinedNews) {
        statements.push(
            env.DB.prepare(`INSERT OR IGNORE INTO articles (id, title, link, pubDate, description, category, source, imageUrl, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
                item.id, item.title, item.link, item.pubDate, item.description, item.category, item.source, item.imageUrl || '', JSON.stringify(item.images || [])
            )
        );
    }
    const chunkSize = 50;
    for (let i = 0; i < statements.length; i += chunkSize) {
        const chunk = statements.slice(i, i + chunkSize);
        await env.DB.batch(chunk);
    }
}

async function cleanUpOldArticles(env) {
    try { 
        await env.DB.prepare(`DELETE FROM articles WHERE datetime(pubDate) < datetime('now', '-30 days')`).run(); 
    } catch (error) {}
}

export default {
  async scheduled(event, env, ctx) {
      const catKeys = Object.keys(topicSources);
      ctx.waitUntil(Promise.all([
          ...catKeys.map(cat => syncCategoryToDB(cat, env)),
          cleanUpOldArticles(env) 
      ]));
  },

  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
    const url = new URL(request.url);

    if (url.pathname === '/') return new Response('Metro News D1 Database API is running!', { headers: corsHeaders });

    if (url.pathname === '/api/article-full') {
        const targetUrl = url.searchParams.get('url');
        if (!targetUrl) return new Response(JSON.stringify({ success: false, error: '缺少文章 URL' }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

        try {
            let fullText = '';
            const hk01Match = targetUrl.match(/(?:article\/|\/)(\d+)(?:\/|\?|$)/);

            if (targetUrl.includes('hk01.com') && hk01Match) {
                const articleId = hk01Match[1];
                try {
                    const apiRes = await fetch(`https://web-data.api.hk01.com/v2/page/article/${articleId}`, {
                        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
                    });
                    if (apiRes.ok) {
                        const apiData = await apiRes.json();
                        const blocks = apiData?.data?.blocks || apiData?.data?.articleData?.blocks || [];
                        if (blocks.length > 0) {
                            const textList = [];
                            for (const b of blocks) {
                                if (b.type === 'html' || b.type === 'p' || b.type === 'text' || b.type === 'paragraph' || b.type === 'heading') {
                                    const htmlContent = b.html || b.content || b.text || '';
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
                } catch (e) {}
            }

            if (!fullText) {
                const res = await fetch(targetUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
                if (res.ok) {
                    const html = await res.text();
                    const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
                    let pMatch;
                    let pList = [];
                    while ((pMatch = pRegex.exec(html)) !== null) {
                        let text = decodeHTMLEntities(pMatch[1]).replace(/<[^>]*>?/gm, '').trim();
                        if (text.length > 10 && !text.includes('版權所有') && !text.includes('hk01.com')) {
                            pList.push(text);
                        }
                    }
                    fullText = pList.join('\n\n');
                }
            }

            return new Response(JSON.stringify({
                success: true,
                content: fullText || ''
            }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

        } catch (error) {
            return new Response(JSON.stringify({ success: false, error: '擷取全文失敗' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
    }

    if (url.pathname === '/api/summarize' && request.method === 'POST') {
        try {
            const { text } = await request.json();
            if (!text) return new Response(JSON.stringify({ success: false, error: '缺少新聞內文' }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            const truncatedText = text.substring(0, 1500);

            const aiResponse = await env.AI.run('@cf/qwen/qwen3-30b-a3b-fp8', {
                messages: [
                    { role: "system", content: "你是一個專業的新聞編輯。請將提供的新聞內文，用香港繁體中文總結核心摘要，直接輸出摘要內容，禁止包含任何導言（如「以下是摘要：」）、結尾或無關的客套話，因應內文長短輸出適當文字數量，必要時可以列點。" },
                    { role: "user", content: truncatedText }
                ]
            });

            return new Response(JSON.stringify({ success: true, summary: aiResponse.response }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } catch (error) {
            return new Response(JSON.stringify({ success: false, error: error.message }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
    }

    if (url.pathname.startsWith('/api/images')) {
        const q = url.searchParams.get('q') || 'cyberpunk';
        const page = parseInt(url.searchParams.get('page')) || 1; 
        try {
            const pixabayKey = env.API_KEY;
            if (!pixabayKey) {
                return new Response(JSON.stringify({ success: false, error: '尚未在 Workers Secrets 設定 API_KEY' }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
            }
            const pxUrl = `https://pixabay.com/api/?key=${pixabayKey}&q=${encodeURIComponent(q)}&image_type=photo&orientation=all&page=${page}&per_page=20&safesearch=true`;
            const pxRes = await fetch(pxUrl);
            const pxData = await pxRes.json();
            
            const formatted = (pxData.hits || []).map(hit => ({
                id: hit.id.toString(), imageUrl: hit.largeImageURL, thumbUrl: hit.webformatURL, tags: hit.tags, source: 'Pixabay'
            }));
            return new Response(JSON.stringify({ success: true, data: formatted, hasMore: (pxData.totalHits || 0) > page * 20 }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } catch (error) {
            return new Response(JSON.stringify({ success: false, error: '圖庫 API 發生錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
    }

    if (url.pathname.startsWith('/api/search')) {
        const q = url.searchParams.get('q') || '';
        const page = parseInt(url.searchParams.get('page')) || 0;
        const limit = 20;
        const offset = page * limit;
        if (!q) return new Response(JSON.stringify({ success: true, count: 0, page, hasMore: false, data: [] }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

        try {
            const { results } = await env.DB.prepare(`SELECT * FROM articles WHERE title LIKE ? OR description LIKE ? ORDER BY pubDate DESC LIMIT ? OFFSET ?`).bind(`%${q}%`, `%${q}%`, limit, offset).all();
            const formattedResults = results.map(row => ({ ...row, images: row.images ? JSON.parse(row.images) : [] }));
            return new Response(JSON.stringify({ success: true, count: formattedResults.length, page: page, hasMore: formattedResults.length === limit, timestamp: new Date().toISOString(), data: formattedResults }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } catch (error) {
            return new Response(JSON.stringify({ success: false, error: '搜尋資料庫時發生錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
    }

    if (url.pathname.startsWith('/api/news/')) {
      const category = url.pathname.split('/').pop();
      const page = parseInt(url.searchParams.get('page')) || 0;
      const forceSync = url.searchParams.get('sync') === '1';
      const limit = 20;
      const offset = page * limit;

      if (category !== 'latest' && !topicSources[category]) {
        return new Response(JSON.stringify({ error: '不支援的新聞分類' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      try {
        let query, params;
        
        // 支援「即時」分類：查詢全站所有新聞
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

        return new Response(JSON.stringify({ success: true, count: formattedResults.length, page: page, hasMore: formattedResults.length === limit, timestamp: new Date().toISOString(), data: formattedResults }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: '存取資料庫時發生錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }
    
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};