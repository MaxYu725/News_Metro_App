export const BASTILLE_SOURCE_NAME = '巴士的報';
export const BASTILLE_FEED_URL = 'https://www.bastillepost.com/hongkong/feed';
export const BASTILLE_TIMEOUT_MS = 15_000;

const CATEGORY_GROUPS = [
  ['tech', new Set(['bastech'])],
  ['sports', new Set(['體育'])],
  ['ent', new Set(['娛圈事', '心韓', 'plastic', 'hottv'])],
  ['local', new Set(['港聞', '政事', '社會事', '法庭事', '國安專頁', '香港電台', '大埔火災', '黎智英案', '23條立法', '屠龍案', '本地炸彈案', '立會選情', '立會新丁'])],
  ['china', new Set(['兩岸', '大灣區', '澳門事'])],
  ['global', new Set(['大視野', '亞太', 'global'])],
  ['community', new Set(['bp大平台'])],
  ['life', new Set(['生活事', '@消費', '中醫事', '醫健事', '美善人生', '動物', '樂活道', '食玩買', '旅遊', '升學教育'])],
  ['hot', new Set(['熱門', '錢財事', '地產', '商業事', '理財', '海外地產', '博客榜', '歷史長河', '史空穿梭', '石榴台', 'channel', '巴士的報channel'])],
];

function decodeHtmlEntities(text) {
  if (!text) return '';
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function unwrapCdata(value) {
  return decodeHtmlEntities(String(value || '')
    .replace(/^\s*<!\[CDATA\[/, '')
    .replace(/\]\]>\s*$/, '')
    .trim());
}

function firstTagValue(itemContent, tagPattern) {
  const match = itemContent.match(new RegExp(`<${tagPattern}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagPattern}>`, 'i'));
  return match ? unwrapCdata(match[1]) : '';
}

export function extractBastilleCategories(itemContent) {
  const categories = [];
  const regex = /<category(?:\s[^>]*)?>([\s\S]*?)<\/category>/gi;
  let match;
  while ((match = regex.exec(itemContent)) !== null) {
    const value = unwrapCdata(match[1]);
    if (value && !categories.includes(value)) categories.push(value);
  }
  return categories;
}

export function resolveBastilleCategory(categoryNames = []) {
  const normalized = new Set(
    categoryNames
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean),
  );

  for (const [metroCategory, aliases] of CATEGORY_GROUPS) {
    for (const alias of aliases) {
      if (normalized.has(alias)) return metroCategory;
    }
  }
  return 'hot';
}

function extractImages(html) {
  const images = [];
  const tagRegex = /<img\b[^>]*>/gi;
  let tagMatch;
  while ((tagMatch = tagRegex.exec(html)) !== null) {
    const tag = tagMatch[0];
    const attrMatch = tag.match(/\bdata-lazy-src=["']([^"']+)["']/i)
      || tag.match(/\bdata-src=["']([^"']+)["']/i)
      || tag.match(/\bsrc=["']([^"']+)["']/i);
    if (!attrMatch) continue;
    const src = unwrapCdata(attrMatch[1]);
    if (
      !src
      || src.startsWith('data:image')
      || src.includes('1x1')
      || src.toLowerCase().includes('blank')
    ) continue;
    if (!images.includes(src)) images.push(src);
  }
  return images;
}

function htmlToText(html) {
  return decodeHtmlEntities(String(html || ''))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<\/(p|div|h[1-6]|blockquote|li)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>?/g, '')
    .replace(/[\t\r ]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

function isoDateOrNow(rawValue, now = () => new Date()) {
  const parsed = new Date(rawValue);
  return Number.isNaN(parsed.getTime()) ? now().toISOString() : parsed.toISOString();
}

export function parseBastilleRss(xmlString, options = {}) {
  const items = [];
  const itemRegex = /<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi;
  let match;

  while ((match = itemRegex.exec(xmlString)) !== null) {
    const itemContent = match[1];
    const title = firstTagValue(itemContent, 'title');
    const link = firstTagValue(itemContent, 'link');
    if (!title || !link) continue;

    const rawContent = firstTagValue(itemContent, 'content:encoded')
      || firstTagValue(itemContent, 'description');
    const images = extractImages(rawContent);
    const categories = extractBastilleCategories(itemContent);

    items.push({
      id: link,
      title,
      link,
      pubDate: isoDateOrNow(firstTagValue(itemContent, 'pubDate'), options.now),
      description: htmlToText(rawContent),
      category: resolveBastilleCategory(categories),
      source: BASTILLE_SOURCE_NAME,
      imageUrl: images[0] || '',
      images,
      sourceCategories: categories,
    });
  }

  return items;
}

export async function fetchBastilleArticles(fetchImpl = fetch) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BASTILLE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(BASTILLE_FEED_URL, {
      signal: controller.signal,
      redirect: 'error',
      headers: {
        'User-Agent': 'MetroNews/1.0',
        'Accept': 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
        'Accept-Language': 'zh-HK,zh-TW;q=0.9,en;q=0.6',
      },
    });
    if (!response.ok) return [];
    return parseBastilleRss(await response.text());
  } catch {
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

export function isBastilleSource(source) {
  return source === BASTILLE_SOURCE_NAME;
}
