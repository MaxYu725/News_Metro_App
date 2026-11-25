#!/usr/bin/env bash
set -euo pipefail
# Provision only the fixed fourth archive, using existing production credentials.
# Do not modify any Worker bindings, existing databases, or account plan here.
: "${CLOUDFLARE_ACCOUNT_ID:?missing Cloudflare account ID}"
: "${CLOUDFLARE_API_TOKEN:?missing Cloudflare API token}"
name=metro_news_archive_04
api="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/d1/database"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
request() {
  local output="$1"; shift
  local status
  status="$(curl -sS --max-time 45 -o "$output" -w '%{http_code}' \
    -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$@")"
  if [[ "$status" != 2* ]] || ! jq -e '.success == true' "$output" >/dev/null; then
    echo "::error::Cloudflare D1 API failed (HTTP $status)"
    jq -c '[.errors[]? | {code,message}]' "$output" >&2 || true
    exit 1
  fi
}
request "$tmp/list.json" "$api?per_page=100&page=1"
jq -e '.result | type == "array"' "$tmp/list.json" >/dev/null
count="$(jq '.result | length' "$tmp/list.json")"
matches="$(jq --arg name "$name" '[.result[] | select(.name == $name)] | length' "$tmp/list.json")"
if [[ "$matches" == 1 ]]; then
  uuid="$(jq -r --arg name "$name" '.result[] | select(.name == $name) | .uuid' "$tmp/list.json")"
  action=reused
elif [[ "$matches" == 0 ]]; then
  if (( count >= 10 )); then
    echo "::error::D1 free-plan 10-database guard reached; no new database created."
    exit 1
  fi
  request "$tmp/create.json" -X POST -H 'Content-Type: application/json' \
    --data '{"name":"metro_news_archive_04","read_replication":{"mode":"disabled"}}' "$api"
  jq -e --arg name "$name" '.result.name == $name' "$tmp/create.json" >/dev/null
  uuid="$(jq -r '.result.uuid' "$tmp/create.json")"
  action=created
else
  echo '::error::Ambiguous archive04 database name; no changes made.'
  exit 1
fi
[[ "$uuid" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]] || { echo '::error::Invalid database UUID'; exit 1; }
echo "ARCHIVE_04 provisioned: action=$action database_name=$name database_id=$uuid"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
  printf '## Archive 04 provision\n- Action: %s\n- Database: %s\n- UUID: %s\n- No Worker bindings or migrations were changed.\n' "$action" "$name" "$uuid" >> "$GITHUB_STEP_SUMMARY"
fi
