export const NEWS_SOURCES = Object.freeze([
  Object.freeze({ id: 'hk01', name: '香港01' }),
  Object.freeze({ id: 'bastille', name: '巴士的報' }),
]);

const SOURCE_BY_ID = new Map(NEWS_SOURCES.map(source => [source.id, source]));
const SOURCE_NAME_SET = new Set(NEWS_SOURCES.map(source => source.name));

export function parseSourceFilter(value) {
  if (value == null || String(value).trim() === '') return NEWS_SOURCES.map(source => source.id);
  const ids = [...new Set(String(value).split(',').map(part => part.trim()).filter(Boolean))];
  if (ids.length === 0 || ids.some(id => !SOURCE_BY_ID.has(id))) return null;
  return ids;
}

export function sourceNamesForIds(ids) {
  return (ids || []).map(id => SOURCE_BY_ID.get(id)?.name).filter(Boolean);
}

export function sourceFilterSql(column, names) {
  const unique = [...new Set((names || []).filter(name => SOURCE_NAME_SET.has(name)))];
  if (unique.length === NEWS_SOURCES.length) return { sql: '', params: [] };
  if (unique.length === 0) return { sql: ' AND 1 = 0', params: [] };
  return {
    sql: ` AND ${column} IN (${unique.map(() => '?').join(', ')})`,
    params: unique,
  };
}
