const SEARCH_ORIGIN = 'https://universal-search.hk01.com';
const ARTICLE_HOSTS = new Set(['hk01.com', 'www.hk01.com']);
const IMAGE_HOSTS = new Set(['cdn.hk01.com']);

export const HK01_SEARCH_EARLIEST_EPOCH = Math.floor(Date.UTC(2016, 0, 1) / 1000);
export const HK01_SEARCH_PAGE_SIZE = 100;
export const HK01_SEARCH_SAFE_WINDOW_HITS = 1000;

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

function extractEnv(bundle, name) {
  const patterns = [
    new RegExp(`${name}:["']([^"']+)`),
    new RegExp(`${name}\\?"?:\\?["']([^"']+)`),
  ];
  for (const pattern of patterns) {
    const match = String(bundle || '').match(pattern);
    if (match) return match[1];
  }
  return '';
}

export function parseHk01SearchConfigFromBundle(bundle) {
  const appId = extractEnv(bundle, 'REACT_APP_ALGOLIA_APP_ID');
  const apiKey = extractEnv(bundle, 'REACT_APP_ALGOLIA_API_KEY');
  const index = extractEnv(bundle, 'REACT_APP_HK01_ARTICLE_INDEX_NAME');

  if (!/^[A-Za-z0-9_-]{4,80}$/.test(appId)) throw new Error('HK01 search app id not discovered');
  if (!/^[A-Za-z0-9_-]{8,200}$/.test(apiKey)) throw new Error('HK01 search API key not discovered');
  if (!/^[A-Za-z0-9._-]{2,120}$/.test(index)) throw new Error('HK01 search index not discovered');

  return { appId, apiKey, index };
}

async function fetchText(url, fetchImpl, limit = 6_000_000) {
  const { signal, clear } = timeoutSignal(25_000);
  try {
    const response = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Metro-News-Archive/1.0)',
        Accept: '*/*',
        'Accept-Language': 'zh-HK,zh-TW;q=0.9,en;q=0.6',
      },
    });
    if (!response.ok) throw new Error(`HK01 search bootstrap HTTP ${response.status}`);
    const finalUrl = new URL(response.url || url);
    if (finalUrl.protocol !== 'https:' || finalUrl.hostname !== 'universal-search.hk01.com') {
      throw new Error('HK01 search bootstrap escaped publisher host');
    }
    const text = await response.text();
    return text.slice(0, limit);
  } finally {
    clear();
  }
}

export async function discoverHk01SearchConfig(fetchImpl = fetch) {
  const home = await fetchText(`${SEARCH_ORIGIN}/`, fetchImpl, 1_500_000);
  const scripts = [];
  const regex = /<script[^>]+src=["']([^"']+)/gi;
  let match;
  while ((match = regex.exec(home)) !== null) {
    const url = new URL(match[1], `${SEARCH_ORIGIN}/`);
    if (url.protocol !== 'https:' || url.hostname !== 'universal-search.hk01.com') continue;
    if (!url.pathname.startsWith('/static/js/')) continue;
    if (!scripts.includes(url.href)) scripts.push(url.href);
  }
  if (scripts.length === 0) throw new Error('HK01 search bootstrap scripts not discovered');

  let bundle = '';
  for (const script of scripts.slice(0, 20)) {
    bundle += `\n${await fetchText(script, fetchImpl)}`;
    if (
      bundle.includes('REACT_APP_ALGOLIA_APP_ID')
      && bundle.includes('REACT_APP_ALGOLIA_API_KEY')
      && bundle.includes('REACT_APP_HK01_ARTICLE_INDEX_NAME')
    ) {
      try {
        return parseHk01SearchConfigFromBundle(bundle);
      } catch {
        // Another chunk can still contain the concrete values.
      }
    }
  }
  return parseHk01SearchConfigFromBundle(bundle);
}

export function hk01ArticleNumericId(value) {
  try {
    const url = new URL(String(value || ''));
    if (!ARTICLE_HOSTS.has(url.hostname)) return '';
    const parts = url.pathname.split('/').filter(Boolean);
    for (const part of parts) {
      if (/^\d{1,12}$/.test(part)) return part;
    }
    return '';
  } catch {
    return '';
  }
}

export function mapHk01SearchCategory(mainCategory) {
  const value = String(mainCategory || '').trim().toLowerCase();
  if (!value) return 'local';

  const includesAny = words => words.some(word => value.includes(word));
  if (includesAny(['體育', '足球', '籃球', '運動'])) return 'sports';
  if (includesAny(['娛樂', '眾樂迷', '電影', '電視', '音樂', '星'])) return 'ent';
  if (includesAny(['國際', '世界', '環球'])) return 'global';
  if (includesAny(['中國', '兩岸', '大國小事', '台灣', '澳門'])) return 'china';
  if (includesAny(['科技', '數碼', '電玩', '遊戲', '手機', 'ai', '人工智能'])) return 'tech';
  if (includesAny(['生活', '健康', '親子', '寵物', '旅遊', '食玩買', '教煮', '女生', '職場'])) return 'life';
  if (includesAny(['社區', '01論壇', '01觀點', '社論', '深度', '專題'])) return 'community';
  if (includesAny(['熱話', '開罐', '熱爆'])) return 'hot';
  return 'local';
}

export function parseHk01SearchHit(hit, startEpoch = 0, endEpoch = Number.MAX_SAFE_INTEGER) {
  if (!hit || hit.type !== 'article') return null;
  const link = safeHttpsUrl(hit.url, ARTICLE_HOSTS);
  const title = String(hit.title || '').trim();
  const published = Number(hit.published_at_ts);
  const pubDate = safeIsoFromEpochSeconds(published);
  if (!link || !title || !pubDate) return null;
  if (published < startEpoch || published >= endEpoch) return null;

  return {
    id: link,
    title,
    link,
    pubDate,
    description: String(hit.lead || '').trim(),
    category: mapHk01SearchCategory(hit.main_category),
    source: '香港01',
    imageUrl: safeHttpsUrl(hit.main_image, IMAGE_HOSTS),
  };
}

function searchEndpoint(config) {
  const appId = String(config?.appId || '');
  const index = String(config?.index || '');
  if (!/^[A-Za-z0-9_-]{4,80}$/.test(appId)) throw new Error('invalid HK01 search app id');
  if (!/^[A-Za-z0-9._-]{2,120}$/.test(index)) throw new Error('invalid HK01 search index');
  return `https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/${encodeURIComponent(index)}/query`;
}

function rangeFilter(startEpoch, endEpoch) {
  const start = Number(startEpoch);
  const end = Number(endEpoch);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start) {
    throw new Error('invalid HK01 search time range');
  }
  return `published_at_ts >= ${start} AND published_at_ts < ${end} AND type:article`;
}

