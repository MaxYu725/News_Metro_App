const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'X-Custom-Header, Upgrade-Insecure-Requests',
};

function decodeHTMLEntities(text) {
  return text.replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&amp;/g, '&')
             .replace(/&quot;/g, '"')
             .replace(/&#39;/g, "'")
             .replace(/&apos;/g, "'")
             .replace(/&nbsp;/g, ' ');
}

function parseRSS(xmlString, sourceName) {
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

    const descMatch = itemContent.match(/<content:encoded><!\[CDATA\[([\s\S]*?)\]\]><\/content:encoded>/i)
                   || itemContent.match(/<content:encoded>([\s\S]*?)<\/content:encoded>/i)
                   || itemContent.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i)
                   || itemContent.match(/<description>([\s\S]*?)<\/description>/i);
    
    let rawDescription = descMatch ? descMatch[1].trim() : '';
    let decodedContent = decodeHTMLEntities(rawDescription);

    const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
    let imgMatch;
    const rawImages = [];
    while ((imgMatch = imgRegex.exec(decodedContent)) !== null) {
      rawImages.push(imgMatch[1]);
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
    if (imageUrl) images.push(imageUrl);
    
    for (const img of rawImages) {
        if (!images.includes(img)) {
            images.push(img);
        }
    }
    
    if (!imageUrl && images.length > 0) {
        imageUrl = images[0];
    }

    let cleanText = decodedContent
        .replace(/<\/(p|div|h[1-6]|blockquote)>/gi, '\n\n')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]*>?/gm, '')
        .replace(/\n\s*\n/g, '\n\n')
        .trim();

    const categoryMatch = itemContent.match(/<category><!\[CDATA\[([\s\S]*?)\]\]><\/category>/) || itemContent.match(/<category>([\s\S]*?)<\/category>/);
    const category = categoryMatch ? categoryMatch[1].trim() : '';

    if (title && link) {
      items.push({
        title,
        link,
        pubDate,
        description: cleanText,
        category,
        source: sourceName,
        imageUrl: imageUrl || '',
        images: images
      });
    }
  }
  return items;
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);

    if (url.pathname === '/') {
      return new Response('Metro News Proxy API is running (Now News Edition)!', { headers: corsHeaders });
    }

    if (url.pathname.startsWith('/api/news/')) {
      const category = url.pathname.split('/').pop();
      
      const sources = {
        'local': { urls: ['https://rthk.hk/rthk/news/rss/c_expressnews_clocal.xml'], name: 'RTHK 本地' },
        'finance': { urls: ['https://rthk.hk/rthk/news/rss/c_expressnews_cfinance.xml'], name: 'RTHK 財經' },
        'global': { urls: ['https://rthk.hk/rthk/news/rss/c_expressnews_greaterchina.xml'], name: 'RTHK 國際' },
        'tech': { urls: ['https://www.solidot.org/index.rss'], name: 'Solidot 科技' },
        'ent': { urls: ['https://news.mingpao.com/rss/pns/s00016.xml'], name: '明報 娛樂' },
        'hk01': { 
          urls: [
            'https://rss.shab.fun/hk01/channel/2',
            'https://rsshub.liubing.me/hk01/channel/2',
            'https://rsshub.mxd.me/hk01/channel/2',
            'https://rsshub.rssforever.com/hk01/channel/2',
            'https://rsshub.app/hk01/channel/2'
          ], 
          name: '香港01 港聞' 
        },
        'oncc': {
          urls: [
            'https://rss.shab.fun/oncc/zh-hk/news',
            'https://rsshub.liubing.me/oncc/zh-hk/news',
            'https://rsshub.mxd.me/oncc/zh-hk/news',
            'https://rsshub.rssforever.com/oncc/zh-hk/news',
            'https://rsshub.app/oncc/zh-hk/news'
          ],
          name: '東網 港聞'
        },
        'now': {
          // 加入 Now 新聞官方高速 API
          urls: ['https://news.now.com/api/getNewsListAsRSS?category=119'],
          name: 'Now 新聞'
        }
      };

      const target = sources[category];
      if (!target) return new Response(JSON.stringify({ error: '不支援的新聞分類' }), { status: 400, headers: { 'Content-Type': 'application/json', ...corsHeaders } });

      try {
        let xmlData = null;
        for (const targetUrl of target.urls) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 6000);
            const response = await fetch(targetUrl, { signal: controller.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
            clearTimeout(timeoutId);
            if (response.ok) {
                xmlData = await response.text();
                break;
            }
          } catch (e) { }
        }

        if (!xmlData) throw new Error('所有備援節點皆無回應或遭阻擋');
        
        const cleanJson = parseRSS(xmlData, target.name);
        return new Response(JSON.stringify({ success: true, count: cleanJson.length, timestamp: new Date().toISOString(), data: cleanJson }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      } catch (error) {
        return new Response(JSON.stringify({ success: false, error: '解析新聞來源時發生錯誤' }), { status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }
    }
    return new Response('Not Found', { status: 404, headers: corsHeaders });
  }
};
