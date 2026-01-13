#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck disable=SC1091
source "${ROOT_DIR}/scripts/load_env.sh"

MONDAY_ITEM_ID="${MONDAY_ITEM_ID:-${1:-}}"
if [ -z "$MONDAY_ITEM_ID" ]; then
  echo "Missing MONDAY_ITEM_ID (env or arg)" >&2
  exit 1
fi

header_auth=("-H" "apikey: $SUPABASE_SERVICE_ROLE_KEY" "-H" "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

now_utc=$(date -u "+%Y-%m-%dT%H:%M:%SZ")
printf "LIVE CHECK (text-only)\n"
printf "NOW (UTC): %s\n\n" "$now_utc"

EVENTS_FILTER_URL="$SUPABASE_URL/rest/v1/events?select=event_type,at,site_slug,job_id,payload&event_type=in.(JOB_QUEUED,INTAKE_FAILED,JOB_STARTED,JOB_SUCCEEDED,JOB_FAILED,SITE_GENERATED,PIN_PUBLISHED,PIN_FAILED,CRON_TICK)&or=(payload->>monday_item_id.eq.${MONDAY_ITEM_ID},payload->>item_id.eq.${MONDAY_ITEM_ID})&order=at.desc&limit=15"
EVENTS_ALL_URL="$SUPABASE_URL/rest/v1/events?select=event_type,at,site_slug,job_id,payload&order=at.desc&limit=15"

events_json=$(curl -sS "$EVENTS_FILTER_URL" "${header_auth[@]}")

printf "Latest Monday-related events (last 15, truncated):\n"
if [ "$events_json" = "[]" ] || [ -z "$events_json" ]; then
  events_json=$(curl -sS "$EVENTS_ALL_URL" "${header_auth[@]}")
  printf "%s" "$events_json" | head -c 1200
  printf "\n\n"
  printf "Grep monday_item_id in last 15 events (may be empty):\n"
  printf "%s" "$events_json" | rg -n "$MONDAY_ITEM_ID" || true
else
  printf "%s" "$events_json" | head -c 1200
fi
printf "\n\n"

site_slug=$(EVENTS_JSON="$events_json" node -e '
const events = JSON.parse(process.env.EVENTS_JSON || "[]");
let slug = "";
for (const e of events) {
  if (e && e.site_slug) { slug = e.site_slug; break; }
  const p = e && e.payload ? e.payload : {};
  if (p && (p.site_slug || p.slug)) { slug = p.site_slug || p.slug; break; }
}
console.log(slug || "");
')

if [ -z "$site_slug" ]; then
  site_slug=$(curl -sS "$SUPABASE_URL/rest/v1/sites?select=slug,status,updated_at,published_url&monday_item_id=eq.${MONDAY_ITEM_ID}&limit=1" "${header_auth[@]}" \
    | node -e 'const fs=require("fs"); const d=JSON.parse(fs.readFileSync(0,"utf8")||"[]"); console.log((d[0]&&d[0].slug)||"");')
fi

if [ -n "$site_slug" ]; then
  printf "Site row summary (truncated):\n"
  curl -sS "$SUPABASE_URL/rest/v1/sites?select=slug,status,updated_at,published_url&slug=eq.${site_slug}&limit=1" "${header_auth[@]}" | head -c 400
  printf "\n\n"

  printf "Latest jobs for site (truncated):\n"
  curl -sS "$SUPABASE_URL/rest/v1/jobs?select=id,type,status,updated_at,last_error&site_slug=eq.${site_slug}&order=updated_at.desc&limit=5" "${header_auth[@]}" | head -c 600
  printf "\n\n"

  printf "site_public HEAD (first 12 lines):\n"
  curl -sI "https://ndzrxomconvvrvwkgnor.functions.supabase.co/site_public/${site_slug}" | head -n 12
else
  printf "Site row summary: missing site_slug\n\n"
  printf "Latest jobs for site: missing site_slug\n\n"
  printf "site_public HEAD: missing site_slug\n"
fi

printf "\nops_console (first 120 lines):\n"
curl -sS "https://ndzrxomconvvrvwkgnor.functions.supabase.co/ops_console" \
  -H "x-ops-secret: $OPS_SECRET" | head -n 120
