import worker from './index.js';
import {
  consumeRateLimit,
  corsHeaders,
  isTrustedAppRequest,
  rateLimitKey,
} from './security.js';

const PIXABAY_API_URL = 'https://pixabay.com/api/';
const PIXABAY_HOSTNAMES = new Set(['pixabay.com', 'www.pixabay.com']);
const PIXABAY_TIMEOUT_MS = 10_000;

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

    return worker.fetch(request, env, ctx);
  },
};
