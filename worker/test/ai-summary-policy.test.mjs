import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DETAILED_SUMMARY_MIN_CHARS,
  articleSummaryTextLength,
  needsDetailedSummaryConfirmation,
  getDetailedAISummary,
  saveDetailedAISummary,
} from '../../ai-summary-policy.mjs';

test('detailed summary warning threshold is 1200 effective characters', () => {
  assert.equal(DETAILED_SUMMARY_MIN_CHARS, 1200);
  assert.equal(needsDetailedSummaryConfirmation('甲'.repeat(1199)), true);
  assert.equal(needsDetailedSummaryConfirmation('甲'.repeat(1200)), false);
});

test('old detailed summaries are invalidated while new article-specific summaries remain cached', () => {
  const link = 'https://hk01.com/sns/article/123';
  const entries = new Map([
    ['metro_ai_detailed_summaries_v1', JSON.stringify({ [link]: { summary: '舊案件格式' } })],
  ]);
  const storage = { getItem: (k) => entries.get(k), setItem: (k, v) => entries.set(k, v) };
  assert.equal(getDetailedAISummary(link, storage), '');
  saveDetailedAISummary(link, '景點與交通', storage);
  assert.equal(getDetailedAISummary(link, storage), '景點與交通');
});

test('effective article length ignores markup and whitespace-only formatting', () => {
  assert.equal(articleSummaryTextLength('<p>甲</p>\n\n <div>乙</div>'), 2);
  assert.equal(articleSummaryTextLength('甲　乙\n丙'), 3);
});
