import test from 'node:test';
import assert from 'node:assert/strict';

import {
  articleTextFromHtml,
  extractArticleMedia,
} from '../src/article-content.js';
import { parseRSS } from '../src/index.js';

const CAPTION = '同一組天氣圖的圖片說明。（AI 天氣模式）';

test('article HTML keeps image captions with media and removes them from body text', () => {
  const html = `
    <img src="https://cdn.example/hero.jpg">
    <p>第一段正文。</p>
    <figure>
      <figurecaption>${CAPTION}</figurecaption>
      <img src="https://cdn.example/chart-1.jpg" alt="${CAPTION}">
    </figure>
    <figure>
      <figurecaption>${CAPTION}</figurecaption>
      <img src="https://cdn.example/chart-2.jpg" alt="${CAPTION}">
    </figure>
    <p>第二段正文。</p>
  `;

  assert.deepEqual(extractArticleMedia(html), [
    { url: 'https://cdn.example/hero.jpg', caption: '' },
    { url: 'https://cdn.example/chart-1.jpg', caption: CAPTION },
    { url: 'https://cdn.example/chart-2.jpg', caption: CAPTION },
  ]);
  assert.equal(articleTextFromHtml(html), '第一段正文。\n\n第二段正文。');
});

test('HK01 RSS parser stores versionable media without leaking figure captions into description', () => {
  const encodedDescription = `
    &lt;img src=&quot;https://cdn.example/hero.jpg&quot;&gt;
    &lt;p&gt;第一段正文。&lt;/p&gt;
    &lt;figure&gt;
      &lt;figurecaption&gt;${CAPTION}&lt;/figurecaption&gt;
      &lt;img src=&quot;https://cdn.example/chart.jpg&quot; alt=&quot;${CAPTION}&quot;&gt;
    &lt;/figure&gt;
    &lt;p&gt;第二段正文。&lt;/p&gt;
  `;
  const xml = `<rss><channel><item>
    <title><![CDATA[圖片說明測試]]></title>
    <description><![CDATA[${encodedDescription}]]></description>
    <link>https://hk01.com/sns/article/123</link>
    <pubDate>Mon, 24 Aug 2026 05:02:14 GMT</pubDate>
  </item></channel></rss>`;

  const [article] = parseRSS(xml, '香港01', 'hot');
  assert.equal(article.description, '第一段正文。\n\n第二段正文。');
  assert.deepEqual(article.images, [
    'https://cdn.example/hero.jpg',
    'https://cdn.example/chart.jpg',
  ]);
  assert.deepEqual(article.media, [
    { url: 'https://cdn.example/hero.jpg', caption: '' },
    { url: 'https://cdn.example/chart.jpg', caption: CAPTION },
  ]);
});
