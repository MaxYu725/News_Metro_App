import { mapHk01SearchCategory } from './hk01-search.js';

export const HK01_LATEST_FEED_URL = 'https://web-data.api.hk01.com/v2/feed/latest?offset=0&limit=50';
export const HK01_LATEST_FALLBACK_FEED_URL = 'https://web-data.api.hk01.com/v2/feed/category/0?bucketId=00000';

const API_HOST = 'web-data.api.hk01.com';
const ARTICLE_HOSTS = new Set(['hk01.com', 'www.hk01.com']);
const IMAGE_HOSTS = new Set(['cdn.hk01.com']);

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
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

function safeIsoFromEpochSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  const date = new Date(seconds * 1000);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function stableArticleId(item, data, link) {
  const raw = data?.articleId ?? item?.id;
  const articleId = String(raw ?? '').trim();
  if (/^\d{1,12}$/.test(articleId)) {
    return `https://hk01.com/sns/article/${articleId}`;
  }
  return link;
}

export function parseHk01LatestFeed(payload) {
  const articles = [];
  const items = Array.isArray(payload?.items) ? payload.items : [];

  for (const item of items) {
    const data = item?.data;
    if (!data || typeof data !== 'object') continue;
    if (data.type && data.type !== 'article') continue;
    if (data.isSponsored === true) continue;

    const link = safeHttpsUrl(data.canonicalUrl || data.publishUrl, ARTICLE_HOSTS);
    const title = String(data.title || '').trim();
    const pubDate = safeIsoFromEpochSeconds(data.publishTime);
    if (!link || !title || !pubDate) continue;

    articles.push({
      id: stableArticleId(item, data, link),
      title,
      link,
      pubDate,
      description: String(data.description || '').trim(),
      category: mapHk01SearchCategory(data.mainCategory || data.zone?.name || ''),
      source: '香港01',
      imageUrl: safeHttpsUrl(
        data.mainImage?.cdnUrl || data.originalImage?.cdnUrl || '',
        IMAGE_HOSTS,
      ),
    });
  }

  return articles;
}

async function fetchFeed(url, fetchImpl) {
  const { signal, clear } = timeoutSignal(12_000);
  try {
    const response = await fetchImpl(url, {
      signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json,text/plain,*/*',
        'Accept-Language': 'zh-HK,zh-TW;q=0.9,en;q=0.6',
      },
    });

    if (!response.ok) throw new Error(`HK01 latest HTTP ${response.status}`);

    const finalUrl = new URL(response.url || url);
    if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== API_HOST) {
      throw new Error('HK01 latest redirect escaped publisher API host');
    }

    const articles = parseHk01LatestFeed(await response.json());
    if (articles.length === 0) throw new Error('HK01 latest returned no article items');
    return articles;
  } finally {
    clear();
  }
}

export async function fetchHk01LatestFeed(fetchImpl = fetch) {
  const urls = [HK01_LATEST_FEED_URL, HK01_LATEST_FALLBACK_FEED_URL];
  let lastError;

  for (const url of urls) {
    try {
      return await fetchFeed(url, fetchImpl);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('HK01 latest feed unavailable');
}
