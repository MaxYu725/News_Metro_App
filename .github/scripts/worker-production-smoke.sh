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
jq -e '.success == true and (.data | type == "array")' "$tmp_body" >/dev/null
grep -Fqi "access-control-allow-origin: ${APP_ORIGIN}" "$tmp_headers"

echo 'Smoke: search remains readable'
request 200 -G \
  -H "Origin: ${APP_ORIGIN}" \
  --data-urlencode 'q=香港' \
  --data-urlencode 'page=0' \
  "${WORKER_ORIGIN}/api/search"
jq -e '.success == true and (.data | type == "array")' "$tmp_body" >/dev/null

# Rebuild archive rows under the new retention policy before asserting archive depth.
# The previous production version could legitimately leave only the newest video row
# after its concurrent sync/cleanup race, so checking video first creates a false failure.
echo 'Smoke: controlled full sync applies retention policy'
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
