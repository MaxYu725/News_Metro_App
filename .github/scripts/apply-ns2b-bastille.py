#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def replace_once(path, old, new):
    file = ROOT / path
    text = file.read_text('utf-8')
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected exactly one match, found {text.count(old)}')
    file.write_text(text.replace(old, new, 1), 'utf-8')


# Worker integration
replace_once(
    'worker/src/index.js',
    "import { enforceAdaptiveRetention } from './retention.js';\n",
    "import { enforceAdaptiveRetention } from './retention.js';\nimport { fetchBastilleArticles, isBastilleSource } from './sources/bastille.js';\n",
)

old_sync = """async function syncCategoryToDB(category, env) {
  const targetSources = topicSources[category];
  if (!targetSources) return;

  const resultsArray = await Promise.all(targetSources.map(sourceConfig => fetchFromSource(sourceConfig, category)));
  const combinedNews = resultsArray.flat();
  if (combinedNews.length === 0) return;

  const statements = combinedNews.map(item =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO articles (id, title, link, pubDate, description, category, source, imageUrl, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      item.id,
      item.title,
      item.link,
      item.pubDate,
      item.description,
      item.category,
      item.source,
      item.imageUrl || '',
      JSON.stringify(item.images || []),
    ),
  );

  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    await env.DB.batch(statements.slice(i, i + chunkSize));
  }
}

async function syncAllCategoriesAndRetention(env) {
  await Promise.all(Object.keys(topicSources).map(cat => syncCategoryToDB(cat, env)));
  await enforceAdaptiveRetention(env.DB);
}
"""
new_sync = """async function insertArticles(items, env) {
  if (!Array.isArray(items) || items.length === 0) return;

  const statements = items.map(item =>
    env.DB.prepare(
      `INSERT OR IGNORE INTO articles (id, title, link, pubDate, description, category, source, imageUrl, images) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      item.id,
      item.title,
      item.link,
      item.pubDate,
      item.description,
      item.category,
      item.source,
      item.imageUrl || '',
      JSON.stringify(item.images || []),
    ),
  );

  const chunkSize = 50;
  for (let i = 0; i < statements.length; i += chunkSize) {
    await env.DB.batch(statements.slice(i, i + chunkSize));
  }
}

async function syncCategoryToDB(category, env) {
  const targetSources = topicSources[category];
  if (!targetSources) return;

  const resultsArray = await Promise.all(targetSources.map(sourceConfig => fetchFromSource(sourceConfig, category)));
  await insertArticles(resultsArray.flat(), env);
}

async function syncBastilleToDB(env, requestedCategory = null) {
  if (requestedCategory === 'video') return;

  const articles = await fetchBastilleArticles();
  const eligible = requestedCategory
    ? articles.filter(item => item.category === requestedCategory)
    : articles;

  if (eligible.length === 0) {
    console.warn('rss-source-empty', {
      category: requestedCategory || 'mixed',
      source: '巴士的報',
      timeoutMs: 15000,
      urlCount: 1,
    });
    return;
  }

  await insertArticles(eligible, env);
}

async function syncAllCategoriesAndRetention(env) {
  await Promise.all([
    Promise.all(Object.keys(topicSources).map(cat => syncCategoryToDB(cat, env))),
    syncBastilleToDB(env),
  ]);
  await enforceAdaptiveRetention(env.DB);
}

function formatArticleRow(row) {
  let images = [];
  try {
    images = row.images ? JSON.parse(row.images) : [];
  } catch {
    images = [];
  }
  return {
    ...row,
    images,
    isFullContentLoaded: isBastilleSource(row.source),
  };
}
"""
replace_once('worker/src/index.js', old_sync, new_sync)

