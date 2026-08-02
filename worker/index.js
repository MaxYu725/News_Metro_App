// Cloudflare Worker: Metro News Live API Aggregator
// Endpoint: https://metro-news-api.maxyu0725.workers.dev/

const RSS_FEEDS = {
  latest: [
    { name: 'RTHK Express', url: 'https://news.rthk.hk/rthk/ch/rss/m_expressnews_clocal.xml' },
    { name: 'MingPao News', url: 'https://news.mingpao.com/rss/pns/s00001.xml' },
    { name: 'CRHK News', url: 'https://www.881903.com/rss/news' }
  ],
  local: [
    { name: 'RTHK Local', url: 'https://news.rthk.hk/rthk/ch/rss/m_expressnews_clocal.xml' },
    { name: 'HK Gov News', url: 'https://www.news.gov.hk/tc/common/html/ticker.rss.xml' }
  ],
  entertainment: [
    { name: 'RTHK Entertainment', url: 'https://news.rthk.hk/rthk/ch/rss/m_expressnews_clocal.xml' },
    { name: 'MingPao Ent', url: 'https://news.mingpao.com/rss/pns/s00014.xml' }
  ],
  tech: [
    { name: 'Unwire HK', url: 'https://unwire.hk/feed/' },
    { name: 'HKEPC', url: 'https://www.hkepc.com/rss' }
  ]
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Health check endpoint
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'metro-news-api', timestamp: new Date().toISOString() }), {
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
      });
    }

    const category = url.searchParams.get('category') || 'latest';
    const cacheKey = `news_cache_${category}`;

    // Try reading from KV Cache
    if (env.NEWS_CACHE_KV) {
      const cachedData = await env.NEWS_CACHE_KV.get(cacheKey);
      if (cachedData) {
        return new Response(cachedData, {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
        });
      }
    }

    const feeds = RSS_FEEDS[category] || RSS_FEEDS.latest;
    let articles = [];

    for (const feed of feeds) {
      try {
        const res = await fetch(feed.url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } });
        if (res.ok) {
          const xmlText = await res.text();
          const parsed = parseRssItems(xmlText, feed.name, category);
          articles = articles.concat(parsed);
        }
      } catch (e) {
        console.error(`Error fetching ${feed.name}:`, e);
      }
    }

    // Deduplicate and limit to 35 articles
    articles = deduplicateArticles(articles).slice(0, 35);

    const resultPayload = JSON.stringify({
      status: 'ok',
      category: category,
      updated_at: new Date().toISOString(),
      count: articles.length,
      articles: articles
    });

    // Write to KV Cache with TTL = 300s (5 minutes)
    if (env.NEWS_CACHE_KV) {
      ctx.waitUntil(env.NEWS_CACHE_KV.put(cacheKey, resultPayload, { expirationTtl: 300 }));
    }

    return new Response(resultPayload, {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=300'
      }
    });
  }
};

function parseRssItems(xml, sourceName, category) {
  const items = [];
  const itemMatches = xml.match(/<item>[\s\S]*?<\/item>/gi) || [];

  for (const itemXml of itemMatches) {
    const titleMatch = itemXml.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    const linkMatch = itemXml.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);
    const pubDateMatch = itemXml.match(/<pubDate>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/pubDate>/i);
    const descMatch = itemXml.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);

    if (titleMatch && linkMatch) {
      const title = cleanText(titleMatch[1]);
      const link = linkMatch[1].trim();
      const pubDate = pubDateMatch ? pubDateMatch[1].trim() : new Date().toISOString();
      const rawDesc = descMatch ? cleanText(descMatch[1]) : '';
      const summary = rawDesc.slice(0, 180) + (rawDesc.length > 180 ? '...' : '');

      if (title.length > 0) {
        items.push({
          id: 'art_' + Math.abs(hashCode(title + link)),
          title: title,
          summary: summary,
          source: sourceName,
          category: category,
          pubDate: pubDate,
          url: link
        });
      }
    }
  }
  return items;
}

function cleanText(text) {
  return text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}

function deduplicateArticles(articles) {
  const seen = new Set();
  return articles.filter(item => {
    if (seen.has(item.title)) return false;
    seen.add(item.title);
    return true;
  });
}

function hashCode(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}
