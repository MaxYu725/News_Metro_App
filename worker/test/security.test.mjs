import test from 'node:test';
import assert from 'node:assert/strict';

import {
  APP_ORIGIN,
  consumeRateLimit,
  corsHeaders,
  isTrustedAppRequest,
  parseAllowedArticleUrl,
  rateLimitKey,
} from '../src/security.js';

test('article URL allowlist accepts only HTTPS HK01 hosts', () => {
  assert.equal(parseAllowedArticleUrl('https://www.hk01.com/article/123')?.hostname, 'www.hk01.com');
  assert.equal(parseAllowedArticleUrl('https://hk01.com/123')?.hostname, 'hk01.com');

  for (const value of [
    'https://example.com/',
    'https://example.com/?next=https://www.hk01.com/123',
    'https://hk01.com.evil.example/123',
    'http://www.hk01.com/123',
    'https://user@www.hk01.com/123',
    'javascript:alert(1)',
    '',
  ]) {
    assert.equal(parseAllowedArticleUrl(value), null, value);
  }
});

test('CORS only reflects the production Pages origin', () => {
  const trusted = new Request('https://worker.example/api/news/latest', {
    headers: { Origin: APP_ORIGIN },
  });
  const hostile = new Request('https://worker.example/api/news/latest', {
    headers: { Origin: 'https://audit.invalid' },
  });

  assert.equal(isTrustedAppRequest(trusted), true);
  assert.equal(isTrustedAppRequest(hostile), false);
  assert.equal(corsHeaders(trusted)['Access-Control-Allow-Origin'], APP_ORIGIN);
  assert.equal(corsHeaders(hostile)['Access-Control-Allow-Origin'], undefined);
  assert.notEqual(corsHeaders(trusted)['Access-Control-Allow-Origin'], '*');
});

test('rate limiting fails closed when the binding is unavailable or rejects', async () => {
  assert.equal(await consumeRateLimit(undefined, 'x'), false);
  assert.equal(await consumeRateLimit({ limit: async () => ({ success: false }) }, 'x'), false);
  assert.equal(await consumeRateLimit({ limit: async () => ({ success: true }) }, 'x'), true);
});

test('rate limit key scopes by route and connecting actor', () => {
  const request = new Request('https://worker.example/', {
    headers: { 'CF-Connecting-IP': '203.0.113.10' },
  });
  assert.equal(rateLimitKey(request, 'summarize'), 'summarize:203.0.113.10');
});