replace_once(
    'worker/src/index.js',
    "return jsonResponse(request, { success: false, error: '只允許 HTTPS 香港01文章 URL' }, 400);",
    "return jsonResponse(request, { success: false, error: '只允許已支援新聞來源的 HTTPS 文章 URL' }, 400);",
)
replace_once(
    'worker/src/index.js',
    "        let fullText = '';\n        const hk01Match = targetUrl.pathname.match(/(?:^|\\/)(\\d+)(?:\\/|$)/);\n",
    "        let fullText = '';\n        const isHk01Article = targetUrl.hostname === 'hk01.com' || targetUrl.hostname === 'www.hk01.com';\n        const hk01Match = isHk01Article ? targetUrl.pathname.match(/(?:^|\\/)(\\d+)(?:\\/|$)/) : null;\n",
)
replace_once(
    'worker/src/index.js',
    "const formattedResults = rows.map(row => ({ ...row, images: row.images ? JSON.parse(row.images) : [] }));",
    "const formattedResults = rows.map(formatArticleRow);",
)
replace_once(
    'worker/src/index.js',
    "const formattedResults = results.map(row => ({ ...row, images: row.images ? JSON.parse(row.images) : [] }));",
    "const formattedResults = results.map(formatArticleRow);",
)
replace_once(
    'worker/src/index.js',
    "              await syncCategoryToDB(category, env);\n              if (forceSync) await enforceAdaptiveRetention(env.DB);",
    "              await Promise.all([\n                syncCategoryToDB(category, env),\n                syncBastilleToDB(env, category),\n              ]);\n              if (forceSync) await enforceAdaptiveRetention(env.DB);",
)

# Security allowlist
replace_once(
    'worker/src/security.js',
    "const ARTICLE_HOSTNAMES = new Set(['hk01.com', 'www.hk01.com']);",
    "const ARTICLE_HOSTNAMES = new Set(['hk01.com', 'www.hk01.com', 'bastillepost.com', 'www.bastillepost.com']);",
)

replace_once(
    'worker/test/security.test.mjs',
    "test('article URL allowlist accepts only HTTPS HK01 hosts', () => {\n  assert.equal(parseAllowedArticleUrl('https://www.hk01.com/article/123')?.hostname, 'www.hk01.com');\n  assert.equal(parseAllowedArticleUrl('https://hk01.com/123')?.hostname, 'hk01.com');\n",
    "test('article URL allowlist accepts only supported HTTPS publisher hosts', () => {\n  assert.equal(parseAllowedArticleUrl('https://www.hk01.com/article/123')?.hostname, 'www.hk01.com');\n  assert.equal(parseAllowedArticleUrl('https://hk01.com/123')?.hostname, 'hk01.com');\n  assert.equal(parseAllowedArticleUrl('https://www.bastillepost.com/hongkong/article/123-test')?.hostname, 'www.bastillepost.com');\n  assert.equal(parseAllowedArticleUrl('https://bastillepost.com/hongkong/article/123-test')?.hostname, 'bastillepost.com');\n",
)
replace_once(
    'worker/test/security.test.mjs',
    "    'https://hk01.com.evil.example/123',\n",
    "    'https://hk01.com.evil.example/123',\n    'https://bastillepost.com.evil.example/123',\n",
)

# Source-aware production D1 audit
replace_once(
    '.github/scripts/worker-production-d1-audit.sh',
    "COUNT(DISTINCT source) AS source_count,",
    "COUNT(DISTINCT source) AS source_count, SUM(CASE WHEN source = '香港01' THEN 1 ELSE 0 END) AS hk01_rows, SUM(CASE WHEN source = '巴士的報' THEN 1 ELSE 0 END) AS bastille_rows, SUM(CASE WHEN source = '巴士的報' AND category = 'video' THEN 1 ELSE 0 END) AS bastille_video_rows,",
)
replace_once(
    '.github/scripts/worker-production-d1-audit.sh',
    "const sources = Number(row.source_count || 0);\n",
    "const sources = Number(row.source_count || 0);\nconst hk01Rows = Number(row.hk01_rows || 0);\nconst bastilleRows = Number(row.bastille_rows || 0);\nconst bastilleVideoRows = Number(row.bastille_video_rows || 0);\n",
)
replace_once(
    '.github/scripts/worker-production-d1-audit.sh',
    "if (sources < 1) throw new Error('expected at least one source');\n",
    "if (sources < 2) throw new Error(`expected at least two sources after controlled sync, got ${sources}`);\nif (hk01Rows <= 0) throw new Error('香港01 rows are missing');\nif (bastilleRows <= 0) throw new Error('巴士的報 rows are missing after controlled sync');\nif (bastilleVideoRows !== 0) throw new Error(`巴士的報 must not populate video; got ${bastilleVideoRows}`);\n",
)
replace_once(
    '.github/scripts/worker-production-d1-audit.sh',
    "console.log(`D1 production health: total=${total}, video=${video}, categories=${categories}, sources=${sources}, fts_table=${ftsTables}, fts_triggers=${ftsTriggers}, size_bytes=${sizeBytes}, utilization_pct=${utilization}, retention_last_size=${lastCleanupSize}, retention_last_deleted=${lastDeletedRows}, retention_last_mode=${lastMode}`);",
    "console.log(`D1 production health: total=${total}, video=${video}, categories=${categories}, sources=${sources}, hk01=${hk01Rows}, bastille=${bastilleRows}, bastille_video=${bastilleVideoRows}, fts_table=${ftsTables}, fts_triggers=${ftsTriggers}, size_bytes=${sizeBytes}, utilization_pct=${utilization}, retention_last_size=${lastCleanupSize}, retention_last_deleted=${lastDeletedRows}, retention_last_mode=${lastMode}`);",
)

