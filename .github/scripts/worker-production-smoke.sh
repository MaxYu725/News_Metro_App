#!/usr/bin/env bash
set -euo pipefail

WORKER_ORIGIN="${WORKER_ORIGIN:-https://news-proxy.maxyu0725us.workers.dev}"
APP_ORIGIN="${APP_ORIGIN:-https://maxyu725.github.io}"

tmp_body=$(mktemp)
tmp_headers=$(mktemp)
trap 'rm -f "$tmp_body" "$tmp_headers"' EXIT

request() {
  local expected="$1"
  shift
  : >"$tmp_body"
  : >"$tmp_headers"
  local status
  status=$(curl -sS --max-time 20 -D "$tmp_headers" -o "$tmp_body" -w '%{http_code}' "$@")
  if [[ "$status" != "$expected" ]]; then
    echo "Expected HTTP ${expected}, received ${status}" >&2
    cat "$tmp_body" >&2 || true
    return 1
  fi
}

echo 'Smoke: root health'
request 200 "${WORKER_ORIGIN}/"
grep -q 'Metro News D1 Database API is running' "$tmp_body"

echo 'Smoke: trusted CORS preflight'
request 204 -X OPTIONS \
  -H "Origin: ${APP_ORIGIN}" \
  -H 'Access-Control-Request-Method: POST' \
  "${WORKER_ORIGIN}/api/summarize"
grep -Fqi "access-control-allow-origin: ${APP_ORIGIN}" "$tmp_headers"
if grep -Fqi 'access-control-allow-origin: *' "$tmp_headers"; then
  echo 'Wildcard CORS was returned to trusted origin' >&2
  exit 1
fi

echo 'Smoke: hostile CORS preflight'
request 403 -X OPTIONS \
  -H 'Origin: https://audit.invalid' \
  -H 'Access-Control-Request-Method: POST' \
  "${WORKER_ORIGIN}/api/summarize"
if grep -qi '^access-control-allow-origin:' "$tmp_headers"; then
  echo 'Hostile origin received Access-Control-Allow-Origin' >&2
  exit 1
fi

echo 'Smoke: arbitrary article URL is blocked before fetch'
request 400 -G \
  -H "Origin: ${APP_ORIGIN}" \
  --data-urlencode 'url=https://example.com/?ref=https://www.hk01.com/123' \
  "${WORKER_ORIGIN}/api/article-full"
jq -e '.success == false' "$tmp_body" >/dev/null

echo 'Smoke: latest news remains readable'
request 200 -H "Origin: ${APP_ORIGIN}" "${WORKER_ORIGIN}/api/news/latest?page=0"
jq -e '.success == true and (.data | type == "array") and (.data | length > 0)' "$tmp_body" >/dev/null
grep -Fqi "access-control-allow-origin: ${APP_ORIGIN}" "$tmp_headers"
latest_id=$(jq -r '.data[0].id // .data[0].link // empty' "$tmp_body")
latest_title=$(jq -r '.data[0].title // empty' "$tmp_body")
search_probe=$(printf '%s' "$latest_title" | python3 -c 'import sys; print("".join(list(sys.stdin.read())[:6]))')
if [[ -z "$latest_id" || ${#search_probe} -lt 3 ]]; then
  echo 'Unable to derive FTS smoke probe from latest article' >&2
  exit 1
fi

echo 'Smoke: FTS5 trigram search finds a live article'
request 200 -G \
  -H "Origin: ${APP_ORIGIN}" \
  --data-urlencode "q=${search_probe}" \
  --data-urlencode 'page=0' \
  "${WORKER_ORIGIN}/api/search"
jq --arg id "$latest_id" -e '.success == true and (.data | type == "array") and any(.data[]; (.id == $id) or (.link == $id))' "$tmp_body" >/dev/null

echo 'Smoke: archive scope finds a known historical Bastille article'
request 200 -G \
  -H "Origin: ${APP_ORIGIN}" \
  --data-urlencode 'q=婦人油麻地' \
  --data-urlencode 'scope=all' \
  "${WORKER_ORIGIN}/api/search"
jq -e '.success == true and .scope == "all" and (.nextCursor | type == "string") and (.data | type == "array") and any(.data[]; .source == "巴士的報")' "$tmp_body" >/dev/null

echo 'Smoke: archive scope rejects malformed cursors'
request 400 -G \
  -H "Origin: ${APP_ORIGIN}" \
  --data-urlencode 'q=婦人油麻地' \
  --data-urlencode 'scope=all' \
  --data-urlencode 'cursor=not-a-valid-cursor' \
  "${WORKER_ORIGIN}/api/search"
jq -e '.success == false' "$tmp_body" >/dev/null

# Force one full sync so production exercises the adaptive retention size probe.
echo 'Smoke: controlled full sync preserves adaptive retention health'
status=$(curl -sS --max-time 90 -D "$tmp_headers" -o "$tmp_body" -w '%{http_code}' \
  -H "Origin: ${APP_ORIGIN}" \
  "${WORKER_ORIGIN}/api/news/latest?page=0&sync=1")
if [[ "$status" != '200' ]]; then
  echo "Expected force-sync HTTP 200, received ${status}" >&2
  cat "$tmp_body" >&2 || true
  exit 1
fi
jq -e '.success == true and (.data | type == "array")' "$tmp_body" >/dev/null

echo 'Smoke: image archive remains populated after controlled sync'
request 200 -H "Origin: ${APP_ORIGIN}" "${WORKER_ORIGIN}/api/news/video?page=0"
jq -e '.success == true and (.data | type == "array") and (.data | length > 1)' "$tmp_body" >/dev/null

echo 'Production Worker smoke tests: PASS'
