import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DETAILED_SUMMARY_MIN_CHARS,
  articleSummaryTextLength,
  needsDetailedSummaryConfirmation,
} from '../../ai-summary-policy.mjs';

test('detailed summary warning threshold is 1200 effective characters', () => {
  assert.equal(DETAILED_SUMMARY_MIN_CHARS, 1200);
  assert.equal(needsDetailedSummaryConfirmation('甲'.repeat(1199)), true);
  assert.equal(needsDetailedSummaryConfirmation('甲'.repeat(1200)), false);
});

test('effective article length ignores markup and whitespace-only formatting', () => {
  assert.equal(articleSummaryTextLength('<p>甲</p>\n\n <div>乙</div>'), 2);
  assert.equal(articleSummaryTextLength('甲　乙\n丙'), 3);
});
