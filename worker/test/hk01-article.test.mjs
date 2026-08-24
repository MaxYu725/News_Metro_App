import test from 'node:test';
import assert from 'node:assert/strict';

import { parseHk01ArticlePayload } from '../src/sources/hk01-article.js';

test('current HK01 article payload separates text blocks from image captions', () => {
  const parsed = parseHk01ArticlePayload({
    article: {
      teaser: ['導言。'],
      originalImage: {
        cdnUrl: 'https://cdn.example/hero.jpg',
        caption: '',
      },
      blocks: [
        { blockType: 'related', articles: [] },
        {
          blockType: 'text',
          htmlTokens: [[
            { type: 'boldText', content: '第一段' },
            { type: 'text', content: '正文。' },
          ]],
        },
        {
          blockType: 'image',
          image: {
            cdnUrl: 'https://cdn.example/chart-1.jpg',
            caption: '第一張圖說。',
          },
        },
        {
          blockType: 'gallery',
          images: [
            { cdnUrl: 'https://cdn.example/chart-2.jpg', caption: '圖集說明。' },
            { cdnUrl: 'https://cdn.example/chart-3.jpg', caption: '圖集說明。' },
          ],
        },
        { blockType: 'summary', summary: ['第二段正文。'] },
      ],
    },
  });

  assert.equal(parsed.content, '導言。\n\n第一段正文。\n\n第二段正文。');
  assert.doesNotMatch(parsed.content, /圖說|圖集說明/);
  assert.deepEqual(parsed.media, [
    { url: 'https://cdn.example/hero.jpg', caption: '' },
    { url: 'https://cdn.example/chart-1.jpg', caption: '第一張圖說。' },
    { url: 'https://cdn.example/chart-2.jpg', caption: '圖集說明。' },
    { url: 'https://cdn.example/chart-3.jpg', caption: '圖集說明。' },
  ]);
});
