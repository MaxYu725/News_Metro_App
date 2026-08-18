import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NEWS_SOURCES,
  parseSourceFilter,
  sourceFilterSql,
  sourceNamesForIds,
} from '../src/source-filter.js';

test('source filter defaults to all supported sources', () => {
  assert.deepEqual(parseSourceFilter(null), NEWS_SOURCES.map(source => source.id));
  assert.deepEqual(parseSourceFilter(''), NEWS_SOURCES.map(source => source.id));
});

test('source filter rejects unknown and empty selections', () => {
  assert.equal(parseSourceFilter('unknown'), null);
  assert.equal(parseSourceFilter(','), null);
});

test('source filter de-duplicates IDs and maps canonical names', () => {
  assert.deepEqual(parseSourceFilter('hk01,hk01'), ['hk01']);
  assert.deepEqual(sourceNamesForIds(['hk01', 'bastille']), ['香港01', '巴士的報']);
});

test('SQL filter is omitted for default/all sources and parameterized for a subset', () => {
  assert.deepEqual(sourceFilterSql('source', []), { sql: '', params: [] });
  assert.deepEqual(sourceFilterSql('source', ['香港01', '巴士的報']), { sql: '', params: [] });
  assert.deepEqual(sourceFilterSql('source', ['香港01']), { sql: ' AND source IN (?)', params: ['香港01'] });
});
