#!/usr/bin/env bash
set -euo pipefail

: "${CF_ACCOUNT_ID:?CF_ACCOUNT_ID is required}"
: "${CF_API_TOKEN:?CF_API_TOKEN is required}"

API="https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}"
AUTH=( -H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json" )
WORKER_ORIGIN="https://news-proxy.maxyu0725us.workers.dev"

cf_get() {
  local path="$1"
  local out="$2"
  local code
  code=$(curl -sS --retry 2 --retry-delay 1 -o "$out" -w '%{http_code}' "${AUTH[@]}" "${API}${path}")
  if [[ "$code" -lt 200 || "$code" -ge 300 ]] || [[ "$(jq -r '.success // false' "$out" 2>/dev/null || echo false)" != "true" ]]; then
    echo "::error::Cloudflare GET ${path} failed (HTTP ${code})"
    jq -c '{success,errors,messages}' "$out" 2>/dev/null || cat "$out"
    return 1
  fi
}

cf_raw_get() {
  local path="$1"
  local out="$2"
  local headers="$3"
  local code
  code=$(curl -sS --retry 2 --retry-delay 1 -D "$headers" -o "$out" -w '%{http_code}' "${AUTH[@]}" "${API}${path}")
  if [[ "$code" -lt 200 || "$code" -ge 300 ]]; then
    echo "::warning::Cloudflare raw GET ${path} failed (HTTP ${code})"
    return 1
  fi
}

cf_post() {
  local path="$1"
  local body="$2"
  local out="$3"
  local code
  code=$(curl -sS --retry 2 --retry-delay 1 -o "$out" -w '%{http_code}' -X POST "${AUTH[@]}" --data "$body" "${API}${path}")
  if [[ "$code" -lt 200 || "$code" -ge 300 ]] || [[ "$(jq -r '.success // false' "$out" 2>/dev/null || echo false)" != "true" ]]; then
    echo "::warning::Cloudflare POST ${path} failed (HTTP ${code})"
    jq -c '{success,errors,messages}' "$out" 2>/dev/null || cat "$out"
    return 1
  fi
}

d1_query() {
  local db_id="$1"
  local label="$2"
  local sql="$3"
  local out="/tmp/d1-query.json"
  local body
  body=$(jq -nc --arg sql "$sql" '{sql:$sql}')
  echo "$label"
  if cf_post "/d1/database/${db_id}/query" "$body" "$out"; then
    jq -c '.result[]?.results // []' "$out"
  fi
}

probe_article_url() {
  local label="$1"
  local target="$2"
  local out="/tmp/article-probe.json"
  local code
  code=$(curl -sS --max-time 15 -o "$out" -w '%{http_code}' -G \
    --data-urlencode "url=${target}" \
    "${WORKER_ORIGIN}/api/article-full" || true)
  echo "${label}: http=${code}"
  if jq -e . "$out" >/dev/null 2>&1; then
    jq -c '{success:(.success // null), error:(.error // null), content_chars:((.content // .text // "") | tostring | length)}' "$out"
  else
    echo '{"json":false}'
  fi
}

echo '## Workers inventory'
cf_get '/workers/scripts' /tmp/workers.json
jq -r '.result[] | [(.id // "?"),(.modified_on // "-"),(.compatibility_date // "-"),(.usage_model // "-")] | @tsv' /tmp/workers.json \
  | awk 'BEGIN {print "worker\tmodified_on\tcompatibility_date\tusage_model"} {print}'

mapfile -t WORKERS < <(jq -r '.result[].id' /tmp/workers.json)
for worker in "${WORKERS[@]}"; do
  echo
  echo "### Worker: ${worker}"

  if cf_get "/workers/scripts/${worker}/settings" /tmp/worker-settings.json; then
    echo 'Bindings (name/type only; secret values are never printed):'
    jq -r '.result.bindings // [] | if length == 0 then "(none)" else .[] | [(.name // "?"),(.type // "?"),(.id // .namespace_id // .bucket_name // .class_name // "-")] | @tsv end' /tmp/worker-settings.json
    echo 'Runtime settings:'
    jq -c '.result | {compatibility_date,compatibility_flags,usage_model,placement,observability,tail_consumers}' /tmp/worker-settings.json
  fi

  if cf_get "/workers/scripts/${worker}/deployments" /tmp/worker-deployments.json; then
    echo 'Latest deployment:'
    jq -c '.result.deployments[0] // .result[0] // {} | {id,created_on,source,versions}' /tmp/worker-deployments.json
  fi

  if cf_get "/workers/scripts/${worker}/schedules" /tmp/worker-schedules.json; then
    echo 'Cron schedules:'
    jq -c '.result // []' /tmp/worker-schedules.json
  fi

  if cf_raw_get "/workers/scripts/${worker}" /tmp/worker-source.bin /tmp/worker-source.headers; then
    echo 'Source static scan (source text and secret values are not printed):'
    grep -i '^content-type:' /tmp/worker-source.headers | tail -1 | tr -d '\r' || true
    python3 .github/scripts/cloudflare-source-audit.py /tmp/worker-source.bin
  fi
done

echo
echo '## Harmless public-edge security probes'
probe_article_url 'article-full non-HK01 control' 'https://example.com/'
probe_article_url 'article-full substring-bypass probe' 'https://example.com/?ref=https://www.hk01.com/'

echo 'CORS preflight for summarize from unrelated origin:'
curl -sS --max-time 10 -o /dev/null -D /tmp/cors-headers \
  -X OPTIONS \
  -H 'Origin: https://audit.invalid' \
  -H 'Access-Control-Request-Method: POST' \
  "${WORKER_ORIGIN}/api/summarize" || true
grep -Ei '^(HTTP/|access-control-allow-origin:|access-control-allow-methods:|access-control-allow-headers:)' /tmp/cors-headers \
  | tr -d '\r' || true

echo
echo '## D1 inventory'
cf_get '/d1/database?per_page=100' /tmp/d1.json
jq -r '.result[] | [(.uuid // .id // "?"),(.name // "?"),(.created_at // "-"),((.file_size // 0)|tostring),(.version // "-")] | @tsv' /tmp/d1.json \
  | awk 'BEGIN {print "database_id\tname\tcreated_at\tfile_size\tversion"} {print}'

mapfile -t DBS < <(jq -r '.result[] | [(.uuid // .id),.name] | @tsv' /tmp/d1.json)
for row in "${DBS[@]}"; do
  db_id="${row%%$'\t'*}"
  db_name="${row#*$'\t'}"
  echo
  echo "### D1: ${db_name} (${db_id})"

  schema_body=$(jq -nc --arg sql "SELECT type, name, tbl_name, sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') ORDER BY type, name" '{sql:$sql}')
  if cf_post "/d1/database/${db_id}/query" "$schema_body" /tmp/d1-schema.json; then
    echo 'Schema objects:'
    jq -r '.result[]?.results[]? | [(.type // "?"),(.name // "?"),(.tbl_name // "?"),(.sql // "-")] | @tsv' /tmp/d1-schema.json
  fi

  d1_query "$db_id" 'Article health:' "SELECT COUNT(*) AS total, COUNT(DISTINCT category) AS categories, COUNT(DISTINCT source) AS sources, SUM(CASE WHEN title IS NULL OR trim(title) = '' THEN 1 ELSE 0 END) AS missing_title, SUM(CASE WHEN link IS NULL OR trim(link) = '' THEN 1 ELSE 0 END) AS missing_link, SUM(CASE WHEN description IS NULL OR trim(description) = '' THEN 1 ELSE 0 END) AS missing_description, SUM(CASE WHEN imageUrl IS NULL OR trim(imageUrl) = '' THEN 1 ELSE 0 END) AS missing_imageUrl, SUM(CASE WHEN images IS NULL OR trim(images) = '' THEN 1 ELSE 0 END) AS missing_images FROM articles"
  d1_query "$db_id" 'Duplicate links:' "SELECT COUNT(*) AS duplicate_link_groups, COALESCE(SUM(c - 1), 0) AS duplicate_link_extra_rows FROM (SELECT COUNT(*) AS c FROM articles GROUP BY link HAVING c > 1)"
  d1_query "$db_id" 'Duplicate titles:' "SELECT COUNT(*) AS duplicate_title_groups, COALESCE(SUM(c - 1), 0) AS duplicate_title_extra_rows FROM (SELECT COUNT(*) AS c FROM articles GROUP BY title HAVING c > 1)"
  d1_query "$db_id" 'Category distribution:' "SELECT category, COUNT(*) AS total, MIN(pubDate) AS min_pubDate, MAX(pubDate) AS max_pubDate FROM articles GROUP BY category ORDER BY total DESC"
  d1_query "$db_id" 'Source distribution:' "SELECT source, COUNT(*) AS total FROM articles GROUP BY source ORDER BY total DESC"
  d1_query "$db_id" 'Recent inserted pubDate samples:' "SELECT pubDate, category, source FROM articles ORDER BY rowid DESC LIMIT 8"
  d1_query "$db_id" 'Query plan — category feed:' "EXPLAIN QUERY PLAN SELECT id,title,link,pubDate,description,category,source,imageUrl,images FROM articles WHERE category = '__audit__' ORDER BY pubDate DESC LIMIT 20"
  d1_query "$db_id" 'Query plan — global feed:' "EXPLAIN QUERY PLAN SELECT id,title,link,pubDate,description,category,source,imageUrl,images FROM articles ORDER BY pubDate DESC LIMIT 20"
done
