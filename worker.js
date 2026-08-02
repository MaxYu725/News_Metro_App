/**
 * Metro News Live - Cloudflare Worker Backend Relay
 * Configured for KV Binding: NEWS_CACHE_KV (Namespace ID: 0faa3dc0b32a435fb91672dd0f2cfe25)
 */
export default {
    async fetch(request, env, ctx) {
        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Content-Type': 'application/json;charset=UTF-8'
        };

        if (request.method === 'OPTIONS') {
            return new Response(null, { headers: corsHeaders });
        }

        const cacheKey = 'metro_news_feed_json';
        try {
            // Check KV Cache first
            if (env.NEWS_CACHE_KV) {
                const cached = await env.NEWS_CACHE_KV.get(cacheKey);
                if (cached) {
                    return new Response(cached, { headers: corsHeaders });
                }
            }

            // Standard public RSS sources
            const feeds = {
                latest: 'https://rthk.hk/rthk/news/rss/c_expressnews_clocal.xml',
                local: 'https://www.news.gov.hk/tc/common/html/topstories.rss.xml',
                entertainment: 'https://rthk.hk/rthk/news/rss/c_expressnews_center.xml',
                tech: 'https://hk.news.yahoo.com/rss/tech'
            };

            const categories = {};
            for (const [cat, url] of Object.entries(feeds)) {
                try {
                    const rssRes = await fetch(url, { headers: { 'User-Agent': 'MetroNewsApp/1.0' } });
                    const xmlText = await rssRes.text();
                    categories[cat] = parseXmlToJson(xmlText, cat);
                } catch (e) {
                    categories[cat] = [];
                }
            }

            const outputJson = JSON.stringify({
                timestamp: Date.now(),
                categories: categories
            });

            // Store in KV with 5-minute TTL
            if (env.NEWS_CACHE_KV) {
                await env.NEWS_CACHE_KV.put(cacheKey, outputJson, { expirationTtl: 300 });
            }

            return new Response(outputJson, { headers: corsHeaders });
        } catch (error) {
            return new Response(JSON.stringify({ error: error.message }), {
                status: 500,
                headers: corsHeaders
            });
        }
    }
};

function parseXmlToJson(xmlStr, prefix) {
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;
    let count = 0;
    while ((match = itemRegex.exec(xmlStr)) !== null && count < 8) {
        const itemXml = match[1];
        const title = extractTag(itemXml, 'title') || 'Untitled Headline';
        const pubDate = extractTag(itemXml, 'pubDate') || new Date().toUTCString();
        const description = stripHtmlTags(extractTag(itemXml, 'description') || extractTag(itemXml, 'content:encoded') || 'No description provided.');
        const hashId = `${prefix}-${Math.abs(hashCode(title))}`;

        items.push({
            id: hashId,
            title: decodeXmlEntities(title),
            source: prefix.toUpperCase(),
            time: formatShortTime(pubDate),
            content: decodeXmlEntities(description)
        });
        count++;
    }
    return items;
}

function extractTag(xml, tag) {
    const reg = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = xml.match(reg);
    if (!m) return '';
    return m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1').trim();
}

function stripHtmlTags(str) {
    return str.replace(/<[^>]*>?/gm, '').trim();
}

function decodeXmlEntities(str) {
    return str.replace(/&amp;/g, '&')
              .replace(/&lt;/g, '<')
              .replace(/&gt;/g, '>')
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'");
}

function hashCode(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash) + str.charCodeAt(i);
        hash |= 0;
    }
    return hash;
}

function formatShortTime(dateStr) {
    try {
        const d = new Date(dateStr);
        const diffMins = Math.floor((Date.now() - d.getTime()) / 60000);
        if (diffMins < 60) return `${Math.max(1, diffMins)}m ago`;
        if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
        return `${d.getMonth() + 1}/${d.getDate()}`;
    } catch (e) {
        return 'recent';
    }
}