async function queryHk01Search(config, startEpoch, endEpoch, page, fetchImpl) {
  const params = new URLSearchParams({
    query: '',
    hitsPerPage: String(HK01_SEARCH_PAGE_SIZE),
    page: String(page),
    distinct: '0',
    typoTolerance: 'false',
    filters: rangeFilter(startEpoch, endEpoch),
  });
  const body = JSON.stringify({ params: params.toString() });
  const { signal, clear } = timeoutSignal(25_000);
  try {
    const response = await fetchImpl(searchEndpoint(config), {
      method: 'POST',
      signal,
      redirect: 'error',
      headers: {
        'X-Algolia-Application-Id': config.appId,
        'X-Algolia-API-Key': config.apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Metro-News-Archive/1.0)',
        Origin: SEARCH_ORIGIN,
        Referer: `${SEARCH_ORIGIN}/`,
      },
      body,
    });
    if (!response.ok) throw new Error(`HK01 search query HTTP ${response.status}`);
    return await response.json();
  } finally {
    clear();
  }
}

function isExhaustive(body) {
  return body?.exhaustiveNbHits === true || body?.exhaustive?.nbHits === true;
}

async function fetchWindowRecursive({ startEpoch, endEpoch, config, fetchImpl, depth }) {
  const first = await queryHk01Search(config, startEpoch, endEpoch, 0, fetchImpl);
  let requests = 1;
  const nbHits = Number(first?.nbHits || 0);
  const nbPages = Number(first?.nbPages || 0);
  const unsafe = !isExhaustive(first)
    || nbHits > HK01_SEARCH_SAFE_WINDOW_HITS
    || nbPages > Math.ceil(HK01_SEARCH_SAFE_WINDOW_HITS / HK01_SEARCH_PAGE_SIZE);

  if (unsafe) {
    if (endEpoch - startEpoch <= 60 || depth >= 24) {
      throw new Error(`HK01 search window cannot be safely paged: ${startEpoch}..${endEpoch}, hits=${nbHits}`);
    }
    const mid = startEpoch + Math.floor((endEpoch - startEpoch) / 2);
    const newer = await fetchWindowRecursive({ startEpoch: mid, endEpoch, config, fetchImpl, depth: depth + 1 });
    const older = await fetchWindowRecursive({ startEpoch, endEpoch: mid, config, fetchImpl, depth: depth + 1 });
    return {
      hits: [...newer.hits, ...older.hits],
      requests: requests + newer.requests + older.requests,
    };
  }

  const hits = Array.isArray(first?.hits) ? [...first.hits] : [];
  for (let page = 1; page < nbPages; page += 1) {
    const body = await queryHk01Search(config, startEpoch, endEpoch, page, fetchImpl);
    requests += 1;
    if (!isExhaustive(body)) throw new Error('HK01 search page became non-exhaustive');
    if (Array.isArray(body?.hits)) hits.push(...body.hits);
  }
  return { hits, requests };
}

export async function fetchHk01SearchWindow({
  startEpoch,
  endEpoch,
  config,
  fetchImpl = fetch,
}) {
  const start = Number(startEpoch);
  const end = Number(endEpoch);
  rangeFilter(start, end);

  const result = await fetchWindowRecursive({
    startEpoch: start,
    endEpoch: end,
    config,
    fetchImpl,
    depth: 0,
  });

  const byId = new Map();
  for (const hit of result.hits) {
    const article = parseHk01SearchHit(hit, start, end);
    if (!article) continue;
    const articleId = hk01ArticleNumericId(article.link) || article.id;
    if (!byId.has(articleId)) byId.set(articleId, article);
  }

  const articles = [...byId.values()].sort((a, b) => {
    const date = String(b.pubDate).localeCompare(String(a.pubDate));
    return date || String(b.id).localeCompare(String(a.id));
  });
  return { articles, requests: result.requests };
}