# Baseline validator: ensure source contract cannot disappear silently.
replace_once(
    '.github/scripts/validate-worker-baseline.py',
    "    retention = (WORKER / \"src\" / \"retention.js\").read_text(\"utf-8\")\n",
    "    retention = (WORKER / \"src\" / \"retention.js\").read_text(\"utf-8\")\n    bastille = (WORKER / \"src\" / \"sources\" / \"bastille.js\").read_text(\"utf-8\")\n",
)
replace_once(
    '.github/scripts/validate-worker-baseline.py',
    "    if \"targetUrl.includes('hk01.com')\" in combined:\n        fail(\"unsafe HK01 substring allowlist must not be reintroduced\")\n",
    "    if \"targetUrl.includes('hk01.com')\" in combined:\n        fail(\"unsafe HK01 substring allowlist must not be reintroduced\")\n\n    # NS2B: second source must stay source-specific and use the existing schema.\n    for signal in [\n        \"BASTILLE_SOURCE_NAME = '巴士的報'\",\n        \"https://www.bastillepost.com/hongkong/feed\",\n        \"parseBastilleRss\",\n        \"resolveBastilleCategory\",\n        \"content:encoded\",\n    ]:\n        if signal not in bastille:\n            fail(f\"Bastille provider signal missing: {signal}\")\n    for signal in [\n        \"fetchBastilleArticles\",\n        \"syncBastilleToDB\",\n        \"isFullContentLoaded: isBastilleSource(row.source)\",\n    ]:\n        if signal not in source:\n            fail(f\"Bastille integration signal missing: {signal}\")\n    if \"bastillepost.com\" not in security:\n        fail(\"Bastille article hostname allowlist is missing\")\n",
)

# Frontend: make source identity visible and skip redundant full-text fetch via API flag.
replace_once(
    'app.js',
    "                <p class=\"text-xs text-white/25 mt-2 tracking-wide\">來源：HK01</p>",
    "                <p class=\"text-xs text-white/25 mt-2 tracking-wide\">來源：香港01 · 巴士的報</p>",
)
replace_once(
    'app.js',
    "        const catName = categoryMap[news.category] || news.category || '即時';\n        const deck = deckText(news);\n",
    "        const catName = categoryMap[news.category] || news.category || '即時';\n        const sourceName = stripHtml(news.source || '香港01');\n        const deck = deckText(news);\n",
)
replace_once(
    'app.js',
    "                            <span class=\"text-xs font-bold tracking-wider uppercase ${currentThemeText}\">${catName}</span>\n                            <span class=\"feed-ai-indicator",
    "                            <span class=\"text-xs font-bold tracking-wider uppercase ${currentThemeText}\">${catName}</span>\n                            <span class=\"text-[10px] text-white/35 tracking-wider\">· ${escapeHtml(sourceName)}</span>\n                            <span class=\"feed-ai-indicator",
)

replace_once(
    'reader-ui.js',
    "function readerCategory(tile, article, state) {\n    const fresh = tile.querySelector('.fresh-label')?.textContent?.trim();\n    if (fresh) return `${fresh.replace(/^●\\s*/, '')} · ${state.category}`;\n    return state.category || article.category || '新聞';\n}\n",
    "function readerCategory(tile, article, state) {\n    const fresh = tile.querySelector('.fresh-label')?.textContent?.trim();\n    const source = article.source || '香港01';\n    const category = state.category || article.category || '新聞';\n    if (fresh) return `${fresh.replace(/^●\\s*/, '')} · ${source} · ${category}`;\n    return `${source} · ${category}`;\n}\n",
)

# PWA shell update for source-label UI.
replace_once(
    'sw.js',
    "const SHELL_CACHE = 'metro-news-shell-v26-hd-gesture';",
    "const SHELL_CACHE = 'metro-news-shell-v27-bastille';",
)

print('NS2B integration patch applied')
