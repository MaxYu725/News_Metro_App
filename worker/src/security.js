export const APP_ORIGIN = 'https://maxyu725.github.io';

const ARTICLE_HOSTNAMES = new Set(['hk01.com', 'www.hk01.com', 'bastillepost.com', 'www.bastillepost.com']);

export function corsHeaders(request) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
    'X-Content-Type-Options': 'nosniff',
  };

  const origin = request.headers.get('Origin');
  if (origin === APP_ORIGIN) {
    headers['Access-Control-Allow-Origin'] = origin;
  }

  return headers;
}

export function isTrustedAppRequest(request) {
  return request.headers.get('Origin') === APP_ORIGIN;
}

export function parseAllowedArticleUrl(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.length === 0 || rawValue.length > 2048) {
    return null;
  }

  let parsed;
  try {
    parsed = new URL(rawValue);
  } catch {
    return null;
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    (parsed.port && parsed.port !== '443') ||
    !ARTICLE_HOSTNAMES.has(hostname)
  ) {
    return null;
  }

  return parsed;
}

export function rateLimitKey(request, scope) {
  const actor = request.headers.get('CF-Connecting-IP')?.trim() || 'unknown';
  return `${scope}:${actor}`;
}

export async function consumeRateLimit(binding, key) {
  if (!binding || typeof binding.limit !== 'function') {
    return false;
  }

  try {
    const result = await binding.limit({ key });
    return result?.success === true;
  } catch {
    return false;
  }
}
